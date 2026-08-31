import { tk } from '../i18n';
import {
  SCORE_BUCKET_MAX,
  type CompactScore,
  type ScoreBreakdown,
  type ScoreBucket,
  type ScoreEntry,
} from './types';

const BUCKETS: ScoreBucket[] = ['evidence', 'containment', 'scope', 'efficiency'];

/**
 * The score is a pure function of the append-only score log, so it is fully
 * replayable and auditable. Nothing else — and certainly no LLM — may write it.
 *
 * Each bucket is summed independently and clamped to `[0, max]`, which means a
 * player cannot go negative overall by making many small mistakes in one area,
 * and cannot exceed a bucket's ceiling by repeating a rewarded step.
 */
export function computeScore(entries: readonly ScoreEntry[]): ScoreBreakdown {
  const buckets = {} as ScoreBreakdown['buckets'];

  for (const bucket of BUCKETS) {
    const max = SCORE_BUCKET_MAX[bucket];
    const raw = entries
      .filter((entry) => entry.bucket === bucket)
      .reduce((sum, entry) => sum + entry.delta, 0);
    buckets[bucket] = { earned: clamp(raw, 0, max), max };
  }

  const total = BUCKETS.reduce((sum, bucket) => sum + buckets[bucket].earned, 0);
  const max = BUCKETS.reduce((sum, bucket) => sum + SCORE_BUCKET_MAX[bucket], 0);

  return { buckets, total, max, entries: [...entries] };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Localized, human-readable score log for the debrief. */
export function describeScoreEntries(
  entries: readonly ScoreEntry[],
): { bucket: ScoreBucket; delta: number; reason: string; source: string }[] {
  return entries.map((entry) => ({
    bucket: entry.bucket,
    delta: entry.delta,
    reason: tk(entry.reasonKey),
    source: entry.source,
  }));
}

/** Wire-sized score for tool results. */
export function compactScore(breakdown: ScoreBreakdown): CompactScore {
  return {
    total: breakdown.total,
    max: breakdown.max,
    buckets: {
      evidence: breakdown.buckets.evidence.earned,
      containment: breakdown.buckets.containment.earned,
      scope: breakdown.buckets.scope.earned,
      efficiency: breakdown.buckets.efficiency.earned,
    },
  };
}
