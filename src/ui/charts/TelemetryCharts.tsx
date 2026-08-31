import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';

import { usePrefersReducedMotion } from '../../app/gameContext';
import type { eventCategories } from '../../game/fixtures/telemetry';
import { SAMPLE_SECONDS, type Sample } from '../../game/live';
import { formatClock } from '../../game/selectors';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  animationProps,
  surfaceProps,
  type ChartConfig,
} from './chart';

/**
 * The dashboard telemetry charts. Loaded lazily, which is what keeps Recharts
 * out of the main bundle and out of the office entirely — the office renders
 * the same panels in `compact` mode, and compact mode never reaches this file.
 *
 * Every series is a pure function of the case state handed in. Nothing is
 * generated here, nothing is sampled from a clock this module owns, and no
 * value is rounded differently than `game/live.ts` rounded it — two runs at the
 * same simulation time must draw the same picture.
 */

/* ------------------------------------------------------------------ *
 * Event stream — the anomaly stream over time
 * ------------------------------------------------------------------ */

const STREAM_CONFIG: ChartConfig = {
  baseline: { label: 'Baseline traffic', color: 'var(--chart-series-baseline)' },
  anomaly: { label: 'Anomalous', color: 'var(--chart-series-anomaly)' },
};

/** Five evenly spaced sample times, so the axis carries real clock values. */
function axisTicks(window: Sample[]): number[] {
  if (window.length === 0) return [];
  const wanted = Math.min(5, window.length);
  const step = (window.length - 1) / Math.max(1, wanted - 1);
  const ticks: number[] = [];
  for (let i = 0; i < wanted; i += 1) {
    ticks.push(window[Math.round(i * step)]!.atSec);
  }
  return [...new Set(ticks)];
}

const hhmm = (atSec: number) => formatClock(atSec).slice(0, 5);

/**
 * The tooltip heading is the simulation clock the sample was taken on.
 *
 * It reads the timestamp out of the row rather than out of the formatted axis
 * label: shadcn's `labelFormatter` is handed the *config* label when the axis
 * value is not a string, and this axis is numeric seconds, so formatting the
 * first argument would print `NaN:NaN:NaN`.
 */
const clockLabel = (_label: unknown, payload: readonly { payload?: { atSec?: number } }[]) =>
  formatClock(Number(payload?.[0]?.payload?.atSec ?? 0));

export function EventStreamChart({ window: samples }: { window: Sample[] }) {
  const reducedMotion = usePrefersReducedMotion();

  const data = samples.map((sample) => ({
    atSec: sample.atSec,
    baseline: sample.baseline,
    anomaly: sample.anomaly,
  }));

  const anomalyTotal = samples.reduce((sum, sample) => sum + sample.anomaly, 0);
  const peak = samples.reduce(
    (worst, sample) => (sample.anomaly > worst.anomaly ? sample : worst),
    samples[0] ?? { atSec: 0, anomaly: 0, baseline: 0, label: '' },
  );
  const from = samples[0] ? hhmm(samples[0].atSec) : '';
  const to = samples[samples.length - 1] ? hhmm(samples[samples.length - 1]!.atSec) : '';

  const last = samples[samples.length - 1];
  const description =
    `Event stream from ${from} to ${to}, one sample every ${SAMPLE_SECONDS} seconds. ` +
    `${anomalyTotal} anomalous events sit on top of a stable baseline` +
    (anomalyTotal > 0 ? `, peaking at ${peak.anomaly} events at ${hhmm(peak.atSec)}.` : '.') +
    (last ? ` Newest sample ${to}, ${last.baseline + last.anomaly} events.` : '');

  return (
    <ChartContainer config={STREAM_CONFIG} height={168} className="viz--stream">
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }} {...surfaceProps(description)}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="atSec"
          type="number"
          domain={['dataMin', 'dataMax']}
          ticks={axisTicks(samples)}
          tickFormatter={hhmm}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={12}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          tickCount={4}
          allowDecimals={false}
          width={44}
        />
        <ChartTooltip
          cursor={{ strokeDasharray: '3 3' }}
          content={<ChartTooltipContent unit="events" labelFormatter={clockLabel} />}
        />
        <Area
          dataKey="baseline"
          stackId="stream"
          type="linear"
          stroke="var(--color-baseline)"
          fill="var(--color-baseline)"
          fillOpacity={0.16}
          strokeWidth={1.5}
          dot={false}
          activeDot={{ r: 2.5, strokeWidth: 1 }}
          {...animationProps(reducedMotion)}
        />
        <Area
          dataKey="anomaly"
          stackId="stream"
          type="linear"
          stroke="var(--color-anomaly)"
          fill="var(--color-anomaly)"
          fillOpacity={0.24}
          strokeWidth={1.5}
          dot={false}
          activeDot={{ r: 2.5, strokeWidth: 1 }}
          {...animationProps(reducedMotion)}
        />
        {/*
         * The active sample, marked at the right edge.
         *
         * A stream that appends every thirty seconds needs somewhere for the
         * eye to rest between appends, and the newest reading is the only
         * honest place to put it. Both marks are keyed on the sample's own
         * clock so the landing animation replays when a bucket lands and at no
         * other time — a paused clock cannot cross a boundary, so a paused
         * chart holds still.
         */}
        {last ? (
          <ReferenceLine
            key={`edge-line-${last.atSec}`}
            x={last.atSec}
            stroke="var(--chart-grid)"
            strokeWidth={1}
            className="chart__edge"
          />
        ) : null}
        {last ? (
          <ReferenceDot
            key={`edge-dot-${last.atSec}`}
            x={last.atSec}
            y={last.baseline + last.anomaly}
            r={3.5}
            fill="var(--chart-series-anomaly)"
            // A ring in the panel's own ground, so the mark reads as a mark
            // rather than as a data point wherever the curve happens to sit.
            stroke="var(--tray-bg)"
            strokeWidth={1.5}
            className="chart__edge"
          />
        ) : null}

        <ChartLegend
          content={<ChartLegendContent />}
          itemSorter={(item) => (item.dataKey === 'baseline' ? 0 : 1)}
        />
      </AreaChart>
    </ChartContainer>
  );
}

