import { describe, expect, it } from 'vitest';

import {
  PostgresRunRepository,
  type SqlClient,
  type SqlPool,
  type SqlResult,
} from '../../../server/persistence/postgresRepository';
import { SequenceConflictError, type NewCommand } from '../../../server/persistence/repository';

/**
 * The PostgreSQL adapter, tested against a recording fake.
 *
 * Stated plainly: **no live PostgreSQL runs in this environment**, so these
 * tests verify the adapter's SQL and mapping, not the database's behaviour.
 * That split is deliberate rather than a compromise — the guarantees the
 * database owns (the `(run_id, seq)` primary key and the partial unique index)
 * are declared in `schema.sql` and cannot be asserted without a server, while
 * the guarantees the *adapter* owns are exactly what a fake can check: that it
 * takes the row lock before reading `last_seq`, that it refuses a non-contiguous
 * batch before writing anything, that a unique violation becomes a controlled
 * `SequenceConflictError`, and that a mid-batch failure aborts the transaction.
 *
 * `tests/backend/integration` runs the same expectations against the in-memory
 * repository through the real HTTP stack.
 */

interface Recorded {
  text: string;
  params: readonly unknown[];
}

class FakePool implements SqlPool {
  readonly statements: Recorded[] = [];
  /** Rows returned for the next query matching a substring. */
  responses = new Map<string, SqlResult>();
  failOn: { match: string; error: Error } | null = null;
  transactionCommitted = false;
  transactionRolledBack = false;

  async query<Row = Record<string, unknown>>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<SqlResult<Row>> {
    this.statements.push({ text, params });
    if (this.failOn && text.includes(this.failOn.match)) throw this.failOn.error;
    for (const [match, result] of this.responses) {
      if (text.includes(match)) return result as SqlResult<Row>;
    }
    return { rows: [], rowCount: 0 };
  }

  async transaction<T>(fn: (client: SqlClient) => Promise<T>): Promise<T> {
    try {
      const value = await fn(this);
      this.transactionCommitted = true;
      return value;
    } catch (error) {
      this.transactionRolledBack = true;
      throw error;
    }
  }

  find(substring: string): Recorded | undefined {
    return this.statements.find((statement) => statement.text.includes(substring));
  }
}

function command(seq: number, overrides: Partial<NewCommand> = {}): NewCommand {
  return {
    runId: 'run_x',
    seq,
    kind: 'inspect_artifact',
    origin: 'human',
    input: { artifactId: 'art_email_001' },
    result: { ok: true, stateVersion: seq },
    incidentAtSec: 100 + seq,
    stateVersionBefore: seq - 1,
    stateVersionAfter: seq,
    idempotencyKeyHash: null,
    createdAt: '2026-08-29T00:00:00.000Z',
    ...overrides,
  };
}

const advance = {
  lastSeq: 2,
  stateVersion: 2,
  stateHash: `sha256:${'a'.repeat(64)}`,
  status: 'active' as const,
  ending: null,
  score: null,
  updatedAt: '2026-08-29T00:00:01.000Z',
};

