import type { PixelStyleConfig } from '@rampart/config';
import { Rng } from '@rampart/sim';

/**
 * The light of the day through a match, in the pixel style: morning gold as it opens,
 * plain noon light in the middle, and the sun going down toward the last round, which is
 * set at sunset. Laid on the ground and the sea only, under the walls, so no player's
 * colour moves with it — the rule the torchlight taught (ARCHIVE 11g).
 *
 * With no round cap the day comes round again every ten rounds.
 */
export function daylight(
  round: number,
  maxRounds: number | null,
  peakAlpha: number,
): { colour: number; alpha: number } {
  const span = maxRounds ?? 10;
  const r = maxRounds === null ? ((Math.max(1, round) - 1) % span) + 1 : Math.max(1, round);
  const f = span <= 1 ? 1 : Math.min(1, (r - 1) / (span - 1));
  // Keyframes of the day: colour and how strongly it is laid on, at fractions of it.
  const keys: [number, number, number][] = [
    [0, 0xffd08a, 0.45],
    [0.35, 0xffffff, 0],
    [0.7, 0xffb866, 0.4],
    [1, 0xff6a3a, 1],
  ];
  let k = 0;
  while (k < keys.length - 2 && f > (keys[k + 1] as [number, number, number])[0]) k++;
  const [f0, c0, a0] = keys[k] as [number, number, number];
  const [f1, c1, a1] = keys[k + 1] as [number, number, number];
  const t = f1 === f0 ? 1 : (f - f0) / (f1 - f0);
  const mix = (a: number, b: number): number => {
    const ch = (s: number): number =>
      Math.round(((a >> s) & 0xff) * (1 - t) + ((b >> s) & 0xff) * t);
    return (ch(16) << 16) | (ch(8) << 8) | ch(0);
  };
  return { colour: mix(c0, c1), alpha: peakAlpha * (a0 + (a1 - a0) * t) };
}

/**
 * The shadows the sun casts through the day (PLAN 11.15), in tiles: how far they reach
 * south of what stands up, and how far they lean — west in the morning, with the sun in
 * the east, east at sunset. Long and leaning early and late, short and straight at noon,
 * on the day `daylight` colours by round; at noon exactly the fixed shadow of before.
 */
export function shadowCast(
  round: number,
  maxRounds: number | null,
): { length: number; lean: number } {
  const span = maxRounds ?? 10;
  const r = maxRounds === null ? ((Math.max(1, round) - 1) % span) + 1 : Math.max(1, round);
  const f = span <= 1 ? 1 : Math.min(1, (r - 1) / (span - 1));
  // Noon a third of the way through, as the daylight's plain white is.
  const noon = 0.35;
  const away = f < noon ? (noon - f) / noon : (f - noon) / (1 - noon);
  return {
    length: 0.35 + away * (f < noon ? 0.3 : 0.45),
    lean: (f < noon ? -0.35 : 0.45) * away,
  };
}

export type Weather = 'clear' | 'overcast' | 'rain' | 'fog' | 'snow';

/** The match's weather, from its seed and the odds of each, so every look agrees. */
export function weatherFor(seed: number, odds: PixelStyleConfig['weatherOdds']): Weather {
  const kinds: Weather[] = ['clear', 'overcast', 'rain', 'fog', 'snow'];
  const total = kinds.reduce((sum, kind) => sum + odds[kind], 0);
  if (total <= 0) return 'clear';
  let roll = new Rng((seed ^ 0x3ea7e2) >>> 0).nextFloat() * total;
  for (const kind of kinds) {
    roll -= odds[kind];
    if (roll < 0) return kind;
  }
  return 'clear';
}
