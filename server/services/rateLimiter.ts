/**
 * Fixed-window rate limiting (contract §10: "Rate-limit run creation,
 * generation and command append separately").
 *
 * Hand-rolled rather than plugin-based for one reason worth stating: the
 * contract asks for *separate* limits per operation, and the test that proves
 * "creating runs quickly does not throttle command appends" has to be able to
 * drive a clock. An injectable `now` gives that; a plugin's internal store does
 * not.
 */

export interface RateLimitRule {
  /** Requests permitted per window. */
  limit: number;
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets. Sent as `Retry-After` on a 429. */
  retryAfterSec: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  /**
   * `scope` names the operation ("run_create", "command_append"), so two
   * operations from the same client never share a budget.
   */
  check(scope: string, client: string, rule: RateLimitRule): RateLimitDecision {
    const key = `${scope}::${client}`;
    const now = this.now();
    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
      return { allowed: true, remaining: rule.limit - 1, retryAfterSec: 0 };
    }

    if (bucket.count >= rule.limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      };
    }

    bucket.count += 1;
    return { allowed: true, remaining: rule.limit - bucket.count, retryAfterSec: 0 };
  }

  /** Drops expired buckets so a long-lived process does not grow without bound. */
  prune(): void {
    const now = this.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  reset(): void {
    this.buckets.clear();
  }

  get size(): number {
    return this.buckets.size;
  }
}
