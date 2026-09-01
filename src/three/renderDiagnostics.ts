/**
 * What the renderer actually did, for the performance gates.
 *
 * ## Why this exists at all
 *
 * The office runs `frameloop="demand"`. Frames are *requested* — by a head
 * turn, by the arrival animation, by the 10 Hz ambient pump — not pumped at
 * display rate. So the two quantities that a naive measurement conflates come
 * apart completely:
 *
 * - `requestAnimationFrame` ticks at the display's rate whether or not this
 *   scene drew anything. On an idle office it reads ~60 with the WebGL renderer
 *   doing nothing at all.
 * - `WebGLRenderer.info.render.frame` counts actual `render()` calls, and on
 *   that same idle office it advances about ten times a second by design.
 *
 * The performance spec sampled the first and printed it as "office idle:
 * avg=… FPS". That number is the browser's vsync, not the room's frame rate:
 * it would keep reading 60 with the canvas black, with every draw call removed,
 * and with the renderer disposed. A budget that cannot fail is not a budget,
 * which is why `performance.spec.ts` no longer calls that measurement WebGL FPS
 * and reads this instead.
 *
 * ## What is measured here
 *
 * Frame *cost*, sampled where the cost is: the delta between consecutive
 * rendered frames, and three.js's own render statistics. Cost is the honest
 * budget for a demand-rendered scene — "each frame the room draws must be cheap
 * enough for 60 Hz" is a claim about this renderer, whereas "rAF ran 60 times"
 * is a claim about the monitor.
 *
 * Strictly a reporter, on the same pattern as `characterDiagnostics`: it can
 * read the renderer and it cannot draw, pose or touch case state. Published on
 * `window.__CYCASE_RENDER__`.
 */

export interface RenderSample {
  /** `WebGLRenderer.info.render.frame` — real `render()` calls since creation. */
  frame: number;
  /** Draw calls on the last rendered frame. */
  calls: number;
  /** Triangles submitted on the last rendered frame. */
  triangles: number;
  /** Live geometries and textures, for leak checks across office remounts. */
  geometries: number;
  textures: number;
  /** Programs compiled. A jump here at a bad moment is a visible stall. */
  programs: number;
}

export interface FrameCost {
  /** Rendered frames observed in the window. */
  frames: number;
  /** Wall-clock milliseconds the window covered. */
  elapsedMs: number;
  /**
   * Mean interval between rendered frames.
   *
   * On a demand-rendered scene this is *not* 1000/fps: an idle office draws on
   * a 10 Hz pump, so the interval is ~100 ms and that is correct behaviour.
   * Read it together with `frames`.
   */
  meanIntervalMs: number;
  /** The longest gap between two rendered frames in the window. */
  worstIntervalMs: number;
  /**
   * Mean and worst *cost* of a rendered frame, in milliseconds.
   *
   * Measured across `useFrame` — which R3F runs immediately before `gl.render`
   * — to the same point on the next rendered frame, minus the idle wait the
   * demand loop spent parked. This is the quantity a 60 Hz budget is actually
   * about: a frame that costs 4 ms has headroom whether it is drawn ten times a
   * second or sixty.
   */
  meanCostMs: number;
  worstCostMs: number;
}

interface Probe {
  sample: () => RenderSample | null;
  /** Rendered-frame timestamps and per-frame costs, newest last. */
  history: () => { at: number; costMs: number }[];
}

let probe: Probe | null = null;

/** Called by the scene on mount; `null` clears it on unmount. */
export function publishRenderProbe(next: Probe | null): void {
  probe = next;
}

function costOver(windowMs: number): FrameCost | null {
  const history = probe?.history() ?? [];
  if (history.length < 2) return null;

  const now = history[history.length - 1]!.at;
  const inWindow = history.filter((entry) => now - entry.at <= windowMs);
  if (inWindow.length < 2) return null;

  const first = inWindow[0]!;
  const elapsedMs = now - first.at;

  let worstInterval = 0;
  for (let i = 1; i < inWindow.length; i += 1) {
    worstInterval = Math.max(worstInterval, inWindow[i]!.at - inWindow[i - 1]!.at);
  }

  const costs = inWindow.map((entry) => entry.costMs).filter((cost) => cost > 0);
  const meanCost = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : 0;

  return {
    frames: inWindow.length,
    elapsedMs,
    meanIntervalMs: elapsedMs / (inWindow.length - 1),
    worstIntervalMs: worstInterval,
    meanCostMs: meanCost,
    worstCostMs: costs.length ? Math.max(...costs) : 0,
  };
}

export interface RenderDiagnostics {
  /** Renderer statistics right now, or null when no office is mounted. */
  sample: () => RenderSample | null;
  /** Frame cost over the last `windowMs`, or null with too few frames. */
  cost: (windowMs?: number) => FrameCost | null;
  /** True while a scene is mounted and reporting. */
  available: () => boolean;
}

export const renderDiagnostics: RenderDiagnostics = {
  sample: () => probe?.sample() ?? null,
  cost: (windowMs = 3000) => costOver(windowMs),
  available: () => probe !== null,
};

declare global {
  interface Window {
    __CYCASE_RENDER__?: RenderDiagnostics;
  }
}

if (typeof window !== 'undefined') {
  window.__CYCASE_RENDER__ = renderDiagnostics;
}
