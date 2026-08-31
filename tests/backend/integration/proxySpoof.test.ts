import { describe, expect, it } from 'vitest';

import { createHarness } from '../helpers/server';

/**
 * Regressions for two findings an adversarial review confirmed by execution, not by
 * reading. Both were "green" in the existing suite because the tests exercised the
 * mechanism rather than the route.
 */

/** Two run creations per minute, so the third must be refused. */
const TIGHT_CREATE = {
  runCreate: { limit: 2, windowMs: 60_000 },
  commandAppend: { limit: 300, windowMs: 60_000 },
  scenarioGenerate: { limit: 5, windowMs: 60_000 },
};

const CREATE = {
  method: 'POST' as const,
  url: '/api/v1/runs',
  payload: { scenarioId: 'CASE-001', scenarioVersion: 1, clientBuild: 'test' },
};

describe('rate limiting cannot be bypassed by a client-supplied header', () => {
  it('keeps one client in one bucket however it sets X-Forwarded-For', async () => {
    // With trustProxy:true this returned 201 six times: the leftmost XFF entry is
    // client-written, and it was the entire rate-limit key.
    const harness = createHarness({ config: { rateLimits: { ...TIGHT_CREATE } } });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 6; i += 1) {
        const response = await harness.app.inject({
          ...CREATE,
          headers: { 'x-forwarded-for': `10.0.0.${i}` },
        });
        statuses.push(response.statusCode);
      }
      expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);
      expect(statuses.slice(0, 2)).toEqual([201, 201]);
    } finally {
      await harness.close();
    }
  });

  it('still honours a real proxy chain when the hop count says one exists', async () => {
    const harness = createHarness({
      config: {
        trustedProxyHops: 1,
        rateLimits: { ...TIGHT_CREATE },
      },
    });
    try {
      // One trusted hop: the *last* entry is the one the proxy appended, so two
      // genuinely different clients keep separate budgets.
      const a = await harness.app.inject({ ...CREATE, headers: { 'x-forwarded-for': '203.0.113.7' } });
      const b = await harness.app.inject({ ...CREATE, headers: { 'x-forwarded-for': '203.0.113.8' } });
      expect(a.statusCode).toBe(201);
      expect(b.statusCode).toBe(201);
    } finally {
      await harness.close();
    }
  });
});

describe('origin enforcement fails closed rather than inverting', () => {
  it('refuses an Origin-less mutation when no allowlist is configured', async () => {
    // The dangerous default: flag on, allowlist empty. Every browser write was
    // rejected and every scripted write accepted, which reads as "locked down".
    const harness = createHarness({ config: { corsAllowlist: [], requireOriginOnMutation: true } });
    try {
      const response = await harness.app.inject(CREATE);
      expect(response.statusCode).toBe(401);
      expect(response.json().error.recovery).toContain('CYCASE_CORS_ORIGINS');
    } finally {
      await harness.close();
    }
  });

  it('allows an Origin-less mutation once an allowlist exists', async () => {
    const harness = createHarness({
      config: { corsAllowlist: ['https://cycase.example'], requireOriginOnMutation: true },
    });
    try {
      expect((await harness.app.inject(CREATE)).statusCode).toBe(201);
    } finally {
      await harness.close();
    }
  });

  it('still rejects a disallowed Origin', async () => {
    const harness = createHarness({
      config: { corsAllowlist: ['https://cycase.example'], requireOriginOnMutation: true },
    });
    try {
      const response = await harness.app.inject({
        ...CREATE,
        headers: { origin: 'https://attacker.example' },
      });
      expect(response.statusCode).toBe(401);
    } finally {
      await harness.close();
    }
  });
});
