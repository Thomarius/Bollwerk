import { applyEnclosure, stateFromAscii } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { PILE_CORNERS, pileCorner, ringCorners, spreadOut } from './life.js';

const ring = (picture: string) => {
  const state = stateFromAscii(picture);
  applyEnclosure(state);
  return state;
};

describe("Night's braziers", () => {
  it('stand on the four outer corners of a sealed ring, pointing out of it', () => {
    const state = ring(`
      ..........
      .,,,,,,,,.
      .,#####,,.
      .,#,,,#,,.
      .,#,@@#,,.
      .,#,@@#,,.
      .,#####,,.
      .,,,,,,,,.
      ..........
    `);
    const corners = ringCorners(state).map((c) => [c.x, c.y, c.dx, c.dy]);
    expect(corners).toEqual([
      [2, 2, -1, -1],
      [6, 2, 1, -1],
      [2, 6, -1, 1],
      [6, 6, 1, 1],
    ]);
  });

  it('stand on no inner corner, and on none of a ring that is open', () => {
    // An L-shaped ring: its inner corner at (6, 4) turns the other way and is passed over.
    const sealed = ring(`
      ...........
      .,,,,,,,,,.
      .,#####,,,.
      .,#,,,#,,,.
      .,#,@@####.
      .,#,@@,,,#.
      .,########.
      .,,,,,,,,,.
      ...........
    `);
    const corners = ringCorners(sealed).map((c) => `${c.x},${c.y}`);
    expect(corners).toEqual(['2,2', '6,2', '9,4', '2,6', '9,6']);
    // A mid-edge block gone: nothing is sealed, so nothing burns.
    const open = ring(`
      ..........
      .,,,,,,,,.
      .,##,##,,.
      .,#,,,#,,.
      .,#,@@#,,.
      .,#,@@#,,.
      .,#####,,.
      .,,,,,,,,.
      ..........
    `);
    expect(ringCorners(open)).toEqual([]);
  });

  it('are spread round a ring as far apart as they go, a few at most', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(spreadOut(points, 3, 3)).toEqual([points[0], points[3], points[2]]);
    expect(spreadOut(points, 0, 3)).toEqual([]);
    // None nearer than the gap: two side by side make one.
    expect(spreadOut(points.slice(0, 2), 3, 3)).toEqual([points[0]]);
  });
});

describe("a gun's pile of balls", () => {
  it('lies in the corner across from its sandbags', () => {
    const corner = (outward: number) => PILE_CORNERS[pileCorner(outward)];
    // Sandbags to the south-east: the pile north-west, and so on round.
    expect(corner(1)).toEqual([0, 0]);
    expect(corner(3)).toEqual([1, 0]);
    expect(corner(5)).toEqual([1, 1]);
    expect(corner(7)).toEqual([0, 1]);
    // Facing a side, the corner on the far side, just clockwise of straight across.
    expect(corner(0)).toEqual([0, 0]);
    expect(corner(6)).toEqual([0, 1]);
  });
});
