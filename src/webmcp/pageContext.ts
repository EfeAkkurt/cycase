import type { OfficeSubScene } from '../app/gameContext';
import type { SceneId, ToolResult } from '../game/types';

/**
 * Where the player is on the page, for the agent.
 *
 * A coach that cannot see the room talks into it. `get_incident` already says
 * what is true about the case; without this it says nothing about whether the
 * person being coached is even looking at a console yet, so an agent asked to
 * explain the first decision will happily explain it to a black screen with an
 * Enter Simulation button on it.
 *
 * The engine does not know which scene the camera is in — scene is machine
 * state, not case state — and it must not, because the tool log is replayed
 * server-side and a scene inside a stored result would break that. So this is a
 * presentation fact, merged into `get_incident` by the tool layer exactly as
 * `withGuidanceDelivery` merges narration delivery, and never persisted.
 *
 * On the wire it is one short token — the awaiting state. There is no room
 * for a sentence per call — the compacted payload runs close to the budget in
 * the heaviest states — so the size is reserved *before* compaction
 * (`compactResult(payload, pageReserve(page))`) and the meaning of each state
 * is spelled out once in the tool description (`pageStateGuide`).
 *
 * Two gates stay with the player and the agent is told to ask for them rather
 * than work around them: entering the simulation is the gesture that unlocks
 * audio, and acknowledging the alarm is the in-fiction wake.
 */
export type PageAwaiting =
  | 'enter_simulation'
  | 'acknowledge_alarm'
  | 'briefing'
  | 'briefing_choice'
  | 'console_ready'
  | 'debrief';

export interface PageContext {
  scene: SceneId;
  awaiting: PageAwaiting;
}

/** One instruction per state, relayed to the model through the tool description. */
export const PAGE_HINTS: Record<PageAwaiting, string> = {
  enter_simulation: 'ask the player to press Enter Simulation on the page',
  acknowledge_alarm: 'ask the player to acknowledge the alarm on the centre monitor',
  briefing: 'VERA is reporting; wait, then read the incident again',
  briefing_choice: 'the player is still at the desk; ask them to open the response console',
  console_ready: 'the console is open; every call is visible on the page',
  debrief: 'the case is closed and the debrief is on screen',
};

export function describePage(scene: SceneId, officeSub: OfficeSubScene | null): PageContext {
  let awaiting: PageAwaiting;
  if (scene === 'boot' || scene === 'intro') awaiting = 'enter_simulation';
  else if (scene === 'debrief') awaiting = 'debrief';
  else if (scene === 'office') {
    if (officeSub === 'alarmUnacknowledged') awaiting = 'acknowledge_alarm';
    else if (officeSub === 'acknowledged' || officeSub === 'assistantReporting') {
      awaiting = 'briefing';
    } else awaiting = 'briefing_choice';
  } else awaiting = 'console_ready';

  return { scene, awaiting };
}

/** Reads the office sub-state out of a raw XState machine value. */
export function officeSubSceneOf(value: unknown): OfficeSubScene | null {
  if (typeof value !== 'object' || value === null) return null;
  const office = (value as Record<string, unknown>).office;
  return typeof office === 'string' ? (office as OfficeSubScene) : null;
}

/**
 * The wire form: the awaiting state alone, e.g. `"briefing_choice"`.
 *
 * The scene is deliberately not on the wire. Each awaiting value belongs to
 * exactly one scene, so the pair would repeat itself, and the ten characters it
 * costs are not free here: measured against a full case on this tree the
 * compacted `get_incident` runs within ~15 characters of the budget at its
 * heaviest, so every byte reserved is a byte the compactor has to cut from the
 * case itself. `PageContext.scene` stays for callers and tests.
 */
export function pageToken(page: PageContext): string {
  return page.awaiting;
}

/** Characters the merged `page` field will add to a JSON payload. */
export function pageReserve(page: PageContext): number {
  return `,"page":${JSON.stringify(pageToken(page))}`.length;
}

/** Merges the page token into a successful, already-compacted `get_incident` result. */
export function withPageContext(result: ToolResult, page: PageContext): ToolResult {
  if (!result.ok || !result.data || typeof result.data !== 'object') return result;
  return { ...result, data: { ...(result.data as Record<string, unknown>), page: pageToken(page) } };
}

/** The sentence in the `get_incident` description that decodes the token. */
export function pageStateGuide(): string {
  const states = (Object.keys(PAGE_HINTS) as PageAwaiting[])
    .map((key) => `${key}: ${PAGE_HINTS[key]}`)
    .join('; ');
  return `The result also carries page: what the page is waiting for. Values — ${states}.`;
}
