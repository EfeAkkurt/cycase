import { createInitialContext } from '../game/context';
import { executeCommand } from '../game/engine';
import type { GameCommand, GameContext } from '../game/types';
import { API_LIMITS } from '../../shared/apiContract';
import { hashContext } from '../../shared/runSignature';
import { BackendRequestError, type BackendClient } from './client';
import { contiguousSuffix, createMemoryQueue, type OfflineQueue } from './offlineQueue';
import { runtimeModeStore, type RuntimeModeStore } from './runtimeMode';
import type { QueuedCommand, RunExport, RunHandle } from './types';

/**
 * Mirrors the browser's command log to the backend (contract §9).
 *
 * The design in one sentence: the engine keeps playing, this class watches
 * `GameContext.commandLog` grow, and everything else — queueing, uploading,
 * conflict handling — happens behind the game rather than in front of it.
 *
 * Two decisions are worth stating because they are what make the contract's
 * "browser is the only rules engine" claim survive contact with persistence:
 *
 * 1. **This class never sends a command into the runtime.** It is
 *    write-only with respect to gameplay. A backend response can freeze sync
 *    or change a label; it can never change case state.
 * 2. **It derives every submission by re-executing the log through the same
 *    engine.** That shadow replay is compared with the live context's hash
 *    before anything is uploaded, so a divergence between the live run and its
 *    own replay is caught in the browser, offline, rather than surfacing later
 *    as a server-side `REPLAY_MISMATCH` nobody can diagnose.
 */

export interface TokenStore {
  get(runId: string): string | null;
  set(runId: string, token: string): void;
  clear(runId: string): void;
}

/**
 * §9/§10: the write token lives in `sessionStorage` for the tab's lifetime.
 * Not `localStorage` (it would outlive the tab and survive a shared machine),
 * not IndexedDB (that is the persisted queue, and the token must never be
 * persisted next to command payloads).
 */
export function createSessionTokenStore(
  storage: Storage | undefined = typeof sessionStorage === 'undefined' ? undefined : sessionStorage,
): TokenStore {
  const memory = new Map<string, string>();
  const key = (runId: string) => `cycase.runToken.${runId}`;

  return {
    get(runId) {
      if (!storage) return memory.get(runId) ?? null;
      try {
        return storage.getItem(key(runId));
      } catch {
        return memory.get(runId) ?? null;
      }
    },
    set(runId, token) {
      memory.set(runId, token);
      try {
        storage?.setItem(key(runId), token);
      } catch {
        /* A private-mode profile may refuse. The in-memory copy still works. */
      }
    },
    clear(runId) {
      memory.delete(runId);
      try {
        storage?.removeItem(key(runId));
      } catch {
        /* ignore */
      }
    },
  };
}

/** The minimum surface `RunSyncController` needs. Keeps `GameRuntime` untouched. */
export interface RuntimeLike {
  readonly context: GameContext;
  subscribe(listener: () => void): { unsubscribe: () => void };
}

export interface RunSyncOptions {
  runtime: RuntimeLike;
  /** `null` means local mode. No client is constructed and no request is made. */
  client: BackendClient | null;
  clientBuild: string;
  queue?: OfflineQueue;
  tokens?: TokenStore;
  store?: RuntimeModeStore;
  operatorName?: string;
}

export class RunSyncController {
  private readonly runtime: RuntimeLike;
  private readonly client: BackendClient | null;
  private readonly clientBuild: string;
  private readonly queue: OfflineQueue;
  private readonly tokens: TokenStore;
  private readonly store: RuntimeModeStore;

  /** The shadow replay of everything observed so far. */
  private shadow: GameContext;
  private observedLogLength = 0;
  private handle: RunHandle | null = null;
  private subscription: { unsubscribe: () => void } | null = null;
  private flushing = false;
  private frozen = false;
  private freezeReason = '';
  private lastAcknowledgedSeq = 0;
  private lastServerHash: string | null = null;
  private pendingFlush: Promise<void> = Promise.resolve();

  constructor(options: RunSyncOptions) {
    this.runtime = options.runtime;
    this.client = options.client;
    this.clientBuild = options.clientBuild;
    this.queue = options.queue ?? createMemoryQueue();
    this.tokens = options.tokens ?? createSessionTokenStore();
    this.store = options.store ?? runtimeModeStore;
    this.shadow = createInitialContext(options.operatorName);
  }

