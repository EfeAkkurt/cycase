import type { PersistedCommand, RunStatus, TelemetryEvent } from '../../shared/apiContract';
import type { ScenarioVersionRecord } from './repository';
import {
  SequenceConflictError,
  type NewCommand,
  type NewRun,
  type RunAdvance,
  type RunRecord,
  type RunRepository,
} from './repository';

/**
 * PostgreSQL implementation of `RunRepository`.
 *
 * It talks to an injected `SqlClient` rather than importing `pg` directly. That
 * is not ceremony: it keeps `pg` an optional dependency (so `tsc -b` and
 * `vite build` stay clean on a machine that never installs it), and it makes
 * the SQL — which is the part that actually carries the contract's uniqueness
 * and transactionality guarantees — testable against a recording fake.
 */

export interface SqlResult<Row = Record<string, unknown>> {
  rows: Row[];
  rowCount?: number | null;
}

export interface SqlClient {
  query<Row = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<SqlResult<Row>>;
}

export interface SqlPool extends SqlClient {
  /** Runs `fn` inside a single connection wrapped in BEGIN/COMMIT. */
  transaction<T>(fn: (client: SqlClient) => Promise<T>): Promise<T>;
}

/** Postgres error code for a unique/PK violation. */
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === UNIQUE_VIOLATION;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

interface RunRow {
  id: string;
  write_token_hash: string;
  scenario_id: string;
  scenario_version: number;
  status: string;
  last_seq: number;
  state_version: number;
  state_hash: string;
  ending: string | null;
  score_json: RunRecord['score'];
  client_build: string;
  created_at: unknown;
  updated_at: unknown;
  expires_at: unknown;
}

interface CommandRow {
  seq: number;
  kind: string;
  origin: 'human' | 'agent';
  input_json: unknown;
  result_json: unknown;
  incident_at_sec: number;
  state_version_before: number;
  state_version_after: number;
  created_at: unknown;
}

function mapRun(row: RunRow): RunRecord {
  return {
    id: row.id,
    writeTokenHash: row.write_token_hash,
    scenarioId: row.scenario_id,
    scenarioVersion: Number(row.scenario_version),
    status: row.status as RunStatus,
    lastSeq: Number(row.last_seq),
    stateVersion: Number(row.state_version),
    stateHash: row.state_hash,
    ending: row.ending,
    score: row.score_json ?? null,
    clientBuild: row.client_build,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    expiresAt: toIso(row.expires_at),
  };
}

function mapCommand(row: CommandRow): PersistedCommand {
  return {
    seq: Number(row.seq),
    kind: row.kind,
    origin: row.origin,
    input: row.input_json,
    incidentAtSec: Number(row.incident_at_sec),
    stateVersionBefore: Number(row.state_version_before),
    stateVersionAfter: Number(row.state_version_after),
    result: row.result_json,
    createdAt: toIso(row.created_at),
  };
}

export class PostgresRunRepository implements RunRepository {
  private readonly pool: SqlPool;

