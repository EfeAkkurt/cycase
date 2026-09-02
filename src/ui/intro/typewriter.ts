/**
 * The typewriter plan.
 *
 * Audit contract P0.5: "add a separate `aria-hidden` visual typewriter layer at
 * 28–36 ms per glyph with punctuation pauses and grouped key sounds."
 *
 * The schedule is computed once, as data, before a single character is drawn.
 * That is what makes the cadence measurable rather than a matter of taste:
 * every step carries the millisecond it is due at and the rest time already
 * spent, so dividing elapsed time by glyphs over any window yields the real
 * per-glyph rate instead of an average polluted by the punctuation rests.
 */

/** Base rate. The contract's window is 28–36 ms; this sits in the middle. */
export const GLYPH_MS = 31;

/** Rest after the closing character of a line, before the next line starts. */
export const LINE_PAUSE_MS = 340;

/** A key group is at most this many characters. */
export const GROUP_SIZE = 3;

/**
 * Punctuation rests, graded by how long a reader's eye actually stops.
 *
 * The old table had three values doing the work of five: a comma and a
 * semicolon rested the same, and a full stop, an exclamation and a question
 * mark were identical at 220 ms. Read back, the line lost its shape — every
 * sentence ended with the same beat regardless of what kind of sentence it was.
 *
 * Deliberately still not `:` — the opening line is a clock, and a rest inside
 * `03:17:42` reads as a stutter rather than as breath.
 */
const PAUSE_AFTER: Record<string, number> = {
  ',': 110,
  ';': 150,
  ':': 0,
  '.': 230,
  '!': 260,
  '?': 280,
  '…': 300,
  '—': 160,
};

/**
 * A rest a space earns, when the word it closed was long enough to earn one.
 *
 * Nothing rested at a word boundary before, so a nine-word sentence arrived as
 * one undifferentiated run of glyphs at a fixed rate. This is small on purpose:
 * enough to give the line a pulse, not enough to read as hesitation.
 */
export const WORD_PAUSE_MS = 26;

/** Words shorter than this are not worth a rest; they read as one gesture. */
const WORD_PAUSE_MIN_CHARS = 4;

/** True where a key group must be flushed even before it is full. */
function isBoundary(char: string): boolean {
  return char === ' ' || char in PAUSE_AFTER;
}

export interface GlyphStep {
  /** Index of the line this glyph belongs to. */
  line: number;
  /** Characters of that line visible once this step has been applied. */
  chars: number;
  /** Milliseconds from the start of the sequence at which this step is due. */
  at: number;
  /** 1-based count of glyphs revealed once this step has been applied. */
  glyph: number;
  /** Total punctuation and line rest already spent before this step. */
  pause: number;
  /** This step closes a key group, so it carries the click. */
  sound: boolean;
}

/**
 * Expands lines into one step per character.
 *
 * `at` is `glyph * GLYPH_MS + pause`, so subtracting the pause delta across any
 * two steps leaves exactly the glyph time between them.
 */
export function planTypewriter(lines: string[]): GlyphStep[] {
  const steps: GlyphStep[] = [];
  let glyph = 0;
  let pause = 0;
  let group = 0;

  lines.forEach((text, line) => {
    const chars = [...text];
    let sinceBoundary = 0;

    chars.forEach((char, index) => {
      glyph += 1;
      group += 1;

      const last = index === chars.length - 1;
      /*
       * A key click closes a group, a word or a clause.
       *
       * Grouping alone produced a click every third glyph forever, which is a
       * machine-gun rather than a typist: real key sounds cluster inside a word
       * and thin out at its edges. Flushing on the boundary as well means the
       * click density follows the words instead of ignoring them.
       */
      const sound = group >= GROUP_SIZE || isBoundary(char) || last;
      if (sound) group = 0;

      steps.push({
        line,
        chars: index + 1,
        at: glyph * GLYPH_MS + pause,
        glyph,
        pause,
        sound,
      });

      pause += PAUSE_AFTER[char] ?? 0;

      // A rest at the end of a word, but only a word long enough to have been
      // one. `sinceBoundary` counts the glyphs since the last space.
      if (char === ' ') {
        if (sinceBoundary >= WORD_PAUSE_MIN_CHARS) pause += WORD_PAUSE_MS;
        sinceBoundary = 0;
      } else {
        sinceBoundary += 1;
      }

      if (last && line < lines.length - 1) pause += LINE_PAUSE_MS;
    });
  });

  return steps;
}

/** Total wall-clock length of the planned sequence. */
export function typewriterDuration(steps: GlyphStep[]): number {
  return steps.length === 0 ? 0 : steps[steps.length - 1]!.at;
}
