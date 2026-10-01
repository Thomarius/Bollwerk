import { defaultArtConfig, defaultTerrainConfig } from '@rampart/config';
import { describe, expect, it } from 'vitest';

import { matchPalette } from './colours.js';
import { LocalMatch } from './localMatch.js';
import { castleBreath, islandCentres, surfAt, tablePreview } from './preview.js';
import { matchShapes } from './shapes.js';

describe('the table preview', () => {
  it('shows the map the match will be played on', () => {
    const preview = tablePreview(1234, 3, [0, 1, 2], defaultArtConfig, defaultTerrainConfig);
    const match = new LocalMatch({ seed: 1234, seats: [null, 5, 5] });
    expect(preview.terrain.width).toBe(match.state.width);
    expect(preview.terrain.height).toBe(match.state.height);
    expect(Array.from(preview.terrain.terrain)).toEqual(Array.from(match.state.terrain));
  });

  it('deals each seat the island and colour the match will give it', () => {
    for (const seed of [1, 2, 3, 99, 4000000000]) {
      const teams = [0, 1, 1, 0];
      const preview = tablePreview(seed, 4, teams, defaultArtConfig, defaultTerrainConfig);
      // The host holds seat 0; the match says which player they became.
      const match = new LocalMatch({ seed, seats: [null, 5, 5, 5], teams });
      expect(preview.playerOfSeat[0]).toBe(match.humanPlayer);
      const palette = matchPalette(defaultArtConfig, match.state);
      preview.playerOfSeat.forEach((player, seat) => {
        expect(preview.colourOfSeat[seat]).toEqual(palette[player]);
      });
      // Each seat's team in the match is the very team the lobby showed it in, so the
      // letters agree — they did not while ids went by first appearance among players.
      teams.forEach((label, seat) => {
        expect(match.state.players[preview.playerOfSeat[seat] as number]?.team).toBe(label);
      });
    }
  });

  it('deals each seat the shape the match will give it, a team one between them', () => {
    for (const [teams, seed] of [
      [[0, 1, 1, 0], 7],
      [[0, 1, 2, 3, 4], 8],
    ] as const) {
      const n = teams.length;
      const preview = tablePreview(seed, n, teams, defaultArtConfig, defaultTerrainConfig);
      const match = new LocalMatch({ seed, seats: [null, ...Array<number>(n - 1).fill(5)], teams });
      const shapes = matchShapes(defaultArtConfig, match.state);
      preview.playerOfSeat.forEach((player, seat) => {
        expect(preview.shapeOfSeat[seat]).toBe(shapes[player]);
      });
      // Seats on one team in the lobby carry one shape, and no two teams share one.
      const byTeam = new Map<number, Set<string>>();
      teams.forEach((team, seat) =>
        byTeam.set(team, (byTeam.get(team) ?? new Set()).add(preview.shapeOfSeat[seat]!)),
      );
      expect([...byTeam.values()].every((set) => set.size === 1)).toBe(true);
      expect(new Set(preview.shapeOfSeat).size).toBe(byTeam.size);
    }
  });

  it('changes when the seed does', () => {
    const a = tablePreview(1, 3, [0, 1, 2], defaultArtConfig, defaultTerrainConfig);
    const b = tablePreview(2, 3, [0, 1, 2], defaultArtConfig, defaultTerrainConfig);
    expect(Array.from(a.terrain.terrain)).not.toEqual(Array.from(b.terrain.terrain));
  });

  it('finds a centre for every island, to label it with its seat', () => {
    const preview = tablePreview(5, 4, [0, 1, 2, 3], defaultArtConfig, defaultTerrainConfig);
    const centres = islandCentres(preview.terrain);
    expect([...centres.keys()].sort()).toEqual([1, 2, 3, 4]);
    for (const { x, y } of centres.values()) {
      expect(x).toBeGreaterThan(0);
      expect(y).toBeGreaterThan(0);
    }
  });
});

describe('the lobby map breathing', () => {
  it('breathes the surf between none and full, back where it began each period', () => {
    for (const t of [0, 400, 1600, 2900]) {
      const v = surfAt(4, 7, t, 3200);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(surfAt(4, 7, t + 3200, 3200)).toBeCloseTo(v);
    }
  });

  it('keeps neighbouring coast tiles out of step, so the coast shimmers rather than blinks', () => {
    const along = [0, 1, 2, 3, 4, 5].map((x) => surfAt(x, 7, 0, 3200));
    expect(new Set(along.map((v) => v.toFixed(3))).size).toBeGreaterThan(3);
  });

  it('breathes the castles together, still at the start of a period', () => {
    expect(castleBreath(0, 2200)).toBe(0);
    expect(castleBreath(1100, 2200)).toBeCloseTo(1);
    expect(castleBreath(2200, 2200)).toBeCloseTo(0);
  });
});
