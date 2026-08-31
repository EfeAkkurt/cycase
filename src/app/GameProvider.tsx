import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useActorRef } from '@xstate/react';

import { INCIDENT_SECONDS_PER_PLAY_SECOND } from '../game/live';
import { gameMachine } from '../game/machine';
import { GameRuntime } from '../game/runtime';
import { GameBindingContext, type GameBinding } from './gameContext';

/**
 * One real second per tick. Each tick advances the *incident* clock by
 * `INCIDENT_SECONDS_PER_PLAY_SECOND` — the audit contract's documented 3x
 * multiplier (P0.6). A case worth 15–20 minutes of incident response has to fit
 * a 5–7 minute session, and the honest way to buy that time is to say the
 * incident runs faster than the desk, not to let per-command clock costs
 * masquerade as real time. Play time stays exactly recoverable from the same
 * number: see `playSeconds()` in `game/live.ts`.
 */
const TICK_MS = 1000;

/**
 * Component-only module, so React Fast Refresh can replace it without
 * recreating the context identity. Hooks live in `gameContext.ts`.
 */
export function GameProvider({ children }: { children: ReactNode }) {
  const actor = useActorRef(gameMachine, { input: {} });
  const runtime = useMemo(() => new GameRuntime(actor), [actor]);
  const [announcement, setAnnouncement] = useState('');

  const binding = useMemo<GameBinding>(
    () => ({ runtime, announce: setAnnouncement }),
    [runtime],
  );

  // Live incident clock. Deliberately does not touch `stateVersion`, so a
  // ticking clock can never make an agent's in-flight call go stale.
  useEffect(() => {
    const id = window.setInterval(() => {
      const context = actor.getSnapshot().context;
      if (context.caseClosed || context.paused) return;
      actor.send({ type: 'TICK', seconds: INCIDENT_SECONDS_PER_PLAY_SECOND });
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [actor]);

  return (
    <GameBindingContext.Provider value={binding}>
      {children}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </GameBindingContext.Provider>
  );
}
