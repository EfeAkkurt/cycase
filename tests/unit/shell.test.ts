import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { createInitialContext } from '../../src/game/context';
import { executeCommand } from '../../src/game/engine';
import { DASHBOARD_ROUTES } from '../../src/game/types';
import { en } from '../../src/i18n/en';
import {
  CONTROL_HEIGHT,
  DETAIL_STATUS_IDS,
  GRID_UNIT,
  HIT_TARGET,
  NAV_ITEM_HEIGHT,
  PRIMARY_STATUS_IDS,
  RAIL_COLLAPSED_WIDTH,
  RAIL_WIDTH,
  SIDEBAR_RAIL_WIDTH,
  SIDEBAR_WIDTH,
  destinationTitle,
  incidentStatusDetailRows,
  incidentStatusPrimaryRows,
  incidentStatusRows,
  incidentStatusSentence,
  navItemA11y,
  onGrid,
  railWidth,
  sidebarWidth,
} from '../../src/ui/dashboard/shell';
import { PERFECT_COMMANDS } from './fixtures/perfectRun';

/**
 * The console shell's pure half.
 *
 * Everything asserted here is a function of `GameContext` and the token file.
 * The rendered geometry — the 240px column, the fold — is measured in
 * `tests/e2e/shell.spec.ts` against a real browser, because a unit test that
 * "proves" a layout by re-reading the number the layout was written from
 * proves nothing.
 *
 * What this file is for is the half that a browser measurement cannot see:
 * that the status group is derived rather than stored, that the announced
 * sentence is not the ticking numbers, that a collapsed icon still carries a
 * name a screen reader can use, and that one constant means one number.
 */

const context = createInitialContext();

function drive(count: number) {
  let ctx = createInitialContext();
  for (const command of PERFECT_COMMANDS.slice(0, count)) {
    ctx = executeCommand(ctx, command).context;
  }
  return ctx;
}

describe('shell geometry', () => {
  it('states each width once, and the collapsed rail is genuinely narrower', () => {
    expect(sidebarWidth(false)).toBe(SIDEBAR_WIDTH);
    expect(sidebarWidth(true)).toBe(SIDEBAR_RAIL_WIDTH);
    expect(SIDEBAR_RAIL_WIDTH).toBeLessThan(SIDEBAR_WIDTH);
  });

  it('keeps every shell dimension on the 4px token grid', () => {
    for (const value of [
      SIDEBAR_WIDTH,
      SIDEBAR_RAIL_WIDTH,
      RAIL_WIDTH,
      RAIL_COLLAPSED_WIDTH,
      NAV_ITEM_HEIGHT,
      CONTROL_HEIGHT,
      HIT_TARGET,
    ]) {
      expect(onGrid(value), `${value}px`).toBe(true);
    }
    expect(GRID_UNIT).toBe(4);
    expect(onGrid(6)).toBe(false);
    expect(onGrid(-4)).toBe(false);
    expect(onGrid(4.5)).toBe(false);
  });

  /**
   * The constants exist to stop the same number being typed in three places.
   * If the CSS drifts from `shell.ts`, the collapsed rail and the measurement
   * that guards it stop describing the same product — so the token file is
   * read here rather than trusted.
   */
  it('matches the custom properties the stylesheet actually ships', () => {
    const css = readFileSync(new URL('../../src/styles/tokens.css', import.meta.url), 'utf8');
    const token = (name: string) => {
      const match = new RegExp(`--${name}:\\s*([0-9]+)px`).exec(css);
      if (!match) throw new Error(`--${name} is not declared in tokens.css`);
      return Number(match[1]);
    };

    expect(token('sidebar-w')).toBe(SIDEBAR_WIDTH);
    expect(token('sidebar-w-rail')).toBe(SIDEBAR_RAIL_WIDTH);
    expect(token('sidebar-item-h')).toBe(NAV_ITEM_HEIGHT);
    expect(token('rail-w')).toBe(RAIL_WIDTH);
    expect(token('rail-w-collapsed')).toBe(RAIL_COLLAPSED_WIDTH);
    expect(token('hit-target')).toBe(HIT_TARGET);
    expect(token('control-height-sm')).toBe(CONTROL_HEIGHT);
  });

  it('collapses the learning rail to a strip that is narrower than the open column', () => {
    expect(railWidth(false)).toBe(RAIL_WIDTH);
    expect(railWidth(true)).toBe(RAIL_COLLAPSED_WIDTH);
    expect(RAIL_COLLAPSED_WIDTH).toBeLessThan(RAIL_WIDTH);
  });

  /**
   * WCAG 2.2 AA "Target Size (Minimum)" is 24×24 CSS px. Collapsed, the label
   * is gone and the row becomes a square of exactly this height — so the height
   * is also the width, and the floor has to hold in both directions.
   */
  it('leaves the collapsed destination row above the WCAG target-size floor', () => {
    expect(NAV_ITEM_HEIGHT).toBeGreaterThanOrEqual(24);
    expect(SIDEBAR_RAIL_WIDTH).toBeGreaterThanOrEqual(NAV_ITEM_HEIGHT);
    expect(HIT_TARGET).toBeGreaterThanOrEqual(44);
  });
});

