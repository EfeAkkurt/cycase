/**
 * What a chart looks like while its chunk is still arriving.
 *
 * It reserves the exact height the chart will take, so nothing under it jumps
 * when the real chart lands, and it is hidden from assistive technology — a
 * placeholder has nothing to describe, and announcing one would be noise.
 */
export function ChartSkeleton({ height = 168 }: { height?: number }) {
  return <div className="viz__skeleton" style={{ height }} aria-hidden="true" />;
}
