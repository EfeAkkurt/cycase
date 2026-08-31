import type { PersistedCommand, RunStatus } from '../../shared/apiContract';
import type { ScenarioVersionStatus } from '../../shared/scenarioPlan';
import type { TelemetryEvent } from '../../shared/apiContract';

/**
 * The persistence seam.
 *
 * Everything above this interface is deterministic and testable without a
 * database; everything below is SQL. The in-memory implementation is not a
 * shortcut — it is the reference semantics that `PostgresRunRepository` has to
 * match, and both are exercised by the same suite of expectations.
 */

export interface RunRecord {
  id: string;
  writeTokenHash: string;
  scenarioId: string;
  scenarioVersion: number;
  status: RunStatus;
  lastSeq: number;
  stateVersion: number;
  stateHash: string;
  ending: string | null;
  score: { total: number; max: number; buckets: Record<string, number> } | null;
  clientBuild: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface NewRun {
  id: string;
  writeTokenHash: string;
  scenarioId: string;
  scenarioVersion: number;
  stateHash: string;
  clientBuild: string;
  createdAt: string;
  expiresAt: string;
}

/** One command as it is handed to the repository for insertion. */
export interface NewCommand extends PersistedCommand {
  runId: string;
  idempotencyKeyHash: string | null;
}

/** The run fields a verified append advances. Applied atomically with the rows. */
export interface RunAdvance {
  lastSeq: number;
  stateVersion: number;
  stateHash: string;
  status: RunStatus;
  ending: string | null;
  score: RunRecord['score'];
  updatedAt: string;
}

export interface ScenarioVersionRecord {
  scenarioId: string;
  version: number;
  schemaVersion: number;
  status: ScenarioVersionStatus;
  plan: unknown;
  validation: unknown;
  promptVersion: string | null;
  modelId: string | null;
  createdAt: string;
  publishedAt: string | null;
}

/**
 * Raised when a batch cannot be applied. The route turns it into a controlled
 * `CONFLICT`; the message never reaches the client verbatim.
 */
export class SequenceConflictError extends Error {
  readonly expectedSeq: number;

  constructor(expectedSeq: number) {
    super(`expected seq ${expectedSeq}`);
    this.name = 'SequenceConflictError';
    this.expectedSeq = expectedSeq;
  }
}

export interface RunRepository {
  ping(): Promise<boolean>;

  createRun(run: NewRun): Promise<RunRecord>;
  getRun(runId: string): Promise<RunRecord | null>;

  listCommands(runId: string, after: number, limit: number): Promise<PersistedCommand[]>;
  /** Every command, ordered by seq. Used to rebuild the replay seed. */
  allCommands(runId: string): Promise<PersistedCommand[]>;

  /** Looks up an already-acknowledged append by its transport idempotency key. */
  findCommandByIdempotencyHash(
    runId: string,
    idempotencyKeyHash: string,
  ): Promise<PersistedCommand | null>;

  /**
   * Appends a contiguous, already-verified batch and advances the run in one
   * transaction. Throws `SequenceConflictError` if the first sequence is not
   * `lastSeq + 1` at commit time, so a concurrent append cannot interleave.
   */
  appendCommands(
    runId: string,
    commands: readonly NewCommand[],
    advance: RunAdvance,
  ): Promise<void>;

  /** Deletes runs whose `expiresAt` has passed. Returns the number removed. */
  purgeExpired(now: string): Promise<number>;

  saveScenarioVersion(record: ScenarioVersionRecord): Promise<void>;
  getScenarioVersion(scenarioId: string, version: number): Promise<ScenarioVersionRecord | null>;

  appendTelemetryEvents(runId: string, events: readonly TelemetryEvent[]): Promise<number>;
  listTelemetryEvents(runId: string, afterSequence: number): Promise<TelemetryEvent[]>;
}

/* ------------------------------------------------------------------ *
 * In-memory implementation
 * ------------------------------------------------------------------ */

export class InMemoryRunRepository implements RunRepository {
  private readonly runs = new Map<string, RunRecord>();
  private readonly commands = new Map<string, PersistedCommand[]>();
  private readonly idempotency = new Map<string, number>();
  private readonly scenarios = new Map<string, ScenarioVersionRecord>();
  private readonly telemetry = new Map<string, TelemetryEvent[]>();

  /** Set by a test to simulate a database outage. */
  failNext: Error | null = null;
  healthy = true;

  private guard(): void {
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }
  }

  async ping(): Promise<boolean> {
    return this.healthy;
  }

  async createRun(run: NewRun): Promise<RunRecord> {
    this.guard();
    const record: RunRecord = {
      ...run,
      status: 'active',
      lastSeq: 0,
      stateVersion: 0,
      ending: null,
      score: null,
      updatedAt: run.createdAt,
    };
    this.runs.set(run.id, record);
    this.commands.set(run.id, []);
    return { ...record };
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    this.guard();
    const record = this.runs.get(runId);
    return record ? { ...record } : null;
  }