describe('incident status', () => {
  it('carries the eight values the brief moved out of the top bar', () => {
    const rows = incidentStatusRows(context);
    expect(rows.map((row) => row.id)).toEqual([
      'incident-id',
      'incident-severity',
      'play-clock',
      'incident-clock',
      'event-rate',
      'feed-health',
      'state-version',
      'agent-status',
    ]);
  });

  it('puts incident, severity, feed and agent on the glanceable strip', () => {
    expect(incidentStatusPrimaryRows(context).map((row) => row.id)).toEqual([...PRIMARY_STATUS_IDS]);
    expect(incidentStatusDetailRows(context).map((row) => row.id)).toEqual([...DETAIL_STATUS_IDS]);
  });

  it('labels every row — no value is left to be read off its position', () => {
    for (const row of incidentStatusRows(context)) {
      expect(row.label.length, row.id).toBeGreaterThan(0);
      expect(row.value.length, row.id).toBeGreaterThan(0);
    }
  });

  /**
   * The E2E suite reads these ids directly (`#state-version`, `#play-clock`),
   * and `guidance.spec.ts` asserts the incident clock prints its multiplier and
   * points at the sr-only explainer. Naming them here is what stops a rename
   * from being discovered by a browser suite this worktree cannot run.
   */
  it('keeps the ids and the clock wiring the browser suites read', () => {
    const rows = incidentStatusRows(context);
    const incidentClock = rows.find((row) => row.id === 'incident-clock');
    expect(incidentClock?.suffix).toBe('3×');
    expect(incidentClock?.describedBy).toBe('clock-explainer');

    expect(rows.find((row) => row.id === 'state-version')?.value).toBe('v0');
    expect(rows.find((row) => row.id === 'play-clock')?.label).toBe('Play time');
    expect(incidentClock?.label).toBe('Incident time');
  });

  it('derives from context rather than storing anything: the same run moves it', () => {
    const before = incidentStatusRows(createInitialContext());
    const after = incidentStatusRows(drive(PERFECT_COMMANDS.length));

    const version = (rows: ReturnType<typeof incidentStatusRows>) =>
      rows.find((row) => row.id === 'state-version')?.value;
    const severity = (rows: ReturnType<typeof incidentStatusRows>) =>
      rows.find((row) => row.id === 'incident-severity');

    expect(version(before)).toBe('v0');
    expect(version(after)).toBe(`v${PERFECT_COMMANDS.length}`);

    expect(severity(before)?.tone).toBe('critical');
    expect(severity(before)?.pulse).toBe(true);
    // A closed case is not still critical, and it has stopped pulsing.
    expect(severity(after)?.tone).toBe('success');
    expect(severity(after)?.pulse).toBe(false);
  });

  it('marks the paused feed on the row, not only in colour', () => {
    const paused = { ...context, paused: true };
    const row = incidentStatusRows(paused).find((item) => item.id === 'feed-health');
    expect(row?.detail).toBe('Paused');
    expect(row?.tone).toBe('warning');
  });
});