  constructor(pool: SqlPool) {
    this.pool = pool;
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async createRun(run: NewRun): Promise<RunRecord> {
    const { rows } = await this.pool.query<RunRow>(
      `INSERT INTO runs (
         id, write_token_hash, scenario_id, scenario_version, status,
         last_seq, state_version, state_hash, client_build, created_at, updated_at, expires_at
       ) VALUES ($1, $2, $3, $4, 'active', 0, 0, $5, $6, $7, $7, $8)
       RETURNING *`,
      [
        run.id,
        run.writeTokenHash,
        run.scenarioId,
        run.scenarioVersion,
        run.stateHash,
        run.clientBuild,
        run.createdAt,
        run.expiresAt,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error('insert returned no row');
    return mapRun(row);
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    const { rows } = await this.pool.query<RunRow>('SELECT * FROM runs WHERE id = $1', [runId]);
    const row = rows[0];
    return row ? mapRun(row) : null;
  }

  async listCommands(runId: string, after: number, limit: number): Promise<PersistedCommand[]> {
    const { rows } = await this.pool.query<CommandRow>(
      `SELECT seq, kind, origin, input_json, result_json, incident_at_sec,
              state_version_before, state_version_after, created_at
         FROM run_commands
        WHERE run_id = $1 AND seq > $2
        ORDER BY seq ASC
        LIMIT $3`,
      [runId, after, limit],
    );
    return rows.map(mapCommand);
  }

  async allCommands(runId: string): Promise<PersistedCommand[]> {
    const { rows } = await this.pool.query<CommandRow>(
      `SELECT seq, kind, origin, input_json, result_json, incident_at_sec,
              state_version_before, state_version_after, created_at
         FROM run_commands
        WHERE run_id = $1
        ORDER BY seq ASC`,
      [runId],
    );
    return rows.map(mapCommand);
  }

  async findCommandByIdempotencyHash(
    runId: string,
    idempotencyKeyHash: string,
  ): Promise<PersistedCommand | null> {
    const { rows } = await this.pool.query<CommandRow>(
      `SELECT seq, kind, origin, input_json, result_json, incident_at_sec,
              state_version_before, state_version_after, created_at
         FROM run_commands
        WHERE run_id = $1 AND idempotency_key_hash = $2`,
      [runId, idempotencyKeyHash],
    );
    const row = rows[0];
    return row ? mapCommand(row) : null;
  }

  async appendCommands(
    runId: string,
    commands: readonly NewCommand[],
    advance: RunAdvance,
  ): Promise<void> {
    const first = commands[0];
    if (!first) return;

    await this.pool.transaction(async (client) => {
      // `FOR UPDATE` serialises concurrent appends to the same run: the second
      // transaction blocks here and then sees the first one's last_seq, so the
      // contiguity check below cannot be won by both.
      const locked = await client.query<{ last_seq: number; status: string }>(
        'SELECT last_seq, status FROM runs WHERE id = $1 FOR UPDATE',
        [runId],
      );
      const run = locked.rows[0];
      if (!run) throw new SequenceConflictError(1);

      const expected = Number(run.last_seq) + 1;
      if (first.seq !== expected) throw new SequenceConflictError(expected);

      for (const [index, command] of commands.entries()) {
        if (command.seq !== expected + index) throw new SequenceConflictError(expected);
        try {
          await client.query(
            `INSERT INTO run_commands (
               run_id, seq, kind, origin, input_json, result_json, incident_at_sec,
               state_version_before, state_version_after, idempotency_key_hash, created_at
             ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11)`,
            [
              runId,
              command.seq,
              command.kind,
              command.origin,
              JSON.stringify(command.input ?? null),
              JSON.stringify(command.result ?? null),
              command.incidentAtSec,
              command.stateVersionBefore,
              command.stateVersionAfter,
              command.idempotencyKeyHash,
              command.createdAt,
            ],
          );
        } catch (error) {
          // Either (run_id, seq) or (run_id, idempotency_key_hash) collided.
          // Both mean "someone already wrote this"; the transaction rolls back,
          // so nothing from this batch survives.
          if (isUniqueViolation(error)) throw new SequenceConflictError(expected);
          throw error;
        }
      }

      await client.query(
        `UPDATE runs
            SET last_seq = $2, state_version = $3, state_hash = $4,
                status = $5, ending = $6, score_json = $7::jsonb, updated_at = $8
          WHERE id = $1`,
        [
          runId,
          advance.lastSeq,
          advance.stateVersion,
          advance.stateHash,
          advance.status,
          advance.ending,
          advance.score ? JSON.stringify(advance.score) : null,
          advance.updatedAt,
        ],
      );
    });
  }

  async purgeExpired(now: string): Promise<number> {
    const result = await this.pool.query('DELETE FROM runs WHERE expires_at <= $1', [now]);
    return result.rowCount ?? 0;
  }

  async saveScenarioVersion(record: ScenarioVersionRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO scenario_versions (
         scenario_id, version, schema_version, status, plan_json, validation_json,
         prompt_version, model_id, created_at, published_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10)
       ON CONFLICT (scenario_id, version) DO UPDATE
         SET status = EXCLUDED.status,
             plan_json = EXCLUDED.plan_json,
             validation_json = EXCLUDED.validation_json,
             published_at = EXCLUDED.published_at`,
      [
        record.scenarioId,
        record.version,
        record.schemaVersion,
        record.status,
        JSON.stringify(record.plan),
        JSON.stringify(record.validation),
        record.promptVersion,
        record.modelId,
        record.createdAt,
        record.publishedAt,
      ],
    );
  }

  async getScenarioVersion(
    scenarioId: string,
    version: number,
  ): Promise<ScenarioVersionRecord | null> {
    const { rows } = await this.pool.query<Record<string, unknown>>(
      'SELECT * FROM scenario_versions WHERE scenario_id = $1 AND version = $2',
      [scenarioId, version],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      scenarioId: String(row.scenario_id),
      version: Number(row.version),
      schemaVersion: Number(row.schema_version),
      status: row.status as ScenarioVersionRecord['status'],
      plan: row.plan_json,
      validation: row.validation_json,
      promptVersion: (row.prompt_version as string | null) ?? null,
      modelId: (row.model_id as string | null) ?? null,
      createdAt: toIso(row.created_at),
      publishedAt: row.published_at ? toIso(row.published_at) : null,
    };
  }

  async appendTelemetryEvents(runId: string, events: readonly TelemetryEvent[]): Promise<number> {
    let inserted = 0;
    for (const event of events) {
      const result = await this.pool.query(
        `INSERT INTO telemetry_events (
           run_id, event_id, sequence, scenario_time_sec, source, severity,
           entity_ids_json, kind, payload_json, emitted_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10)
         ON CONFLICT DO NOTHING`,
        [
          runId,
          event.eventId,
          event.sequence,
          event.scenarioTimeSec,
          event.source,
          event.severity,
          JSON.stringify(event.entityIds),
          event.kind,
          JSON.stringify(event.payload),
          event.emittedAt,
        ],
      );
      inserted += result.rowCount ?? 0;
    }
    return inserted;
  }

  async listTelemetryEvents(runId: string, afterSequence: number): Promise<TelemetryEvent[]> {
    const { rows } = await this.pool.query<Record<string, unknown>>(
      `SELECT event_id, sequence, scenario_time_sec, source, severity,
              entity_ids_json, kind, payload_json, emitted_at
         FROM telemetry_events
        WHERE run_id = $1 AND sequence > $2
        ORDER BY sequence ASC`,
      [runId, afterSequence],
    );
    return rows.map((row) => ({
      eventId: String(row.event_id),
      sequence: Number(row.sequence),
      scenarioTimeSec: Number(row.scenario_time_sec),
      source: row.source as TelemetryEvent['source'],
      severity: row.severity as TelemetryEvent['severity'],
      entityIds: (row.entity_ids_json as string[]) ?? [],
      kind: String(row.kind),
      payload: (row.payload_json as TelemetryEvent['payload']) ?? {},
      emittedAt: toIso(row.emitted_at),
    }));
  }
}

/**
 * Lazily loads `pg` and wraps a `Pool` as a `SqlPool`.
 *
 * The specifier is a variable so the bundler never follows it and TypeScript
 * never demands `@types/pg` — `pg` is an optional dependency that only a hosted
 * deployment installs. Nothing in the browser build path reaches this function.
 */
export async function createPostgresPool(connectionString: string): Promise<SqlPool> {
  const specifier = 'pg';
  const mod = await import(/* @vite-ignore */ specifier);
  const PoolCtor = (mod.default ?? mod).Pool as new (config: unknown) => {
    query: SqlClient['query'];
    connect: () => Promise<SqlClient & { release: () => void }>;
    end: () => Promise<void>;
  };

  const pool = new PoolCtor({ connectionString, max: 10, idleTimeoutMillis: 30_000 });

  return {
    query: (text, params) => pool.query(text, params),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const value = await fn(client);
        await client.query('COMMIT');
        return value;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
