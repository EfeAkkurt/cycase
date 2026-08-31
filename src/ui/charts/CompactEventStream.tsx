import { SAMPLE_SECONDS, type Sample } from '../../game/live';

/**
 * The office variant of the event stream.
 *
 * The dashboard chart is Recharts; this one is forty lines of SVG with no
 * dependencies at all. That is a deliberate split, not an oversight: this panel
 * is rendered onto the 3D monitors in the office, three of them, inside a scene
 * that has a frame-rate budget. Recharts allocates a Redux store, a resize
 * observer and a layout pass per chart, and the office does not need any of it
 * to draw a 320x56 thumbnail — so `compact` never imports the chart module, and
 * Recharts stays out of the office's chunk entirely.
 *
 * It is drawn to the same rules as its big sibling: the same two series, the
 * same colours, a real 1px gridline, and a text description.
 */

const WIDTH = 320;
const HEIGHT = 56;

export function CompactEventStream({ window: samples }: { window: Sample[] }) {
  const peak = Math.max(1, ...samples.map((sample) => sample.baseline + sample.anomaly));
  const step = WIDTH / Math.max(1, samples.length - 1);

  const x = (index: number) => index * step;
  const y = (value: number) => HEIGHT - (value / peak) * HEIGHT;

  const baselineTop = samples.map((sample, index) => `${x(index).toFixed(1)} ${y(sample.baseline).toFixed(1)}`);
  const totalTop = samples.map((sample, index) =>
    `${x(index).toFixed(1)} ${y(sample.baseline + sample.anomaly).toFixed(1)}`,
  );

  const baselineArea = samples.length
    ? `M0 ${HEIGHT} L${baselineTop.join(' L')} L${WIDTH} ${HEIGHT} Z`
    : '';
  // The anomalous band is the ribbon between the two curves: up the total, back
  // along the baseline. Stacked, exactly as the dashboard draws it.
  const anomalyBand = samples.length
    ? `M${totalTop.join(' L')} L${[...baselineTop].reverse().join(' L')} Z`
    : '';

  const anomalyTotal = samples.reduce((sum, sample) => sum + sample.anomaly, 0);
  const from = samples[0]?.label ?? '';
  const last = samples[samples.length - 1];
  const to = last?.label ?? '';
  const description =
    `Event stream from ${from} to ${to}, one sample every ${SAMPLE_SECONDS} seconds. ` +
    `${anomalyTotal} anomalous events above a stable baseline. ` +
    `Newest sample ${to}, ${last ? last.baseline + last.anomaly : 0} events.`;

  /*
   * The active sample, marked at the right edge.
   *
   * Drawn as strokes rather than a circle on purpose: this SVG is stretched
   * with `preserveAspectRatio="none"`, so anything with width would arrive as
   * an ellipse at whatever aspect the monitor bezel happens to be. A vertical
   * rule has no width to distort, and `non-scaling-stroke` keeps it a hairline
   * at every size.
   */
  const edgeY = last ? y(last.baseline + last.anomaly) : HEIGHT;

  return (
    <svg
      className="chart chart--spark"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={description}
    >
      <line
        x1={0}
        y1={HEIGHT / 2}
        x2={WIDTH}
        y2={HEIGHT / 2}
        stroke="var(--chart-grid)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      <path d={baselineArea} fill="var(--chart-series-baseline-fill)" />
      <path d={anomalyBand} fill="var(--chart-series-anomaly-fill)" />
      <path
        d={samples.length ? `M${baselineTop.join(' L')}` : ''}
        fill="none"
        stroke="var(--chart-series-baseline)"
        strokeWidth={1.2}
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={samples.length ? `M${totalTop.join(' L')}` : ''}
        fill="none"
        stroke="var(--chart-series-anomaly)"
        strokeWidth={1.4}
        vectorEffect="non-scaling-stroke"
      />

      {last ? (
        // Keyed on the sample's own clock, so the landing animation replays
        // exactly when a bucket lands and at no other time. A paused clock
        // cannot cross a boundary, so a paused stream sits still.
        <g key={last.atSec} className="chart__edge">
          <line
            x1={WIDTH - 0.5}
            y1={0}
            x2={WIDTH - 0.5}
            y2={HEIGHT}
            stroke="var(--chart-grid)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={WIDTH - 0.5}
            y1={Math.max(0, edgeY - 5)}
            x2={WIDTH - 0.5}
            y2={Math.min(HEIGHT, edgeY + 5)}
            stroke="var(--chart-series-anomaly)"
            strokeWidth={3}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      ) : null}
    </svg>
  );
}
