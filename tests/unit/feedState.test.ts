import { describe, expect, it } from 'vitest';

import { STALE_AFTER_SEC, feedState } from '../../src/ui/investigate/ToolContext';
import { en } from '../../src/i18n/en';

/**
 * The eight feed states, as a pure function.
 *
 * This is a unit test rather than a browser one because the thing worth pinning
 * is the *precedence*, and precedence is exactly what a screenshot cannot show:
 * a tool that is simultaneously paused, empty and stale has to pick one answer,
 * and which one it picks is the difference between "the clock is stopped" and
 * "this source is broken".
 */
describe('feedState', () => {
  const live = { shown: 12 };

  it('reports a healthy feed as live', () => {
    expect(feedState(live, false, 0)).toBe('live');
  });

  it('puts a transport failure above everything else', () => {
    /*
     * If the console cannot reach the source, every other observation about the
     * rows is about a stale copy. Saying "no rows" when the truth is "not
     * collecting" is the single most misleading thing this component could do —
     * one means the attacker did nothing, the other means we cannot see.
     */
    expect(feedState({ shown: 0, transport: 'offline' }, true, 9999)).toBe('offline');
    expect(feedState({ ...live, transport: 'error' }, false, 0)).toBe('error');
  });

  it('reports loading before it reports emptiness', () => {
    // A view that has not arrived has no rows *yet*; calling that "no rows"
    // would be a claim about the source rather than about the request.
    expect(feedState({ shown: 0, loading: true }, false, 0)).toBe('loading');
  });

  it('reports paused above stale, because the clock explains the age', () => {
    /*
     * A paused console's newest event ages by definition — the clock has
     * stopped, not the feed. Reporting that as stale would tell the analyst to
     * go and check a collector that is working perfectly.
     */
    expect(feedState(live, true, STALE_AFTER_SEC + 600)).toBe('paused');
  });

  it('distinguishes an empty source from an emptied one', () => {
    // The distinction the tools did not previously draw, and the two mean
    // opposite things about whether to trust what is on screen.
    expect(feedState({ shown: 0, hidden: 0 }, false, 0)).toBe('empty');
    expect(feedState({ shown: 0, hidden: 7 }, false, 0)).toBe('partial');
  });

  it('reports stale only once the newest row is past the threshold', () => {
    expect(feedState(live, false, STALE_AFTER_SEC)).toBe('live');
    expect(feedState(live, false, STALE_AFTER_SEC + 1)).toBe('stale');
  });

  it('reports partial when rows are held back but some are shown', () => {
    expect(feedState({ shown: 3, hidden: 9 }, false, 0)).toBe('partial');
  });

  it('prefers stale over partial: an old table is worth saying first', () => {
    /*
     * Both are true and only one can be the headline. "Nothing new for 20
     * minutes" changes whether the analyst should act on what they see;
     * "9 rows filtered out" changes what they should click. The first is the
     * more urgent correction to a wrong belief.
     */
    expect(feedState({ shown: 3, hidden: 9 }, false, STALE_AFTER_SEC + 1)).toBe('stale');
  });

  it('has copy for every state, in both the chip and the sentence', () => {
    /*
     * The union and the string table are edited in different files, so a state
     * added to one and not the other renders the key itself as UI text. This is
     * the cheap guard against that.
     */
    const states = [
      'loading',
      'live',
      'paused',
      'stale',
      'empty',
      'partial',
      'offline',
      'error',
    ] as const;

    for (const state of states) {
      expect(en[`tool.state.${state}`], `no chip label for ${state}`).toBeTruthy();
      expect(en[`tool.state.${state}.detail`], `no sentence for ${state}`).toBeTruthy();
    }
  });
});
