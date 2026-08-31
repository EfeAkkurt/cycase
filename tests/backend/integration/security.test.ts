import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { API_LIMITS, type CreateRunData } from '../../../shared/apiContract';
import { playRun } from '../helpers/run';
import { createHarness, failure, successData, type Harness } from '../helpers/server';

describe('API security (§10)', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  async function createRun(): Promise<CreateRunData> {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      payload: { scenarioId: 'CASE-001', scenarioVersion: 1, clientBuild: 'test' },
    });
    return successData<CreateRunData>(response.payload);
  }

  /* ---------------- authorization ---------------- */

  it('refuses an append with no token', async () => {
    const run = await createRun();
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/runs/${run.runId}/commands`,
      payload: playRun().submissions[0]!,
    });
    expect(response.statusCode).toBe(401);
    expect(failure(response.payload).code).toBe('UNAUTHORIZED');
  });

  it('refuses an append with a wrong token', async () => {
    const run = await createRun();
    const other = await createRun();
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/runs/${run.runId}/commands`,
      headers: { authorization: `Bearer ${other.writeToken}` },
      payload: playRun().submissions[0]!,
    });
    expect(response.statusCode).toBe(401);
    expect(await harness.repository.allCommands(run.runId)).toHaveLength(0);
  });

  it('gives the same answer for a wrong token and a run that does not exist', async () => {
    const run = await createRun();
    const wrongToken = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/runs/${run.runId}`,
      headers: { authorization: 'Bearer not-the-token' },
    });
    const noSuchRun = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/runs/run_aaaaaaaaaaaaaaaaaaaaaa',
      headers: { authorization: `Bearer ${run.writeToken}` },
    });
    expect(wrongToken.statusCode).toBe(noSuchRun.statusCode);
    expect(failure(wrongToken.payload).message).toBe(failure(noSuchRun.payload).message);
  });

  it('refuses an expired run', async () => {
    const run = await createRun();
    // §6: seven days. Step one millisecond past it.
    harness.setNow(Date.parse(run.expiresAt) + 1);

    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/runs/${run.runId}`,
      headers: { authorization: `Bearer ${run.writeToken}` },
    });
    expect(response.statusCode).toBe(401);
    expect(failure(response.payload).message).toContain('expired');
  });

  it('purges runs past their retention window', async () => {
    const run = await createRun();
    const removed = await harness.repository.purgeExpired(
      new Date(Date.parse(run.expiresAt) + 1).toISOString(),
    );
    expect(removed).toBe(1);
    expect(await harness.repository.getRun(run.runId)).toBeNull();
  });

  /* ---------------- CORS and Origin ---------------- */

  it('echoes only an allowlisted origin and never a wildcard', async () => {
    const allowed = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { origin: 'https://cycase.example' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('https://cycase.example');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    expect(allowed.headers.vary).toBe('Origin');

    const foreign = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { origin: 'https://attacker.example' },
    });
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('never pairs a wildcard origin with credentials', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { origin: 'https://cycase.example' },
    });
    expect(response.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('answers a preflight from an allowlisted origin and refuses others', async () => {
    const allowed = await harness.app.inject({
      method: 'OPTIONS',
      url: '/api/v1/runs',
      headers: { origin: 'https://cycase.example' },
    });
    expect(allowed.statusCode).toBe(204);

    const refused = await harness.app.inject({
      method: 'OPTIONS',
      url: '/api/v1/runs',
      headers: { origin: 'https://attacker.example' },
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('validates Origin on every mutation', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      headers: { origin: 'https://attacker.example' },
      payload: { scenarioId: 'CASE-001', scenarioVersion: 1, clientBuild: 'test' },
    });
    expect(response.statusCode).toBe(401);
    expect(failure(response.payload).code).toBe('UNAUTHORIZED');
  });

  it('allows a mutation with an allowlisted Origin', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      headers: { origin: 'https://cycase.example' },
      payload: { scenarioId: 'CASE-001', scenarioVersion: 1, clientBuild: 'test' },
    });
    expect(response.statusCode).toBe(201);
  });

  /* ---------------- body limits ---------------- */

  it('rejects a body over 256 KB with a controlled error', async () => {
    const run = await createRun();
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/runs/${run.runId}/commands`,
      headers: { authorization: `Bearer ${run.writeToken}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ pad: 'x'.repeat(API_LIMITS.maxBodyBytes + 1024) }),
    });
    expect(response.statusCode).toBe(400);
    const error = failure(response.payload);
    expect(error.code).toBe('INVALID_INPUT');
    expect(error.message).not.toMatch(/FST_ERR|stack/i);
  });

  it('rejects a single command padded past the per-command cap', async () => {
    const run = await createRun();
    const played = playRun();
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/runs/${run.runId}/commands`,
      headers: { authorization: `Bearer ${run.writeToken}` },
      payload: {
        ...played.submissions[0]!,
        input: {
          ...(played.submissions[0]!.input as object),
          pad: 'x'.repeat(API_LIMITS.maxCommandJsonBytes),
        },
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects unparseable JSON without leaking the parser error', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      headers: { 'content-type': 'application/json' },
      payload: '{"scenarioId":',
    });
    expect(response.statusCode).toBe(400);
    expect(failure(response.payload).message).toBe('Request body could not be parsed as JSON.');
  });

  /* ---------------- rate limits ---------------- */

  it('rate-limits run creation separately from command append', async () => {
    const limited = createHarness({
      config: {
        corsAllowlist: ['https://cycase.example'],
        rateLimits: {
          runCreate: { limit: 2, windowMs: 60_000 },
          commandAppend: { limit: 100, windowMs: 60_000 },
          scenarioGenerate: { limit: 1, windowMs: 60_000 },
        },
      },
    });

    const create = () =>
      limited.app.inject({
        method: 'POST',
        url: '/api/v1/runs',
        payload: { scenarioId: 'CASE-001', scenarioVersion: 1, clientBuild: 'test' },
      });

    const first = await create();
    const second = await create();
    const third = await create();

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(third.statusCode).toBe(429);
    expect(failure(third.payload).code).toBe('RATE_LIMITED');
    expect(third.headers['retry-after']).toBeDefined();

    // Command append still has its own budget.
    const run = successData<CreateRunData>(first.payload);
    const append = await limited.app.inject({
      method: 'POST',
      url: `/api/v1/runs/${run.runId}/commands`,
      headers: { authorization: `Bearer ${run.writeToken}` },
      payload: playRun().submissions[0]!,
    });
    expect(append.statusCode).toBe(201);

    await limited.close();
  });

  /* ---------------- controlled failures ---------------- */

  it('a database failure returns a controlled error without leaking internals', async () => {
    const run = await createRun();
    harness.repository.failNext = new Error(
      // A synthetic credential, present precisely so this test can assert the
      // response never echoes it back.
      'ECONNREFUSED postgres://cycase:hunter2@db.internal:5432/cycase', // secret-scan-allow
    );

    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/runs/${run.runId}`,
      headers: { authorization: `Bearer ${run.writeToken}` },
    });

    expect(response.statusCode).toBe(500);
    const error = failure(response.payload);
    expect(error.code).toBe('INTERNAL');
    expect(error.message).toBe('The service could not complete this request.');
    expect(response.payload).not.toContain('ECONNREFUSED');
    expect(response.payload).not.toContain('hunter2');
    expect(response.payload).not.toContain('postgres://');
    expect(response.payload).not.toMatch(/at Object|\.ts:\d+/);
  });

  it('a persistence failure during append leaves the run unadvanced', async () => {
    const run = await createRun();
    const played = playRun();

    await harness.app.inject({
      method: 'POST',
      url: `/api/v1/runs/${run.runId}/commands`,
      headers: { authorization: `Bearer ${run.writeToken}` },
      payload: played.submissions[0]!,
    });

    // Fail the write itself, after verification has already succeeded.
    let calls = 0;
    const original = harness.repository.appendCommands.bind(harness.repository);
    harness.repository.appendCommands = async (..._args) => {
      calls += 1;
      throw new Error('relation "run_commands" does not exist');
    };

    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/runs/${run.runId}/commands`,
      headers: { authorization: `Bearer ${run.writeToken}` },
      payload: played.submissions[1]!,
    });

    expect(calls).toBe(1);
    expect(response.statusCode).toBe(500);
    expect(failure(response.payload).code).toBe('INTERNAL');
    expect(response.payload).not.toContain('run_commands');

    harness.repository.appendCommands = original;
    expect((await harness.repository.getRun(run.runId))!.lastSeq).toBe(1);
  });

  it('answers an unknown endpoint in the same envelope', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(response.statusCode).toBe(404);
    expect(failure(response.payload).code).toBe('NOT_FOUND');
  });
});

describe('optional features are off by default', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('scenario generation is not shipped and says so without revealing credentials', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/scenarios/generate',
      payload: {
        topic: 'phishing_session_theft',
        difficulty: 'beginner',
        locale: 'en',
        durationMinutes: 5,
      },
    });
    expect(response.statusCode).toBe(404);
    const error = failure(response.payload);
    expect(error.message).toBe('Scenario generation is not enabled on this deployment.');
    expect(response.payload).not.toMatch(/openai|api[_-]?key/i);
  });

  it('SSE endpoints answer NOT_FOUND while the feature flag is off', async () => {
    const created = successData<CreateRunData>(
      (
        await harness.app.inject({
          method: 'POST',
          url: '/api/v1/runs',
          payload: { scenarioId: 'CASE-001', scenarioVersion: 1, clientBuild: 'test' },
        })
      ).payload,
    );

    const token = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/runs/${created.runId}/stream-token`,
      headers: { authorization: `Bearer ${created.writeToken}` },
    });
    expect(token.statusCode).toBe(404);

    const stream = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/runs/${created.runId}/events?streamToken=x`,
    });
    expect(stream.statusCode).toBe(404);
  });

  it('mints a stream token when the flag is on, and never accepts the write token in the URL', async () => {
    const enabled = createHarness({
      config: {
        corsAllowlist: ['https://cycase.example'],
        features: { sseTelemetry: true, scenarioGeneration: false },
      },
    });

    const created = successData<CreateRunData>(
      (
        await enabled.app.inject({
          method: 'POST',
          url: '/api/v1/runs',
          payload: { scenarioId: 'CASE-001', scenarioVersion: 1, clientBuild: 'test' },
        })
      ).payload,
    );

    const minted = await enabled.app.inject({
      method: 'POST',
      url: `/api/v1/runs/${created.runId}/stream-token`,
      headers: { authorization: `Bearer ${created.writeToken}` },
    });
    expect(minted.statusCode).toBe(201);
    const streamToken = successData<{ streamToken: string }>(minted.payload).streamToken;
    expect(streamToken).not.toBe(created.writeToken);

    // The persistent write token is not a valid stream credential.
    const rejected = await enabled.app.inject({
      method: 'GET',
      url: `/api/v1/runs/${created.runId}/events?streamToken=${encodeURIComponent(created.writeToken)}`,
    });
    expect(rejected.statusCode).toBe(401);

    await enabled.close();
  });
});
