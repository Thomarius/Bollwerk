import { Structure, computeEnclosure, stateFromAscii, type MatchState } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import {
  drainFrom,
  drainWash,
  drainsFrom,
  releaseDrains,
  floodFrom,
  floodOver,
  sealGlow,
  territoryDuring,
} from './seal.js';

// A ring around a castle with one gap in its top edge, mid-way along it.
const breached = `
  ..........
  .,,,,,,,,.
  .,###,##,.
  .,#,,,,#,.
  .,#,@@,#,.
  .,#,@@,#,.
  .,#,,,,#,.
  .,######,.
  .,,,,,,,,.
  ..........
`;

function closed(state: MatchState): MatchState {
  const next = { ...state, structure: state.structure.slice() };
  next.structure[2 * state.width + 5] = Structure.Wall;
  return next;
}

describe('the flood of newly sealed ground', () => {
  const open = stateFromAscii(breached);
  const sealed = closed(open);
  const before = computeEnclosure(open).territory;
  const after = computeEnclosure(sealed).territory;

  it('floods only what was gained, from the castle outward', () => {
    const flood = floodFrom(before, after, open.width, open.castles, 0);
    expect(flood).not.toBeNull();
    // The 4x4 interior, castle included.
    expect(flood?.tiles.length).toBe(16);
    const castleTile = 4 * open.width + 4;
    const corner = 3 * open.width + 3;
    const at = (i: number): number => flood?.dist[Array.from(flood.tiles).indexOf(i)] as number;
    expect(at(castleTile)).toBe(0);
    expect(at(corner)).toBe(2);
    expect(flood?.maxDist).toBe(2);
    expect(Array.from(flood?.owners ?? []).every((o) => o === 1)).toBe(true);
  });

  it('floods nothing when nothing was gained', () => {
    expect(floodFrom(after, after, open.width, open.castles, 0)).toBeNull();
    // Nor when ground is lost, as a breach does.
    expect(floodFrom(after, before, open.width, open.castles, 0)).toBeNull();
  });

  it('widens from the edge of what was already held', () => {
    // The same loop grown by pretending half of it was already sealed.
    const half = after.slice();
    for (let i = 0; i < half.length; i++) if (i % open.width >= 5) half[i] = 0;
    const flood = floodFrom(half, after, open.width, [], 0);
    // Only the new half floods, starting beside the old.
    expect(flood?.tiles.length).toBe(8);
    const next = 3 * open.width + 5;
    expect(flood?.dist[Array.from(flood.tiles).indexOf(next)]).toBe(0);
  });

  it('reveals the ground as its front passes, and leaves the rest hidden', () => {
    const flood = floodFrom(before, after, open.width, open.castles, 1000);
    if (flood === null) throw new Error('expected a flood');
    const count = (t: Uint8Array): number => t.filter((v) => v > 0).length;
    // At 10 tiles a second: the castle at once, a step every 100ms.
    expect(count(territoryDuring(after, [flood], 1000, 10))).toBe(4);
    expect(count(territoryDuring(after, [flood], 1150, 10))).toBe(12);
    expect(count(territoryDuring(after, [flood], 1200, 10))).toBe(16);
    expect(territoryDuring(after, [], 1000, 10)).toBe(after);
  });

  it('never puts back ground lost since the flood began', () => {
    const flood = floodFrom(before, after, open.width, open.castles, 0);
    if (flood === null) throw new Error('expected a flood');
    // Breached again mid-flood: nothing may show that the board no longer holds.
    expect(territoryDuring(before, [flood], 100, 10).every((v) => v === 0)).toBe(true);
  });

  it('lights the front and lets it fade behind, then ends', () => {
    const flood = floodFrom(before, after, open.width, open.castles, 0);
    if (flood === null) throw new Error('expected a flood');
    const glow = sealGlow([flood], 100, open.width, 10, 3);
    // Front at step 1: the ring at step 1 is brightest, the castle fading behind it.
    const ring = glow.filter((g) => g.strength === 1);
    expect(ring.length).toBe(8);
    expect(glow.find((g) => g.x === 4 && g.y === 4)?.strength).toBeCloseTo(2 / 3);
    expect(glow.every((g) => g.owner === 0)).toBe(true);
    expect(floodOver(flood, 400, 10, 3)).toBe(false);
    expect(floodOver(flood, 501, 10, 3)).toBe(true);
  });
});

describe('the drain of ground lost to a breach', () => {
  // The same ring, sealed and then opened at the gap in its top edge.
  const open = stateFromAscii(breached);
  const sealed = closed(open);
  const held = computeEnclosure(sealed).territory;
  const now = computeEnclosure(open);

  it('drains only what was lost, from the gap inward', () => {
    const drain = drainFrom(held, now.territory, now.outside, open.width, 0);
    expect(drain).not.toBeNull();
    // The 4x4 interior, castle included.
    expect(drain?.tiles.length).toBe(16);
    const at = (x: number, y: number): number =>
      drain?.dist[Array.from(drain.tiles).indexOf(y * open.width + x)] as number;
    // Under the gap first; the far corner of the ring last.
    expect(at(5, 3)).toBe(0);
    expect(at(3, 6)).toBe(drain?.maxDist);
    expect(at(3, 6)).toBeGreaterThan(at(4, 4));
  });

  it('is nothing when nothing was lost', () => {
    expect(drainFrom(held, held, computeEnclosure(sealed).outside, open.width, 0)).toBeNull();
  });

  it('washes every lost tile at first, and each goes as the drain reaches it', () => {
    const drain = drainFrom(held, now.territory, now.outside, open.width, 0)!;
    expect(drainWash([drain], 0, open.width, 10)).toHaveLength(16);
    // A second in at ten tiles a second, the whole interior has run out.
    expect(drainWash([drain], 1000, open.width, 10)).toHaveLength(0);
    // Half-way, the tiles by the gap are gone and the far ones still washed.
    const half = drainWash([drain], ((drain.maxDist / 2) * 1000) / 10, open.width, 10);
    expect(half.some((w) => w.x === 5 && w.y === 3)).toBe(false);
    expect(half.find((w) => w.x === 3 && w.y === 6)?.strength).toBe(1);
  });

  it('waits wholly washed until the banner line reaches it', () => {
    const [drain] = drainsFrom(held, now.territory, now.outside, open.width);
    expect(drain).toBeDefined();
    expect(drainWash([drain!], 5000, open.width, 10)).toHaveLength(16);
    // The interior's top row is 3; a line above it releases nothing.
    releaseDrains([drain!], 3, open.width, 5000);
    expect(drain!.startMs).toBe(Number.POSITIVE_INFINITY);
    releaseDrains([drain!], 4, open.width, 5000);
    expect(drain!.startMs).toBe(5000);
    expect(drainWash([drain!], 6000, open.width, 10)).toHaveLength(0);
  });
});
