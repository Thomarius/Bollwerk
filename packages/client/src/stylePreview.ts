import { artForStyle, defaultArtConfig, type ArtStyle } from '@rampart/config';
import { applyEnclosure, computeEnclosure, stateFromAscii, type MatchState } from '@rampart/sim';

import { createTheme, Scene } from './render/scene.js';

/**
 * A small picture of each style beside the menu's look choices (PLAN 11.16 S1), drawn by
 * the style's own theme through a real `Scene`, so it is the look itself and not a
 * likeness. One fixed island — a sealed ring with guns and the crowned main castle, a
 * second castle outside it, sea round it all — rendered once per style on a canvas of its
 * own, kept as an image, and the renderer thrown away: the menu stays quick, and no
 * WebGL context outlives its picture.
 */
export const PREVIEW_BOARD = `
  ..............
  ..,,,,,,,,,,..
  .,,########,,.
  .,,#,,,,,,#,,.
  .,,#**@@**#,,.
  .,,#**@@**#,,.
  .,,#,,,,,,#@@.
  .,,########@@.
  ..,,,,,,,,,,..
  ..............
`;

/** A seed whose weather is clear and whose light is noon's, so every style shows plainly. */
const PREVIEW_SEED = 5;
const PREVIEW_ROUND = 5;

export function previewState(): MatchState {
  const state = stateFromAscii(PREVIEW_BOARD);
  state.seed = PREVIEW_SEED;
  state.round = PREVIEW_ROUND;
  state.phase = 'build';
  const player = state.players[0];
  if (player !== undefined) player.startingCastleId = 0;
  applyEnclosure(state);
  return state;
}

/**
 * The picture's size: sixteen pixels a tile, the pixel style's own, so its sprites are not
 * resampled; the menu shows it at half that, which keeps it crisp on a dense screen.
 */
export const PREVIEW_SIZE = { width: 224, height: 160 } as const;

const cache = new Map<ArtStyle, Promise<string>>();
/** One at a time: each takes a WebGL context, which browsers ration. */
let queue: Promise<unknown> = Promise.resolve();

/** The style's picture as a data URL, rendered the first time it is asked for. */
export function stylePreview(style: ArtStyle): Promise<string> {
  let image = cache.get(style);
  if (image === undefined) {
    image = queue.then(() => render(style));
    queue = image.catch(() => undefined);
    cache.set(style, image);
  }
  return image;
}

async function render(style: ArtStyle): Promise<string> {
  const canvas = document.createElement('canvas');
  const scene = new Scene();
  const art = artForStyle(defaultArtConfig, style);
  const look = { theme: createTheme(style, PREVIEW_SEED), art };
  try {
    await scene.init(canvas, { build: look, combat: look }, defaultArtConfig);
    const state = previewState();
    const enclosure = computeEnclosure(state);
    scene.resize(state, PREVIEW_SIZE.width, PREVIEW_SIZE.height);
    scene.showLooks({ from: 'build', to: 'build', lineY: null });
    scene.drawTerrain(state);
    scene.drawTerritory(state, { build: enclosure.territory, combat: enclosure.territory });
    scene.drawStructures(state);
    // A few long frames, so the flags are hoisted and anything that settles has settled.
    for (let k = 0; k < 12; k++) {
      scene.drawEffects(state, 0, 250, {
        build: enclosure.castleEnclosed,
        combat: enclosure.castleEnclosed,
      });
    }
    scene.render();
    return scene.app.canvas.toDataURL('image/png');
  } finally {
    scene.app.destroy(true);
  }
}
