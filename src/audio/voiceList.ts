import { LOCALE_PREFERENCES, type SpeechLocale, type VoiceOption } from './speech';

/**
 * Ordering the voice list so the usable voices are the visible ones.
 *
 * A browser hands back whatever `getVoices()` returns, in whatever order the
 * operating system keeps them — commonly forty or more, alphabetical by an
 * internal name, with the two or three that can actually read this copy
 * scattered through the middle. A player looking for a voice for *English*
 * narration was reading a list mostly composed of voices for languages the
 * product has no copy in.
 *
 * Two groups, and the rule for the first one is the same rule the automatic
 * pick already uses (`SpeechDirector.pickVoice`): the locale's preferred BCP-47
 * prefixes, local before remote. That matters beyond tidiness — the picker and
 * the automatic choice agreeing means the voice at the top of the list is the
 * one the player would have got anyway.
 *
 * Pure, and separate from the director, so the ordering can be asserted without
 * a speech engine.
 */

export interface RankedVoices {
  /** Can read this copy: right language, local engines first. */
  recommended: VoiceOption[];
  /** Everything else, grouped by language so it is at least navigable. */
  other: VoiceOption[];
}

/** How well a voice matches the locale. Lower is better; -1 is no match. */
export function localeRank(voice: VoiceOption, locale: SpeechLocale): number {
  const lang = voice.lang.toLowerCase();
  const prefixes = LOCALE_PREFERENCES[locale];
  for (let index = 0; index < prefixes.length; index += 1) {
    if (lang.startsWith(prefixes[index]!)) return index;
  }
  return -1;
}

function byName(a: VoiceOption, b: VoiceOption): number {
  return a.name.localeCompare(b.name);
}

export function rankVoices(voices: readonly VoiceOption[], locale: SpeechLocale): RankedVoices {
  const recommended: { voice: VoiceOption; rank: number }[] = [];
  const other: VoiceOption[] = [];

  for (const voice of voices) {
    const rank = localeRank(voice, locale);
    if (rank < 0) other.push(voice);
    else recommended.push({ voice, rank });
  }

  recommended.sort((a, b) => {
    // Exact locale before generic, then a local engine before a network one —
    // a remote voice stalls on a slow connection, and the narration is timed.
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.voice.localService !== b.voice.localService) return a.voice.localService ? -1 : 1;
    return byName(a.voice, b.voice);
  });

  other.sort((a, b) => a.lang.localeCompare(b.lang) || byName(a, b));

  return { recommended: recommended.map((entry) => entry.voice), other };
}

/**
 * Substring match over the name and the language tag, case-insensitively.
 *
 * Deliberately not fuzzy. A player types "en-GB" or "Daniel", and a matcher
 * that also returned near-misses would bury the exact hit they asked for.
 */
export function filterVoices(voices: readonly VoiceOption[], query: string): VoiceOption[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...voices];
  return voices.filter(
    (voice) =>
      voice.name.toLowerCase().includes(needle) || voice.lang.toLowerCase().includes(needle),
  );
}
