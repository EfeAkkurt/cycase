import { describe, expect, it } from 'vitest';

import type { ToolResult } from '../../src/game/types';
import {
  PAGE_HINTS,
  describePage,
  officeSubSceneOf,
  pageReserve,
  pageStateGuide,
  pageToken,
  withPageContext,
} from '../../src/webmcp/pageContext';

/**
 * `get_incident` tells the agent where the player is on the page. The engine
 * cannot know that — scene is machine state, not case state — so the mapping
 * lives in the tool layer and is pinned here without a browser.
 */
describe('describePage', () => {
  it('tells the agent the player has not entered yet', () => {
    expect(describePage('boot', null)).toEqual({ scene: 'boot', awaiting: 'enter_simulation' });
    expect(describePage('intro', null).awaiting).toBe('enter_simulation');
  });

  it('follows the office choreography', () => {
    expect(describePage('office', 'alarmUnacknowledged').awaiting).toBe('acknowledge_alarm');
    expect(describePage('office', 'acknowledged').awaiting).toBe('briefing');
    expect(describePage('office', 'assistantReporting').awaiting).toBe('briefing');
    expect(describePage('office', 'briefingChoice').awaiting).toBe('briefing_choice');
    expect(describePage('office', 'explained').awaiting).toBe('briefing_choice');
    expect(describePage('office', 'resume').awaiting).toBe('briefing_choice');
  });

  it('reports the console and the debrief as ready', () => {
    expect(describePage('transition', null).awaiting).toBe('console_ready');
    expect(describePage('dashboard', null).awaiting).toBe('console_ready');
    expect(describePage('debrief', null).awaiting).toBe('debrief');
  });
});

describe('officeSubSceneOf', () => {
  it('reads the office sub-state out of a machine value', () => {
    expect(officeSubSceneOf({ office: 'briefingChoice' })).toBe('briefingChoice');
  });

  it('returns null for a scene that has no sub-state', () => {
    expect(officeSubSceneOf('dashboard')).toBeNull();
    expect(officeSubSceneOf(null)).toBeNull();
    expect(officeSubSceneOf({ dashboard: {} })).toBeNull();
  });
});

describe('the wire form', () => {
  it('is the awaiting state alone, and stays small', () => {
    // The scene is not on the wire: it repeats what awaiting already says, and
    // the compacted payload has only ~15 characters to spare at its heaviest.
    const scenes = ['boot', 'intro', 'office', 'transition', 'dashboard', 'debrief'] as const;
    const subs = ['alarmUnacknowledged', 'acknowledged', 'briefingChoice', null] as const;
    for (const scene of scenes) {
      for (const sub of subs) {
        const page = describePage(scene, sub);
        expect(pageToken(page)).toBe(page.awaiting);
        expect(pageReserve(page)).toBeLessThanOrEqual(28);
      }
    }
  });

  it('is decoded by the description, one instruction per state', () => {
    const guide = pageStateGuide();
    for (const [key, hint] of Object.entries(PAGE_HINTS)) {
      expect(guide).toContain(`${key}: ${hint}`);
    }
    // The whole description has a 500-character budget in the Chrome guidance;
    // this sentence is only part of it.
    expect(guide.length).toBeLessThanOrEqual(560);
  });
});

describe('withPageContext', () => {
  const page = describePage('dashboard', null);

  it('merges the page token into a successful result without touching the rest', () => {
    const result: ToolResult = { ok: true, stateVersion: 3, data: { incidentId: 'inc' } };
    expect(withPageContext(result, page)).toEqual({
      ok: true,
      stateVersion: 3,
      data: { incidentId: 'inc', page: 'console_ready' },
    });
  });

  it('adds exactly what pageReserve promised', () => {
    const result: ToolResult = { ok: true, stateVersion: 3, data: { incidentId: 'inc' } };
    const before = JSON.stringify(result).length;
    const after = JSON.stringify(withPageContext(result, page)).length;
    expect(after - before).toBe(pageReserve(page));
  });

  it('leaves failures and dataless results alone', () => {
    const failure: ToolResult = {
      ok: false,
      stateVersion: 3,
      error: { code: 'ACTION_NOT_ALLOWED', message: 'no', recovery: 'x' },
    };
    expect(withPageContext(failure, page)).toBe(failure);
    const bare: ToolResult = { ok: true, stateVersion: 3 };
    expect(withPageContext(bare, page)).toBe(bare);
  });
});
