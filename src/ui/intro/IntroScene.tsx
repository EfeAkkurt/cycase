import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { useGame, usePrefersReducedMotion, useRuntime } from '../../app/gameContext';
import { useAudio } from '../../audio/audioContext';
import { t } from '../../i18n';
import { Button } from '../primitives';
import { planTypewriter, type GlyphStep } from './typewriter';

/**
 * The opening.
 *
 * Two layers over the same three sentences, which is the whole point of the
 * audit contract's P0.5 wording:
 *
 *  - a transcript that inserts each sentence *whole* into a polite live region,
 *    so assistive technology never receives a half-typed string;
 *  - an `aria-hidden` visual layer that types the same sentence a glyph at a
 *    time, with punctuation rests and a key click per character group.
 *
 * The visual layer renders through `content: attr(data-typed)`. That is not a
 * trick for its own sake: pseudo-element text is outside `textContent`, so the
 * decorative copy cannot be picked up as a second occurrence of a sentence that
 * already exists in the accessible transcript — by any consumer, a screen
 * reader and a test locator alike.
 *
 * The glyph loop writes those attributes straight to the DOM rather than
 * through state. Seventy-odd React renders would buy nothing and would put the
 * scheduler between the timer and the paint, which is exactly the jitter the
 * 28–36 ms cadence has to survive.
 */
export function IntroScene() {
  const runtime = useRuntime();
  const ctx = useGame();
  const audio = useAudio();
  const reducedMotion = usePrefersReducedMotion();

  const lines = useMemo(
    () => [
      { key: 'clock', text: t('intro.line.clock') },
      { key: 'alert', text: t('intro.line.alert') },
      { key: 'wake', text: t('intro.line.wake', { name: ctx.operatorName }) },
    ],
    [ctx.operatorName],
  );

  const steps = useMemo(() => planTypewriter(lines.map((line) => line.text)), [lines]);

  /** How many sentences the transcript has released, whole, to the live region. */
  const [spoken, setSpoken] = useState(reducedMotion ? lines.length : 0);
  const [done, setDone] = useState(reducedMotion);

  const layerRef = useRef<HTMLDivElement>(null);
  const glyphRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  const audioRef = useRef(audio);
  useEffect(() => {
    audioRef.current = audio;
  }, [audio]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;

    // Reduced motion gets the finished frame. No reveal, no clicks, no waiting.
    if (reducedMotion) {
      lines.forEach((line, index) => {
        const node = glyphRefs.current[index];
        if (!node) return;
        node.dataset.typed = line.text;
        node.dataset.state = 'done';
      });
      layer.dataset.twGlyphs = String(steps.length);
      layer.dataset.twPause = '0';
      layer.dataset.twKeys = '0';
      return;
    }

    let timer = 0;
    let index = 0;
    let keys = 0;
    const start = performance.now();

    const apply = (step: GlyphStep) => {
      const text = lines[step.line]!.text;

      /*
       * The whole sentence reaches the transcript before its first glyph
       * reaches the DOM, and the order is the point.
       *
       * The glyph write below is synchronous; `setSpoken` was not, so for the
       * span between them the partial line existed on screen while the
       * complete one had not yet been committed. A reader sampling in that
       * window is handed half a sentence, which is exactly what the aria-hidden
       * typed layer exists to prevent. `flushSync` closes the window.
       *
       * It has to be the FIRST glyph rather than the line before, because the
       * transcript is a live region and a live region does not announce the
       * content it is first rendered with.
       */
      if (step.chars === 1) {
        flushSync(() => setSpoken((count) => Math.max(count, step.line + 1)));
      }

      const node = glyphRefs.current[step.line];
      if (node) {
        node.dataset.typed = text.slice(0, step.chars);
        // The caret belongs to the line under the hand, and nowhere else.
        node.dataset.state = step.chars === text.length ? 'done' : 'typing';
      }
      if (step.sound) {
        keys += 1;
        audioRef.current.play('typewriter');
      }
      layer.dataset.twGlyphs = String(step.glyph);
      layer.dataset.twPause = String(step.pause);
      layer.dataset.twKeys = String(keys);
    };

    const tick = () => {
      apply(steps[index]!);
      index += 1;
      if (index >= steps.length) {
        setDone(true);
        return;
      }
      // Absolute targets, not accumulated delays: a single late timer cannot
      // drag the whole line off the contracted cadence.
      const target = start + steps[index]!.at;
      timer = window.setTimeout(tick, Math.max(0, target - performance.now()));
    };

    timer = window.setTimeout(tick, steps[0]!.at);
    return () => window.clearTimeout(timer);
  }, [lines, steps, reducedMotion]);

  return (
    <main className="scene" id="main">
      <div className="scene__inner">
        <div className="scene__lines intro__lines">
          {/*
            The accessible truth. Each sentence arrives complete, at the moment
            its first glyph is drawn, so what a screen reader hears is always a
            superset of what the screen shows.
          */}
          <div className="sr-only" aria-live="polite">
            {lines.slice(0, spoken).map((line) => (
              <p key={line.key}>{line.text}</p>
            ))}
          </div>

          <div
            className="intro__typewriter"
            data-testid="intro-typewriter"
            data-tw-glyphs="0"
            data-tw-pause="0"
            data-tw-keys="0"
            aria-hidden="true"
            ref={layerRef}
          >
            {lines.map((line, index) => (
              <p
                key={line.key}
                data-typed=""
                data-state=""
                data-line={line.key}
                className={
                  line.key === 'clock'
                    ? 'intro__glyphs intro__glyphs--clock scene__line--clock'
                    : 'intro__glyphs'
                }
                ref={(node) => {
                  glyphRefs.current[index] = node;
                }}
              />
            ))}
          </div>
        </div>

        <div className="row" style={{ justifyContent: 'center' }}>
          <Button
            variant={done ? 'primary' : 'ghost'}
            onClick={() => {
              audio.play('reveal');
              runtime.send({ type: 'INTRO_ADVANCE' });
            }}
          >
            {done ? t('intro.action.investigate') : t('app.skip_intro')}
          </Button>
        </div>
      </div>
    </main>
  );
}
