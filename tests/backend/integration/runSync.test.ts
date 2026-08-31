import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { replayHistory, signatureHash } from '../../../server/services/replayVerifier';
import { hashContext } from '../../../shared/runSignature';
import { BackendClient } from '../../../src/backend/client';
import { createIndexedDbQueue } from '../../../src/backend/offlineQueue';
import { RunSyncController, createSessionTokenStore } from '../../../src/backend/runSync';
import { RuntimeModeStore, statusLabel } from '../../../src/backend/runtimeMode';
import { bootRuntime, PERFECT_RUN } from '../helpers/run';
import { createHarness, type Harness } from '../helpers/server';

/**
 * The offline queue and the server, together.
 *
 * These tests drive the real `RunSyncController` against the real routes, with
 * `fetch` bridged to `app.inject`. That bridge is the only fake: the sync
 * layer, the HTTP pipeline, the verifier and the repository are all the
 * production ones, so a green run here means the reconnect path in §9 actually
 * works rather than merely type-checking.
 */

function injectFetch(harness: Harness, control: { offline: boolean }): typeof fetch {
  return (async (input: string, init: RequestInit = {}) => {
    if (control.offline) throw new TypeError('Failed to fetch');
    const url = new URL(String(input));
    const response = await harness.app.inject({
      method: (init.method ?? 'GET') as 'GET' | 'POST',
      url: `${url.pathname}${url.search}`,
      headers: init.headers as Record<string, string>,
      payload: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(response.payload, {
      status: response.statusCode,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

function play(runtime: ReturnType<typeof bootRuntime>, from: number, to: number): void {
  for (const [index, step] of PERFECT_RUN.slice(from, to).entries()) {
    runtime.send({ type: 'TICK', seconds: 4 });
    runtime.getIncident('agent');
    const input: Record<string, unknown> = { ...step.input, stateVersion: runtime.stateVersion };
    if (step.kind === 'take_response_action' || step.kind === 'submit_decision') {
      input.idempotencyKey = `sync:${from + index}`;
    }
    const result = runtime.execute(step.kind, input, 'human');
    expect(result.ok, `${step.kind} at ${from + index}`).toBe(true);
  }
}

/**
 * Lets the controller's fire-and-forget observation chain settle.
 *
 * Observation is intentionally not awaited by gameplay, so a test has to drain
 * it explicitly; `controller.idle()` is the controller's own drain and this
 * wrapper adds the extra microtask hops IndexedDB needs.
 */
async function settle(controller?: RunSyncController): Promise<void> {
  for (let i = 0; i < 40; i += 1) await new Promise((resolve) => setImmediate(resolve));
  if (controller) await controller.idle();
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

describe('run sync against the live API', () => {
  let harness: Harness;
  let control: { offline: boolean };

  beforeEach(() => {
    harness = createHarness();
    control = { offline: false };
  });

  afterEach(async () => {
    await harness.close();
  });

  function makeController(store: RuntimeModeStore, runtime: ReturnType<typeof bootRuntime>) {
    return new RunSyncController({
      runtime,
      client: new BackendClient({
        baseUrl: 'http://api.test',
        fetchImpl: injectFetch(harness, control),
      }),
      clientBuild: 'v0.1.0 · test',
      queue: createIndexedDbQueue(new IDBFactory()),
      tokens: createSessionTokenStore(undefined),
      store,
    });
  }

  it('mirrors a full run to the server and lands on the same signature', async () => {
    const runtime = bootRuntime();
    const store = new RuntimeModeStore();
    const controller = makeController(store, runtime);

    await controller.start();
    expect(store.getSnapshot().mode).toBe('connected');
    expect(statusLabel(store.getSnapshot())).toBe('Connected simulation');

    runtime.send({ type: 'SKIP_INTRO' });
    play(runtime, 0, PERFECT_RUN.length);
    await settle(controller);

    const runId = controller.runId!;
    const stored = await harness.repository.allCommands(runId);
    expect(stored).toHaveLength(runtime.context.commandLog.length);
    expect(signatureHash(replayHistory(stored))).toBe(hashContext(runtime.context));

    const run = await harness.repository.getRun(runId);
    expect(run!.status).toBe('closed');
    expect(run!.ending).toBe('contained');
    expect(store.getSnapshot().sync).toBe('synced');
    expect(store.getSnapshot().queuedCommands).toBe(0);

    controller.stop();
  });

  it('falls back to degraded on server loss without losing a command, then uploads the exact missing suffix once', async () => {
    const runtime = bootRuntime();
    const store = new RuntimeModeStore();
    const controller = makeController(store, runtime);

    await controller.start();
    runtime.send({ type: 'SKIP_INTRO' });

    play(runtime, 0, 5);
    await settle(controller);
    const acknowledgedBeforeOutage = (await harness.repository.getRun(controller.runId!))!.lastSeq;
    expect(acknowledgedBeforeOutage).toBeGreaterThan(0);

    // The backend goes away mid-case.
    control.offline = true;
    play(runtime, 5, PERFECT_RUN.length);
    await settle();

    expect(store.getSnapshot().mode).toBe('degraded');
    expect(statusLabel(store.getSnapshot())).toBe('Offline, recording locally');
    // Gameplay was untouched by the outage.
    expect(runtime.context.caseClosed).toBe(true);
    expect(runtime.context.ending).toBe('contained');
    // Nothing was dropped.
    const queued = await controller.queued();
    expect(queued[0]!.seq).toBe(acknowledgedBeforeOutage + 1);
    expect(queued[queued.length - 1]!.seq).toBe(runtime.context.commandLog.length);

    // Reconnect.
    control.offline = false;
    await controller.flush();
    await settle(controller);

    const stored = await harness.repository.allCommands(controller.runId!);
    expect(stored.map((command) => command.seq)).toEqual(
      stored.map((_, index) => index + 1),
    );
    expect(stored).toHaveLength(runtime.context.commandLog.length);
    expect(signatureHash(replayHistory(stored))).toBe(hashContext(runtime.context));
    expect(store.getSnapshot().sync).toBe('synced');

    // Flushing again uploads nothing: exactly once, not at-least-once.
    await controller.flush();
    expect(await harness.repository.allCommands(controller.runId!)).toHaveLength(stored.length);

    controller.stop();
  });

  it('starts in degraded mode when the backend is unreachable at boot, and still finishes the case', async () => {
    control.offline = true;
    const runtime = bootRuntime();
    const store = new RuntimeModeStore();
    const controller = makeController(store, runtime);

    await controller.start();
    expect(store.getSnapshot().mode).toBe('degraded');

    runtime.send({ type: 'SKIP_INTRO' });
    play(runtime, 0, PERFECT_RUN.length);
    await settle();

    expect(runtime.context.caseClosed).toBe(true);
    expect(runtime.context.ending).toBe('contained');
    expect((await controller.queued()).length).toBe(runtime.context.commandLog.length);

    controller.stop();
  });

  it('freezes sync on a replay mismatch, keeps gameplay running and offers a JSON export', async () => {
    const runtime = bootRuntime();
    const store = new RuntimeModeStore();
    const controller = makeController(store, runtime);

    await controller.start();
    runtime.send({ type: 'SKIP_INTRO' });
    play(runtime, 0, 3);
    await settle();

    // A second writer advances the server's history down a different path, so
    // the next upload cannot possibly replay to the same signature.
    const runId = controller.runId!;
    const server = await harness.repository.getRun(runId);
    await harness.repository.appendCommands(
      runId,
      [
        {
          runId,
          seq: server!.lastSeq + 1,
          kind: 'submit_decision',
          origin: 'agent',
          input: {
            decisionId: 'D2',
            optionId: 'D2_trust_sender_display_name',
            stateVersion: server!.stateVersion,
            idempotencyKey: 'divergent',
          },
          result: { ok: true, stateVersion: server!.stateVersion + 1 },
          incidentAtSec: 12_000,
          stateVersionBefore: server!.stateVersion,
          stateVersionAfter: server!.stateVersion + 1,
          idempotencyKeyHash: null,
          createdAt: new Date(harness.now()).toISOString(),
        },
      ],
      {
        lastSeq: server!.lastSeq + 1,
        stateVersion: server!.stateVersion + 1,
        stateHash: `sha256:${'9'.repeat(64)}`,
        status: 'active',
        ending: null,
        score: null,
        updatedAt: new Date(harness.now()).toISOString(),
      },
    );

    play(runtime, 3, PERFECT_RUN.length);
    await settle();
    await controller.flush();
    await settle();

    expect(controller.isFrozen).toBe(true);
    expect(store.getSnapshot().sync).toBe('needs-review');
    expect(statusLabel(store.getSnapshot())).toBe('Run sync needs review');

    // Gameplay never stopped.
    expect(runtime.context.caseClosed).toBe(true);
    expect(runtime.context.ending).toBe('contained');

    // Neither history was overwritten.
    const exported = await controller.exportRun();
    expect(exported.runId).toBe(runId);
    expect(exported.localStateHash).toBe(hashContext(runtime.context));
    expect(exported.serverStateHash).not.toBe(exported.localStateHash);
    expect(exported.commands.length).toBeGreaterThan(0);
    expect(JSON.stringify(exported)).not.toMatch(/writeToken|Bearer/);
    // And the export is real JSON a person can hand to support.
    expect(() => JSON.parse(JSON.stringify(exported))).not.toThrow();

    controller.stop();
  });
});
