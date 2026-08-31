import {
  ROUTES,
  type AppendBatchData,
  type AppendCommandData,
  type ApiResponse,
  type CreateRunData,
  type HealthData,
  type ListCommandsData,
  type RunSummaryData,
} from '../../shared/apiContract';
import type { BackendClientError, QueuedCommand } from './types';

/**
 * The browser's HTTP client for the run API.
 *
 * The property that matters most is what happens when no backend is
 * configured: `createBackendClient` returns `null`, and every caller in this
 * directory is written to treat `null` as "we are in local mode". There is no
 * default base URL, no probe, no health poll — a build with
 * `VITE_CYCASE_BACKEND_URL` unset makes exactly zero network requests, which is
 * the contract's first definition-of-done bullet and is asserted by
 * `tests/backend/unit/client.test.ts` with an injected fetch spy.
 */

export interface BackendClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  /** Aborts a request that outlives the player's patience. */
  timeoutMs?: number;
}

export class BackendRequestError extends Error {
  readonly detail: BackendClientError;

  constructor(detail: BackendClientError) {
    super(detail.message);
    this.name = 'BackendRequestError';
    this.detail = detail;
  }
}

const DEFAULT_TIMEOUT_MS = 8000;

export class BackendClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: BackendClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async health(): Promise<HealthData> {
    return this.request<HealthData>('GET', ROUTES.health);
  }

  async createRun(clientBuild: string): Promise<CreateRunData> {
    return this.request<CreateRunData>('POST', ROUTES.runs, {
      body: { scenarioId: 'CASE-001', scenarioVersion: 1, clientBuild },
    });
  }

  async getRun(runId: string, token: string): Promise<RunSummaryData> {
    return this.request<RunSummaryData>('GET', ROUTES.run(runId), { token });
  }

  async listCommands(
    runId: string,
    token: string,
    after: number,
    limit?: number,
  ): Promise<ListCommandsData> {
    const query = new URLSearchParams({ after: String(after) });
    if (limit !== undefined) query.set('limit', String(limit));
    return this.request<ListCommandsData>('GET', `${ROUTES.commands(runId)}?${query}`, { token });
  }

  async appendCommand(
    runId: string,
    token: string,
    command: QueuedCommand,
  ): Promise<AppendCommandData> {
    return this.request<AppendCommandData>('POST', ROUTES.commands(runId), {
      token,
      body: command,
    });
  }

  async appendBatch(
    runId: string,
    token: string,
    commands: readonly QueuedCommand[],
  ): Promise<AppendBatchData> {
    return this.request<AppendBatchData>('POST', ROUTES.commandsBatch(runId), {
      token,
      body: { commands },
    });
  }

  private async request<T>(
    method: string,
    path: string,
    options: { token?: string; body?: unknown } = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = { accept: 'application/json' };
      if (options.body !== undefined) headers['content-type'] = 'application/json';
      // The write token travels in a header and nowhere else: never a query
      // string, never a log line, never a persisted command payload (§9, §10).
      if (options.token) headers.authorization = `Bearer ${options.token}`;

      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
        credentials: 'omit',
      });

      const payload = (await response.json().catch(() => null)) as ApiResponse<T> | null;

      if (!payload || typeof payload !== 'object' || !('ok' in payload)) {
        throw new BackendRequestError({
          code: 'INTERNAL',
          message: 'The backend returned an unreadable response.',
          status: response.status,
        });
      }

      if (payload.ok) return payload.data;

      throw new BackendRequestError({
        code: payload.error.code,
        message: payload.error.message,
        recovery: payload.error.recovery,
        expectedSeq: payload.error.expectedSeq,
        status: response.status,
      });
    } catch (error) {
      if (error instanceof BackendRequestError) throw error;
      // A network failure, a CORS refusal and a timeout are the same thing to
      // the player: the backend is unreachable and the run keeps going locally.
      throw new BackendRequestError({
        code: 'OFFLINE',
        message: 'The backend is unreachable.',
        recovery: 'Commands are being recorded locally and will upload on reconnect.',
        status: 0,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Reads the configured base URL and builds a client, or returns `null`.
 *
 * `null` is the default and means local mode. Deliberately not a boolean flag
 * plus a URL: one source of truth means a half-configured build cannot end up
 * "connected" with nowhere to connect.
 */
export function createBackendClient(
  env: Record<string, string | undefined> = import.meta.env as unknown as Record<
    string,
    string | undefined
  >,
  fetchImpl?: typeof fetch,
): BackendClient | null {
  const baseUrl = env.VITE_CYCASE_BACKEND_URL?.trim();
  if (!baseUrl) return null;
  return new BackendClient(fetchImpl ? { baseUrl, fetchImpl } : { baseUrl });
}
