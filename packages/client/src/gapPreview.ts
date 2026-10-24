import { ArtStyleSchema, artForStyle, defaultArtConfig, type ArtStyle } from '@bollwerk/config';
import { applyEnclosure, computeEnclosure, stateFromAscii, type MatchState } from '@bollwerk/sim';

import { buildHints } from './hints.js';
import { createTheme, Scene, type Ghost } from './render/scene.js';

/**
 * The corner gaps' ping in every style (`?gaps=preview`, a developer's page, ARCHIVE 14r):
 * above, one style live, chosen by its button; below, every style, a still frame each. Each
 * through a real `Scene` and the build hints as a match makes them, as the menu's pictures are.
 *
 * Three castles of one player in the build phase, none sealed, so all three are outlined as
 * in play: a ring missing its corner block, a thick wall holed in its two rows one column
 * apart (both only corner gaps, so both pinged), and a ring with a straight gap, which is not.
 */
export const GAP_BOARD = `
  .........................................
  .,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,.
  .,########,,,,#####,######,,,,########,,.
  .,#,,,,,,#,,,,######,#####,,,,#,,,,,,#,,.
  .,#,**,,,#,,,,#,,,,,,,,,,#,,,,#,@@,,,#,,.
  .,#,**@@,#,,,,#,,**,@@,,,#,,,,#,@@,,,,,,.
  .,#,,,@@,#,,,,#,,**,@@,,,#,,,,#,,,,,,#,,.
  .,#######,,,,,############,,,,########,,.
  .,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,.
  .........................................
`;

const SEED = 5;

export function gapState(): MatchState {
  const state = stateFromAscii(GAP_BOARD);
  state.seed = SEED;
  state.round = 3;
  state.phase = 'build';
  const player = state.players[0];
  if (player !== undefined) player.startingCastleId = 0;
  applyEnclosure(state);
  return state;
}

export async function showGapPreview(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const tile = Number(params.get('tile') ?? 20);
  const stillTile = Number(params.get('stillTile') ?? 12);
  const first = ArtStyleSchema.safeParse(params.get('style')).data ?? 'flat';

  document.body.innerHTML = '';
  document.body.style.cssText = 'margin:0;background:#1a1a24;overflow:auto';
  const page = document.createElement('div');
  page.style.cssText = 'padding:12px;font:13px sans-serif;color:#e8e4d8';
  document.body.append(page);

  const heading = document.createElement('div');
  heading.innerHTML =
    '<b>Corner gaps</b> — the left and middle castles have only corner gaps left and are ' +
    'pinged; the right one has a straight gap, and is not.';
  page.append(heading);

  const buttons = document.createElement('div');
  buttons.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin:8px 0';
  page.append(buttons);
  const live = document.createElement('div');
  page.append(live);

  let running: { stop: () => void } | null = null;
  const choose = async (style: ArtStyle): Promise<void> => {
    running?.stop();
    for (const b of buttons.children) {
      (b as HTMLElement).style.background =
        (b as HTMLElement).dataset['style'] === style ? '#556' : '#2a2a38';
    }
    running = await runLive(live, style, tile);
  };
  for (const style of ArtStyleSchema.options) {
    const b = document.createElement('button');
    b.textContent = style;
    b.dataset['style'] = style;
    b.style.cssText = 'color:#e8e4d8;border:1px solid #556;padding:3px 8px;cursor:pointer';
    b.onclick = () => void choose(style);
    buttons.append(b);
  }
  await choose(first);

  const sheet = document.createElement('div');
  sheet.style.cssText =
    `margin-top:18px;display:grid;gap:4px 6px;align-items:center;` +
    `grid-template-columns:repeat(3,84px ${41 * stillTile}px)`;
  page.append(sheet);
  for (const style of ArtStyleSchema.options) {
    const label = document.createElement('div');
    label.textContent = style;
    const img = document.createElement('img');
    img.src = await renderStill(style, stillTile);
    img.style.cssText = `display:block;width:${41 * stillTile}px`;
    sheet.append(label, img);
  }
  page.dataset['done'] = '1';
}

interface Board {
  scene: Scene;
  state: MatchState;
  ghost: Ghost;
  sealed: readonly boolean[];
}

async function board(style: ArtStyle, tile: number): Promise<Board> {
  const canvas = document.createElement('canvas');
  const scene = new Scene();
  const look = { theme: createTheme(style, SEED), art: artForStyle(defaultArtConfig, style) };
  await scene.init(canvas, { build: look, combat: look }, defaultArtConfig);
  const state = gapState();
  const enclosure = computeEnclosure(state);
  scene.resize(state, state.width * tile, state.height * tile);
  scene.showLooks({ from: 'build', to: 'build', lineY: null });
  scene.drawTerrain(state);
  scene.drawTerritory(state, { build: enclosure.territory, combat: enclosure.territory });
  scene.drawStructures(state);
  const ghost: Ghost = {
    tile: null,
    cells: [],
    valid: false,
    footprint: null,
    selectable: [],
    aiming: false,
    ...buildHints(state, 0, enclosure),
  };
  return { scene, state, ghost, sealed: enclosure.castleEnclosed };
}

function frame(b: Board, deltaMs: number): void {
  b.scene.drawEffects(b.state, 0, deltaMs, { build: b.sealed, combat: b.sealed });
  b.scene.drawOverlay(b.state, b.ghost, 0);
  b.scene.render();
}

async function runLive(
  host: HTMLElement,
  style: ArtStyle,
  tile: number,
): Promise<{ stop: () => void }> {
  host.innerHTML = '';
  const b = await board(style, tile);
  host.append(b.scene.app.canvas);
  let stopped = false;
  let last = performance.now();
  const loop = (now: number): void => {
    if (stopped) return;
    frame(b, now - last);
    last = now;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return {
    stop: () => {
      stopped = true;
      b.scene.app.destroy({ removeView: true });
    },
  };
}

async function renderStill(style: ArtStyle, tile: number): Promise<string> {
  const b = await board(style, tile);
  try {
    for (let k = 0; k < 6; k++) frame(b, 250);
    return b.scene.app.canvas.toDataURL('image/png');
  } finally {
    b.scene.app.destroy({ removeView: true });
  }
}
