import { PlayerShapeSchema, defaultArtConfig } from '@rampart/config';
import { describe, expect, it } from 'vitest';

import { SHAPE_PATHS, matchShapes, shapeSvg } from './shapes.js';

describe('a shape per player', () => {
  it('gives every free-for-all player a shape of their own', () => {
    const players = Array.from({ length: 8 }, (_, id) => ({ id, team: 7 - id }));
    const shapes = matchShapes(defaultArtConfig, { players });
    expect(new Set(shapes).size).toBe(8);
    // By player, as the colours go, whatever the teams of one are numbered.
    expect(shapes[0]).toBe(defaultArtConfig.playerShapes[0]);
  });

  it('gives teammates one shape and each team its own', () => {
    const teams = [1, 0, 0, 1, 2, 3, 3, 2];
    const shapes = matchShapes(defaultArtConfig, {
      players: teams.map((team, id) => ({ id, team })),
    });
    expect(shapes[1]).toBe(shapes[2]);
    expect(shapes[0]).toBe(shapes[3]);
    expect(new Set(shapes).size).toBe(4);
    // Team A, the lobby's first column, has the first shape.
    expect(shapes[1]).toBe(defaultArtConfig.playerShapes[0]);
  });

  it('has a path for every shape the config may name', () => {
    for (const shape of PlayerShapeSchema.options) {
      expect(SHAPE_PATHS[shape]).toMatch(/^M[\d. ]/);
      expect(shapeSvg(shape, '#c8283c')).toContain(`d="${SHAPE_PATHS[shape]}" fill="#c8283c"`);
    }
  });
});
