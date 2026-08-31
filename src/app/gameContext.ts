import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useSelector } from '@xstate/react';

import type { GameRuntime } from '../game/runtime';
import type { GameContext, SceneId, ToolResult } from '../game/types';

/**
 * Context and hooks, deliberately in their own module.
 *
 * React Fast Refresh only re-runs a module cleanly when it exports components
 * *or* non-components, never both. Keeping the context object here means an
 * edit to `GameProvider.tsx` cannot recreate `GameBindingContext` underneath
 * consumers that still hold the old one — which fails at runtime with
 * "must be used inside <GameProvider>".
 */

export interface GameBinding {
  runtime: GameRuntime;
  /** Pushes a sentence into the polite live region. */
  announce: (message: string) => void;
}

export const GameBindingContext = createContext<GameBinding | null>(null);

function useBinding(): GameBinding {
  const binding = useContext(GameBindingContext);
  if (!binding) throw new Error('useGame* must be used inside <GameProvider>.');
  return binding;
}

export function useRuntime(): GameRuntime {
  return useBinding().runtime;
}

export function useAnnounce(): (message: string) => void {
  return useBinding().announce;
}

/** Subscribes to the whole case context. */
export function useGame(): GameContext {
  const { runtime } = useBinding();
  return useSelector(runtime.actor, (snapshot) => snapshot.context);
}

/** Fine-grained subscription, for anything that renders often. */
export function useGameSelector<T>(select: (context: GameContext) => T): T {
  const { runtime } = useBinding();
  return useSelector(runtime.actor, (snapshot) => select(snapshot.context));
}

/**
 * The whole case context, but republished only when `isSame` says something
 * that matters has changed.
 *
 * The live clock ticks once a second and produces a new context object every
 * time, which is correct for a clock readout and wrong for anything expensive
 * hanging off it. The telemetry window is forty samples that are identical for
 * ten consecutive ticks; handing a charting library a fresh array each second
 * is how a chart starts re-animating for no reason.
 *
 * `isSame` returning true keeps the *previous* context — deliberately. A caller
 * uses this only for values that genuinely depend on nothing but the fields it
 * compares, so holding the older object is not staleness, it is the point.
 */
export function useStableGame(
  isSame: (previous: GameContext, next: GameContext) => boolean,
): GameContext {
  const { runtime } = useBinding();
  return useSelector(runtime.actor, (snapshot) => snapshot.context, isSame);
}

export function useScene(): SceneId {
  const { runtime } = useBinding();
  return useSelector(runtime.actor, (snapshot) => {
    const value = snapshot.value;
    return (typeof value === 'string' ? value : Object.keys(value)[0]) as SceneId;
  });
}

export type OfficeSubScene =
  | 'alarmUnacknowledged'
  | 'acknowledged'
  | 'assistantReporting'
  | 'briefingChoice'
  | 'explained'
  | 'resume';

export function useOfficeSubScene(): OfficeSubScene | null {
  const { runtime } = useBinding();
  return useSelector(runtime.actor, (snapshot) => {
    const value = snapshot.value;
    if (typeof value === 'string') return null;
    const office = (value as Record<string, unknown>).office;
    return typeof office === 'string' ? (office as OfficeSubScene) : null;
  });
}

/**
 * Runs a command and announces its outcome. This is what every dashboard
 * control uses, so a human click and an agent tool call are indistinguishable
 * to the game core and equally visible to a screen reader.
 */
export function useCommand(): (run: (runtime: GameRuntime) => ToolResult) => ToolResult {
  const { runtime, announce } = useBinding();
  const lastRef = useRef('');

  return (run) => {
    const result = run(runtime);
    // Announce prose a person can act on, never the engine's internal summary
    // ("Decided D1 -> D1_preserve_and_inspect" means nothing read aloud).
    const message = result.ok ? describeSuccess(result) : describeFailure(result);
    // Re-announce identical messages by appending a zero-width space, otherwise
    // some screen readers stay silent on a repeated string.
    lastRef.current = message === lastRef.current ? `${message}\u200B` : message;
    announce(lastRef.current);
    return result;
  };
}

/** Turns a successful result into a sentence worth hearing. */
function describeSuccess(result: ToolResult): string {
  const data = result.data as Record<string, unknown> | undefined;
  if (!data) return 'Done.';
  if (typeof data.explanation === 'string') return data.explanation;
  if (typeof data.result === 'string') return data.result;
  if (typeof data.summary === 'string') return data.summary;
  if (typeof data.hint === 'string') return data.hint;
  if (typeof data.analystNote === 'string') return data.analystNote;
  return 'Done.';
}

function describeFailure(result: ToolResult): string {
  const error = result.error;
  if (!error) return 'That call was rejected and nothing changed.';
  return [error.message, error.recovery].filter(Boolean).join(' ');
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
