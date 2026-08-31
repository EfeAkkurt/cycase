import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Identifier and write-token handling (contract §10).
 *
 * Three properties are load-bearing and each is tested:
 *
 * - **≥128 bits of randomness.** Run ids get 16 bytes, write tokens 32. Both
 *   come from `randomBytes`, never `Math.random`.
 * - **Hashed at rest.** Only `sha256(token)` reaches the database, so a dump of
 *   the runs table does not hand anyone a write capability.
 * - **Constant-time comparison.** Verification compares fixed-length digests
 *   with `timingSafeEqual`, so a wrong token leaks no prefix information.
 *
 * SHA-256 rather than a slow KDF is the right choice *here* specifically
 * because the token is a 256-bit random value we generated: there is no
 * password to grind, and a memory-hard KDF would only add latency to every
 * command append. It would be the wrong choice for a user-chosen secret.
 */

const RUN_ID_BYTES = 16; // 128 bits
const WRITE_TOKEN_BYTES = 32; // 256 bits
const STREAM_TOKEN_BYTES = 16; // 128 bits

function base64url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

export function generateRunId(): string {
  return `run_${base64url(randomBytes(RUN_ID_BYTES))}`;
}

export function generateWriteToken(): string {
  return base64url(randomBytes(WRITE_TOKEN_BYTES));
}

export function generateStreamToken(): string {
  return base64url(randomBytes(STREAM_TOKEN_BYTES));
}

export function generateRequestId(): string {
  return `req_${base64url(randomBytes(12))}`;
}

/** Lowercase hex sha256. Used for write tokens and idempotency keys at rest. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Constant-time token check.
 *
 * Both sides are hashed first, which makes the compared buffers a fixed 32
 * bytes regardless of the presented token's length — `timingSafeEqual` throws
 * on a length mismatch, and branching on that would itself be a length oracle.
 */
export function verifyToken(presented: string, storedHash: string): boolean {
  if (typeof presented !== 'string' || presented.length === 0) return false;
  if (typeof storedHash !== 'string' || storedHash.length !== 64) return false;

  const presentedDigest = createHash('sha256').update(presented, 'utf8').digest();
  let storedDigest: Buffer;
  try {
    storedDigest = Buffer.from(storedHash, 'hex');
  } catch {
    return false;
  }
  if (storedDigest.length !== presentedDigest.length) return false;

  return timingSafeEqual(presentedDigest, storedDigest);
}

/** `Authorization: Bearer <token>` → token, or null. Case-insensitive scheme. */
export function parseBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+([A-Za-z0-9._~+/=-]+)\s*$/i.exec(header);
  return match ? (match[1] ?? null) : null;
}

/** Short, non-reversible run identifier for logs (§11: "run id hash, never token"). */
export function runIdLogHash(runId: string): string {
  return hashToken(runId).slice(0, 12);
}
