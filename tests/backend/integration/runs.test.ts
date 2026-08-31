import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { replayHistory, signatureHash } from '../../../server/services/replayVerifier';
import type {
  AppendBatchData,
  AppendCommandData,
  CreateRunData,
  HealthData,
  ListCommandsData,
  RunSummaryData,
} from '../../../shared/apiContract';
import { hashContext } from '../../../shared/runSignature';
import { createInitialContext } from '../../../src/game/context';
import { playRun } from '../helpers/run';
import { createHarness, failure, successData, type Harness } from '../helpers/server';

describe('run lifecycle', () => {
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
      payload: { scenarioId: 'CASE-001', scenarioVersion: 1, clientBuild: 'v0.1.0 · test' },
    });
    expect(response.statusCode).toBe(201);
    return successData<CreateRunData>(response.payload);
  }

  /* ---------------- health ---------------- */

  it('reports readiness with a version and the scenario schema version', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(response.statusCode).toBe(200);
    const data = successData<HealthData>(response.payload);
    expect(data).toEqual({
      status: 'ready',
      version: 'test-sha',
      database: 'ready',
      scenarioSchemaVersion: 1,
    });
  });

  it('returns 503 when persistence is unavailable', async () => {
    harness.repository.healthy = false;
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(response.statusCode).toBe(503);
    expect(successData<HealthData>(response.payload).database).toBe('unavailable');
  });

  it('gives every response an opaque request id', async () => {
    const a = await harness.app.inject({ method: 'GET', url: '/api/v1/health' });
    const b = await harness.app.inject({ method: 'GET', url: '/api/v1/health' });
    const idA = JSON.parse(a.payload).requestId as string;
    const idB = JSON.parse(b.payload).requestId as string;
    expect(idA).toMatch(/^req_/);
    expect(idA).not.toBe(idB);
  });

  /* ---------------- create ---------------- */

  it('creates a run with a one-time token, an expiry and the initial state hash', async () => {
    const data = await createRun();
    expect(data.runId).toMatch(/^run_[A-Za-z0-9_-]{22,}$/);
    expect(data.writeToken.length).toBeGreaterThanOrEqual(43);
    expect(data.initialStateHash).toBe(hashContext(createInitialContext()));

    // §6: anonymous runs expire after seven days.
    const ttlDays = (Date.parse(data.expiresAt) - harness.now()) / 86_400_000;
    expect(ttlDays).toBeCloseTo(7, 5);

    // The token is hashed at rest.
    const stored = await harness.repository.getRun(data.runId);
    expect(stored!.writeTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored!.writeTokenHash).not.toContain(data.writeToken);
  });

  it('rejects a malformed create body without leaking internals', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      payload: { scenarioId: 'CASE-999', scenarioVersion: 1, clientBuild: 'x' },
    });
    expect(response.statusCode).toBe(400);
    const error = failure(response.payload);
    expect(error.code).toBe('INVALID_INPUT');
    expect(error.message).not.toMatch(/zod|stack|at Object/i);
  });

  /* ---------------- the headline path ---------------- */

  it('create -> append -> fetch -> replay lands on an identical signature', async () => {
    const run = await createRun();
    const played = playRun();

    for (const submission of played.submissions) {
      const response = await harness.app.inject({
        method: 'POST',
        url: `/api/v1/runs/${run.runId}/commands`,
        headers: { authorization: `Bearer ${run.writeToken}` },
        payload: submission,
      });
      expect(response.statusCode, `seq ${submission.seq}`).toBe(201);
      const data = successData<AppendCommandData>(response.payload);
      expect(data.seq).toBe(submission.seq);
      expect(data.duplicate).toBe(false);
      expect(data.stateHash).toBe(submission.clientStateHash);
    }

    const summaryResponse = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/runs/${run.runId}`,
      headers: { authorization: `Bearer ${run.writeToken}` },
    });
    const summary = successData<RunSummaryData>(summaryResponse.payload);
    expect(summary.lastSeq).toBe(played.submissions.length);
    expect(summary.status).toBe('closed');
    expect(summary.ending).toBe('contained');
    expect(summary.score).toEqual({
      total: 100,
      max: 100,
      buckets: { evidence: 30, containment: 35, scope: 20, efficiency: 15 },
    });
    expect(summary.replaySignature).toBe(hashContext(played.context));

    // Never returns the token or anything provider-shaped.
    expect(JSON.stringify(summary)).not.toContain(run.writeToken);
    expect(summaryResponse.payload).not.toMatch(/writeToken|write_token_hash/);

    const logResponse = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/runs/${run.runId}/commands?after=0&limit=500`,
      headers: { authorization: `Bearer ${run.writeToken}` },
    });
    const log = successData<ListCommandsData>(logResponse.payload);
    expect(log.commands).toHaveLength(played.submissions.length);
    expect(log.hasMore).toBe(false);

    // The client's own reconstruction from the fetched log.
    const rebuilt = replayHistory(log.commands);
    expect(signatureHash(rebuilt)).toBe(summary.replaySignature);
    expect(rebuilt.ending).toBe('contained');
  });

  it('pages the command log and reports hasMore', async () => {
    const run = await createRun();
    const played = playRun();
    await harness.app.inject({
      method: 'POST',
      url: `/api/v1/runs/${run.runId}/commands/batch`,
      headers: { authorization: `Bearer ${run.writeToken}` },
      payload: { commands: played.submissions },
    });

    const first = successData<ListCommandsData>(
      (
        await harness.app.inject({
          method: 'GET',
          url: `/api/v1/runs/${run.runId}/commands?after=0&limit=3`,
          headers: { authorization: `Bearer ${run.writeToken}` },
        })
      ).payload,
    );
    expect(first.commands.map((c) => c.seq)).toEqual([1, 2, 3]);
    expect(first.hasMore).toBe(true);

    const rest = successData<ListCommandsData>(
      (
        await harness.app.inject({
          method: 'GET',
          url: `/api/v1/runs/${run.runId}/commands?after=3&limit=500`,
          headers: { authorization: `Bearer ${run.writeToken}` },
        })
      ).payload,
    );
    expect(rest.commands[0]!.seq).toBe(4);
    expect(rest.hasMore).toBe(false);
  });

  it('preserves human and agent origins exactly', async () => {
    const run = await createRun();
    const played = playRun(undefined, 'agent');
    await harness.app.inject({
      method: 'POST',
      url: `/api/v1/runs/${run.runId}/commands/batch`,
      headers: { authorization: `Bearer ${run.writeToken}` },
      payload: { commands: played.submissions.slice(0, 5) },
    });

    const log = successData<ListCommandsData>(
      (
        await harness.app.inject({
          method: 'GET',
          url: `/api/v1/runs/${run.runId}/commands`,
          headers: { authorization: `Bearer ${run.writeToken}` },
        })
      ).payload,
    );
    expect(log.commands.every((command) => command.origin === 'agent')).toBe(true);
  });

  /* ---------------- duplicates and conflicts ---------------- */

  it('a duplicate (runId, seq) returns the ORIGINAL acknowledgement and applies nothing', async () => {
    const run = await createRun();
    const played = playRun();
    const first = played.submissions[0]!;

    const original = successData<AppendCommandData>(
      (
        await harness.app.inject({
          method: 'POST',
          url: `/api/v1/runs/${run.runId}/commands`,
          headers: { authorization: `Bearer ${run.writeToken}` },
          payload: first,
        })
      ).payload,
    );

    const repeat = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/runs/${run.runId}/commands`,
      headers: { authorization: `Bearer ${run.writeToken}` },
      payload: first,
    });
    const replayed = successData<AppendCommandData>(repeat.payload);

    expect(repeat.statusCode).toBe(200);
    expect(replayed.duplicate).toBe(true);
    expect(replayed.seq).toBe(original.seq);
    expect(replayed.stateHash).toBe(original.stateHash);
    expect(replayed.lastSeq).toBe(original.lastSeq);
    expect(await harness.repository.allCommands(run.runId)).toHaveLength(1);
  });

  it('a duplicate idempotency key cannot apply twice, even with a different seq', async () => {
    const run = await createRun();
    const played = playRun();
    const first = played.submissions[0]!;

    await harness.app.inject({
      method: 'POST',
      url: `/api/v1/runs/${run.runId}/commands`,
      headers: { authorization: `Bearer ${run.writeToken}` },
      payload: first,
    });

    // Same transport key, next sequence: the server must recognise the retry.
    const second = played.submissions[1]!;
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/runs/${run.runId}/commands`,
      headers: { authorization: `Bearer ${run.writeToken}` },
      payload: { ...second, idempotencyKey: first.idempotencyKey },
    });

    const data = successData<AppendCommandData>(response.payload);
    expect(data.duplicate).toBe(true);
    expect(data.seq).toBe(1);
    expect(await harness.repository.allCommands(run.runId)).toHaveLength(1);
  });

  it('a skipped sequence returns 409 CONFLICT with the expected sequence', async () => {
    const run = await createRun();
    const played = playRun();

    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/runs/${run.runId}/commands`,
      headers: { authorization: `Bearer ${run.writeToken}` },
      payload: played.submissions[2]!,
    });

    expect(response.statusCode).toBe(409);
    const error = failure(response.payload);
    expect(error.code).toBe('CONFLICT');
    expect(error.expectedSeq).toBe(1);
    expect(error.recovery).toContain('seq 1');
    expect(await harness.repository.allCommands(run.runId)).toHaveLength(0);
  });

  /* ---------------- replay mismatch ---------------- */

  it('a divergent command returns 409 REPLAY_MISMATCH and does NOT advance the run', async () => {
    const run = await createRun();
    const played = playRun();

    await harness.app.inject({
      method: 'POST',
      url: `/api/v1/runs/${run.runId}/commands`,
      headers: { authorization: `Bearer ${run.writeToken}` },
      payload: played.submissions[0]!,
    });
    const before = await harness.repository.getRun(run.runId);

    const tampered = {
      ...played.submissions[1]!,
      clientStateHash: `sha256:${'f'.repeat(64)}`,
    };
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/runs/${run.runId}/commands`,
      headers: { authorization: `Bearer ${run.writeToken}` },
      payload: tampered,
    });

    expect(response.statusCode).toBe(409);
    const error = failure(response.payload);
    expect(error.code).toBe('REPLAY_MISMATCH');
    expect(error.recovery).toContain('not advanced');

    const after = await harness.repository.getRun(run.runId);
    expect(after!.lastSeq).toBe(before!.lastSeq);
    expect(after!.stateHash).toBe(before!.stateHash);
    expect(await harness.repository.allCommands(run.runId)).toHaveLength(1);
  });

  it('refuses a forged score by refusing the command that would have produced it', async () => {
    const run = await createRun();
    const played = playRun();
    const forged = {
      ...played.submissions[0]!,
      result: {
        ...played.submissions[0]!.result,
        data: { ...(played.submissions[0]!.result.data as object), correct: true, score: 100 },
      },
    };

    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/runs/${run.runId}/commands`,
      headers: { authorization: `Bearer ${run.writeToken}` },
      payload: forged,
    });
    expect(failure(response.payload).code).toBe('REPLAY_MISMATCH');
    expect((await harness.repository.getRun(run.runId))!.score).toBeNull();
  });

  /* ---------------- batch ---------------- */

  it('accepts a contiguous batch and advances once', async () => {
    const run = await createRun();
    const played = playRun();
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/runs/${run.runId}/commands/batch`,
      headers: { authorization: `Bearer ${run.writeToken}` },
      payload: { commands: played.submissions },
    });

    expect(response.statusCode).toBe(201);
    const data = successData<AppendBatchData>(response.payload);
    expect(data.accepted).toBe(played.submissions.length);
    expect(data.status).toBe('closed');
    expect(data.ending).toBe('contained');
  });

  it('a mid-batch failure persists NOTHING', async () => {
    const run = await createRun();
    const played = playRun();
    const commands = played.submissions.map((submission, index) =>
      index === 4 ? { ...submission, clientStateHash: `sha256:${'e'.repeat(64)}` } : submission,
    );

    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/runs/${run.runId}/commands/batch`,
      headers: { authorization: `Bearer ${run.writeToken}` },
      payload: { commands },
    });

    expect(response.statusCode).toBe(409);
    expect(failure(response.payload).code).toBe('REPLAY_MISMATCH');
    // Not four rows, not one: none.
    expect(await harness.repository.allCommands(run.runId)).toHaveLength(0);
    expect((await harness.repository.getRun(run.runId))!.lastSeq).toBe(0);
  });

  it('rejects a non-contiguous batch before doing any work', async () => {
    const run = await createRun();
    const played = playRun();
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/runs/${run.runId}/commands/batch`,
      headers: { authorization: `Bearer ${run.writeToken}` },
      payload: { commands: [played.submissions[0]!, played.submissions[2]!] },
    });
    expect(response.statusCode).toBe(400);
    expect(failure(response.payload).code).toBe('INVALID_INPUT');
    expect(await harness.repository.allCommands(run.runId)).toHaveLength(0);
  });

  it('refuses a batch over the documented maximum', async () => {
    const run = await createRun();
    const played = playRun();
    const commands = Array.from({ length: 51 }, (_, index) => ({
      ...played.submissions[0]!,
      seq: index + 1,
    }));
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/runs/${run.runId}/commands/batch`,
      headers: { authorization: `Bearer ${run.writeToken}` },
      payload: { commands },
    });
    expect(response.statusCode).toBe(400);
  });

  /* ---------------- resume: the missing suffix ---------------- */

  it('a reconnect uploads only the contiguous missing suffix, exactly once', async () => {
    const run = await createRun();
    const played = playRun();

    // The first five landed before the outage.
    await harness.app.inject({
      method: 'POST',
      url: `/api/v1/runs/${run.runId}/commands/batch`,
      headers: { authorization: `Bearer ${run.writeToken}` },
      payload: { commands: played.submissions.slice(0, 5) },
    });

    const summary = successData<RunSummaryData>(
      (
        await harness.app.inject({
          method: 'GET',
          url: `/api/v1/runs/${run.runId}`,
          headers: { authorization: `Bearer ${run.writeToken}` },
        })
      ).payload,
    );
    expect(summary.lastSeq).toBe(5);

    // The client uploads from last_seq + 1 and nothing earlier.
    const suffix = played.submissions.filter((submission) => submission.seq > summary.lastSeq);
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/runs/${run.runId}/commands/batch`,
      headers: { authorization: `Bearer ${run.writeToken}` },
      payload: { commands: suffix },
    });
    expect(response.statusCode).toBe(201);

    const stored = await harness.repository.allCommands(run.runId);
    expect(stored).toHaveLength(played.submissions.length);
    expect(new Set(stored.map((c) => c.seq)).size).toBe(stored.length);
    expect(signatureHash(replayHistory(stored))).toBe(hashContext(played.context));
  });

  it('refuses further commands once the case is closed', async () => {
    const run = await createRun();
    const played = playRun();
    await harness.app.inject({
      method: 'POST',
      url: `/api/v1/runs/${run.runId}/commands/batch`,
      headers: { authorization: `Bearer ${run.writeToken}` },
      payload: { commands: played.submissions },
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/runs/${run.runId}/commands`,
      headers: { authorization: `Bearer ${run.writeToken}` },
      payload: {
        ...played.submissions[0]!,
        seq: played.submissions.length + 1,
        // A fresh transport key, so this exercises the closed-run branch rather
        // than the idempotency replay above it.
        idempotencyKey: 'append.after-close',
      },
    });
    expect(response.statusCode).toBe(409);
    expect(failure(response.payload).code).toBe('CONFLICT');
  });
});
