import { API_LIMITS } from '../shared/apiContract';
import type { RateLimitRule } from './services/rateLimiter';

/**
 * Server configuration, read once from the environment.
 *
 * Every secret named here stays on this side of the boundary: nothing in
 * `server/` is importable from `src/`, and the browser client only ever learns
 * a base URL. `.env.example` lists the names, never values.
 */

export interface ServerConfig {
  host: string;
  port: number;
  /** Git SHA reported by `/health`. */
  version: string;
  databaseUrl: string | null;
  /** Exact origins allowed to call the API. Never `*` when credentials are used. */
  corsAllowlist: string[];
  /** Mutations must present an `Origin` the allowlist accepts. */
  requireOriginOnMutation: boolean;
  rateLimits: {
    runCreate: RateLimitRule;
    commandAppend: RateLimitRule;
    scenarioGenerate: RateLimitRule;
  };
  features: {
    /** §6: SSE telemetry is optional and off unless explicitly enabled. */
    sseTelemetry: boolean;
    /** §6: scenario generation needs a server-side credential AND this flag. */
    scenarioGeneration: boolean;
  };
  maxBodyBytes: number;
  runTtlMs: number;
  /**
   * How many reverse proxies sit in front of this service.
   *
   * Blanket `trustProxy: true` resolves `request.ip` from the leftmost
   * X-Forwarded-For entry, which is always client-supplied — real proxies
   * *append* to XFF, they do not overwrite it. Because the rate limiter keys on
   * `request.ip`, that let a client choose its own bucket: with a limit of two,
   * six run creations that varied the header returned 201 six times. The key
   * being attacker-*chosen* rather than merely attacker-evadable also turned the
   * limiter into a DoS primitive against a spoofed victim address.
   *
   * A hop count makes Fastify trust only the entries a real proxy chain added.
   * 0 — the default — means no proxy in front: use the socket address and ignore
   * X-Forwarded-For entirely.
   */
  trustedProxyHops: number;
  /** Silences structured logs. Set automatically under NODE_ENV=test. */
  quiet: boolean;
}

function boolFromEnv(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function intFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function listFromEnv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const openAiKeyPresent = Boolean(env.OPENAI_API_KEY);

  return {
    host: env.CYCASE_HOST ?? '127.0.0.1',
    port: intFromEnv(env.PORT ?? env.CYCASE_PORT, 8787),
    version: env.BUILD_SHA ?? env.CYCASE_BUILD_SHA ?? 'unknown',
    databaseUrl: env.DATABASE_URL && env.DATABASE_URL.length > 0 ? env.DATABASE_URL : null,
    corsAllowlist: listFromEnv(env.CYCASE_CORS_ORIGINS),
    requireOriginOnMutation: boolFromEnv(env.CYCASE_REQUIRE_ORIGIN, true),
    rateLimits: {
      // Deliberately different budgets: creating runs is rare and expensive,
      // appending commands happens once per player click.
      runCreate: {
        limit: intFromEnv(env.CYCASE_RATE_RUN_CREATE, 10),
        windowMs: intFromEnv(env.CYCASE_RATE_RUN_CREATE_WINDOW_MS, 60_000),
      },
      commandAppend: {
        limit: intFromEnv(env.CYCASE_RATE_COMMAND_APPEND, 300),
        windowMs: intFromEnv(env.CYCASE_RATE_COMMAND_APPEND_WINDOW_MS, 60_000),
      },
      scenarioGenerate: {
        limit: intFromEnv(env.CYCASE_RATE_SCENARIO_GENERATE, 5),
        windowMs: intFromEnv(env.CYCASE_RATE_SCENARIO_GENERATE_WINDOW_MS, 60 * 60_000),
      },
    },
    features: {
      sseTelemetry: boolFromEnv(env.CYCASE_FEATURE_SSE, false),
      // Both conditions, not either: a flag without a credential would produce
      // a route that 500s, and a credential without a flag would enable an
      // unreviewed generator by accident.
      scenarioGeneration: boolFromEnv(env.CYCASE_FEATURE_SCENARIO_GENERATION, false) && openAiKeyPresent,
    },
    maxBodyBytes: API_LIMITS.maxBodyBytes,
    runTtlMs: API_LIMITS.runTtlMs,
    trustedProxyHops: intFromEnv(env.CYCASE_TRUSTED_PROXY_HOPS, 0),
    quiet: env.NODE_ENV === 'test' || boolFromEnv(env.CYCASE_QUIET),
  };
}
