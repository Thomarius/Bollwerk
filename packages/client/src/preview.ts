import type { ArtConfig, PlayerPalette, PlayerShape, TerrainConfig } from '@bollwerk/config';
import {
  Terrain,
  denseTeams,
  generateTerrain,
  seatOrder,
  tableTeamSize,
  type GeneratedTerrain,
} from '@bollwerk/sim';

import { matchPalette } from './colours.js';
import { drawShape, matchShapes } from './shapes.js';

/**
 * The table's map, before the match: the islands the seed will generate, which island
 * each seat will be dealt, and the colour it will play in.
 *
 * Possible because the seed is fixed when the table is set rather than when the match
 * starts, and because everything else follows from it — the terrain is generated from
 * the seed and the teams' size, and seats are dealt onto islands by `seatOrder`, which
 * the server and a local match both use. Seats are in lobby order: the host first, then
 * people in the order they joined, then the bots — the order a match is started in.
 */
export interface TablePreview {
  terrain: GeneratedTerrain;
  /** The player each seat becomes, so the island it gets is this + 1. */
  playerOfSeat: number[];
  /** Colours by seat. */
  colourOfSeat: PlayerPalette[];
  /** Shapes by seat, dealt by the same rule as the colours. */
  shapeOfSeat: PlayerShape[];
}

/** Terrain is the slow part and depends on three numbers, so the last few are kept. */
const terrains = new Map<string, GeneratedTerrain>();

function terrainFor(
  config: TerrainConfig,
  playerCount: number,
  seed: number,
  teamSize: number,
): GeneratedTerrain {
  const key = `${seed}:${playerCount}:${teamSize}`;
  let terrain = terrains.get(key);
  if (terrain === undefined) {
    terrain = generateTerrain(config, playerCount, seed, teamSize);
    if (terrains.size > 8) terrains.clear();
    terrains.set(key, terrain);
  }
  return terrain;
}

export function tablePreview(
  seed: number,
  playerCount: number,
  teamsBySeat: readonly number[],
  art: ArtConfig,
  terrainConfig: TerrainConfig,
): TablePreview {
  const teams = Array.from({ length: playerCount }, (_, seat) => teamsBySeat[seat] ?? seat);
  const terrain = terrainFor(terrainConfig, playerCount, seed, tableTeamSize(teams));
  const playerOfSeat = seatOrder(seed, teams, terrainConfig);
  // The match's own palette rule, over the players the seats will become, with team
  // ids made exactly as `createMatch` makes them — the colour family follows the id.
  const labels = new Array<number | undefined>(playerCount);
  playerOfSeat.forEach((player, seat) => {
    labels[player] = teamsBySeat[seat];
  });
  const players = denseTeams(labels).map((team, id) => ({ id, team }));
  const byPlayer = matchPalette(art, { players });
  const colourOfSeat = playerOfSeat.map((player) => byPlayer[player] as PlayerPalette);
  const shapes = matchShapes(art, { players });
  const shapeOfSeat = playerOfSeat.map((player) => shapes[player] as PlayerShape);
  return { terrain, playerOfSeat, colourOfSeat, shapeOfSeat };
}

/** The middle of each island, by island id, for its label. */
export function islandCentres(terrain: GeneratedTerrain): Map<number, { x: number; y: number }> {
  const sums = new Map<number, { x: number; y: number; n: number }>();
  for (let i = 0; i < terrain.islandId.length; i++) {
    const island = terrain.islandId[i] as number;
    if (island === 0 || terrain.terrain[i] !== Terrain.Land) continue;
    const x = i % terrain.width;
    const entry = sums.get(island) ?? { x: 0, y: 0, n: 0 };
    entry.x += x;
    entry.y += (i - x) / terrain.width;
    entry.n++;
    sums.set(island, entry);
  }
  const centres = new Map<number, { x: number; y: number }>();
  for (const [island, sum] of sums) centres.set(island, { x: sum.x / sum.n, y: sum.y / sum.n });
  return centres;
}

