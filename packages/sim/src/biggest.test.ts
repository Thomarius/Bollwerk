import { defaultRuleset } from '@bollwerk/config';
import { describe, expect, it } from 'vitest';

import { applyEnclosure } from './enclosure.js';
import { fire, resolveImpacts } from './shots.js';
import { circleOffsets, isLoaded } from './specials.js';
import { stateFromAscii, withSpecials } from './testing.js';
import { Structure, type MatchState, type Shot } from './types.js';

/**
 * Player 0's Allerdickste Bertha (`G` cost 3, `g` cost 2) and a cannon, its own wall along
 * the channel; player 1's island across it, an 11 by 11 block of wall, so a crater clears
 * whole circles of it.
 */
function board(glyph: 'g' | 'G'): MatchState {
  const rows: string[] = ['.'.repeat(26)];
  for (let y = 1; y <= 11; y++) {
    let row = '.';
    for (let x = 1; x <= 7; x++) {
      if (x === 7) row += '#';
      else if ((x === 2 || x === 3) && (y === 2 || y === 3)) row += glyph;
      else if ((x === 4 || x === 5) && (y === 8 || y === 9)) row += '*';
      else row += ',';
    }
    row += '.';
    for (let x = 9; x <= 24; x++) row += x >= 11 && x <= 21 ? '#' : ',';
    rows.push(row + '.');
  }
  rows.push('.'.repeat(26));
  const islands = rows.map((row, y) =>
    [...row].map((_, x) => (x >= 9 && x <= 24 && y >= 1 && y <= 11 ? '2' : '.')).join(''),
  );
  const state = stateFromAscii(rows.join('\n'), withSpecials(defaultRuleset), islands.join('\n'));
  state.phase = 'combat';
  state.phaseEndTick = 100_000;
  applyEnclosure(state);
  for (const cannon of state.cannons) cannon.active = true;
  return state;
}

function land(state: MatchState, shot: Shot): void {
  state.tick = shot.impactTick;
  resolveImpacts(state);
}

function shotAt(state: MatchState, x: number, y: number): Shot {
  const result = fire(state, 0, x, y);
  if (!('shot' in result)) throw new Error(result.rejection);
  return result.shot;
}

const at = (state: MatchState, x: number, y: number): number =>
  state.structure[y * state.width + x] as number;

describe('the Allerdickste Bertha', () => {
  it('clears circles: 29 tiles at radius 3, 49 at 4, 69 at 4.5, 97 at 5.5', () => {
    expect(circleOffsets(3)).toHaveLength(29);
    expect(circleOffsets(4)).toHaveLength(49);
    expect(circleOffsets(4.5)).toHaveLength(69);
    expect(circleOffsets(5.5)).toHaveLength(97);
    for (const [dx, dy] of circleOffsets(3)) expect(dx * dx + dy * dy).toBeLessThanOrEqual(9);
  });

  it('clears every wall within its radius of the tile aimed at, and none beyond', () => {
    for (const glyph of ['g', 'G'] as const) {
      const state = board(glyph);
      const radius = state.ruleset.specials.biggest![glyph === 'g' ? 2 : 3]!.craterRadius;
      let cleared = 0;
      land(state, shotAt(state, 16, 6));
      for (let y = 1; y <= 11; y++) {
        for (let x = 11; x <= 21; x++) {
          const inside = (x - 16) ** 2 + (y - 6) ** 2 <= radius * radius;
          if (inside) cleared++;
          expect(at(state, x, y)).toBe(inside ? Structure.Empty : Structure.Wall);
        }
      }
      expect(cleared).toBeGreaterThan(0);
      expect(state.players[0]?.wallsDestroyed).toBe(cleared);
    }
  });

  it('spares its owner’s own wall, though its crater reaches across the channel', () => {
    const state = board('G');
    land(state, shotAt(state, 10, 6));
    expect(at(state, 7, 6)).toBe(Structure.Wall);
    expect(at(state, 11, 6)).toBe(Structure.Empty);
  });

  it('flies ten seconds, near or far, and fires first while it is ready', () => {
    const state = board('g');
    const ticks = Math.ceil((10_000 * state.ruleset.tickRateHz) / 1000);
    const near = shotAt(state, 10, 2);
    expect(near.kind).toBe('biggest');
    expect(near.impactTick - near.launchTick).toBe(ticks);
    land(state, near);
    const far = shotAt(state, 21, 10);
    expect(far.kind).toBe('biggest');
    expect(far.impactTick - far.launchTick).toBe(ticks);
  });

  it('fires once, then the cannons until its shell is down — its flight its reload', () => {
    const state = board('g');
    const big = shotAt(state, 16, 6);
    const tower = state.cannons.find((c) => c.kind === 'biggest');
    expect(tower !== undefined && isLoaded(tower)).toBe(false);
    expect(shotAt(state, 12, 2).kind).toBe('cannon');
    land(state, big);
    expect(tower !== undefined && isLoaded(tower)).toBe(true);
  });
});
