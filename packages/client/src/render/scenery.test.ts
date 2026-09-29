import { defaultArtConfig } from '@rampart/config';
import { Structure, Terrain } from '@rampart/sim';
import { describe, expect, it } from 'vitest';

import { LocalMatch } from '../localMatch.js';

import { SceneryTracker, placeScenery } from './scenery.js';

const config = defaultArtConfig.scenery;

function match(seed: number, players = 3): LocalMatch {
  return new LocalMatch({ seed, seats: [null, ...Array<number>(players - 1).fill(5)] });
}

describe('scenery on open land', () => {
  it('stands only on land a step in from the coast, clear of every castle', () => {
    for (const seed of [1, 7, 42]) {
      const { state } = match(seed);
      const items = placeScenery(state, config);
      expect(items.length).toBeGreaterThan(0);
      const w = state.width;
      for (const item of items) {
        for (const [dx, dy] of [
          [0, 0],
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          expect(state.terrain[(item.y + dy) * w + item.x + dx]).toBe(Terrain.Land);
        }
        for (const castle of state.castles) {
          const apart =
            item.x < castle.x - 1 ||
            item.x > castle.x + castle.w ||
            item.y < castle.y - 1 ||
            item.y > castle.y + castle.h;
          expect(apart).toBe(true);
        }
      }
    }
  });

  it('is the same for a seed every time, and differs between seeds', () => {
    const a = placeScenery(match(5).state, config);
    const b = placeScenery(match(5).state, config);
    const c = placeScenery(match(6).state, config);
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
  });

  it('covers some of the land and leaves most of it open', () => {
    const { state } = match(3, 4);
    let land = 0;
    for (const t of state.terrain) if (t === Terrain.Land) land++;
    const share = placeScenery(state, config).length / land;
    expect(share).toBeGreaterThan(0.02);
    expect(share).toBeLessThan(0.2);
  });

  it('is cleared for good from a tile built on or sealed, and puffs once for a landing', () => {
    const { state } = match(9);
    const tracker = new SceneryTracker();
    expect(tracker.sync(state, config)).toBe(true);
    const all = tracker.visible();
    const [built, sealed] = all as [(typeof all)[0], (typeof all)[0]];

    // A piece lands on one: it is taken once, and gone from the next drawing.
    const cell = { x: built.x, y: built.y };
    expect(tracker.take([cell], state.width)).toEqual([built]);
    expect(tracker.take([cell], state.width)).toEqual([]);
    const board = {
      ...state,
      structure: state.structure.slice(),
      territory: state.territory.slice(),
    };
    board.structure[built.index] = Structure.Wall;
    board.territory[sealed.index] = 1;
    expect(tracker.sync(board, config)).toBe(true);
    const after = tracker.visible();
    expect(after).not.toContainEqual(built);
    expect(after).not.toContainEqual(sealed);

    // The wall shot away and the seal lost: the ground stays cleared.
    expect(tracker.sync(state, config)).toBe(false);
    expect(tracker.visible()).toEqual(after);
  });

  it('puffs for nothing it did not draw', () => {
    const { state } = match(9);
    const tracker = new SceneryTracker();
    tracker.sync(state, config);
    const item = placeScenery(state, config)[0]!;
    // Never drawn in this look — hidden while the piece landed.
    expect(tracker.take([{ x: item.x, y: item.y }], state.width)).toEqual([]);
  });
});