/**
 * Paints the preview: sea, each island in its seat's colour with its castles, and the
 * seat's number over it — the same number the seat's card carries — with the viewer's
 * own island ringed. Pixel-exact at a whole-number scale, like the game's pixel style.
 *
 * `art` is the chosen build look's, so the table looks like the game it will be; the
 * numbers and the ring take `ink`, the shared UI's, since a look's own ink need not
 * read on its islands — Parchment's is near black.
 */
/**
 * The lobby map breathing (PLAN 11.11 W7), as pure functions of time so they are tested
 * rather than watched. Surf along a coast rises and falls, each tile a little out of step
 * with its neighbours so the coast shimmers rather than blinks; 0 to 1.
 */
export function surfAt(x: number, y: number, timeMs: number, periodMs: number): number {
  // A fixed offset per tile, from a small hash of its position.
  const offset = ((((x * 73856093) ^ (y * 19349663)) >>> 0) % 1000) / 1000;
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * (timeMs / periodMs + offset));
}

/** The castles' breath, all together: 0 to 1. */
export function castleBreath(timeMs: number, periodMs: number): number {
  return 0.5 - 0.5 * Math.cos((2 * Math.PI * timeMs) / periodMs);
}

/**
 * `timeMs` animates the surf and the castles (`surfAt`, `castleBreath`); left at 0 —
 * under reduced motion — the map is still.
 */
export function drawPreview(
  canvas: HTMLCanvasElement,
  preview: TablePreview,
  viewerSeat: number,
  art: ArtConfig,
  maxWidthPx: number,
  ink: ArtConfig = art,
  timeMs = 0,
): void {
  const { terrain } = preview;
  const scale = Math.max(2, Math.floor(maxWidthPx / terrain.width));
  // Resized only when it changes: setting a canvas's size clears it and costs a reflow,
  // which redrawn every frame would do sixty times a second.
  if (canvas.width !== terrain.width * scale) canvas.width = terrain.width * scale;
  if (canvas.height !== terrain.height * scale) canvas.height = terrain.height * scale;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  ctx.imageSmoothingEnabled = false;

  const seatOfIsland = new Map<number, number>();
  preview.playerOfSeat.forEach((player, seat) => seatOfIsland.set(player + 1, seat));

  // The sea and the land change only with the table, so they are painted once and copied;
  // the map is drawn every frame the lobby is open, and painting them was a rectangle a tile.
  const still = stillLayer(preview, seatOfIsland, art, scale);
  ctx.drawImage(still.canvas, 0, 0);

  // Surf on the sea tiles beside land, breathing.
  ctx.fillStyle = art.palette.waterFoam;
  for (const i of still.surf) {
    const x = i % terrain.width;
    const y = (i - x) / terrain.width;
    ctx.globalAlpha = 0.15 + 0.4 * surfAt(x, y, timeMs, art.menu.mapSurfMs);
    ctx.fillRect(x * scale, y * scale, scale, scale);
  }
  ctx.globalAlpha = 1;

  // Castles, breathing together: brightened toward white and back.
  const breath = castleBreath(timeMs, art.menu.mapCastleMs);
  for (const castle of terrain.castles) {
    const seat = seatOfIsland.get(castle.islandId);
    ctx.fillStyle = (seat === undefined ? undefined : preview.colourOfSeat[seat]?.light) ?? '#fff';
    ctx.fillRect(castle.x * scale, castle.y * scale, castle.w * scale, castle.h * scale);
    ctx.fillStyle = `rgb(255 255 255 / ${(0.35 * breath).toFixed(3)})`;
    ctx.fillRect(castle.x * scale, castle.y * scale, castle.w * scale, castle.h * scale);
  }

  const centres = still.centres;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const figure = Math.max(11, scale * 5);
  ctx.font = `700 ${figure}px ui-monospace, Menlo, Consolas, monospace`;
  for (const [island, centre] of centres) {
    const seat = seatOfIsland.get(island);
    if (seat === undefined) continue;
    const cx = (centre.x + 0.5) * scale;
    const cy = (centre.y + 0.5) * scale;
    ctx.fillStyle = 'rgb(10 10 18 / 60%)';
    ctx.fillText(String(seat + 1), cx + 1, cy + 1);
    ctx.fillStyle = ink.palette.uiInk;
    ctx.fillText(String(seat + 1), cx, cy);
    // The seat's shape under its number, in the light shade of its colour, as the seat
    // card carries it beside the number.
    const shape = preview.shapeOfSeat[seat];
    const colour = preview.colourOfSeat[seat];
    if (shape !== undefined && colour !== undefined) {
      const size = figure;
      drawShape(ctx, shape, cx, cy + figure * 1.05, size, colour.light, 'rgb(10 10 18 / 70%)');
    }
  }

  // The viewer's island, outlined, so "where am I" needs no looking up.
  const mine = preview.playerOfSeat[viewerSeat];
  if (mine === undefined) return;
  ctx.fillStyle = ink.palette.uiAccent;
  for (let i = 0; i < terrain.terrain.length; i++) {
    if (terrain.islandId[i] !== mine + 1 || terrain.terrain[i] !== Terrain.Land) continue;
    const x = i % terrain.width;
    const y = (i - x) / terrain.width;
    const edge = (nx: number, ny: number): boolean =>
      nx < 0 ||
      ny < 0 ||
      nx >= terrain.width ||
      ny >= terrain.height ||
      terrain.islandId[ny * terrain.width + nx] !== mine + 1 ||
      terrain.terrain[ny * terrain.width + nx] !== Terrain.Land;
    const line = Math.max(1, Math.floor(scale / 2));
    if (edge(x, y - 1)) ctx.fillRect(x * scale, y * scale, scale, line);
    if (edge(x, y + 1)) ctx.fillRect(x * scale, (y + 1) * scale - line, scale, line);
    if (edge(x - 1, y)) ctx.fillRect(x * scale, y * scale, line, scale);
    if (edge(x + 1, y)) ctx.fillRect((x + 1) * scale - line, y * scale, line, scale);
  }
}

