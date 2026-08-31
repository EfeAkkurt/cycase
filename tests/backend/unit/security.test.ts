import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../../server/config';
import { createLogger, redact, redactHeaders, redactString } from '../../../server/services/logRedaction';
import { RateLimiter } from '../../../server/services/rateLimiter';

describe('rate limiter (§10: separate limits per operation)', () => {
  it('allows up to the limit and then refuses with a retry hint', () => {
    const now = 0;
    const limiter = new RateLimiter(() => now);
    const rule = { limit: 3, windowMs: 1000 };

    expect(limiter.check('run_create', 'ip', rule).allowed).toBe(true);
    expect(limiter.check('run_create', 'ip', rule).allowed).toBe(true);
    expect(limiter.check('run_create', 'ip', rule).allowed).toBe(true);

    const refused = limiter.check('run_create', 'ip', rule);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSec).toBeGreaterThan(0);
  });

  it('keeps run creation and command append on separate budgets', () => {
    const now = 0;
    const limiter = new RateLimiter(() => now);
    const create = { limit: 1, windowMs: 1000 };
    const append = { limit: 5, windowMs: 1000 };

    limiter.check('run_create', 'ip', create);
    expect(limiter.check('run_create', 'ip', create).allowed).toBe(false);
    // Exhausting run creation must not throttle gameplay.
    expect(limiter.check('command_append', 'ip', append).allowed).toBe(true);
  });

  it('keeps clients on separate budgets', () => {
    const limiter = new RateLimiter(() => 0);
    const rule = { limit: 1, windowMs: 1000 };
    limiter.check('run_create', 'a', rule);
    expect(limiter.check('run_create', 'a', rule).allowed).toBe(false);
    expect(limiter.check('run_create', 'b', rule).allowed).toBe(true);
  });

  it('resets when the window rolls over, and prunes dead buckets', () => {
    let now = 0;
    const limiter = new RateLimiter(() => now);
    const rule = { limit: 1, windowMs: 1000 };

    limiter.check('run_create', 'ip', rule);
    expect(limiter.check('run_create', 'ip', rule).allowed).toBe(false);

    now = 1001;
    expect(limiter.check('run_create', 'ip', rule).allowed).toBe(true);

    now = 5000;
    limiter.prune();
    expect(limiter.size).toBe(0);
  });
});

describe('log redaction (§10)', () => {
  it('removes bearer tokens from a message', () => {
    expect(redactString('auth was Bearer abc123def456')).not.toContain('abc123def456');
  });

  it('removes long opaque blobs, which are almost always credentials', () => {
    const token = 'kQ7xM2p9RsT4vW1yZ3bN6cF8hJ0lO5aE';
    expect(redactString(`token=${token}`)).not.toContain(token);
  });

  it('removes a database URL', () => {
    // secret-scan-allow: synthetic, and the assertion below is that redaction removes it.
    const url = 'postgres://user:pass@db.internal:5432/cycase';
    expect(redactString(`connecting to ${url}`)).not.toContain('pass');
  });

  it('redacts sensitive headers but keeps the rest for diagnosis', () => {
    const headers = redactHeaders({
      authorization: 'Bearer secret-token-value',
      cookie: 'sid=abc',
      'user-agent': 'Chrome/149',
    });
    expect(headers.authorization).toBe('[redacted]');
    expect(headers.cookie).toBe('[redacted]');
    expect(headers['user-agent']).toBe('Chrome/149');
  });

  it('redacts artifact content, inputs, results and prompts at any depth', () => {
    const redacted = redact({
      run: 'abcd',
      command: {
        kind: 'inspect_artifact',
        input: { artifactId: 'art_email_001' },
        result: { data: { fields: [{ label: 'Sender', value: 'attacker@example.com' }] } },
      },
      prompt: 'system: you are…',
    }) as Record<string, unknown>;

    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain('attacker@example.com');
    expect(serialized).not.toContain('you are');
    // The shape survives, so a log line still says *what* happened.
    expect((redacted.command as Record<string, unknown>).kind).toBe('inspect_artifact');
  });

  it('never emits a write token through the structured logger', () => {
    const lines: string[] = [];
    const logger = createLogger((line) => lines.push(line));
    logger.log('info', 'run_created', {
      writeToken: 'kQ7xM2p9RsT4vW1yZ3bN6cF8hJ0lO5aE',
      run: 'abc123',
    });
    expect(lines[0]).not.toContain('kQ7xM2p9RsT4vW1yZ3bN6cF8hJ0lO5aE');
    expect(lines[0]).toContain('run_created');
  });

  it('does not recurse forever on a cyclic object', () => {
    const cyclic: Record<string, unknown> = { name: 'x' };
    cyclic.self = cyclic;
    expect(() => JSON.stringify(redact(cyclic))).not.toThrow();
  });
});

describe('config defaults (§6, §10)', () => {
  it('leaves both optional features off with an empty environment', () => {
    const config = loadConfig({});
    expect(config.features.sseTelemetry).toBe(false);
    expect(config.features.scenarioGeneration).toBe(false);
    expect(config.databaseUrl).toBeNull();
    expect(config.corsAllowlist).toEqual([]);
    expect(config.requireOriginOnMutation).toBe(true);
  });

  it('refuses to enable scenario generation on a flag alone', () => {
    expect(loadConfig({ CYCASE_FEATURE_SCENARIO_GENERATION: 'true' }).features.scenarioGeneration).toBe(
      false,
    );
    expect(
      loadConfig({ CYCASE_FEATURE_SCENARIO_GENERATION: 'true', OPENAI_API_KEY: 'x' }).features
        .scenarioGeneration,
    ).toBe(true);
    // A credential alone is not enough either.
    expect(loadConfig({ OPENAI_API_KEY: 'x' }).features.scenarioGeneration).toBe(false);
  });

  it('parses a CORS allowlist and never produces a wildcard', () => {
    const config = loadConfig({
      CYCASE_CORS_ORIGINS: 'https://cycase.example, https://staging.cycase.example',
    });
    expect(config.corsAllowlist).toEqual([
      'https://cycase.example',
      'https://staging.cycase.example',
    ]);
    expect(config.corsAllowlist).not.toContain('*');
  });

  it('caps the body at 256 KB and expires runs after seven days', () => {
    const config = loadConfig({});
    expect(config.maxBodyBytes).toBe(256 * 1024);
    expect(config.runTtlMs).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
