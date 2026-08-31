/**
 * Chart surface for the product.
 *
 * `chart.tsx` is the shadcn/ui chart component ported to this project's CSS
 * conventions; the rest are the concrete charts built on it. Recharts is only
 * reachable through the lazily loaded modules, never from this barrel — an
 * eager re-export here would pull the whole library back into the main chunk.
 */
export { ChartSkeleton } from './ChartSkeleton';
export { CompactEventStream } from './CompactEventStream';
export { LiveStreamStatus } from './LiveStreamStatus';
export type { ChartConfig } from './chart';
export type { ScoreBucketRow } from './ScoreBreakdownChart';
