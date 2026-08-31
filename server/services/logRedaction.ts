/**
 * Log redaction (contract §10: "Redact bearer tokens, prompts, artifact content
 * and personal fields from logs").
 *
 * The rule this file encodes is that structured logs carry *shape*, not
 * *content*: a command kind and sequence number, never the artifact fields it
 * returned; a run id hash, never the token that authorises it.
 */

const REDACTED = '[redacted]';

/** Header names whose values never appear in a log line. */
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-stream-token',
]);

/** Object keys whose values never appear in a log line, at any depth. */
const SENSITIVE_KEYS = new Set([
  'writetoken',
  'write_token',
  'streamtoken',
  'stream_token',
  'token',
  'authorization',
  'password',
  'apikey',
  'api_key',
  'openai_api_key',
  'databaseurl',
  'database_url',
  'secret',
  'prompt',
  'prompts',
  'plan',
  'planjson',
  'plan_json',
  'fields',
  'artifact',
  'artifacts',
  'input',
  'result',
  'payload',
  'data',
  'value',
  'upn',
  'email',
]);

/**
 * Bearer tokens and long base64url blobs that appear inline in a message.
 * The blob rule is intentionally aggressive: any 24+ character base64url run in
 * a log string is far more likely to be a credential than prose.
 */
const INLINE_SECRET_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b[A-Za-z0-9_-]{32,}\b/g,
  /\bpostgres(?:ql)?:\/\/[^\s]+/gi,
  /\bsk-[A-Za-z0-9]{8,}/g,
];

export function redactString(value: string): string {
  let out = value;
  for (const pattern of INLINE_SECRET_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

export function redactHeaders(
  headers: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? REDACTED : String(value);
  }
  return out;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return REDACTED;
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : redact(child, depth + 1);
  }
  return out;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface StructuredLogger {
  log(level: LogLevel, event: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): StructuredLogger;
}

/**
 * A tiny structured logger.
 *
 * Fastify ships one, but routing every gameplay log line through this function
 * makes redaction a property of the logger rather than of each call site — the
 * only version of that rule that survives a new contributor.
 */
export function createLogger(
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
  base: Record<string, unknown> = {},
): StructuredLogger {
  return {
    log(level, event, fields = {}) {
      const line = {
        level,
        event,
        at: new Date().toISOString(),
        ...(redact(base) as Record<string, unknown>),
        ...(redact(fields) as Record<string, unknown>),
      };
      write(JSON.stringify(line));
    },
    child(fields) {
      return createLogger(write, { ...base, ...fields });
    },
  };
}

/** A logger that writes nowhere. Used by tests and by `NODE_ENV=test`. */
export function createSilentLogger(): StructuredLogger {
  return createLogger(() => {});
}
