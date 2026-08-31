import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';

import {
  API_ERROR_STATUS,
  type ApiErrorCode,
  type ApiFailure,
  type ApiSuccess,
} from '../shared/apiContract';
import type { ServerConfig } from './config';
import { loadConfig } from './config';
import { InMemoryRunRepository, type RunRepository } from './persistence/repository';
import { createLogger, createSilentLogger, type StructuredLogger } from './services/logRedaction';
import { RateLimiter } from './services/rateLimiter';
import { generateRequestId } from './services/tokens';
import { registerHealthRoutes } from './routes/health';
import { registerRunRoutes } from './routes/runs';
import { registerScenarioRoutes } from './routes/scenarios';
import { registerTelemetryRoutes } from './routes/telemetry';

/**
 * The API surface.
 *
 * Assembled from injected pieces (config, repository, clock) so the integration
 * tests drive the real Fastify stack — real routing, real body parsing, real
 * hooks — against an in-memory store, instead of testing route handlers in
 * isolation and hoping the middleware agrees.
 */

export interface AppDeps {
  config?: Partial<ServerConfig>;
  repository?: RunRepository;
  logger?: StructuredLogger;
  /** Injectable so expiry and rate-limit windows are testable. */
  now?: () => number;
}

export interface AppContext {
  config: ServerConfig;
  repository: RunRepository;
  logger: StructuredLogger;
  rateLimiter: RateLimiter;
  now: () => number;
}

declare module 'fastify' {
  interface FastifyRequest {
    cycaseRequestId: string;
    cycaseStartedAt: number;
  }
}

/* ------------------------------------------------------------------ *
 * Response helpers
 * ------------------------------------------------------------------ */

export function succeed<T>(reply: FastifyReply, request: FastifyRequest, data: T, status = 200) {
  const body: ApiSuccess<T> = { ok: true, requestId: request.cycaseRequestId, data };
  return reply.status(status).send(body);
}

export interface FailOptions {
  recovery?: string;
  expectedSeq?: number;
  status?: number;
  /** Extra fields for the log line only. Never sent to the client. */
  logFields?: Record<string, unknown>;
}

/**
 * The only way a route reports a failure.
 *
 * `message` is authored copy, never an exception's text: contract §6 forbids
 * returning stack traces, database errors, prompts or provider output, and the
 * reliable way to honour that is to make leaking impossible at the call site.
 */
export function fail(
  reply: FastifyReply,
  request: FastifyRequest,
  code: ApiErrorCode,
  message: string,
  options: FailOptions = {},
) {
  const body: ApiFailure = {
    ok: false,
    requestId: request.cycaseRequestId,
    error: {
      code,
      message,
      ...(options.recovery ? { recovery: options.recovery } : {}),
      ...(options.expectedSeq !== undefined ? { expectedSeq: options.expectedSeq } : {}),
    },
  };
  return reply.status(options.status ?? API_ERROR_STATUS[code]).send(body);
}

/* ------------------------------------------------------------------ *
 * Server
 * ------------------------------------------------------------------ */

