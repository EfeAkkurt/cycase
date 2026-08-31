import { useSyncExternalStore } from 'react';

import { useSpeech } from '../../audio/speechContext';
import { t, type StringKey } from '../../i18n';
import type { GuidanceTone } from '../../game/types';
import { Badge, Button, Icon } from '../primitives';
import { narrationChannel, type NarrationState } from './narrationStore';

/**
 * The generated line, as a player sees it.
 *
 * Rendered in the office dialogue area and in the dashboard rail; both read the
 * same channel, so the same line appears wherever the player is standing when
 * the agent says it.
 *
 * Every line here came from `present_guidance`, which means a connected agent
 * wrote it, and the panel says so above the text. Printing VERA's name over a
 * generated sentence would credit a person for it, and naming the agent in a
 * speaker slot would read as a second character — there is one in-world
 * assistant, and she does not deliver this channel. So the label names the
 * source, not a speaker, and it is inside the announced region rather than
 * beside it.
 *
 * Text only, always. The message is authored by a model that may itself have
 * read attacker-controlled evidence, so it is set as a text node — never
 * `innerHTML`, never markdown, never a link. The engine sanitises it first; this
 * is the second of the two independent defences, and it is the one that holds if
 * the first is ever loosened.
 */

export function useNarration(): NarrationState {
  return useSyncExternalStore(
    (listener) => narrationChannel.subscribe(() => listener()),
    () => narrationChannel.getState(),
    () => narrationChannel.getState(),
  );
}

const TONE_LABEL: Record<GuidanceTone, StringKey> = {
  urgent: 'narration.tone.urgent',
  calm: 'narration.tone.calm',
  teaching: 'narration.tone.teaching',
  warning: 'narration.tone.warning',
  encouraging: 'narration.tone.encouraging',
  debrief: 'narration.tone.debrief',
};

/** Tone drives emphasis, never colour alone. */
const TONE_TONE: Record<GuidanceTone, 'critical' | 'warning' | 'accent' | 'neutral'> = {
  urgent: 'critical',
  warning: 'warning',
  teaching: 'accent',
  encouraging: 'accent',
  calm: 'neutral',
  debrief: 'neutral',
};

export function NarrationPanel({ compact = false }: { compact?: boolean }) {
  const narration = useNarration();
  const speech = useSpeech();
  const line = narration.active;

  if (!line) return null;

  return (
    <div
      className={compact ? 'narration narration--compact' : 'narration'}
      id="rail-narration"
      role="status"
      aria-live="polite"
    >
      {/*
       * `aria-live="off"` on everything that is not the sentence.
       *
       * The region has to stay on this element — it is the one the office and
       * the rail both mount — but a live region announces every node that
       * changes inside it, and that meant a screen reader read the tone badge,
       * the queue counter and three button labels before reaching the line.
       * Switching the surrounding chrome off leaves exactly one announced
       * subtree: the labelled caption below. Sentence-level, as §7 requires.
       *
       * `aria-atomic` stays at its default `false` on *this* element on purpose
       * — setting it true here would pull the whole subtree, buttons included,
       * back into the announcement and undo this. It is set on the caption
       * wrapper instead, where it reaches the source label and nothing more.
       */}
      <div className="narration__head" aria-live="off">
        <Badge tone={TONE_TONE[line.tone]}>{t(TONE_LABEL[line.tone])}</Badge>
        {narration.speaking ? (
          <span className="narration__status">{t('narration.speaking')}</span>
        ) : null}
        {narration.pending.length > 0 ? (
          <span className="narration__status">
            {t('narration.queued', { count: narration.pending.length })}
          </span>
        ) : null}
      </div>

      {/*
       * The caption, and the label that says where it came from — one element,
       * announced together.
       *
       * The label used to live in the head, which is `aria-live="off"`. That is
       * correct for the tone badge and the queue counter, and wrong for this:
       * it meant a sighted player was told the line was generated and a screen
       * reader user was not. §7 asks for the label, not for a visible label.
       *
       * `aria-atomic` on this wrapper is what fixes it. The region's own
       * `aria-atomic` stays at its default `false` — turning it on there would
       * drag the badge, the counter and three button labels back into every
       * announcement. Set here, it reaches exactly as far as the source label
       * and the sentence: when `line.message` changes, assistive technology
       * walks up to the nearest atomic ancestor and reads "Generated guidance"
       * followed by the whole line, which is the announcement the caption
       * contract actually promises.
       *
       * `{line.message}` stays a React text child, so any markup in it is
       * displayed rather than parsed — which is the point. `.narration__text`
       * keeps the message and nothing else: it is the caption element the
       * browser tests read, and it is the scroll container the truncation check
       * measures.
       */}
      <div className="narration__caption" aria-atomic="true">
        <span className="narration__speaker">
          <Icon name="agent" size={12} />
          {t('narration.generated')}
        </span>
        <p className="narration__text" data-narration-sequence={line.narrativeSequence}>
          {line.message}
        </p>
      </div>

      <div className="narration__controls" aria-live="off">
        <Button
          size="sm"
          variant="ghost"
          id="narration-skip"
          onClick={() => {
            speech.cancel();
            narrationChannel.skip();
          }}
        >
          {t('narration.skip')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          id="narration-repeat"
          onClick={() => {
            if (!narration.voiceEnabled) return;
            speech.speak({
              id: `narration-${line.narrativeSequence}-repeat`,
              text: line.message,
              role: 'colleague',
              priority: 'interrupt',
            });
          }}
          disabled={!narration.voiceEnabled}
        >
          {t('narration.repeat')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          id="narration-stop-voice"
          aria-pressed={!narration.voiceEnabled}
          onClick={() => {
            // Written through the speech engine, which owns the preference and
            // persists it; the channel picks the change up from there.
            speech.setMuted(narration.voiceEnabled);
          }}
        >
          {narration.voiceEnabled ? t('narration.stop_voice') : t('narration.start_voice')}
        </Button>
      </div>

      {/*
       * Said once, plainly. Browser speech quality is whatever the operating
       * system provides, and the caption is the channel that always works.
       */}
      {!narration.voiceEnabled || !speech.hasVoice ? (
        <p className="narration__note" aria-live="off">
          {t('narration.caption_only')}
        </p>
      ) : null}
    </div>
  );
}
