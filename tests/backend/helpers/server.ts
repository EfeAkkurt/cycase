import { buildServer, type AppDeps } from '../../../server/app';
import { InMemoryRunRepository } from '../../../server/persistence/repository';
import { createSilentLogger } from '../../../server/services/logRedaction';
import type { ApiFailure, ApiSuccess } from '../../../shared/apiContract';

/**
 * Integration harness.
 *
 * `app.inject` drives the real Fastify pipeline — routing, body limits, every
 * hook — without a socket, so these tests exercise the same middleware a
 * deployed request would and still run in milliseconds. The load suite uses a
 * real listener instead, because latency measured through `inject` would be a
 * measurement of Fastify's internals rather than of the service.
 */

export interface Harness {
  app: ReturnType<typeof buildServer>;
  repository: InMemoryRunRepository;
  now: () => number;
  setNow: (ms: number) => void;
  close: () => Promise<void>;
}

export function createHarness(overrides: AppDeps = {}): Harness {
  const repository = (overrides.repository as InMemoryRunRepository) ?? new InMemoryRunRepository();
  let clock = Date.parse('2026-08-29T03:00:00.000Z');

  const app = buildServer({
    repository,
    logger: createSilentLogger(),
    now: () => clock,
    ...overrides,
    config: {
      corsAllowlist: ['https://cycase.example'],
      version: 'test-sha',
      quiet: true,
      ...overrides.config,
    },
  });

  return {
    app,
    repository,
    now: () => clock,
    setNow: (ms) => {
      clock = ms;
    },
    close: () => app.close(),
  };
}

export function successData<T>(payload: string): T {
  const parsed = JSON.parse(payload) as ApiSuccess<T>;
  if (!parsed.ok) throw new Error(`expected success, got ${payload}`);
  return parsed.data;
}

export function failure(payload: string): ApiFailure['error'] {
  const parsed = JSON.parse(payload) as ApiFailure;
  if (parsed.ok) throw new Error(`expected failure, got ${payload}`);
  return parsed.error;
}

export function requestId(payload: string): string {
  return (JSON.parse(payload) as { requestId: string }).requestId;
}
