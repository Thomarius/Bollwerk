import { ArtStyleSchema, type ArtStyle } from '@bollwerk/config';
import { describe, expect, it } from 'vitest';

import { chooseStyleTrack, type StylePauses, type StyleTrackRules } from './styleMusic.js';

/** Medieval and Minimal keep the shared music, as the manifest has it. */
const rules = (chance = 0.5, pauseRounds = 3): StyleTrackRules => ({
  chance,
  pauseRounds,
  hasTrack: (style) => style !== 'pixel' && style !== 'flat',
});

const WINS = 0;
const LOSES = 0.99;

describe('a style’s own track', () => {
  it('plays when the roll falls under the chance, and not otherwise', () => {
    expect(chooseStyleTrack('anime', 1, new Map(), rules(), 0.49).plays).toBe(true);
    expect(chooseStyleTrack('anime', 1, new Map(), rules(), 0.5).plays).toBe(false);
  });

  it('always plays at a chance of 1, never at 0', () => {
    expect(chooseStyleTrack('anime', 1, new Map(), rules(1), 0.999).plays).toBe(true);
    expect(chooseStyleTrack('anime', 1, new Map(), rules(0), 0).plays).toBe(false);
  });

  it('never plays for a style without one, nor holds it back', () => {
    const chosen = chooseStyleTrack('pixel', 1, new Map(), rules(1), WINS);
    expect(chosen.plays).toBe(false);
    expect(chosen.pauses.size).toBe(0);
  });

  it('starts its pause only when it plays', () => {
    expect(chooseStyleTrack('anime', 1, new Map(), rules(), LOSES).pauses.size).toBe(0);
    expect(chooseStyleTrack('anime', 1, new Map(), rules(), WINS).pauses.get('anime')).toBe(1);
  });

  it('is held back for its pause’s rounds, and free after', () => {
    const pauses: StylePauses = new Map([['anime', 2]]);
    const plays = (round: number): boolean =>
      chooseStyleTrack('anime', round, pauses, rules(1, 3), WINS).plays;
    expect([2, 3, 4, 5, 6, 7].map(plays)).toEqual([false, false, false, false, true, true]);
  });

  it('holds back only its own style', () => {
    const pauses: StylePauses = new Map([['anime', 2]]);
    expect(chooseStyleTrack('noir', 3, pauses, rules(1), WINS).plays).toBe(true);
  });

  it('in both looks, plays as building begins and leaves combat the shared music', () => {
    // The user's case (ARCHIVE 14za): one style for both looks, the build look winning.
    const build = chooseStyleTrack('opera', 2, new Map(), rules(1), WINS);
    expect(build.plays).toBe(true);
    const combat = chooseStyleTrack('opera', 3, build.pauses, rules(1), WINS);
    expect(combat.plays).toBe(false);
  });

  it('with a pause of none, may play again the next round but not the same one', () => {
    const played = chooseStyleTrack('opera', 2, new Map(), rules(1, 0), WINS).pauses;
    expect(chooseStyleTrack('opera', 2, played, rules(1, 0), WINS).plays).toBe(false);
    expect(chooseStyleTrack('opera', 3, played, rules(1, 0), WINS).plays).toBe(true);
  });

  it('over thirty rounds of random looks, never plays a style inside its pause', () => {
    const styles = ArtStyleSchema.options;
    let pauses: StylePauses = new Map();
    const heard: { style: ArtStyle; round: number }[] = [];
    // A fixed sequence stands in for Math.random, so the test is the same every run.
    let seed = 7;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let round = 1; round <= 30; round++) {
      for (let look = 0; look < 2; look++) {
        // Few styles, so they come round again inside their pauses.
        const style = styles[Math.floor(next() * 4) + 3] as ArtStyle;
        const chosen = chooseStyleTrack(style, round, pauses, rules(), next());
        pauses = chosen.pauses;
        if (chosen.plays) heard.push({ style, round });
      }
    }
    expect(heard.length).toBeGreaterThan(5);
    for (const [i, a] of heard.entries()) {
      const again = heard.slice(i + 1).find((b) => b.style === a.style);
      if (again !== undefined) expect(again.round).toBeGreaterThan(a.round + 3);
    }
  });
});
