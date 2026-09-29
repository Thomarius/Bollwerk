import { applyEnclosure, stateFromAscii } from '@rampart/sim';
import { describe, expect, it } from 'vitest';

import { boardPicture, type FilmColours } from './filmstrip.js';

const colours: FilmColours = {
  water: [0, 0, 100],
  land: [0, 100, 0],
  rubble: [90, 90, 90],
  players: [
    { base: [200, 0, 0], light: [250, 100, 100], dark: [100, 0, 0] },
    { base: [0, 0, 200], light: [100, 100, 250], dark: [0, 0, 100] },
  ],
};

/** The colour of one tile of a picture. */
function at(picture: Uint8ClampedArray, width: number, x: number, y: number): number[] {
  const i = (y * width + x) * 4;
  return [...picture.slice(i, i + 3)];
}

describe('the filmstrip', () => {
  const state = stateFromAscii(`
    .........
    .######..
    .#,@@,#,.
    .#,@@,#,.
    .######..
    .........
  `);
  applyEnclosure(state);
  const picture = boardPicture(state, colours);

  it('draws a pixel a tile, all opaque', () => {
    expect(picture.length).toBe(state.width * state.height * 4);
    for (let i = 3; i < picture.length; i += 4) expect(picture[i]).toBe(255);
  });

  it('tells sea, land, wall, sealed ground and castle apart, in the owner’s colours', () => {
    expect(at(picture, state.width, 0, 0)).toEqual([0, 0, 100]); // sea
    expect(at(picture, state.width, 7, 2)).toEqual([0, 100, 0]); // open land
    expect(at(picture, state.width, 1, 1)).toEqual([200, 0, 0]); // wall
    expect(at(picture, state.width, 3, 2)).toEqual([100, 0, 0]); // castle
    // Sealed ground: the land washed toward the owner's light shade.
    expect(at(picture, state.width, 2, 2)).toEqual([113, 100, 45]);
  });

  it('draws an eliminated player’s wall as nobody’s rubble', () => {
    const ruin = stateFromAscii(`
      ....
      .##.
      ....
    `);
    ruin.owner.fill(0);
    expect(at(boardPicture(ruin, colours), ruin.width, 1, 1)).toEqual([90, 90, 90]);
  });
});