describe('the announced status sentence', () => {
  /**
   * The accessibility contract asks for status to be announced "as sentences,
   * not as a stream of numbers". The two clocks tick every second, so the
   * region must be built from the values that only change on a real transition
   * — otherwise a screen-reader user is read a running clock for the whole
   * session. This is that rule, stated as a test.
   */
  it('never contains a ticking clock', () => {
    const ticked = { ...context, clockSec: context.clockSec + 137 };
    expect(incidentStatusSentence(ticked)).toBe(incidentStatusSentence(context));

    const clocks = incidentStatusRows(ticked)
      .filter((row) => row.id === 'play-clock' || row.id === 'incident-clock')
      .map((row) => row.value);
    for (const value of clocks) {
      expect(incidentStatusSentence(ticked)).not.toContain(value);
    }
  });

  it('reads as prose, and changes when the case changes', () => {
    const sentence = incidentStatusSentence(context);
    expect(sentence).toContain('INC-74219');
    expect(sentence).toContain('Critical');
    expect(sentence).toContain('v0');
    expect(sentence).toMatch(/\.$/);

    expect(incidentStatusSentence(drive(PERFECT_COMMANDS.length))).not.toBe(sentence);
  });

  it('says which way the feed is running', () => {
    expect(incidentStatusSentence(context)).toContain('feed is live');
    expect(incidentStatusSentence({ ...context, paused: true })).toContain('feed is paused');
  });
});

describe('destination rows', () => {
  it('keeps the visible label first, so a name filter still anchors on it', () => {
    const a11y = navItemA11y({
      label: 'Evidence',
      countLabel: '2 of 8 artifacts inspected',
      locked: false,
      lockedReason: 'Unlocks when the case is closed',
      collapsed: false,
    });

    expect(a11y.accessibleName.startsWith('Evidence')).toBe(true);
    expect(a11y.accessibleName).toContain('2 of 8 artifacts inspected');
    expect(a11y.showLabel).toBe(true);
    // Nothing to explain while the label is on screen beside its chip.
    expect(a11y.title).toBeUndefined();
  });

  it('keeps label and count in the name once the label is hidden', () => {
    const a11y = navItemA11y({
      label: 'Evidence',
      countLabel: '2 of 8 artifacts inspected',
      locked: false,
      lockedReason: 'Unlocks when the case is closed',
      collapsed: true,
    });

    expect(a11y.showLabel).toBe(false);
    expect(a11y.accessibleName).toContain('Evidence');
    expect(a11y.accessibleName).toContain('2 of 8 artifacts inspected');
    // Sighted mouse users lose the label too; the tooltip gives it back.
    expect(a11y.title).toBe(a11y.accessibleName);
  });

  it('makes a locked destination say why, at both widths', () => {
    for (const collapsed of [false, true]) {
      const a11y = navItemA11y({
        label: 'Debrief',
        countLabel: '',
        locked: true,
        lockedReason: 'Unlocks when the case is closed',
        collapsed,
      });
      expect(a11y.accessibleName, `collapsed=${collapsed}`).toContain(
        'Unlocks when the case is closed',
      );
      expect(a11y.title).toBe(a11y.accessibleName);
    }
  });

  it('gives every one of the six destinations a page title', () => {
    expect(DASHBOARD_ROUTES).toHaveLength(6);
    for (const route of DASHBOARD_ROUTES) {
      expect(destinationTitle(route).length, route).toBeGreaterThan(0);
    }
    expect(destinationTitle('command')).toBe('Command');
  });

  it('has a spoken count for every destination that shows a chip', () => {
    // Debrief is the one destination with no count: it is a place, not a
    // quantity, and it is locked until the case closes.
    for (const route of DASHBOARD_ROUTES.filter((item) => item !== 'debrief')) {
      expect(en[`nav.count.${route}` as keyof typeof en], route).toBeDefined();
    }
  });
});
