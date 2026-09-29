import type { MatchState } from '@rampart/sim';
import { describe, expect, it } from 'vitest';

import { between, openingShot, winnerShot } from './camera.js';

const art = { openingZoom: 2, openingHold: 0.25, winnerZoom: 1.5, winnerPushMs: 1000 };

function state(fields: Partial<Record<string, unknown>>): MatchState {
  return {
    width: 40,
    height: 20,
    phase: 'intermission',
    pendingPhase: 'castle_select',
    round: 0,
    tick: 0,
    phaseEndTick: 100,
    ...fields,
  } as unknown as MatchState;
}

const island = { x: 9, y: 4 };

describe('the opening shot', () => {
  it('starts on the viewer’s island and holds there a moment', () => {
    for (const tick of [0, 20, 25]) {
      expect(openingShot(state({ tick }), 0, island, art)).toEqual({
        zoom: 2,
        focusX: 9.5,
        focusY: 4.5,
      });
    }
  });

  it('pulls out to the whole map by the time the castle choice opens', () => {
    const middle = openingShot(state({ tick: 60 }), 0, island, art)!;
    expect(middle.zoom).toBeGreaterThan(1);
    expect(middle.zoom).toBeLessThan(2);
    expect(openingShot(state({ tick: 100 }), 0, island, art)).toEqual({
      zoom: 1,
      focusX: 20,
      focusY: 10,
    });
  });

  it('is only the opening: not a later intermission, and not without an island', () => {
    expect(openingShot(state({ round: 1 }), 0, island, art)).toBeNull();
    expect(openingShot(state({ pendingPhase: 'combat' }), 0, island, art)).toBeNull();
    expect(openingShot(state({ phase: 'castle_select' }), 0, island, art)).toBeNull();
    expect(openingShot(state({}), 0, undefined, art)).toBeNull();
  });
});

describe('the push onto the winner', () => {
  const over = state({ phase: 'game_over', round: 10 });

  it('grows the winner where it stands, from the whole map to close, then holds', () => {
    // In place: the middle of the screen is the summary's.
    const start = { zoom: 1, focusX: 9.5, focusY: 4.5, inPlace: true };
    expect(winnerShot(over, 0, [island], art)).toEqual(start);
    const end = { ...start, zoom: 1.5 };
    expect(winnerShot(over, 1000, [island], art)).toEqual(end);
    expect(winnerShot(over, 60_000, [island], art)).toEqual(end);
  });

  it('frames shared winners together, and nobody for a draw', () => {
    const shot = winnerShot(over, 1000, [island, { x: 29, y: 14 }], art)!;
    expect([shot.focusX, shot.focusY]).toEqual([19.5, 9.5]);
    expect(winnerShot(over, 1000, [], art)).toBeNull();
    expect(winnerShot(state({ phase: 'build' }), 1000, [island], art)).toBeNull();
  });
});

describe('moving between shots', () => {
  it('zooms in proportion, so halfway between 1 and 4 is 2', () => {
    const a = { zoom: 1, focusX: 0, focusY: 0 };
    const b = { zoom: 4, focusX: 10, focusY: 0 };
    expect(between(a, b, 0.5)).toEqual({ zoom: 2, focusX: 5, focusY: 0 });
  });
});
