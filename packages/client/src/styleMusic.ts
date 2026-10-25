import type { ArtStyle } from '@bollwerk/config';

/**
 * Whether a style's own track plays as its look starts (ARCHIVE 14za).
 *
 * Kept pure, as `banners.ts` and `scores.ts` are, so the rules can be tested without a
 * browser: the roll is handed in, and the pauses are given and returned rather than kept.
 */

/** The manifest's two values, and which styles have a track at all. */
export interface StyleTrackRules {
  /** `styleTrackChance`: 0 to 1. */
  chance: number;
  /** `styleTrackPauseRounds`: the rounds after the one it played in that a track is held back. */
  pauseRounds: number;
  hasTrack: (style: ArtStyle) => boolean;
}

/** The round each style's track last played in; a style never heard is absent. */
export type StylePauses = ReadonlyMap<ArtStyle, number>;

/**
 * As a look starts in `style` in `round` — the round as it stands once the look's phase has
 * begun — with `roll` drawn from [0, 1): whether the style's own track plays in place of
 * the shared one, and the pauses after.
 *
 * Rolled at every start, even of a style that has not changed. A track that played in round
 * r is held back through round r + `pauseRounds`, its own round included: so a style that
 * won as building began, and is the combat look too, finds its pause running at combat and
 * plays the shared battle music, as the user meant. Other styles are not held back.
 */
export function chooseStyleTrack(
  style: ArtStyle,
  round: number,
  pauses: StylePauses,
  rules: StyleTrackRules,
  roll: number,
): { plays: boolean; pauses: StylePauses } {
  if (!rules.hasTrack(style)) return { plays: false, pauses };
  const last = pauses.get(style);
  if (last !== undefined && round <= last + rules.pauseRounds) return { plays: false, pauses };
  if (roll >= rules.chance) return { plays: false, pauses };
  return { plays: true, pauses: new Map(pauses).set(style, round) };
}
