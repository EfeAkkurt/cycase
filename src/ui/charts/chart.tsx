import * as React from 'react';
import * as RechartsPrimitive from 'recharts';
import type { TooltipValueType } from 'recharts';

/**
 * shadcn/ui `chart`, ported to this project.
 *
 * The upstream component (`@shadcn/chart`, which pulls `recharts@3.8.0`) is a
 * themed Recharts container: a `ChartConfig` maps each series key to a label
 * and a colour, `ChartStyle` publishes those colours as `--color-<key>` custom
 * properties scoped to the chart, and the tooltip/legend read the same config
 * so a series is named identically everywhere it appears.
 *
 * That contract is kept verbatim. What is *not* kept is the delivery mechanism:
 * upstream expresses every rule as a Tailwind arbitrary-variant class, and this
 * project has no Tailwind — it has hand-written CSS over a locked token set
 * (`src/styles/tokens.css`). So the class strings become BEM-ish classes in
 * `global.css` under the `.viz` block, and the tokens replace shadcn's
 * `--muted-foreground` / `--border` / `--background`.
 *
 * Three deliberate divergences from upstream, each forced by a house rule:
 *
 *  - no light/dark `THEMES` split. This product is dark-only; a second
 *    `.dark`-prefixed block would emit a selector that never matches, and a
 *    non-matching selector is how an unset `--color-<key>` silently falls back
 *    to Recharts' built-in `#3182bd` — a blue, which the palette gate fails on.
 *  - the surface is `role="img"` with a real `aria-label`, not Recharts'
 *    default `role="application"` + `tabIndex={0}`. A static chart is a
 *    picture, not an application, and `role="application"` tells a screen
 *    reader to hand every keystroke to the widget.
 *  - animation is capped at `--motion-duration-base` and switched off entirely
 *    under `prefers-reduced-motion`; Recharts' default is 1500 ms.
 */

export type ChartConfig = Record<
  string,
  {
    label?: React.ReactNode
    icon?: React.ComponentType
    color?: string
  }
>;

/** Local stand-in for shadcn's `cn` — this project has no Tailwind to merge. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

interface ChartContextProps {
  config: ChartConfig;
}

const ChartContext = React.createContext<ChartContextProps | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) throw new Error('useChart must be used within a <ChartContainer />');
  return context;
}

const INITIAL_DIMENSION = { width: 320, height: 200 } as const;

/**
 * The themed frame. Publishes `--color-<key>` for every configured series,
 * then hands Recharts a `ResponsiveContainer` sized by its own box.
 *
 * `height` is explicit rather than upstream's `aspect-video`, because these
 * charts sit in fixed panel furniture — and because a panel projected onto a
 * 3D monitor must not reflow when the aspect ratio of its bezel changes.
 */
export function ChartContainer({
  id,
  className,
  children,
  config,
  height = 180,
  initialDimension = INITIAL_DIMENSION,
  ...props
}: React.ComponentProps<'div'> & {
  config: ChartConfig
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>['children']
  height?: number
  initialDimension?: { width: number; height: number }
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, '')}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cx('viz', className)}
        style={{ height }}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer initialDimension={initialDimension}>
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

/**
 * Publishes the config's colours as custom properties scoped to one chart, so
 * a series is referenced as `var(--color-anomaly)` in the chart body and never
 * as a literal. Every value here is itself a `var(--chart-*)` token.
 */
export function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const colorConfig = Object.entries(config).filter(([, item]) => item.color);
  if (!colorConfig.length) return null;

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `[data-chart=${id}] {\n${colorConfig
          .map(([key, item]) => `  --color-${key}: ${item.color};`)
          .join('\n')}\n}`,
      }}
    />
  );
}

export const ChartTooltip = RechartsPrimitive.Tooltip;

type TooltipNameType = number | string;

/**
 * The tooltip body. Names the series from the config and prints the value in
 * the monospace face — a numeric readout is exactly what house rule 3 reserves
 * `--type-font-mono` for.
 */
