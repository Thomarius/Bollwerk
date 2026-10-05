import { Structure, Terrain } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { liveShot } from './galleryLive.js';
import { previewState } from './stylePreview.js';

describe('the gallery picture shots', () => {
  const state = previewState();
  const at = (x: number, y: number): number => y * state.width + x;

  it('fires from the first gun, at the wall and then into the sea, by turns', () => {
    const first = liveShot(state, 0, 100);
    const second = liveShot(state, 1, 200);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(state.structure[at(first!.toX, first!.toY)]).toBe(Structure.Wall);
    expect(state.terrain[at(second!.toX, second!.toY)]).toBe(Terrain.Water);
    expect(liveShot(state, 2, 300)!.toX).toBe(first!.toX);
    for (const shot of [first!, second!]) {
      expect(shot.cannonId).toBe(state.cannons[0]!.id);
      expect(shot.impactTick).toBeGreaterThan(shot.launchTick);
    }
  });

  it('aims at the wall block farthest from the gun, for a lob worth watching', () => {
    const shot = liveShot(state, 0, 0)!;
    const gun = state.cannons[0]!;
    const reach = (x: number, y: number): number => (x - gun.x) ** 2 + (y - gun.y) ** 2;
    for (let i = 0; i < state.structure.length; i++) {
      if (state.structure[i] !== Structure.Wall) continue;
      const x = i % state.width;
      expect(reach(x, (i - x) / state.width)).toBeLessThanOrEqual(reach(shot.toX, shot.toY));
    }
  });
});