/* ------------------------------------------------------------------ *
 * Event categories — a horizontal bar chart, not a donut
 * ------------------------------------------------------------------ */

const TONE_COLOR: Record<string, string> = {
  critical: 'var(--chart-series-critical)',
  warning: 'var(--chart-series-high)',
  muted: 'var(--chart-series-baseline)',
  accent: 'var(--chart-series-medium)',
  success: 'var(--status-success)',
};

const CATEGORY_CONFIG: ChartConfig = { share: { label: 'Share of events' } };

export function CategoryChart({
  categories,
}: {
  categories: ReturnType<typeof eventCategories>;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const total = categories.reduce((sum, category) => sum + category.value, 0) || 1;

  const data = categories.map((category) => ({
    label: category.label,
    share: Math.round((category.value / total) * 100),
    fill: TONE_COLOR[category.tone] ?? 'var(--chart-series-baseline)',
  }));

  const description = `Share of events by category: ${data
    .map((row) => `${row.label} ${row.share} percent`)
    .join(', ')}.`;

  return (
    <ChartContainer config={CATEGORY_CONFIG} height={150} className="viz--categories">
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 0, right: 34, bottom: 0, left: 0 }}
        barCategoryGap="24%"
        {...surfaceProps(description)}
      >
        <YAxis
          dataKey="label"
          type="category"
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          width={72}
        />
        <XAxis dataKey="share" type="number" domain={[0, 100]} hide />
        <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel unit="%" />} />
        <Bar dataKey="share" radius={0} barSize={10} {...animationProps(reducedMotion)}>
          {data.map((row) => (
            <Cell key={row.label} fill={row.fill} />
          ))}
          <LabelList
            dataKey="share"
            position="right"
            offset={8}
            formatter={(value) => `${value}%`}
            className="viz__value-label"
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

/* ------------------------------------------------------------------ *
 * Severity over time
 * ------------------------------------------------------------------ */

const SEVERITY_CONFIG: ChartConfig = {
  Critical: { label: 'Critical', color: 'var(--chart-series-critical)' },
  High: { label: 'High', color: 'var(--chart-series-high)' },
  Medium: { label: 'Medium', color: 'var(--chart-series-medium)' },
  Low: { label: 'Low', color: 'var(--chart-series-low)' },
};

/**
 * Each band also carries its own dash pattern. Four warm hues on a near-black
 * ground are separable, but "separable" is not the bar — the bar is that the
 * chart still works for a reader who cannot tell them apart at all.
 */
const SEVERITY_ORDER = ['Critical', 'High', 'Medium', 'Low'];

const SEVERITY_DASH: Record<string, string | undefined> = {
  Critical: undefined,
  High: '5 3',
  Medium: '2 3',
  Low: '8 3 2 3',
};

export function SeverityChart({
  series,
  window: samples,
}: {
  series: { label: string; points: number[] }[];
  window: Sample[];
}) {
  const reducedMotion = usePrefersReducedMotion();

  const data = samples.map((sample, index) => {
    const row: Record<string, number> = { atSec: sample.atSec };
    for (const line of series) row[line.label] = line.points[index] ?? 0;
    return row;
  });

  const description = `Severity bands over time. ${series
    .map((line) => `${line.label} peaks at ${Math.max(0, ...line.points)}`)
    .join(', ')}.`;

  return (
    <ChartContainer config={SEVERITY_CONFIG} height={150} className="viz--severity">
      <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }} {...surfaceProps(description)}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="atSec"
          type="number"
          domain={['dataMin', 'dataMax']}
          ticks={axisTicks(samples)}
          tickFormatter={hhmm}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={12}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          tickCount={4}
          allowDecimals={false}
          width={44}
        />
        <ChartTooltip
          cursor={{ strokeDasharray: '3 3' }}
          content={<ChartTooltipContent labelFormatter={clockLabel} />}
        />
        {series.map((line) => (
          <Line
            key={line.label}
            dataKey={line.label}
            type="linear"
            stroke={`var(--color-${line.label})`}
            strokeWidth={1.5}
            strokeDasharray={SEVERITY_DASH[line.label]}
            dot={false}
            activeDot={{ r: 2.5, strokeWidth: 1 }}
            {...animationProps(reducedMotion)}
          />
        ))}
        <ChartLegend
          content={<ChartLegendContent />}
          itemSorter={(item) => SEVERITY_ORDER.indexOf(String(item.dataKey))}
        />
      </LineChart>
    </ChartContainer>
  );
}
