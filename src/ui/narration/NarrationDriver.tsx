import { useEffect } from 'react';

import { useGameSelector } from '../../app/gameContext';
import { useSpeech } from '../../audio/speechContext';
import { narrationChannel } from './narrationStore';

/**
 * Feeds the narration channel and speaks each new line exactly once.
 *
 * Mounted once, above both surfaces. The presentation components are pure
 * readers of the channel, so however many of them are on screen — the office
 * dialogue panel and the dashboard rail can both be alive across a transition —
 * a line is still spoken a single time.
 *
 * This is the component the audit found missing. `present_guidance` appended to
 * `narrativeLog` and returned an effect id naming a region that nothing
 * rendered, so a generated line was accepted, logged, and invisible.
 */

export function NarrationDriver() {
  const speech = useSpeech();

  // Subscribing to the log alone keeps this out of the once-a-second clock
  // re-render: the array identity only changes when a line is appended.
  const narrativeLog = useGameSelector((context) => context.narrativeLog);
  const stateVersion = useGameSelector((context) => context.stateVersion);

  // Order matters: the channel learns where the case is before it is offered new
  // lines, so a line written about a state the player has already left is
  // retired rather than shown on top of the current instruction.
  useEffect(() => {
    narrationChannel.setStateVersion(stateVersion);
  }, [stateVersion]);

  useEffect(() => {
    // Absent until the first line is narrated; the channel treats that as empty.
    narrationChannel.ingest(narrativeLog ?? []);
  }, [narrativeLog]);

  useEffect(() => {
    return narrationChannel.subscribe((state) => {
      const line = state.active;
      if (!line) return;

      /*
       * Narration off is checked *before* the claim, deliberately.
       *
       * Claiming first would burn the sequence on a line that was never
       * spoken, so a player who turns narration on while that line is still on
       * screen would sit in silence until the next one. Checking first leaves
       * the line unclaimed; `setVoiceEnabled` emits, this subscriber runs
       * again, and the line the player is looking at is the line they hear.
       */
      if (!state.voiceEnabled) return;

      // `claimSpeech` is the guarantee, not this callback's frequency: it
      // returns true once per sequence for the lifetime of the run, so a
      // re-render, a second subscriber or a replayed idempotency key cannot
      // produce a second utterance.
      if (!narrationChannel.claimSpeech(line.narrativeSequence)) return;

      speech.speak({
        id: `narration-${line.narrativeSequence}`,
        text: line.message,
        /*
         * One voice. Codex chooses the message and the tone; it does not choose
         * which fictional persona speaks, because there is only one assistant
         * and she is a person — `NODELESS_SOC_REDESIGN_2026-08-31.md` §3.
         */
        role: 'colleague',
        // Narration waits its turn. Interrupting is for something the player
        // must hear now, and a story beat never is.
        priority: 'queued',
      });
    });
  }, [speech]);

  // Mirror the speech engine's own state so the agent-status copy can say the
  // line is being read rather than merely shown.
  useEffect(() => {
    narrationChannel.setSpeaking(speech.speaking);
  }, [speech.speaking]);

  // One switch, not two. The engine already gates `speak()` on its mute and
  // already persists it, so the caption's "Stop Voice" and the settings toggle
  // are the same control seen from two places rather than two preferences that
  // can disagree.
  useEffect(() => {
    narrationChannel.setVoiceEnabled(!speech.muted);
  }, [speech.muted]);

  useEffect(() => () => narrationChannel.reset(), []);

  return null;
}
