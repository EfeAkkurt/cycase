import { narrationChannel } from '../ui/narration/narrationStore';
import type { GameContext, ToolResult } from '../game/types';

/**
 * The delivery half of a `present_guidance` receipt.
 *
 * `docs/WEBMCP_CONTRACT.md` requires the agent to be told `delivery`,
 * `duplicate`, `queueDepth` and `nextStep`. Three of those are presentation
 * facts — whether the line is being read aloud right now, how many are waiting,
 * whether this call was a deduplicated replay — and the engine cannot know them
 * without becoming impure.
 *
 * That matters beyond tidiness. The command log stores each command's result,
 * and `BACKEND_RUNTIME_CONTRACT.md` §6 has the server re-run the log and compare
 * the stored result against its own. A UI-dependent field inside the engine's
 * result would make every connected run fail replay verification for a reason
 * that has nothing to do with the case.
 *
 * So the engine returns the deterministic `GuidanceView`, and the tool layer —
 * which is presentation — merges the delivery facts into the payload the model
 * receives. What is persisted stays reproducible; what the agent reads is
 * complete.
 */

export interface GuidanceDelivery {
  /** `spoken` while the voice is reading it, `queued` behind another line. */
  delivery: 'spoken' | 'queued' | 'caption_only';
  /** True when this call replayed an idempotency key that had been seen. */
  duplicate: boolean;
  /** Lines accepted and not yet shown. */
  queueDepth: number;
  /** What the agent should do next, in its own terms. */
  nextStep: string;
}

/**
 * A replayed idempotent call is invisible in the result itself — the engine
 * hands back the stored payload verbatim, which is the point of idempotency.
 * The tool log records it, so the receipt reads the log rather than guessing.
 */
function wasReplayed(context: GameContext): boolean {
  return context.toolLog.at(-1)?.effectId === 'idempotent-replay';
}

export function guidanceDelivery(context: GameContext, sequence: number): GuidanceDelivery {
  const duplicate = wasReplayed(context);

  /*
   * Offer the log to the channel before reading it.
   *
   * This used to read the channel straight after the engine returned, which
   * described the state *before* the accepted line existed: the driver ingests
   * on a React effect, and that has not run yet when the tool handler returns.
   * So a first line reported `queueDepth: 0, delivery: caption_only` when it
   * was about to be spoken, and a line queued behind another reported the depth
   * of the queue it was not yet in — the receipt was always one line stale.
   *
   * `ingest` dedupes by sequence, so doing it here is not a second delivery:
   * the driver's own call a moment later finds nothing new. It simply moves the
   * moment the channel learns the truth to before the moment we report it.
   */
  narrationChannel.ingest(context.narrativeLog ?? []);
  const narration = narrationChannel.getState();
  const placement = narrationChannel.placementOf(sequence);

  /*
   * Derived from where the line landed, not from `speaking`. The speech engine
   * has not started reading by the time this returns, so `speaking` would say
   * "no" about a line that is about to be read aloud.
   */
  const delivery: GuidanceDelivery['delivery'] = duplicate
    ? 'caption_only'
    : placement === 'pending'
      ? 'queued'
      : narration.voiceEnabled
        ? 'spoken'
        : 'caption_only';

  return {
    delivery,
    duplicate,
    queueDepth: narration.pending.length,
    nextStep: duplicate
      ? 'That key was already used, so nothing was said again. Use a new idempotencyKey for a new line.'
      : 'Narration changed nothing. Call get_incident before your next action.',
  };
}

/** Merges the delivery facts into an accepted guidance result. */
export function withGuidanceDelivery(result: ToolResult, context: GameContext): ToolResult {
  if (!result.ok || !result.data || typeof result.data !== 'object') return result;
  const data = result.data as Record<string, unknown>;
  const sequence = typeof data.narrativeSequence === 'number' ? data.narrativeSequence : -1;
  return { ...result, data: { ...data, ...guidanceDelivery(context, sequence) } };
}