describe('PostgresRunRepository', () => {
  it('reports health from a trivial query and never throws', async () => {
    const pool = new FakePool();
    const repo = new PostgresRunRepository(pool);
    expect(await repo.ping()).toBe(true);

    pool.failOn = { match: 'SELECT 1', error: new Error('connection refused') };
    expect(await repo.ping()).toBe(false);
  });

  it('inserts a run with a hashed token and maps the row back', async () => {
    const pool = new FakePool();
    pool.responses.set('INSERT INTO runs', {
      rows: [
        {
          id: 'run_x',
          write_token_hash: 'b'.repeat(64),
          scenario_id: 'CASE-001',
          scenario_version: 1,
          status: 'active',
          last_seq: 0,
          state_version: 0,
          state_hash: `sha256:${'c'.repeat(64)}`,
          ending: null,
          score_json: null,
          client_build: 'v0.1.0',
          created_at: new Date('2026-08-29T00:00:00.000Z'),
          updated_at: new Date('2026-08-29T00:00:00.000Z'),
          expires_at: new Date('2026-09-05T00:00:00.000Z'),
        },
      ],
    });

    const repo = new PostgresRunRepository(pool);
    const run = await repo.createRun({
      id: 'run_x',
      writeTokenHash: 'b'.repeat(64),
      scenarioId: 'CASE-001',
      scenarioVersion: 1,
      stateHash: `sha256:${'c'.repeat(64)}`,
      clientBuild: 'v0.1.0',
      createdAt: '2026-08-29T00:00:00.000Z',
      expiresAt: '2026-09-05T00:00:00.000Z',
    });

    expect(run.lastSeq).toBe(0);
    expect(run.createdAt).toBe('2026-08-29T00:00:00.000Z');
    // The parameter list carries the hash; the plaintext token never appears.
    expect(pool.find('INSERT INTO runs')!.params).toContain('b'.repeat(64));
  });

  it('takes a row lock before reading last_seq, so two appenders cannot both win', async () => {
    const pool = new FakePool();
    pool.responses.set('FOR UPDATE', { rows: [{ last_seq: 0, status: 'active' }] });

    const repo = new PostgresRunRepository(pool);
    await repo.appendCommands('run_x', [command(1), command(2)], advance);

    const lock = pool.find('FOR UPDATE');
    expect(lock).toBeDefined();
    expect(pool.statements.indexOf(lock!)).toBe(0);
    expect(pool.transactionCommitted).toBe(true);
  });

  it('rejects a batch that does not start at last_seq + 1 without inserting', async () => {
    const pool = new FakePool();
    pool.responses.set('FOR UPDATE', { rows: [{ last_seq: 5, status: 'active' }] });

    const repo = new PostgresRunRepository(pool);
    await expect(repo.appendCommands('run_x', [command(9)], advance)).rejects.toBeInstanceOf(
      SequenceConflictError,
    );
    expect(pool.find('INSERT INTO run_commands')).toBeUndefined();
    expect(pool.transactionRolledBack).toBe(true);
  });

  it('rejects a non-contiguous batch', async () => {
    const pool = new FakePool();
    pool.responses.set('FOR UPDATE', { rows: [{ last_seq: 0, status: 'active' }] });
    const repo = new PostgresRunRepository(pool);
    await expect(
      repo.appendCommands('run_x', [command(1), command(3)], advance),
    ).rejects.toBeInstanceOf(SequenceConflictError);
  });

  it('turns a unique violation into a sequence conflict and rolls the batch back', async () => {
    const pool = new FakePool();
    pool.responses.set('FOR UPDATE', { rows: [{ last_seq: 0, status: 'active' }] });
    const violation = Object.assign(new Error('duplicate key'), { code: '23505' });
    pool.failOn = { match: 'INSERT INTO run_commands', error: violation };

    const repo = new PostgresRunRepository(pool);
    await expect(repo.appendCommands('run_x', [command(1)], advance)).rejects.toBeInstanceOf(
      SequenceConflictError,
    );
    expect(pool.transactionRolledBack).toBe(true);
    expect(pool.find('UPDATE runs')).toBeUndefined();
  });

  it('re-raises a non-unique database error rather than mislabelling it a conflict', async () => {
    const pool = new FakePool();
    pool.responses.set('FOR UPDATE', { rows: [{ last_seq: 0, status: 'active' }] });
    pool.failOn = {
      match: 'INSERT INTO run_commands',
      error: Object.assign(new Error('disk full'), { code: '53100' }),
    };

    const repo = new PostgresRunRepository(pool);
    await expect(repo.appendCommands('run_x', [command(1)], advance)).rejects.toThrow('disk full');
  });

  it('advances the run only after every insert', async () => {
    const pool = new FakePool();
    pool.responses.set('FOR UPDATE', { rows: [{ last_seq: 0, status: 'active' }] });
    const repo = new PostgresRunRepository(pool);
    await repo.appendCommands('run_x', [command(1), command(2)], advance);

    const texts = pool.statements.map((statement) => statement.text);
    const lastInsert = texts.map((t) => t.includes('INSERT INTO run_commands')).lastIndexOf(true);
    const update = texts.findIndex((t) => t.includes('UPDATE runs'));
    expect(update).toBeGreaterThan(lastInsert);
  });

  it('stores the idempotency key hash, never the key', async () => {
    const pool = new FakePool();
    pool.responses.set('FOR UPDATE', { rows: [{ last_seq: 0, status: 'active' }] });
    const repo = new PostgresRunRepository(pool);
    await repo.appendCommands(
      'run_x',
      [command(1, { idempotencyKeyHash: 'd'.repeat(64) })],
      { ...advance, lastSeq: 1, stateVersion: 1 },
    );
    expect(pool.find('INSERT INTO run_commands')!.params).toContain('d'.repeat(64));
  });

  it('pages the command log by seq with a bounded limit', async () => {
    const pool = new FakePool();
    const repo = new PostgresRunRepository(pool);
    await repo.listCommands('run_x', 10, 25);
    const statement = pool.find('FROM run_commands')!;
    expect(statement.text).toContain('seq > $2');
    expect(statement.text).toContain('ORDER BY seq ASC');
    expect(statement.params).toEqual(['run_x', 10, 25]);
  });

  it('deletes expired runs by timestamp and reports the count', async () => {
    const pool = new FakePool();
    pool.responses.set('DELETE FROM runs', { rows: [], rowCount: 4 });
    const repo = new PostgresRunRepository(pool);
    expect(await repo.purgeExpired('2026-09-05T00:00:00.000Z')).toBe(4);
    expect(pool.find('DELETE FROM runs')!.text).toContain('expires_at <= $1');
  });

  it('inserts telemetry with ON CONFLICT DO NOTHING, so duplicates are free', async () => {
    const pool = new FakePool();
    pool.responses.set('INSERT INTO telemetry_events', { rows: [], rowCount: 1 });
    const repo = new PostgresRunRepository(pool);
    const inserted = await repo.appendTelemetryEvents('run_x', [
      {
        eventId: 'evt_1',
        sequence: 1,
        scenarioTimeSec: 0,
        source: 'system',
        severity: 'info',
        entityIds: [],
        kind: 'test',
        payload: {},
        emittedAt: '2026-08-29T00:00:00.000Z',
      },
    ]);
    expect(inserted).toBe(1);
    expect(pool.find('INSERT INTO telemetry_events')!.text).toContain('ON CONFLICT DO NOTHING');
  });
});

describe('schema.sql declares what the adapter relies on', () => {
  it('has the primary key, the partial unique index and the immutability trigger', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath, URL: NodeUrl } = await import('node:url');
    const path = fileURLToPath(
      new NodeUrl('../../../server/persistence/schema.sql', import.meta.url),
    );
    const sql = readFileSync(path, 'utf8');

    expect(sql).toContain('PRIMARY KEY (run_id, seq)');
    expect(sql).toContain('run_commands_idempotency_idx');
    expect(sql).toContain('WHERE idempotency_key_hash IS NOT NULL');
    expect(sql).toContain('PRIMARY KEY (run_id, event_id)');
    expect(sql).toContain('telemetry_events_sequence_idx');
    expect(sql).toContain('published scenario versions are immutable');
    expect(sql).toContain('write_token_hash  CHAR(64)');
  });
});
