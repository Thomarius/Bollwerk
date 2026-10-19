import { describe, expect, it } from 'vitest';

import { iconSport, sportOf } from './sports.js';
import { BALL_SIZE, SPORTS, ballPoint, heldWhenReady, inFlight } from './sports/figures.js';

describe('the Sports style', () => {
  it('gives a gun the same sport on every client, and every sport to some gun', () => {
    expect(sportOf(17, 5)).toBe(sportOf(17, 5));
    const seen = new Set(Array.from({ length: 200 }, (_, id) => sportOf(id, 5)));
    expect(seen).toEqual(new Set(SPORTS));
    // Another match's seed mixes them anew.
    const one = Array.from({ length: 20 }, (_, id) => sportOf(id, 5));
    const other = Array.from({ length: 20 }, (_, id) => sportOf(id, 6));
    expect(one).not.toEqual(other);
  });

  it('shows one sport on the cannon icon for a whole round', () => {
    expect(iconSport(3, 9)).toBe(iconSport(3, 9));
    const rounds = new Set(Array.from({ length: 40 }, (_, round) => iconSport(round, 9)));
    expect(rounds.size).toBeGreaterThan(3);
  });

  it('lets a free ball leave from where the ready pose shows it', () => {
    // A ball apart from the figure — tossed, falling, on the ground — is met where it is; but
    // the dribbled basketball is taken up into the hands for the jump shot.
    for (const sport of SPORTS) {
      if (heldWhenReady(sport) || sport === 'basketball') continue;
      const ready = ballPoint(sport, 'ready');
      const release = ballPoint(sport, 'release');
      expect(release.x).toBeCloseTo(ready.x);
      expect(release.y).toBeCloseTo(ready.y);
    }
  });

  it('keeps every ball within reach of its gun', () => {
    // Feet at the origin, a gun 2 tiles wide: a ball no further out than its footprint's edge,
    // and not much above it, or it would sit on a neighbour.
    for (const sport of SPORTS) {
      for (const pose of ['ready', 'release', 'bench'] as const) {
        const { x, y } = ballPoint(sport, pose);
        expect(Math.abs(x) + BALL_SIZE[sport].rx, `${sport} ${pose}`).toBeLessThanOrEqual(1.05);
        expect(y, `${sport} ${pose}`).toBeLessThan(0);
        expect(y - BALL_SIZE[sport].ry, `${sport} ${pose}`).toBeGreaterThan(-2.4);
      }
    }
  });

  it('flies the shuttlecock cork first, upright either way', () => {
    // Drawn cork at +x: flying left it is turned half round, and flipped so it is not upside down.
    const right = inFlight('badminton', 1, -0.2, 0.3);
    expect(right.rotation).toBeCloseTo(Math.atan2(-0.2, 1));
    expect(right.scaleY).toBe(1);
    const left = inFlight('badminton', -1, -0.2, 0.3);
    expect(Math.abs(left.rotation)).toBeGreaterThan(Math.PI / 2);
    expect(left.scaleY).toBe(-1);
  });
});
