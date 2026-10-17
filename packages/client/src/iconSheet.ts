import { ArtStyleSchema, artForStyle, defaultArtConfig, type ArtStyle } from '@bollwerk/config';
import { computeEnclosure } from '@bollwerk/sim';

import { createTheme, Scene } from './render/scene.js';
import { PREVIEW_SIZE, previewState } from './stylePreview.js';
import { cannonImg, cannonSvg } from './towerIcons.js';
import { playerCssColour } from './colours.js';

/**
 * Every style's cannon icon on one page, for judging them side by side (`?icons=sheet`, a
 * developer's page, `docs/CANNON_ICONS.md` CI4): each style's gun for every player at the
 * row's size and larger, over its own board and over the page's dark, the generic icon
 * beside it. Each style through a real `Scene` of its own, as the menu's pictures are.
 */
export async function showIconSheet(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const sizes = (params.get('sizes') ?? '21,28,42').split(',').map(Number);
  const players = Number(params.get('players') ?? 8);
  const only = params.get('style');
  const styles = ArtStyleSchema.options.filter((s) => only === null || s === only);

  document.body.innerHTML = '';
  const page = document.createElement('div');
  page.className = 'icon-sheet';
  page.style.cssText =
    'padding:12px;font:12px sans-serif;color:#e8e4d8;background:#1a1a24;min-height:100%';
  document.body.append(page);

  for (const style of styles) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;margin:4px 0';
    row.dataset['style'] = style;
    const label = document.createElement('div');
    label.textContent = style;
    label.style.cssText = 'width:84px';
    row.append(label);
    const { board, icons } = await render(style, sizes, players);
    for (const [k, size] of sizes.entries()) {
      for (const backdrop of ['board', 'dark'] as const) {
        const cell = document.createElement('div');
        cell.style.cssText =
          `display:flex;gap:2px;padding:3px;border-radius:4px;` +
          (backdrop === 'board' ? `background:url(${board}) center/cover` : 'background:#0a0a12');
        for (let p = 0; p < players; p++) {
          const span = document.createElement('span');
          span.innerHTML = cannonImg(icons[k]?.[p] ?? '');
          const img = span.firstElementChild as HTMLElement;
          img.style.cssText = `width:${size}px;height:${size}px;display:block`;
          cell.append(img);
        }
        row.append(cell);
      }
    }
    // The generic icon at the row's size, for comparison.
    const generic = document.createElement('div');
    generic.style.cssText = 'display:flex;gap:2px;padding:3px;background:#0a0a12';
    for (let p = 0; p < Math.min(players, 4); p++) {
      const span = document.createElement('span');
      span.innerHTML = cannonSvg(playerCssColour(p));
      const svg = span.firstElementChild as SVGElement;
      svg.style.cssText = `width:${sizes[0] ?? 21}px;height:${sizes[0] ?? 21}px;display:block`;
      generic.append(svg);
    }
    row.append(generic);
    page.append(row);
  }
  page.dataset['done'] = '1';
}

/**
 * Each style's preview board, with its guns, in a build and a combat phase and at two tile
 * sizes (`?icons=boards`): a refactor of a style's gun for its icon must leave these pixel for
 * pixel as they were. Rendered with fixed frames, so two runs of the same code agree.
 */
export async function showBoardSheet(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const only = params.get('style');
  const styles = ArtStyleSchema.options.filter((s) => only === null || s === only);
  document.body.innerHTML = '';
  document.body.style.cssText = 'margin:0;background:#000';
  const page = document.createElement('div');
  page.style.cssText = 'display:flex;flex-wrap:wrap;gap:0;width:1792px';
  document.body.append(page);
  for (const style of styles) {
    for (const phase of ['build', 'combat'] as const) {
      for (const scale of [2, 4]) {
        const img = document.createElement('img');
        img.src = await renderBoard(style, phase, scale);
        img.style.cssText = `display:block;width:${(PREVIEW_SIZE.width * scale) / 2}px`;
        page.append(img);
      }
    }
  }
  page.dataset['done'] = '1';
}

async function renderBoard(
  style: ArtStyle,
  phase: 'build' | 'combat',
  scale: number,
): Promise<string> {
  const canvas = document.createElement('canvas');
  const scene = new Scene();
  const art = artForStyle(defaultArtConfig, style);
  const look = { theme: createTheme(style, 5), art };
  try {
    await scene.init(canvas, { build: look, combat: look }, defaultArtConfig);
    const state = previewState();
    state.phase = phase;
    const enclosure = computeEnclosure(state);
    scene.resize(state, (PREVIEW_SIZE.width * scale) / 2, (PREVIEW_SIZE.height * scale) / 2);
    scene.showLooks({ from: 'build', to: 'build', lineY: null });
    scene.drawTerrain(state);
    scene.drawTerritory(state, { build: enclosure.territory, combat: enclosure.territory });
    scene.drawStructures(state);
    for (let k = 0; k < 4; k++) {
      scene.drawEffects(state, 0, 250, {
        build: enclosure.castleEnclosed,
        combat: enclosure.castleEnclosed,
      });
    }
    scene.render();
    return scene.app.canvas.toDataURL('image/png');
  } finally {
    scene.app.destroy({ removeView: true });
  }
}

async function render(
  style: ArtStyle,
  sizes: readonly number[],
  players: number,
): Promise<{ board: string; icons: string[][] }> {
  const canvas = document.createElement('canvas');
  const scene = new Scene();
  const art = artForStyle(defaultArtConfig, style);
  const look = { theme: createTheme(style, 5), art };
  try {
    await scene.init(canvas, { build: look, combat: look }, defaultArtConfig);
    const state = previewState();
    const enclosure = computeEnclosure(state);
    scene.resize(state, PREVIEW_SIZE.width, PREVIEW_SIZE.height);
    scene.showLooks({ from: 'build', to: 'build', lineY: null });
    scene.drawTerrain(state);
    scene.drawTerritory(state, { build: enclosure.territory, combat: enclosure.territory });
    scene.drawStructures(state);
    scene.drawEffects(state, 0, 250, {
      build: enclosure.castleEnclosed,
      combat: enclosure.castleEnclosed,
    });
    scene.render();
    const board = scene.app.canvas.toDataURL('image/png');
    const icons = sizes.map((size) =>
      Array.from({ length: players }, (_, p) => scene.cannonIcon(p, size)),
    );
    return { board, icons };
  } finally {
    scene.app.destroy({ removeView: true });
  }
}
