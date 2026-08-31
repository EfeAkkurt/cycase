import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';

import { createBackendClient, BackendClient, BackendRequestError } from '../../../src/backend/client';
import { createIndexedDbQueue } from '../../../src/backend/offlineQueue';
import { RunSyncController, createSessionTokenStore } from '../../../src/backend/runSync';
import { RuntimeModeStore, statusLabel } from '../../../src/backend/runtimeMode';
import { RUNTIME_MODE_LABEL, SYNC_REVIEW_LABEL } from '../../../src/backend/types';
import { hashContext } from '../../../shared/runSignature';
import { bootRuntime, PERFECT_RUN } from '../helpers/run';

/**
 * Local mode makes zero backend requests (contract §14, first bullet).
 *
 * This is the version of the proof with teeth. The Playwright run asserts the
 * shipped page makes no backend calls today; this asserts the *sync layer
 * itself* makes none when unconfigured, so the property survives the pass that
 * mounts it into the UI.
 */

function playThrough(runtime: ReturnType<typeof bootRuntime>): void {
  for (const [index, step] of PERFECT_RUN.entries()) {
    runtime.send({ type: 'TICK', seconds: 3 });
    runtime.getIncident('agent');
    const input: Record<string, unknown> = { ...step.input, stateVersion: runtime.stateVersion };
    if (step.kind === 'take_response_action' || step.kind === 'submit_decision') {
      input.idempotencyKey = `local:${index}`;
    }
    const result = runtime.execute(step.kind, input, index % 2 === 0 ? 'human' : 'agent');
    expect(result.ok).toBe(true);
  }
}

describe('local mode makes zero backend requests', () => {
  it('builds no client when VITE_CYCASE_BACKEND_URL is unset', () => {
    const fetchSpy = vi.fn();
    expect(createBackendClient({}, fetchSpy as unknown as typeof fetch)).toBeNull();
    expect(createBackendClient({ VITE_CYCASE_BACKEND_URL: '' }, fetchSpy as unknown as typeof fetch)).toBeNull();
    expect(createBackendClient({ VITE_CYCASE_BACKEND_URL: '   ' }, fetchSpy as unknown as typeof fetch)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('plays Case 001 to the contained ending with the sync layer attached and fetch never called', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('local mode must not reach the network');
    });
    const runtime = bootRuntime();
    const store = new RuntimeModeStore();

    const controller = new RunSyncController({
      runtime,
      client: createBackendClient({}, fetchSpy as unknown as typeof fetch),
      clientBuild: 'test',
      queue: createIndexedDbQueue(new IDBFactory()),
      tokens: createSessionTokenStore(undefined),
      store,
    });

    await controller.start();
    runtime.send({ type: 'SKIP_INTRO' });
    playThrough(runtime);
    // Let the queue writes settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchSpy).toHaveBeenCalledTimes(0);
    expect(runtime.context.caseClosed).toBe(true);
    expect(runtime.context.ending).toBe('contained');
    expect(store.getSnapshot().mode).toBe('local');
    expect(statusLabel(store.getSnapshot())).toBe('Local simulation');

    controller.stop();
  });

  it('still records the run locally, so enabling a backend later can upload it', async () => {
    const runtime = bootRuntime();
    const controller = new RunSyncController({
      runtime,
      client: null,
      clientBuild: 'test',
      queue: createIndexedDbQueue(new IDBFactory()),
      tokens: createSessionTokenStore(undefined),
      store: new RuntimeModeStore(),
    });

    await controller.start();
    runtime.send({ type: 'SKIP_INTRO' });
    playThrough(runtime);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const queued = await controller.queued();
    expect(queued).toHaveLength(runtime.context.commandLog.length);
    expect(queued.map((command) => command.seq)).toEqual(
      queued.map((_, index) => index + 1),
    );
    // `get_incident` polls are pure reads and are never queued.
    expect(queued.some((command) => command.kind === 'get_incident')).toBe(false);
    // Both origins survive the round trip (§13 browser E2E expectation).
    expect(new Set(queued.map((command) => command.origin))).toEqual(new Set(['human', 'agent']));
    // The last queued hash is the run's canonical hash.
    expect(queued[queued.length - 1]!.clientStateHash).toBe(hashContext(runtime.context));

    controller.stop();
  });
});

describe('runtime mode store (§5 strings)', () => {
  it('uses the exact contract strings', () => {
    expect(RUNTIME_MODE_LABEL.local).toBe('Local simulation');
    expect(RUNTIME_MODE_LABEL.connected).toBe('Connected simulation');
    expect(RUNTIME_MODE_LABEL.degraded).toBe('Offline, recording locally');
    expect(SYNC_REVIEW_LABEL).toBe('Run sync needs review');
  });

  it('defaults to local and notifies subscribers on a real change only', () => {
    const store = new RuntimeModeStore();
    expect(store.getSnapshot().mode).toBe('local');

    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });

    store.setMode('connected');
    store.setMode('connected');
    expect(notifications).toBe(1);
    expect(store.getSnapshot().label).toBe('Connected simulation');

    unsubscribe();
    store.setMode('degraded');
    expect(notifications).toBe(1);
  });

  it('lets review state win over the mode label', () => {
    const store = new RuntimeModeStore();
    store.setMode('connected');
    store.freezeForReview('signatures disagree');
    expect(statusLabel(store.getSnapshot())).toBe(SYNC_REVIEW_LABEL);
    expect(store.getSnapshot().reviewReason).toBe('signatures disagree');
  });
});

describe('backend client transport rules', () => {
  it('sends the write token in a header and never in the URL', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true, requestId: 'req_1', data: { lastSeq: 1 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const client = new BackendClient({ baseUrl: 'https://api.example', fetchImpl });
    await client.getRun('run_x', 'super-secret-token');

    expect(calls[0]!.url).not.toContain('super-secret-token');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(
      'Bearer super-secret-token',
    );
    expect(calls[0]!.init.credentials).toBe('omit');
  });

  it('turns an API failure into a typed error carrying expectedSeq', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          ok: false,
          requestId: 'req_1',
          error: { code: 'CONFLICT', message: 'A command sequence was skipped.', expectedSeq: 4 },
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch;

    const client = new BackendClient({ baseUrl: 'https://api.example', fetchImpl });
    await expect(client.getRun('run_x', 'token')).rejects.toBeInstanceOf(BackendRequestError);
    await client.getRun('run_x', 'token').catch((error: BackendRequestError) => {
      expect(error.detail.code).toBe('CONFLICT');
      expect(error.detail.expectedSeq).toBe(4);
    });
  });

  it('reports an unreachable backend as OFFLINE rather than leaking the network error', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('Failed to fetch: ECONNREFUSED 127.0.0.1:8787');
    }) as unknown as typeof fetch;

    const client = new BackendClient({ baseUrl: 'https://api.example', fetchImpl });
    await client.health().catch((error: BackendRequestError) => {
      expect(error.detail.code).toBe('OFFLINE');
      expect(error.message).not.toContain('ECONNREFUSED');
    });
  });
});