  /**
   * Begins mirroring.
   *
   * In local mode this subscribes to the runtime and returns without touching
   * the network — the queue still records, so enabling a backend later can
   * upload a run that started offline.
   */
  async start(): Promise<void> {
    this.subscription = this.runtime.subscribe(() => {
      void this.observe();
    });
    await this.observe();

    if (!this.client) {
      this.store.set({ mode: 'local', sync: 'idle' });
      return;
    }

    try {
      const created = await this.client.createRun(this.clientBuild);
      this.handle = {
        runId: created.runId,
        expiresAt: created.expiresAt,
        initialStateHash: created.initialStateHash,
      };
      this.tokens.set(created.runId, created.writeToken);
      await this.queue.setRunHandle(this.handle);
      this.store.set({ mode: 'connected', sync: 'syncing' });
      await this.flush();
    } catch {
      // §5 `degraded`: the local adapter continues and commands queue locally.
      this.store.set({ mode: 'degraded', sync: 'queued' });
    }
  }

  stop(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }

  get runId(): string | null {
    return this.handle?.runId ?? null;
  }

  /* ---------------------------------------------------------------- *
   * Observation
   * ---------------------------------------------------------------- */

  /**
   * Turns newly logged commands into queue entries.
   *
   * Reading the *log* rather than `lastResult` is what makes this correct under
   * batching: if two commands land between two notifications, both are derived,
   * in order, with their own intermediate state hashes.
   */
  private async observe(): Promise<void> {
    const derived = this.derive();
    if (derived.length === 0) return;
    if (this.frozen) return;

    for (const command of derived) await this.queue.enqueue(command);

    const pending = await this.queue.pending();
    this.store.set({ queuedCommands: pending.length });

    if (this.client && !this.frozen) void this.scheduleFlush();
  }

  /**
   * The synchronous half of observation.
   *
   * Everything that reads or writes `shadow`, `observedLogLength` and the
   * live/replay comparison happens here, in one uninterrupted block. That is
   * not tidiness: a player can issue several commands inside one synchronous
   * turn, and an `await` between advancing the shadow and comparing it would
   * let a second invocation move the shadow past the snapshot the first one
   * captured — which reads exactly like a determinism failure and would freeze
   * a perfectly healthy run.
   */
  private derive(): QueuedCommand[] {
    const live = this.runtime.context;
    const log = live.commandLog;
    if (log.length <= this.observedLogLength) return [];

    const derived: QueuedCommand[] = [];
    for (let index = this.observedLogLength; index < log.length; index += 1) {
      const entry = log[index]!;
      const before = this.shadow.stateVersion;
      const outcome = executeCommand(this.shadow, {
        kind: entry.kind,
        input: entry.input,
        origin: entry.origin,
      } as GameCommand);
      this.shadow = outcome.context;

      const { seq: _seq, ...result } = outcome.result;
      derived.push({
        seq: index + 1,
        kind: entry.kind,
        origin: entry.origin,
        input: entry.input,
        incidentAtSec: entry.atSec,
        stateVersionBefore: before,
        stateVersionAfter: this.shadow.stateVersion,
        result,
        clientStateHash: hashContext(this.shadow),
        // Deterministic transport key: retrying an append cannot apply twice,
        // and it is derived from the seq rather than from the gameplay
        // idempotency key, which is stable by design and would collide.
        idempotencyKey: `append.${index + 1}`,
      });
    }
    this.observedLogLength = log.length;

    // The local self-check, still inside the synchronous block: `this.shadow`
    // and `live` are now the same number of commands deep by construction.
    // A disagreement here means the engine is not deterministic for this run,
    // and uploading would be worse than stopping — so sync freezes and
    // gameplay carries on untouched.
    if (hashContext(this.shadow) !== hashContext(live)) {
      this.freeze('The live run and its local replay disagree.');
      return [];
    }

    return derived;
  }

  /* ---------------------------------------------------------------- *
   * Upload
   * ---------------------------------------------------------------- */

  private scheduleFlush(): Promise<void> {
    // Serialised: two overlapping flushes would both read the same `last_seq`
    // and upload the same suffix, which the server would reject as a conflict.
    this.pendingFlush = this.pendingFlush.then(() => this.flush()).catch(() => {});
    return this.pendingFlush;
  }