/** What `drawPreview` paints once a table: the sea and the land, and where surf breaks. */
interface StillLayer {
  key: string;
  canvas: HTMLCanvasElement;
  /** Sea tiles beside land. */
  surf: number[];
  centres: ReturnType<typeof islandCentres>;
}

const stillLayers = new WeakMap<TablePreview['terrain'], StillLayer>();

function stillLayer(
  preview: TablePreview,
  seatOfIsland: ReadonlyMap<number, number>,
  art: ArtConfig,
  scale: number,
): StillLayer {
  const { terrain } = preview;
  const colours = [...seatOfIsland].map(([island, seat]) => {
    return `${island}:${preview.colourOfSeat[seat]?.dark ?? ''}`;
  });
  const key = `${scale}|${art.palette.waterMid}|${art.palette.grassMid}|${colours.join()}`;
  const kept = stillLayers.get(terrain);
  if (kept?.key === key) return kept;

  const canvas = kept?.canvas ?? document.createElement('canvas');
  canvas.width = terrain.width * scale;
  canvas.height = terrain.height * scale;
  const ctx = canvas.getContext('2d');
  if (ctx !== null) {
    ctx.fillStyle = art.palette.waterMid;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < terrain.terrain.length; i++) {
      if (terrain.terrain[i] !== Terrain.Land) continue;
      const seat = seatOfIsland.get(terrain.islandId[i] as number);
      const colour = seat === undefined ? undefined : preview.colourOfSeat[seat];
      const x = i % terrain.width;
      const y = (i - x) / terrain.width;
      ctx.fillStyle = colour?.dark ?? art.palette.grassMid;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }

  const land = (x: number, y: number): boolean =>
    x >= 0 &&
    y >= 0 &&
    x < terrain.width &&
    y < terrain.height &&
    terrain.terrain[y * terrain.width + x] === Terrain.Land;
  const surf =
    kept?.surf ??
    Array.from(terrain.terrain).flatMap((tile, i) => {
      if (tile === Terrain.Land) return [];
      const x = i % terrain.width;
      const y = (i - x) / terrain.width;
      return land(x - 1, y) || land(x + 1, y) || land(x, y - 1) || land(x, y + 1) ? [i] : [];
    });
  const layer = { key, canvas, surf, centres: kept?.centres ?? islandCentres(terrain) };
  stillLayers.set(terrain, layer);
  return layer;
}