export function buildServer(deps: AppDeps = {}): FastifyInstance & { cycase: AppContext } {
  const config: ServerConfig = { ...loadConfig(), ...deps.config };
  const logger = deps.logger ?? (config.quiet ? createSilentLogger() : createLogger());
  const now = deps.now ?? (() => Date.now());

  const context: AppContext = {
    config,
    repository: deps.repository ?? new InMemoryRunRepository(),
    logger,
    rateLimiter: new RateLimiter(now),
    now,
  };

  const app = Fastify({
    // Fastify's own logger is off: every line this service emits goes through
    // `logRedaction`, so redaction is structural rather than per-call-site.
    logger: false,
    bodyLimit: config.maxBodyBytes,
    // Never `true`: that trusts the leftmost X-Forwarded-For entry, which the
    // client writes, and the rate limiter keys on the resulting `request.ip`.
    // A hop count trusts only what a real proxy chain appended; 0 ignores the
    // header and uses the socket address.
    // Fastify types the hop count as a string; `false` ignores XFF entirely.
    trustProxy: config.trustedProxyHops > 0 ? String(config.trustedProxyHops) : false,
  });

  /* ---- request identity + timing (§10: opaque request id on every response) */
  app.addHook('onRequest', async (request) => {
    request.cycaseRequestId = generateRequestId();
    request.cycaseStartedAt = performance.now();
  });

  /* ---- CORS: strict allowlist, never `*` with credentials (§10) ---- */
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (typeof origin === 'string' && config.corsAllowlist.includes(origin)) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Vary', 'Origin');
      reply.header('Access-Control-Allow-Credentials', 'true');
      reply.header('Access-Control-Allow-Headers', 'content-type,authorization');
      reply.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      reply.header('Access-Control-Max-Age', '600');
    }
    if (request.method === 'OPTIONS') {
      // A preflight from a non-allowlisted origin gets 403 and no CORS headers,
      // which is what makes the allowlist a boundary rather than a suggestion.
      const allowed = typeof origin === 'string' && config.corsAllowlist.includes(origin);
      return reply.status(allowed ? 204 : 403).send();
    }
  });

  /* ---- Origin validation on every mutation (§10) ---- */
  app.addHook('onRequest', async (request, reply) => {
    if (!config.requireOriginOnMutation) return;
    if (request.method !== 'POST' && request.method !== 'PUT' && request.method !== 'DELETE') {
      return;
    }
    const origin = request.headers.origin;
    if (typeof origin !== 'string') {
      /*
       * An Origin-less mutation is a non-browser client. That is defensible on
       * its own — Origin defends against a *browser* being used as a confused
       * deputy, and a client with no Origin carries no ambient credentials.
       *
       * What is NOT defensible is the default configuration it produced: with
       * CYCASE_CORS_ORIGINS unset the allowlist is empty while this flag is on,
       * so every browser write was rejected and every scripted write accepted.
       * An operator smoke-testing from a browser would see 401 everywhere and
       * conclude the gate was working, while curl wrote freely.
       *
       * So the absent-Origin path is allowed only when an allowlist actually
       * exists. An empty allowlist with the flag on is a misconfiguration, and
       * it now fails closed instead of silently inverting.
       */
      if (config.corsAllowlist.length === 0) {
        return fail(
          reply,
          request,
          'UNAUTHORIZED',
          'This deployment has no configured origin allowlist.',
          { recovery: 'Set CYCASE_CORS_ORIGINS, or disable origin enforcement explicitly.' },
        );
      }
      return;
    }
    if (!config.corsAllowlist.includes(origin)) {
      return fail(reply, request, 'UNAUTHORIZED', 'This origin may not write to the API.', {
        recovery: 'Open the game from an allowlisted origin.',
      });
    }
  });

  /* ---- structured access log (§11) ---- */
  app.addHook('onResponse', async (request, reply) => {
    logger.log('info', 'request', {
      requestId: request.cycaseRequestId,
      route: request.routeOptions?.url ?? request.url.split('?')[0],
      method: request.method,
      status: reply.statusCode,
      durationMs: Math.round((performance.now() - request.cycaseStartedAt) * 100) / 100,
    });
  });

  /* ---- controlled failures ---- */
  app.setNotFoundHandler((request, reply) =>
    fail(reply, request, 'NOT_FOUND', 'No such endpoint.'),
  );

  app.setErrorHandler((error, request, reply) => {
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;

    if (statusCode === 413) {
      return fail(reply, request, 'INVALID_INPUT', 'Request body is too large.', {
        recovery: 'Send at most 256 KB, and at most 50 commands per batch.',
      });
    }
    if (statusCode === 400) {
      return fail(reply, request, 'INVALID_INPUT', 'Request body could not be parsed as JSON.');
    }

    // The only place an exception can reach the client, so it is also the only
    // place that has to be certain nothing internal escapes. The message is a
    // constant; the detail goes to the log, redacted.
    const thrown = error as { name?: string; message?: string };
    logger.log('error', 'unhandled_error', {
      requestId: request.cycaseRequestId,
      route: request.routeOptions?.url ?? request.url.split('?')[0],
      name: thrown.name ?? 'Error',
      message: thrown.message ?? '',
    });
    return fail(reply, request, 'INTERNAL', 'The service could not complete this request.', {
      recovery: 'Retry shortly. Local gameplay is unaffected.',
    });
  });

  registerHealthRoutes(app, context);
  registerRunRoutes(app, context);
  registerScenarioRoutes(app, context);
  registerTelemetryRoutes(app, context);

  const decorated = app as unknown as FastifyInstance & { cycase: AppContext };
  decorated.cycase = context;
  return decorated;
}
