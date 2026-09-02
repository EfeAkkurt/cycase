import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { createActor } from 'xstate';

import { gameMachine } from '../../src/game/machine';
import { GameRuntime } from '../../src/game/runtime';
import { DASHBOARD_ROUTES } from '../../src/game/types';
import { en } from '../../src/i18n/en';
import { navItemA11y } from '../../src/ui/dashboard/shell';

/**
 * The debrief while the case is still open.
 *
 * The console used to carry two answers to this. One was the nav row: present
 * in the spine, disabled, saying in its accessible name why it is disabled.
 * The other was `DebriefLockedRoute`, a panel mounted on
 * `ctx.route === 'debrief'` — which no player could ever produce. The nav row
 * is the only control that offers the destination, it is disabled until the
 * case closes, and when it is not disabled it sends `OPEN_DEBRIEF` — which
 * changes the scene rather than the destination, so nothing that reaches the
 * debrief ever renders here. The panel was dead in both directions.
 *
 * It is gone. These tests hold the answer that is left, and the two facts that
 * keep it the only one: the row that says why, the event that refuses while the
 * case is open, and no caller anywhere routing to `debrief` behind the guard's
 * back.
 *
 * The other end of the pair — that closing the case keeps the console on screen,
 * and that `OPEN_DEBRIEF` then moves it — is `tests/unit/runtime.test.ts`,
 * "closing the case", and is not duplicated here.
 */

const SRC = path.resolve(__dirname, '../../src');

function boot(): GameRuntime {
  const actor = createActor(gameMachine, { input: {} });
  actor.start();
  return new GameRuntime(actor);
}

/** Every `.ts`/`.tsx` file under `src/`, with its text. */
function sourceFiles(): { file: string; text: string }[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.ts') || entry.endsWith('.tsx'))
    .map((entry) => ({ file: entry, text: readFileSync(path.join(SRC, entry), 'utf8') }));
}

describe('the locked debrief', () => {
  it('is still one of the six destinations', () => {
    // Locked is not hidden. The row stays in the spine so the player can see
    // that the debrief exists and is coming, rather than watching a seventh
    // item appear from nowhere when the case closes.
    expect(DASHBOARD_ROUTES).toContain('debrief');
  });

  it('says in its accessible name why it cannot be opened yet', () => {
    const locked = navItemA11y({
      label: en['nav.debrief'],
      countLabel: '',
      locked: true,
      lockedReason: en['nav.debrief.locked'],
      collapsed: false,
    });

    expect(locked.accessibleName).toContain(en['nav.debrief']);
    expect(locked.accessibleName).toContain(en['nav.debrief.locked']);
    // A disabled control with no tooltip leaves a mouse user with nothing at
    // all; the reason has to be reachable without a screen reader too.
    expect(locked.title).toBe(locked.accessibleName);
  });

  it('refuses to open while the case is open, without moving the console', () => {
    const runtime = boot();
    runtime.send({ type: 'SKIP_INTRO' });
    runtime.send({ type: 'DEBUG' });
    runtime.send({ type: 'TRANSITION_DONE' });
    expect(runtime.scene).toBe('dashboard');
    expect(runtime.context.caseClosed).toBe(false);

    const before = runtime.context.route;
    runtime.send({ type: 'OPEN_DEBRIEF' });

    // Guarded, so this is a no-op rather than a transition to a locked screen.
    // Nothing moves: not the scene, and not the destination the player was on.
    expect(runtime.scene).toBe('dashboard');
    expect(runtime.context.route).toBe(before);
  });

  it('is never routed to behind the guard', () => {
    /*
     * Two events carry a route — `SET_ROUTE` and `SET_FOCUS` — and both accept
     * any `DashboardRoute`, `debrief` included. Narrowing either event type to
     * exclude one member would be a strange shape for the nav and the
     * investigation panels to consume. What keeps the guard meaningful is that
     * nothing sends it: the one control that offers the destination sends
     * `OPEN_DEBRIEF`, which is guarded.
     *
     * So the assertion is a source scan, event-agnostic on purpose, because the
     * property is "no caller exists". The day someone writes one is the day the
     * dashboard needs a `debrief` branch again, and this is where that should
     * be noticed rather than in an empty panel nobody can reach.
     */
    const offenders = sourceFiles()
      .filter(({ text }) => /route:\s*['"]debrief['"]/.test(text))
      .map(({ file }) => file);

    expect(offenders, offenders.join(', ')).toEqual([]);
  });

  it('has no dashboard route component of its own', () => {
    // The deleted panel, named. A reintroduction is welcome the moment
    // something can reach it — and this test is where that conversation starts.
    const dashboard = readFileSync(path.join(SRC, 'ui/dashboard/Dashboard.tsx'), 'utf8');
    expect(dashboard).not.toContain('DebriefLockedRoute');
    expect(dashboard).not.toMatch(/route === 'debrief'/);
  });
});
