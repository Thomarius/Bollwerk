import { artForStyle, defaultArtConfig, type ArtStyle } from '@bollwerk/config';
import { applyEnclosure, computeEnclosure, stateFromAscii, type MatchState } from '@bollwerk/sim';

import { roseSpot } from './render/corner.js';
import { createTheme, Scene } from './render/scene.js';
import { timerSpot } from './timerSpot.js';

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

function render(style: ArtStyle): Promise<string> {
  return draw(style, previewState(), PREVIEW_SIZE.width, PREVIEW_SIZE.height, (canvas) =>
    canvas.toDataURL('image/png'),
  );
}

/**
 * A board in a style through a real `Scene`, its picture taken by `take` from the canvas once
 * drawn, and the renderer thrown away.
 */
async function draw(
  style: ArtStyle,
  state: MatchState,
  width: number,
  height: number,
  take: (canvas: HTMLCanvasElement) => string,
): Promise<string> {
  const canvas = document.createElement('canvas');
  const scene = new Scene();
  const art = artForStyle(defaultArtConfig, style);
  const look = { theme: createTheme(style, PREVIEW_SEED), art };
  try {
    await scene.init(canvas, { build: look, combat: look }, defaultArtConfig);
    const enclosure = computeEnclosure(state);
    scene.resize(state, width, height);
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
    return take(scene.app.canvas);
  } finally {
    // Not `destroy(true)`, which also releases what every renderer on the page shares: a
    // picture made for the gallery over a running match (ARCHIVE 12b) took the match's
    // pooled batches with it, and its next frame failed.
    scene.app.destroy({ removeView: true });
  }
}

/**
 * The open sea a style's corner piece stands in (PLAN §11 item 4, MS4): a small island in the
 * far corner, for the themes to have one, and water everywhere else, wide enough for the
 * largest piece in the bottom-right corner clear of the big timer's place.
 */
export const CORNER_BOARD = `
  ..................
  .,,,,.............
  .,@@,.............
  .,@@,.............
  .,,,,.............
  ..................
  ..................
  ..................
  ..................
  ..................
  ..................
  ..................
`;

export function cornerState(): MatchState {
  const state = stateFromAscii(CORNER_BOARD);
  state.seed = PREVIEW_SEED;
  state.round = PREVIEW_ROUND;
  state.phase = 'build';
  const player = state.players[0];
  if (player !== undefined) player.startingCastleId = 0;
  applyEnclosure(state);
  return state;
}

/** Pixels a tile for the corner's picture: larger than the looks', as it is shown larger. */
const CORNER_TILE = 24;

const corners = new Map<ArtStyle, Promise<string | null>>();

/**
 * A style's corner piece as a data URL — the buoy, the compass rose, the Ferris wheel… —
 * rendered once by the style's own theme on open sea and cut out at the place the theme
 * puts it (`roseSpot`, clear of the timer, as in a match), in the queue the looks' pictures
 * share. Null where there is no room for one.
 */
export function cornerPicture(style: ArtStyle): Promise<string | null> {
  let image = corners.get(style);
  if (image === undefined) {
    image = queue.then(() => renderCorner(style));
    queue = image.catch(() => undefined);
    corners.set(style, image);
  }
  return image;
}

async function renderCorner(style: ArtStyle): Promise<string | null> {
  const state = cornerState();
  // The whole board fills the canvas, so there is no sea beyond it: none to the right or below.
  const spot = roseSpot(state, 0, 0, timerSpot(state));
  if (spot === null) return null;
  const width = state.width * CORNER_TILE;
  const height = state.height * CORNER_TILE;
  return draw(style, state, width, height, (canvas) => {
    // The piece's square and three quarters of a tile round it, for what reaches past it.
    const ratio = canvas.width / width;
    const half = (spot.size / 2 + 0.75) * CORNER_TILE * ratio;
    const side = Math.round(half * 2);
    const out = document.createElement('canvas');
    out.width = side;
    out.height = side;
    out
      .getContext('2d')
      ?.drawImage(
        canvas,
        Math.round(spot.x * CORNER_TILE * ratio - half),
        Math.round(spot.y * CORNER_TILE * ratio - half),
        side,
        side,
        0,
        0,
        side,
        side,
      );
    return out.toDataURL('image/png');
  });
}
