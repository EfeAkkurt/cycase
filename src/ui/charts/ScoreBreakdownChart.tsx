import { Bar, BarChart, Cell, LabelList, XAxis, YAxis } from 'recharts';

import { usePrefersReducedMotion } from '../../app/gameContext';
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

export interface ScoreBucketRow {
  /** Human label for the bucket. */
  label: string;
  earned: number;
  max: number;
}

const CONFIG: ChartConfig = {
  earned: { label: 'Earned', color: 'var(--chart-series-earned)' },
  shortfall: { label: 'Not earned', color: 'var(--chart-series-shortfall)' },
};

/**
 * The debrief score breakdown.
 *
 * The four buckets are not worth the same number of points, so the bars are
 * drawn on one shared scale rather than each normalised to its own 100%: a
 * full containment bar is visibly longer than a full efficiency bar, because
 * containment is worth more. Every bar also prints `earned/possible`, so the
 * exact figure is readable without measuring pixels — and so the outcome is
 * never carried by the bar's colour alone.
 */
export function ScoreBreakdownChart({ rows }: { rows: ScoreBucketRow[] }) {
  const reducedMotion = usePrefersReducedMotion();
  const ceiling = Math.max(1, ...rows.map((row) => row.max));

  const data = rows.map((row) => ({
    label: row.label,
    earned: row.earned,
    max: row.max,
    shortfall: Math.max(0, row.max - row.earned),
    readout: `${row.earned}/${row.max}`,
    /*
     * Deliberately NOT called `fill`. Recharts reads a row's `fill` key for
     * *every* bar drawn from that row, so a field by that name paints the
     * "not earned" segment in the earned colour too — which turns a stacked
     * bar into one solid block and hides the thing the chart exists to show.
     */
    earnedFill:
      row.earned === row.max
        ? 'var(--status-success)'
        : row.earned === 0
          ? 'var(--status-error)'
          : 'var(--chart-series-earned)',
  }));

  const description = `Score breakdown. ${rows
    .map((row) => `${row.label} ${row.earned} of ${row.max} points`)
    .join(', ')}.`;

  return (
    <ChartContainer config={CONFIG} height={Math.max(150, rows.length * 40 + 40)} className="viz--score">
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 0, right: 52, bottom: 0, left: 0 }}
        barCategoryGap="30%"
        {...surfaceProps(description)}
      >
        <YAxis
          dataKey="label"
          type="category"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={150}
        />
        <XAxis type="number" domain={[0, ceiling]} hide />
        <ChartTooltip cursor={false} content={<ChartTooltipContent unit="pts" />} />
        <Bar
          dataKey="earned"
          stackId="score"
          radius={0}
          barSize={12}
          fill="var(--color-earned)"
          {...animationProps(reducedMotion)}
        >
          {data.map((row) => (
            <Cell key={row.label} fill={row.earnedFill} />
          ))}
          {/*
            The readout rides the *earned* segment rather than the end of the
            stack. On a perfect run every shortfall is zero, and Recharts drops
            a series whose values are all zero — which took the labels with it.
            Anchoring them here also puts the number exactly where the player's
            score stops, which is the thing being read.
          */}
          <LabelList
            dataKey="readout"
            position="right"
            offset={10}
            className="viz__value-label viz__value-label--mono"
          />
        </Bar>
        <Bar
          dataKey="shortfall"
          stackId="score"
          radius={0}
          barSize={12}
          fill="var(--color-shortfall)"
          {...animationProps(reducedMotion)}
        />
        <ChartLegend
          content={<ChartLegendContent />}
          itemSorter={(item) => (item.dataKey === 'earned' ? 0 : 1)}
        />
      </BarChart>
    </ChartContainer>
  );
}

export default ScoreBreakdownChart;