  /**
   * Uploads the contiguous missing suffix, exactly once.
   *
   * The server's `last_seq` is authoritative about what it already has, so the
   * flush always starts by reading it. That is what makes a reconnect after an
   * outage upload the *missing* suffix rather than the whole run.
   */
  async flush(): Promise<void> {
    if (!this.client || !this.handle || this.frozen || this.flushing) return;
    const token = this.tokens.get(this.handle.runId);
    if (!token) return;

    this.flushing = true;
    try {
      const summary = await this.client.getRun(this.handle.runId, token);
      this.lastAcknowledgedSeq = summary.lastSeq;
      this.lastServerHash = summary.replaySignature;
      await this.queue.acknowledge(summary.lastSeq);

      const pending = await this.queue.pending();
      const suffix = contiguousSuffix(pending, summary.lastSeq + 1);
      if (suffix.length === 0) {
        this.store.set({
          mode: 'connected',
          sync: 'synced',
          queuedCommands: 0,
          lastAcknowledgedSeq: summary.lastSeq,
        });
        return;
      }

      this.store.set({ mode: 'connected', sync: 'syncing' });

      for (let offset = 0; offset < suffix.length; offset += API_LIMITS.maxBatchCommands) {
        const chunk = suffix.slice(offset, offset + API_LIMITS.maxBatchCommands);
        const acknowledged =
          chunk.length === 1
            ? await this.client
                .appendCommand(this.handle.runId, token, chunk[0]!)
                .then((data) => ({ lastSeq: data.lastSeq, stateHash: data.stateHash }))
            : await this.client
                .appendBatch(this.handle.runId, token, chunk)
                .then((data) => ({ lastSeq: data.lastSeq, stateHash: data.stateHash }));

        this.lastAcknowledgedSeq = acknowledged.lastSeq;
        this.lastServerHash = acknowledged.stateHash;
        await this.queue.acknowledge(acknowledged.lastSeq);
      }

      const remaining = await this.queue.pending();
      this.store.set({
        mode: 'connected',
        sync: remaining.length === 0 ? 'synced' : 'queued',
        queuedCommands: remaining.length,
        lastAcknowledgedSeq: this.lastAcknowledgedSeq,
      });
    } catch (error) {
      this.handleFlushError(error);
    } finally {
      this.flushing = false;
    }
  }

  private handleFlushError(error: unknown): void {
    if (!(error instanceof BackendRequestError)) {
      this.store.set({ mode: 'degraded', sync: 'queued' });
      return;
    }

    switch (error.detail.code) {
      case 'REPLAY_MISMATCH':
        // §9: never auto-overwrite either history.
        this.freeze('The server replay does not match the local run.');
        return;
      case 'UNAUTHORIZED':
        // An expired or revoked run. Local gameplay is untouched; persistence
        // simply stops being available for the rest of this session.
        this.store.set({ mode: 'degraded', sync: 'queued' });
        return;
      case 'CONFLICT':
        // Someone else advanced the run. The next flush re-reads `last_seq` and
        // uploads from there, so no special handling is needed beyond retrying.
        this.store.set({ mode: 'connected', sync: 'queued' });
        return;
      default:
        this.store.set({ mode: 'degraded', sync: 'queued' });
    }
  }

  /* ---------------------------------------------------------------- *
   * Review and export
   * ---------------------------------------------------------------- */

  private freeze(reason: string): void {
    this.frozen = true;
    this.freezeReason = reason;
    this.store.freezeForReview(reason);
  }

  get isFrozen(): boolean {
    return this.frozen;
  }

  /**
   * The JSON offered when sync freezes (§9).
   *
   * It carries both hashes and the full local command log, which is exactly
   * what a person needs to decide which history is right — and deliberately
   * carries no token.
   */
  async exportRun(): Promise<RunExport> {
    const pending = await this.queue.pending();
    return {
      exportedAt: new Date().toISOString(),
      runId: this.handle?.runId ?? null,
      clientBuild: this.clientBuild,
      reason: this.freezeReason || 'manual export',
      localStateHash: hashContext(this.runtime.context),
      serverStateHash: this.lastServerHash,
      commands: pending,
    };
  }

  /** Everything derived so far, for tests and for the export path. */
  async queued(): Promise<QueuedCommand[]> {
    return this.queue.pending();
  }

  /**
   * Resolves once observation and upload have caught up with the command log.
   *
   * Observation is fire-and-forget by design — a player's click must never wait
   * on IndexedDB or on the network — which leaves no promise for a caller to
   * await. This gives one: it drains the flush chain until the queue is empty
   * or stops shrinking. Tests use it; so could a "sync now before you close the
   * tab" affordance.
   */
  async idle(maxRounds = 60): Promise<void> {
    if (!this.client || this.frozen) return;

    let previous = -1;
    for (let round = 0; round < maxRounds; round += 1) {
      await this.pendingFlush.catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 0));

      const pending = await this.queue.pending();
      if (pending.length === 0 && !this.flushing) return;
      if (this.frozen) return;

      // No progress in a whole round and nothing in flight: the backend is not
      // accepting these commands, and waiting longer will not change that.
      if (pending.length === previous && !this.flushing) {
        void this.scheduleFlush();
      }
      previous = pending.length;
    }
  }
}
