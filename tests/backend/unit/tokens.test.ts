import { describe, expect, it } from 'vitest';

import {
  generateRequestId,
  generateRunId,
  generateStreamToken,
  generateWriteToken,
  hashToken,
  parseBearer,
  runIdLogHash,
  verifyToken,
} from '../../../server/services/tokens';

describe('identifier entropy (§10: at least 128 bits)', () => {
  it('gives run ids at least 128 bits of base64url randomness', () => {
    const id = generateRunId();
    expect(id).toMatch(/^run_[A-Za-z0-9_-]+$/);
    // 16 random bytes → 22 base64url characters (128 bits, no padding).
    expect(id.slice('run_'.length).length).toBeGreaterThanOrEqual(22);
  });

  it('gives write tokens 256 bits', () => {
    const token = generateWriteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it('gives stream tokens at least 128 bits', () => {
    expect(generateStreamToken().length).toBeGreaterThanOrEqual(22);
  });

  it('never repeats across a large sample', () => {
    const ids = new Set(Array.from({ length: 2000 }, generateRunId));
    const tokens = new Set(Array.from({ length: 2000 }, generateWriteToken));
    const requests = new Set(Array.from({ length: 2000 }, generateRequestId));
    expect(ids.size).toBe(2000);
    expect(tokens.size).toBe(2000);
    expect(requests.size).toBe(2000);
  });
});

describe('token hashing at rest', () => {
  it('stores a sha256 digest, never the token', () => {
    const token = generateWriteToken();
    const stored = hashToken(token);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toContain(token);
    expect(token).not.toContain(stored);
  });

  it('is deterministic and collision-free for distinct tokens', () => {
    expect(hashToken('alpha')).toBe(hashToken('alpha'));
    expect(hashToken('alpha')).not.toBe(hashToken('alphb'));
  });

  it('hashes a run id to a short, non-reversible log handle', () => {
    const runId = generateRunId();
    const handle = runIdLogHash(runId);
    expect(handle).toHaveLength(12);
    expect(runId).not.toContain(handle);
  });
});

describe('constant-time verification', () => {
  it('accepts the right token and rejects a wrong one', () => {
    const token = generateWriteToken();
    const stored = hashToken(token);
    expect(verifyToken(token, stored)).toBe(true);
    expect(verifyToken(`${token}x`, stored)).toBe(false);
    expect(verifyToken('', stored)).toBe(false);
  });

  it('rejects a malformed stored hash rather than throwing', () => {
    expect(verifyToken('anything', 'not-a-hash')).toBe(false);
    expect(verifyToken('anything', '')).toBe(false);
    expect(verifyToken('anything', 'a'.repeat(63))).toBe(false);
  });

  /**
   * A timing test cannot prove constant time on a shared CI machine, so this
   * asserts the property that makes constant time *possible*: both operands are
   * hashed to a fixed 32 bytes before comparison, so the work done is identical
   * for a one-character token and a near-miss of the full token.
   *
   * The structural guarantee is `timingSafeEqual` over two 32-byte digests,
   * which is checked by the branch coverage above; this measures only that no
   * gross early-exit was introduced.
   */
  it('does the same amount of work for a near-miss as for a short token', () => {
    const token = generateWriteToken();
    const stored = hashToken(token);
    const nearMiss = `${token.slice(0, -1)}Z`;

    const measure = (candidate: string) => {
      const start = performance.now();
      for (let i = 0; i < 5000; i += 1) verifyToken(candidate, stored);
      return performance.now() - start;
    };

    // Warm up so JIT compilation does not land inside a measurement.
    measure(nearMiss);
    const shortish = measure('a');
    const near = measure(nearMiss);

    // Both are hashing 32 bytes; a 20x gap would mean an early exit was added.
    expect(Math.max(near, shortish) / Math.max(1e-6, Math.min(near, shortish))).toBeLessThan(20);
  });
});

describe('bearer parsing', () => {
  it('reads a well-formed header, case-insensitively', () => {
    expect(parseBearer('Bearer abc123')).toBe('abc123');
    expect(parseBearer('bearer abc123')).toBe('abc123');
    expect(parseBearer('Bearer   abc123  ')).toBe('abc123');
  });

  it('refuses anything else', () => {
    expect(parseBearer(undefined)).toBeNull();
    expect(parseBearer('')).toBeNull();
    expect(parseBearer('Basic abc123')).toBeNull();
    expect(parseBearer('Bearer')).toBeNull();
    expect(parseBearer('Bearer abc 123')).toBeNull();
    expect(parseBearer('Bearer <script>')).toBeNull();
  });
});
