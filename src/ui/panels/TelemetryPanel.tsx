import { Suspense, lazy, useMemo } from 'react';

import { useStableGame } from '../../app/gameContext';
import { eventCategories } from '../../game/fixtures/telemetry';
import {
  currentRate,
  eventWindow,
  latestBucket,
  severityWindow,
} from '../../game/live';
import { t } from '../../i18n';
import { ChartSkeleton, CompactEventStream, LiveStreamStatus } from '../charts';
import { Panel } from '../primitives';
import type { GameContext } from '../../game/types';
import type { PanelMode } from './mode';

/**
 * Event telemetry. One component, two modes:
 *
 * - `compact` renders inside an office monitor bezel;
 * - `full` renders as a dashboard panel.
 *
 * The window slides because the simulation clock advances, and every sample is
 * drawn from the incident's own profile — see `game/live.ts`. Nothing here is
 * random, and the curves flatten because containment actually happened.
 *
 * Series are bone-grey by default. Red marks attacker activity and nothing
 * else, which is the only way a chart stays readable at a glance.
 *
 * The full-mode charts are Recharts, through the shadcn chart container in
 * `ui/charts`. They are `lazy` for one measured reason: the office draws three
 * of these panels onto 3D monitors inside a frame-rate budget, and a static
 * import would put the whole charting library in the chunk the office loads.
 * Compact mode draws its own SVG and never touches it.
 */
export type { PanelMode };

const EventStreamChart = lazy(() =>
  import('../charts/TelemetryCharts').then((module) => ({ default: module.EventStreamChart })),
);
const CategoryChart = lazy(() =>
  import('../charts/TelemetryCharts').then((module) => ({ default: module.CategoryChart })),
);
const SeverityChart = lazy(() =>
  import('../charts/TelemetryCharts').then((module) => ({ default: module.SeverityChart })),
);

/**
 * Two contexts draw the same charts.
 *
 * Every number on this panel is a function of exactly two things: which bucket
 * the clock is in, and the case state version. Nothing else can move a sample —
 * `TICK` deliberately does not bump `stateVersion` (`game/machine.ts`), so the
 * version covers every case change, such as a containment action collapsing the
 * curve, and the bucket covers the passage of time.
 *
 * So a tick that lands inside the current bucket is genuinely the same picture,
 * and republishing it would only give Recharts a new `data` array to re-animate
 * once a second — per-second motion that would contradict the panel's one
 * promise, that a data point appears when and only when a bucket boundary is
 * crossed. The ticking readouts live in `LiveStreamStatus`, which subscribes on
 * its own, so a passing second re-renders one small span instead of three
 * charts.
 */
function sameStream(previous: GameContext, next: GameContext): boolean {
  return (
    previous.stateVersion === next.stateVersion &&
    latestBucket(previous) === latestBucket(next) &&
    previous.paused === next.paused
  );
}

export function TelemetryPanel({ mode = 'full' }: { mode?: PanelMode }) {
  // Republished on a bucket boundary, a state change or a pause — never on a
  // bare tick. See `sameStream` above.
  const ctx = useStableGame(sameStream);

  const { window, rate, categories, severity } = useMemo(
    () => ({
      window: eventWindow(ctx),
      rate: currentRate(ctx),
      categories: eventCategories(ctx),
      severity: severityWindow(ctx),
    }),
    [ctx],
  );

  const from = window[0]?.label ?? '';
  const to = window[window.length - 1]?.label ?? '';

  return (
    <Panel
      id="overview-telemetry"
      title={t('overview.telemetry')}
      compact={mode === 'compact'}
      headingLevel={mode === 'compact' ? 3 : 2}
      actions={
        <span className="mono muted text-xs">
          {rate.total}/min · {rate.anomalous} anomalous
        </span>
      }
    >
      {mode === 'compact' ? (
        <figure className="stack stack--tight" style={{ margin: 0 }}>
          <CompactEventStream window={window} />
          <figcaption className="chart__legend">
            <span className="chart__legend-item">
              <span className="dot" style={{ background: 'var(--chart-series-baseline)' }} />{' '}
              Baseline
            </span>
            <span className="chart__legend-item">
              <span className="dot dot--critical" /> Anomalous
            </span>
            {/* Monitor distance: the chip, but not the per-second counters.
                Three of these panels are projected onto the office glass, and
                a digit ticking at 1 Hz on each is neither legible from the
                seat nor worth the DOM writes. */}
            <LiveStreamStatus compact />
          </figcaption>
        </figure>
      ) : (
        <div className="stack stack--tight">
          <figure className="viz-figure">
            <figcaption className="viz-figure__caption">
              <span className="eyebrow">Anomaly stream</span>
              <span className="mono muted">{from}–{to}</span>
              {/* The bucket width used to be stated here as "30s samples" and
                  left at that. It is now the live chip, which says the same
                  thing and also answers the question it used to raise: if the
                  stream is live, why has the line not moved? */}
              <LiveStreamStatus />
            </figcaption>
            <Suspense fallback={<ChartSkeleton height={168} />}>
              <EventStreamChart window={window} />
            </Suspense>
          </figure>

          <div className="grid-2">
            <figure className="viz-figure">
              <figcaption className="viz-figure__caption">
                <span className="eyebrow">Event categories</span>
                <span className="mono muted">share of window</span>
              </figcaption>
              <Suspense fallback={<ChartSkeleton height={150} />}>
                <CategoryChart categories={categories} />
              </Suspense>
            </figure>

            <figure className="viz-figure">
              <figcaption className="viz-figure__caption">
                <span className="eyebrow">Severity over time</span>
                <span className="mono muted">
                  {from}–{to}
                </span>
              </figcaption>
              <Suspense fallback={<ChartSkeleton height={150} />}>
                <SeverityChart series={severity} window={window} />
              </Suspense>
            </figure>
          </div>
        </div>
      )}
    </Panel>
  );
}