export function ChartTooltipContent({
  active,
  payload,
  className,
  indicator = 'dot',
  hideLabel = false,
  hideIndicator = false,
  label,
  labelFormatter,
  labelClassName,
  formatter,
  color,
  nameKey,
  labelKey,
  unit,
}: React.ComponentProps<typeof RechartsPrimitive.Tooltip> &
  React.ComponentProps<'div'> & {
    hideLabel?: boolean
    hideIndicator?: boolean
    indicator?: 'line' | 'dot' | 'dashed'
    nameKey?: string
    labelKey?: string
    /** Appended after the value, e.g. "events". */
    unit?: string
  } & Omit<
    RechartsPrimitive.DefaultTooltipContentProps<TooltipValueType, TooltipNameType>,
    'accessibilityLayer'
  >) {
  const { config } = useChart();

  const tooltipLabel = React.useMemo(() => {
    if (hideLabel || !payload?.length) return null;

    const [item] = payload;
    const key = `${labelKey ?? item?.dataKey ?? item?.name ?? 'value'}`;
    const itemConfig = getPayloadConfigFromPayload(config, item, key);
    const value =
      !labelKey && typeof label === 'string' ? (config[label]?.label ?? label) : itemConfig?.label;

    if (labelFormatter) {
      return (
        <div className={cx('viz__tooltip-label', labelClassName)}>
          {labelFormatter(value, payload)}
        </div>
      );
    }
    if (!value) return null;
    return <div className={cx('viz__tooltip-label', labelClassName)}>{value}</div>;
  }, [label, labelFormatter, payload, hideLabel, labelClassName, config, labelKey]);

  if (!active || !payload?.length) return null;

  const nestLabel = payload.length === 1 && indicator !== 'dot';

  return (
    <div className={cx('viz__tooltip', className)} role="presentation">
      {!nestLabel ? tooltipLabel : null}
      <div className="viz__tooltip-items">
        {payload
          .filter((item) => item.type !== 'none')
          .map((item, index) => {
            const key = `${nameKey ?? item.name ?? item.dataKey ?? 'value'}`;
            const itemConfig = getPayloadConfigFromPayload(config, item, key);
            const indicatorColor = color ?? item.payload?.fill ?? item.color;

            return (
              <div
                key={index}
                className={cx('viz__tooltip-row', indicator === 'dot' && 'viz__tooltip-row--dot')}
              >
                {formatter && item?.value !== undefined && item.name ? (
                  formatter(item.value, item.name, item, index, item.payload)
                ) : (
                  <>
                    {itemConfig?.icon ? (
                      <itemConfig.icon />
                    ) : (
                      !hideIndicator && (
                        <span
                          className={cx('viz__indicator', `viz__indicator--${indicator}`)}
                          style={
                            {
                              '--viz-indicator-color': indicatorColor,
                            } as React.CSSProperties
                          }
                        />
                      )
                    )}
                    <div
                      className={cx(
                        'viz__tooltip-pair',
                        nestLabel && 'viz__tooltip-pair--nested',
                      )}
                    >
                      <div className="viz__tooltip-names">
                        {nestLabel ? tooltipLabel : null}
                        <span className="viz__tooltip-name">{itemConfig?.label ?? item.name}</span>
                      </div>
                      {item.value != null && (
                        <span className="viz__tooltip-value mono">
                          {typeof item.value === 'number'
                            ? item.value.toLocaleString()
                            : String(item.value)}
                          {unit ? <span className="viz__tooltip-unit"> {unit}</span> : null}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

export const ChartLegend = RechartsPrimitive.Legend;

/**
 * A legend that is also the colour-blind fallback: every series carries its
 * text label, so nothing in these charts is signalled by hue alone.
 */
export function ChartLegendContent({
  className,
  hideIcon = false,
  payload,
  verticalAlign = 'bottom',
  nameKey,
}: React.ComponentProps<'div'> & {
  hideIcon?: boolean
  nameKey?: string
} & RechartsPrimitive.DefaultLegendContentProps) {
  const { config } = useChart();
  if (!payload?.length) return null;

  return (
    <div
      className={cx(
        'viz__legend',
        verticalAlign === 'top' ? 'viz__legend--top' : 'viz__legend--bottom',
        className,
      )}
    >
      {payload
        .filter((item) => item.type !== 'none')
        .map((item, index) => {
          const key = `${nameKey ?? item.dataKey ?? 'value'}`;
          const itemConfig = getPayloadConfigFromPayload(config, item, key);

          return (
            <span key={index} className="viz__legend-item">
              {itemConfig?.icon && !hideIcon ? (
                <itemConfig.icon />
              ) : (
                <span className="viz__swatch" style={{ backgroundColor: item.color }} />
              )}
              {itemConfig?.label}
            </span>
          );
        })}
    </div>
  );
}

/** Helper to extract item config from a payload. Verbatim from upstream. */
function getPayloadConfigFromPayload(config: ChartConfig, payload: unknown, key: string) {
  if (typeof payload !== 'object' || payload === null) return undefined;

  const payloadPayload =
    'payload' in payload && typeof payload.payload === 'object' && payload.payload !== null
      ? payload.payload
      : undefined;

  let configLabelKey: string = key;

  if (key in payload && typeof payload[key as keyof typeof payload] === 'string') {
    configLabelKey = payload[key as keyof typeof payload] as string;
  } else if (
    payloadPayload &&
    key in payloadPayload &&
    typeof payloadPayload[key as keyof typeof payloadPayload] === 'string'
  ) {
    configLabelKey = payloadPayload[key as keyof typeof payloadPayload] as string;
  }

  return configLabelKey in config ? config[configLabelKey] : config[key];
}

/* ------------------------------------------------------------------ *
 * House additions — the parts upstream leaves to the page
 * ------------------------------------------------------------------ */

/**
 * Every chart surface carries the same accessibility contract: it is one
 * image, it has a sentence describing what it shows, and it is not in the tab
 * order. Spread onto the Recharts chart element — `role`, `tabIndex` and
 * `aria-label` are in Recharts' SVG prop allow-list, so they land on the
 * `<svg>` itself rather than on a wrapper.
 *
 * `className` is deliberately not set here: Recharts routes a chart's
 * `className` to the wrapper `div` and hard-codes `recharts-surface` on the
 * `<svg>`, so a class passed here would not survive. That is why
 * `tests/e2e/charts.spec.ts` asserts the description on
 * `.recharts-surface[role="img"]` while `accessibility.spec.ts` keeps
 * asserting it on the hand-rolled `svg.chart` surfaces — between them every
 * chart in the product is covered.
 */
export function surfaceProps(description: string) {
  return {
    role: 'img' as const,
    tabIndex: -1,
    'aria-label': description,
  };
}

/**
 * Motion budget. House rule 4 caps chart animation at `--motion-duration-base`
 * (220 ms) and requires charts to render sensibly under reduced motion, which
 * for a chart means "already in its final position on the first frame".
 */
export const CHART_ANIMATION_MS = 220;

export function animationProps(reducedMotion: boolean) {
  return reducedMotion
    ? { isAnimationActive: false as const }
    : { isAnimationActive: true as const, animationDuration: CHART_ANIMATION_MS, animationEasing: 'ease-out' as const };
}

/** Shared axis furniture: thin, quiet, and identical on every chart. */
export const AXIS_TICK = {
  fill: 'var(--chart-axis-label)',
  fontSize: 12,
} as const;
