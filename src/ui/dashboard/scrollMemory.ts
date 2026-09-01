import { useEffect, useRef } from 'react';

import type { DashboardRoute } from '../../game/types';

/**
 * Where each destination was left, restored when it is returned to.
 *
 * The console's page never scrolls; `#main` does. So leaving Evidence half way
 * down a record, pivoting to Respond to act on it and coming back used to land
 * the reader at the top with no idea where they had been — the console forgot
 * the one piece of context the player was holding in their head.
 *
 * A ref rather than case context, deliberately: a scroll offset is not a fact
 * about the incident, it must never enter the command log, and it must never be
 * replayed. It also stays out of the console shell, which this work does not
 * own — the hook is called from the guided card, which is the one component
 * mounted inside `#main` on every destination and across every route change.
 *
 * It restores only a position it has actually recorded, so it cannot fight a
 * destination that scrolls something into view on arrival.
 */
export function useMainScrollMemory(route: DashboardRoute): void {
  const positions = useRef(new Map<DashboardRoute, number>());
  const currentRoute = useRef(route);

  useEffect(() => {
    const main = document.getElementById('main');
    if (!main) return;
    const onScroll = () => positions.current.set(currentRoute.current, main.scrollTop);
    main.addEventListener('scroll', onScroll, { passive: true });
    return () => main.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    currentRoute.current = route;
    const main = document.getElementById('main');
    if (!main) return;
    const saved = positions.current.get(route);
    // `undefined` means this destination has never been scrolled. Leaving it
    // alone is what lets an arriving destination place the view itself.
    if (saved !== undefined) main.scrollTop = saved;
  }, [route]);
}