  async listCommands(runId: string, after: number, limit: number): Promise<PersistedCommand[]> {
    this.guard();
    const rows = this.commands.get(runId) ?? [];
    return rows.filter((row) => row.seq > after).slice(0, limit).map((row) => ({ ...row }));
  }

  async allCommands(runId: string): Promise<PersistedCommand[]> {
    this.guard();
    return (this.commands.get(runId) ?? []).map((row) => ({ ...row }));
  }

  async findCommandByIdempotencyHash(
    runId: string,
    idempotencyKeyHash: string,
  ): Promise<PersistedCommand | null> {
    this.guard();
    const seq = this.idempotency.get(`${runId}::${idempotencyKeyHash}`);
    if (seq === undefined) return null;
    const row = (this.commands.get(runId) ?? []).find((command) => command.seq === seq);
    return row ? { ...row } : null;
  }

  async appendCommands(
    runId: string,
    commands: readonly NewCommand[],
    advance: RunAdvance,
  ): Promise<void> {
    this.guard();
    const run = this.runs.get(runId);
    if (!run) throw new SequenceConflictError(1);

    const rows = this.commands.get(runId) ?? [];
    const first = commands[0];
    if (!first || first.seq !== run.lastSeq + 1) {
      throw new SequenceConflictError(run.lastSeq + 1);
    }

    // Staged, then committed in one step: a mid-batch failure must leave the
    // store exactly as it was, which is the property the batch test asserts.
    const staged: PersistedCommand[] = [];
    const stagedKeys: string[] = [];
    for (const [index, command] of commands.entries()) {
      if (command.seq !== run.lastSeq + 1 + index) {
        throw new SequenceConflictError(run.lastSeq + 1);
      }
      if (command.idempotencyKeyHash) {
        const key = `${runId}::${command.idempotencyKeyHash}`;
        if (this.idempotency.has(key) || stagedKeys.includes(key)) {
          throw new SequenceConflictError(run.lastSeq + 1);
        }
        stagedKeys.push(key);
      }
      const { runId: _runId, idempotencyKeyHash: _hash, ...row } = command;
      staged.push(row);
    }

    rows.push(...staged);
    this.commands.set(runId, rows);
    for (const [index, key] of stagedKeys.entries()) {
      const owner = commands.find((command) => `${runId}::${command.idempotencyKeyHash}` === key);
      this.idempotency.set(key, owner?.seq ?? staged[index]!.seq);
    }
    this.runs.set(runId, { ...run, ...advance });
  }

  async purgeExpired(now: string): Promise<number> {
    this.guard();
    let removed = 0;
    for (const [id, run] of this.runs) {
      if (run.expiresAt <= now) {
        this.runs.delete(id);
        this.commands.delete(id);
        this.telemetry.delete(id);
        for (const key of [...this.idempotency.keys()]) {
          if (key.startsWith(`${id}::`)) this.idempotency.delete(key);
        }
        removed += 1;
      }
    }
    return removed;
  }

  async saveScenarioVersion(record: ScenarioVersionRecord): Promise<void> {
    this.guard();
    const key = `${record.scenarioId}::${record.version}`;
    const existing = this.scenarios.get(key);
    // §8: published versions are immutable.
    if (existing?.status === 'published') {
      throw new Error('published scenario versions are immutable');
    }
    this.scenarios.set(key, { ...record });
  }

  async getScenarioVersion(
    scenarioId: string,
    version: number,
  ): Promise<ScenarioVersionRecord | null> {
    this.guard();
    const record = this.scenarios.get(`${scenarioId}::${version}`);
    return record ? { ...record } : null;
  }

  async appendTelemetryEvents(runId: string, events: readonly TelemetryEvent[]): Promise<number> {
    this.guard();
    const existing = this.telemetry.get(runId) ?? [];
    const seenIds = new Set(existing.map((event) => event.eventId));
    const seenSeq = new Set(existing.map((event) => event.sequence));
    let inserted = 0;
    for (const event of events) {
      // Unique on (run_id, event_id) and (run_id, sequence), per §8.
      if (seenIds.has(event.eventId) || seenSeq.has(event.sequence)) continue;
      existing.push({ ...event });
      seenIds.add(event.eventId);
      seenSeq.add(event.sequence);
      inserted += 1;
    }
    existing.sort((a, b) => a.sequence - b.sequence);
    this.telemetry.set(runId, existing);
    return inserted;
  }

  async listTelemetryEvents(runId: string, afterSequence: number): Promise<TelemetryEvent[]> {
    this.guard();
    return (this.telemetry.get(runId) ?? [])
      .filter((event) => event.sequence > afterSequence)
      .map((event) => ({ ...event }));
  }
}
