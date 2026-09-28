import { describe, expect, it } from 'vitest';

import {
  SEA_N,
  SEA_NE,
  SEA_NW,
  SEA_SW,
  SEA_W,
  coastDistance,
  filletCorners,
  filletDistance,
} from './coast.js';

const SIZE = 16;
const R = 5;

describe('the coast drawn inside its tiles', () => {
  it('runs straight along a side that meets the sea', () => {
    for (let x = R; x < SIZE - R; x++) {
      for (let y = 0; y < 6; y++) expect(coastDistance(SEA_N, x, y, SIZE, R)).toBe(y + 0.5);
    }
  });

  it('is nowhere on a tile with no sea beside it', () => {
    expect(coastDistance(0, 8, 8, SIZE, R)).toBe(Number.POSITIVE_INFINITY);
  });

  it('cuts back a corner where the land turns outward, and only there', () => {
    const mask = SEA_N | SEA_W | SEA_NW;
    // The very corner is sea now; the middle of the tile is untouched.
    expect(coastDistance(mask, 0, 0, SIZE, R)).toBeLessThan(0);
    expect(coastDistance(mask, 8, 8, SIZE, R)).toBe(8.5);
    // Along the edge past the rounding, the coast is straight again.
    expect(coastDistance(mask, R, 0, SIZE, R)).toBe(0.5);
  });

  it('leaves the corners square when the radius is nought', () => {
    expect(coastDistance(SEA_N | SEA_W | SEA_NW, 0, 0, SIZE, 0)).toBe(0.5);
  });

  /**
   * Land turning inward, as tiles:
   *
   *     , .      , land   . sea
   *     , L
   *
   * The sea tile above L has land on two sides and across its corner, so it is filleted
   * there, and L's coast bends round the fillet. Either side of the seam between them
   * the distance to the coast is measured to the same arc, so the beach runs on without
   * a step.
   */
  it('meets the fillet of the sea beside it without a step', () => {
    const maskL = SEA_N | SEA_NE;
    for (let x = 0; x < R; x++) {
      const inL = coastDistance(maskL, x, 0, SIZE, R);
      const inSea = filletDistance(SEA_SW, x, SIZE - 1, SIZE, R);
      expect(Math.abs(inL - inSea)).toBeLessThanOrEqual(1.01);
      // Filled in, the coast lies further off than the tile's own edge.
      expect(inL).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('fills a sea tile corner only where three tiles of land close round it', () => {
    //  , ,
    //  , .   the sea tile at the bottom right: its north-west corner is filled
    const closed = filletCorners((dx, dy) => dx <= 0 && dy <= 0 && !(dx === 0 && dy === 0));
    expect(closed & SEA_NW).toBe(SEA_NW);
    //  , .
    //  . .   land only across the corner: the sea passes, so nothing joins them
    const diagonal = filletCorners((dx, dy) => dx === -1 && dy === -1);
    expect(diagonal).toBe(0);
    //  . ,
    //  , .   two tiles of land meeting at a point: no fillet either
    const point = filletCorners((dx, dy) => (dx === 0 && dy === -1) || (dx === -1 && dy === 0));
    expect(point).toBe(0);
  });

  it('adds land only inside the corner it fills', () => {
    expect(filletDistance(SEA_SW, 0, SIZE - 1, SIZE, R)).toBeGreaterThan(0);
    expect(filletDistance(SEA_SW, 8, 8, SIZE, R)).toBe(Number.NEGATIVE_INFINITY);
    expect(filletDistance(SEA_NW, SIZE - 1, SIZE - 1, SIZE, R)).toBe(Number.NEGATIVE_INFINITY);
    expect(coastDistance(SEA_W, 0, 8, SIZE, R)).toBe(0.5);
  });
});
