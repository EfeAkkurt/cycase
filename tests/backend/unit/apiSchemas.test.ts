import { describe, expect, it } from 'vitest';

import {
  API_ERROR_CODES,
  API_ERROR_STATUS,
  API_LIMITS,
  appendBatchRequestSchema,
  appendCommandRequestSchema,
  createRunRequestSchema,
  listCommandsQuerySchema,
  withinCommandSizeLimit,
} from '../../../shared/apiContract';
import { playRun } from '../helpers/run';

const valid = playRun().submissions[0]!;

describe('createRunRequestSchema', () => {
  it('accepts the documented body', () => {
    expect(
      createRunRequestSchema.safeParse({
        scenarioId: 'CASE-001',
        scenarioVersion: 1,
        clientBuild: 'v0.1.0 · abc1234',
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown scenario, a wrong version and a missing build', () => {
    expect(
      createRunRequestSchema.safeParse({
        scenarioId: 'CASE-002',
        scenarioVersion: 1,
        clientBuild: 'x',
      }).success,
    ).toBe(false);
    expect(
      createRunRequestSchema.safeParse({
        scenarioId: 'CASE-001',
        scenarioVersion: 2,
        clientBuild: 'x',
      }).success,
    ).toBe(false);
    expect(createRunRequestSchema.safeParse({ scenarioId: 'CASE-001', scenarioVersion: 1 }).success).toBe(
      false,
    );
  });

  it('rejects extra properties rather than silently dropping them', () => {
    expect(
      createRunRequestSchema.safeParse({
        scenarioId: 'CASE-001',
        scenarioVersion: 1,
        clientBuild: 'x',
        isAdmin: true,
      }).success,
    ).toBe(false);
  });

  it('bounds clientBuild', () => {
    expect(
      createRunRequestSchema.safeParse({
        scenarioId: 'CASE-001',
        scenarioVersion: 1,
        clientBuild: 'x'.repeat(API_LIMITS.maxClientBuildLength + 1),
      }).success,
    ).toBe(false);
  });
});

describe('appendCommandRequestSchema', () => {
  it('accepts a submission the engine actually produced', () => {
    expect(appendCommandRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects seq 0 — the API sequence is 1-based', () => {
    expect(appendCommandRequestSchema.safeParse({ ...valid, seq: 0 }).success).toBe(false);
  });

  it('rejects a command kind outside the engine allowlist', () => {
    expect(appendCommandRequestSchema.safeParse({ ...valid, kind: 'drop_tables' }).success).toBe(
      false,
    );
  });

  it('rejects an origin outside human/agent', () => {
    expect(appendCommandRequestSchema.safeParse({ ...valid, origin: 'system' }).success).toBe(false);
  });

  it('rejects a state hash that is not sha256:<64 hex>', () => {
    expect(
      appendCommandRequestSchema.safeParse({ ...valid, clientStateHash: 'deadbeef' }).success,
    ).toBe(false);
    expect(
      appendCommandRequestSchema.safeParse({ ...valid, clientStateHash: `md5:${'a'.repeat(64)}` })
        .success,
    ).toBe(false);
  });

  it('rejects a stateVersion that goes backwards', () => {
    expect(
      appendCommandRequestSchema.safeParse({
        ...valid,
        stateVersionBefore: 5,
        stateVersionAfter: 4,
      }).success,
    ).toBe(false);
  });

  it('allows stateVersionAfter === stateVersionBefore, which request_hint produces', () => {
    expect(
      appendCommandRequestSchema.safeParse({
        ...valid,
        stateVersionBefore: 3,
        stateVersionAfter: 3,
      }).success,
    ).toBe(true);
  });

  it('rejects an idempotency key with unsafe characters or excess length', () => {
    expect(
      appendCommandRequestSchema.safeParse({ ...valid, idempotencyKey: 'a b' }).success,
    ).toBe(false);
    expect(
      appendCommandRequestSchema.safeParse({
        ...valid,
        idempotencyKey: 'a'.repeat(API_LIMITS.maxIdempotencyKeyLength + 1),
      }).success,
    ).toBe(false);
  });

  it('rejects unknown properties', () => {
    expect(appendCommandRequestSchema.safeParse({ ...valid, score: 100 }).success).toBe(false);
  });
});

describe('appendBatchRequestSchema', () => {
  it('accepts up to the documented maximum', () => {
    const commands = Array.from({ length: API_LIMITS.maxBatchCommands }, (_, index) => ({
      ...valid,
      seq: index + 1,
    }));
    expect(appendBatchRequestSchema.safeParse({ commands }).success).toBe(true);
  });

  it('rejects an empty batch and one over the maximum', () => {
    expect(appendBatchRequestSchema.safeParse({ commands: [] }).success).toBe(false);
    const tooMany = Array.from({ length: API_LIMITS.maxBatchCommands + 1 }, (_, index) => ({
      ...valid,
      seq: index + 1,
    }));
    expect(appendBatchRequestSchema.safeParse({ commands: tooMany }).success).toBe(false);
  });
});

describe('listCommandsQuerySchema', () => {
  it('defaults after to 0 and limit to 100', () => {
    const parsed = listCommandsQuerySchema.parse({});
    expect(parsed).toEqual({ after: 0, limit: API_LIMITS.defaultCommandPageSize });
  });

  it('coerces string query parameters', () => {
    expect(listCommandsQuerySchema.parse({ after: '12', limit: '5' })).toEqual({
      after: 12,
      limit: 5,
    });
  });

  it('caps limit at the documented maximum', () => {
    expect(
      listCommandsQuerySchema.safeParse({ limit: API_LIMITS.maxCommandPageSize + 1 }).success,
    ).toBe(false);
    expect(listCommandsQuerySchema.safeParse({ after: -1 }).success).toBe(false);
  });
});

describe('per-command size limit', () => {
  it('accepts a real submission', () => {
    expect(withinCommandSizeLimit(valid)).toBe(true);
  });

  it('rejects a command padded past the cap', () => {
    expect(
      withinCommandSizeLimit({ ...valid, input: { blob: 'x'.repeat(API_LIMITS.maxCommandJsonBytes) } }),
    ).toBe(false);
  });

  it('rejects a value that cannot be serialised at all', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(withinCommandSizeLimit(cyclic)).toBe(false);
  });
});

describe('error envelope', () => {
  it('maps every code to a status, with both conflict codes on 409', () => {
    for (const code of API_ERROR_CODES) {
      expect(API_ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
    }
    expect(API_ERROR_STATUS.CONFLICT).toBe(409);
    expect(API_ERROR_STATUS.REPLAY_MISMATCH).toBe(409);
    expect(API_ERROR_STATUS.RATE_LIMITED).toBe(429);
  });
});
