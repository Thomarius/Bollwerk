import { artForStyle, type ArtConfig, type ArtStyle } from '@bollwerk/config';
import { Rng } from '@bollwerk/sim';

import { Pixels } from './render/pixel/canvas.js';
import { hatch } from './render/walls.js';

/**
 * The game's title in every style: the same 5x7 letters drawn as each look draws — stone,
 * neon, ink, bricks, glass — generated from the palette like every sprite in the game, so
 * nothing binary is committed and the colours cannot drift. `SplitTitle` (decor.ts) shows
 * two of them at once in the menu.
 */

/**
 * Letters as 5x7 bitmaps, `#` for stone. Only those the title uses: this is a logo, not
 * a font, and a letter it lacks is left out rather than guessed at.
 */
const GLYPHS: Record<string, readonly string[]> = {
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
};

/** The game's name, as the menu's title spells it. */
export const GAME_TITLE = 'Bollwerk';

/**
 * A title as drawn: the image, and how its letters sit in it — canvas pixels per glyph
 * cell, room left round the letters for a glow or a halo, and any shadow falling past
 * them to the right and below — so every style's title can be shown at one letter size.
 */
export interface Title {
  src: string;
  cellPx: number;
  padPx: number;
  tailPx: number;
  /** Smooth rather than pixel art, so scaled without nearest-neighbour. */
  smooth: boolean;
  /** Flickers on as it appears, as Cyberpunk's holograms do. */
  flicker: boolean;
}

/** How tall the letters of every title stand in the menu, in CSS pixels. */
export const TITLE_LETTERS_PX = 56;

/**
 * The size to show a title at, and the negative margin that gives back its padding, so
 * the letters of every style's title stand at the same size in the same place.
 */
export function titleLayout(title: Title): { height: number; margin: number } {
  const scale = TITLE_LETTERS_PX / (7 * title.cellPx);
  return {
    height: (7 * title.cellPx + 2 * title.padPx + title.tailPx) * scale,
    margin: title.padPx === 0 ? 0 : -title.padPx * scale,
  };
}

function glyphsOf(text: string): (readonly string[])[] {
  return [...text.toUpperCase()].map((c) => GLYPHS[c]).filter((g) => g !== undefined);
}

/** Each stone cell of a word, in bitmap cells, with the letter it belongs to. */
function cellsOf(letters: readonly (readonly string[])[]): { x: number; y: number; n: number }[] {
  const cells: { x: number; y: number; n: number }[] = [];
  letters.forEach((glyph, n) => {
    glyph.forEach((row, y) => {
      [...row].forEach((cell, x) => {
        if (cell === '#') cells.push({ x: n * 6 + x, y, n });
      });
    });
  });
  return cells;
}

/** Pixels per bitmap cell in the stone titles: each cell is one dressed stone. */
const STONE = 4;

/**
 * Letters in dressed stone — a light top edge, a shaded bottom, a drop shadow — with a
 * thread of `accent` along the top of each, starting `pad` pixels in.
 */
function drawStone(p: Pixels, text: string, art: ArtConfig, accent: string, pad: number): void {
  const { rockLight, rockMid, rockDark, shadow } = art.palette;
  const letters = glyphsOf(text);
  for (const { x, y } of cellsOf(letters)) {
    const px = pad + x * STONE;
    const py = pad + y * STONE;
    p.rect(px + 2, py + 2, STONE, STONE, shadow, 0.8);
    p.rect(px, py, STONE, STONE, rockMid);
    p.rect(px, py, STONE, 1, rockLight);
    p.rect(px, py + STONE - 1, STONE, 1, rockDark);
    p.rect(px + STONE - 1, py, 1, STONE, rockDark, 0.6);
  }
  letters.forEach((glyph, n) => {
    [...(glyph[0] ?? '')].forEach((cell, x) => {
      if (cell === '#') p.rect(pad + (n * 6 + x) * STONE, pad, STONE, 1, accent, 0.8);
    });
  });
}

/** Medieval's title: the word set in the stone of the game's walls, threaded in gold. */
export function stoneTitle(text: string, art: ArtConfig): Title {
  const own = artForStyle(art, 'pixel');
  const cols = glyphsOf(text).length * 6 - 1;
  const p = new Pixels(cols * STONE + 2, 7 * STONE + 2);
  drawStone(p, text, own, own.palette.uiAccent, 0);
  return {
    src: p.canvas.toDataURL(),
    cellPx: STONE,
    padPx: 0,
    tailPx: 2,
    smooth: false,
    flicker: false,
  };
}

/** Room round Night's letters for their halo and a few stars. */
const NIGHT_PAD = 7;

/**
 * Night's title: the same stone in Night's palette, its top edge caught by moonlight
 * rather than gold, a pale halo round the letters and a few stars in the sky behind.
 */
export function moonlitTitle(text: string, art: ArtConfig): Title {
  const own = artForStyle(art, 'night');
  const { waterFoam, uiInk } = own.palette;
  const cols = glyphsOf(text).length * 6 - 1;
  const w = cols * STONE + NIGHT_PAD * 2 + 2;
  const h = 7 * STONE + NIGHT_PAD * 2 + 2;
  const p = new Pixels(w, h);

  // How far each pixel is from the nearest stone, so the halo is laid once per pixel
  // however many stones it is near, and fades with distance.
  const near = new Float32Array(w * h).fill(Number.POSITIVE_INFINITY);
  for (const { x, y } of cellsOf(glyphsOf(text))) {
    const px = NIGHT_PAD + x * STONE;
    const py = NIGHT_PAD + y * STONE;
    for (let dy = -5; dy < STONE + 5; dy++) {
      for (let dx = -5; dx < STONE + 5; dx++) {
        const qx = px + dx;
        const qy = py + dy;
        if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
        const d = Math.max(0, -dx, dx - STONE + 1, -dy, dy - STONE + 1);
        const i = qy * w + qx;
        if (d < near[i]!) near[i] = d;
      }
    }
  }
  for (let i = 0; i < near.length; i++) {
    const d = near[i]!;
    if (d >= 1 && d <= 3) p.set(i % w, Math.floor(i / w), waterFoam, 0.45 - d * 0.11);
  }

  // Stars, seeded so the sky is the same every time, kept clear of the letters.
  const rng = new Rng(11);
  for (let k = 0; k < 16; k++) {
    const x = rng.nextInt(w);
    const y = rng.nextInt(h);
    if (near[y * w + x]! <= 4) continue;
    const bright = rng.nextInt(4) === 0;
    p.set(x, y, uiInk, bright ? 0.95 : 0.55);
    if (!bright) continue;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      p.set(x + dx, y + dy, waterFoam, 0.5);
    }
  }
  drawStone(p, text, own, waterFoam, NIGHT_PAD);
  lightTorches(p, own, w, h);
  return {
    src: p.canvas.toDataURL(),
    cellPx: STONE,
    padPx: NIGHT_PAD,
    tailPx: 2,
    smooth: false,
    flicker: false,
  };
}

/**
 * A torch at either end of Night's title, and their warm light on the stone: laid over
 * what is drawn already and nowhere else, as the game's torchlight falls on the ground
 * and not on the sky.
 */
function lightTorches(p: Pixels, art: ArtConfig, w: number, h: number): void {
  const { emberHot, emberMid, rockDark } = art.palette;
  const ctx = p.canvas.getContext('2d');
  if (ctx === null) return;
  const cy = Math.round(h / 2) + 3;
  for (const x of [3, w - 5]) {
    // The warm light, on the stone and the halo only.
    const light = ctx.createRadialGradient(x + 1, cy - 4, 1, x + 1, cy - 4, 20);
    light.addColorStop(0, `${emberMid}b0`);
    light.addColorStop(1, `${emberMid}00`);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = light;
    ctx.fillRect(x - 20, cy - 24, 42, 40);
    ctx.globalCompositeOperation = 'source-over';
    // The torch: a stave, and a flame with a hot heart.
    p.rect(x + 0.5, cy - 3, 1, 7, rockDark);
    p.rect(x, cy - 7, 2, 4, emberMid);
    p.set(x + 1, cy - 8, emberMid, 0.8);
    p.rect(x, cy - 5, 2, 2, emberHot);
  }
}

/**
 * Minimal's title: flat blocks with a gap between them, as its walls are drawn, each
 * letter in a player's colour — plain, and the whole table in one word.
 */
export function blockTitle(text: string, art: ArtConfig): Title {
  const own = artForStyle(art, 'flat');
  // Finer than the stone, so the gap is a hairline, as between the flat style's blocks.
  const block = STONE * 2;
  const cols = glyphsOf(text).length * 6 - 1;
  const p = new Pixels(cols * block, 7 * block);
  for (const { x, y, n } of cellsOf(glyphsOf(text))) {
    const colour = own.players[n % own.players.length]!.light;
    p.rect(x * block, y * block, block - 1, block - 1, colour);
  }
  return {
    src: p.canvas.toDataURL(),
    cellPx: block,
    padPx: 0,
    tailPx: 0,
    smooth: false,
    flicker: false,
  };
}

/** A straight run of neon tube between two cell centres, in bitmap cells. */
export interface Tube {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * The tubes a neon sign would bend to spell one glyph: a run between every two stone
 * cells side by side or one above the other, and a diagonal only where two cells touch
 * at a corner with nothing beside them, as in the middle of an M — so a letter reads as
 * strokes, not as a grid. A cell touching none is a dot, a tube of no length.
 */
export function neonTubes(glyph: readonly string[]): Tube[] {
  const on = (x: number, y: number): boolean => glyph[y]?.[x] === '#';
  const tubes: Tube[] = [];
  glyph.forEach((row, y) => {
    [...row].forEach((_, x) => {
      if (!on(x, y)) return;
      let joined = false;
      const join = (nx: number, ny: number): void => {
        tubes.push({ x1: x, y1: y, x2: nx, y2: ny });
        joined = true;
      };
      if (on(x + 1, y)) join(x + 1, y);
      if (on(x, y + 1)) join(x, y + 1);
      if (on(x + 1, y + 1) && !on(x + 1, y) && !on(x, y + 1)) join(x + 1, y + 1);
      if (on(x - 1, y + 1) && !on(x - 1, y) && !on(x, y + 1)) join(x - 1, y + 1);
      const touched =
        joined ||
        on(x - 1, y) ||
        on(x, y - 1) ||
        (on(x - 1, y - 1) && !on(x - 1, y) && !on(x, y - 1)) ||
        (on(x + 1, y - 1) && !on(x + 1, y) && !on(x, y - 1));
      if (!touched) tubes.push({ x1: x, y1: y, x2: x, y2: y });
    });
  });
  return tubes;
}

/** Canvas pixels per bitmap cell, for the neon title: smooth, not pixel art. */
const NEON_CELL = 12;
/** Room round the letters for the glow, in canvas pixels. */
const NEON_PAD = 14;

/**
 * The same word as a neon sign, in Cyberpunk's colours: tubes bent along each letter's
 * strokes, a glow round them and a white-hot core down the middle.
 */
export function neonTitle(text: string, art: ArtConfig): Title {
  const { emberMid, uiInk } = artForStyle(art, 'cyberpunk').palette;
  const letters = glyphsOf(text);
  const canvas = document.createElement('canvas');
  canvas.width = (letters.length * 6 - 1) * NEON_CELL + NEON_PAD * 2;
  canvas.height = 7 * NEON_CELL + NEON_PAD * 2;
  const ctx = canvas.getContext('2d');
  const title = { cellPx: NEON_CELL, padPx: NEON_PAD, tailPx: 0, smooth: true, flicker: true };
  if (ctx === null) return { src: canvas.toDataURL(), ...title };
  const at = (cell: number): number => NEON_PAD + (cell + 0.5) * NEON_CELL;
  ctx.beginPath();
  letters.forEach((glyph, n) => {
    for (const tube of neonTubes(glyph)) {
      ctx.moveTo(at(n * 6 + tube.x1), at(tube.y1));
      ctx.lineTo(at(n * 6 + tube.x2), at(tube.y2));
    }
  });
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // The glow, twice over so it carries; then the tube; then its core.
  ctx.shadowColor = emberMid;
  ctx.shadowBlur = NEON_CELL;
  ctx.strokeStyle = emberMid;
  ctx.lineWidth = NEON_CELL * 0.45;
  ctx.stroke();
  ctx.stroke();
  ctx.shadowBlur = NEON_CELL * 0.4;
  ctx.lineWidth = NEON_CELL * 0.3;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = uiInk;
  ctx.lineWidth = NEON_CELL * 0.1;
  ctx.stroke();
  return { src: canvas.toDataURL(), ...title };
}

/** Canvas pixels per bitmap cell in the drawn titles, Blueprint's and Parchment's. */
const DRAWN_CELL = 10;
/** Room round their letters: for the sheet and dimension line, or the ribbon. */
const DRAWN_PAD = 16;

/** A smooth canvas for a drawn title, the word's cells and where each one stands. */
function drawnCanvas(text: string): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  cells: { x: number; y: number }[];
  has: (x: number, y: number) => boolean;
  cols: number;
} {
  const letters = glyphsOf(text);
  const cols = letters.length * 6 - 1;
  const canvas = document.createElement('canvas');
  canvas.width = cols * DRAWN_CELL + DRAWN_PAD * 2;
  canvas.height = 7 * DRAWN_CELL + DRAWN_PAD * 2;
  const cells = cellsOf(letters);
  const set = new Set(cells.map((c) => `${c.x},${c.y}`));
  return { canvas, ctx: canvas.getContext('2d'), cells, has: (x, y) => set.has(`${x},${y}`), cols };
}

/** Where cell edges face out of the word, in canvas pixels. */
function wordOutline(
  cells: readonly { x: number; y: number }[],
  has: (x: number, y: number) => boolean,
): [number, number, number, number][] {
  const at = (v: number): number => DRAWN_PAD + v * DRAWN_CELL;
  const out: [number, number, number, number][] = [];
  for (const { x, y } of cells) {
    if (!has(x, y - 1)) out.push([at(x), at(y), at(x + 1), at(y)]);
    if (!has(x, y + 1)) out.push([at(x), at(y + 1), at(x + 1), at(y + 1)]);
    if (!has(x - 1, y)) out.push([at(x), at(y), at(x), at(y + 1)]);
    if (!has(x + 1, y)) out.push([at(x + 1), at(y), at(x + 1), at(y + 1)]);
  }
  return out;
}

/**
 * Blueprint's title: the word drawn as a plan draws walls — outlined in white, hatched
 * inside — on a sheet of blue drafting paper, with a dimension line under it.
 */
export function planTitle(text: string, art: ArtConfig): Title {
  const { waterMid, grassLight, rockLight, waterFoam } = artForStyle(art, 'blueprint').palette;
  const { canvas, ctx, cells, has, cols } = drawnCanvas(text);
  const title = { cellPx: DRAWN_CELL, padPx: DRAWN_PAD, tailPx: 0, smooth: true, flicker: false };
  if (ctx === null) return { src: canvas.toDataURL(), ...title };
  const at = (v: number): number => DRAWN_PAD + v * DRAWN_CELL;
  // The sheet, and its grid.
  ctx.fillStyle = waterMid;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = grassLight;
  ctx.globalAlpha = 0.18;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = DRAWN_PAD % DRAWN_CELL; x < canvas.width; x += DRAWN_CELL) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, canvas.height);
  }
  for (let y = DRAWN_PAD % DRAWN_CELL; y < canvas.height; y += DRAWN_CELL) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(canvas.width, y + 0.5);
  }
  ctx.stroke();
  // Hatching inside the letters.
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = waterFoam;
  ctx.beginPath();
  for (const { x, y } of cells) {
    for (const s of hatch({ x: at(x), y: at(y), w: DRAWN_CELL, h: DRAWN_CELL }, 4, '\\')) {
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
    }
  }
  ctx.stroke();
  // The outline, and the construction lines it was drawn from, running on past it.
  ctx.strokeStyle = rockLight;
  ctx.globalAlpha = 0.25;
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of wordOutline(cells, has)) {
    const dx = Math.sign(x2 - x1) * 4;
    const dy = Math.sign(y2 - y1) * 4;
    ctx.moveTo(x1 - dx, y1 - dy);
    ctx.lineTo(x2 + dx, y2 + dy);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of wordOutline(cells, has)) {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();
  // The dimension line: the word's width, arrowed between two ticks, below it.
  const y = at(7) + DRAWN_PAD / 2;
  const left = at(0);
  const right = at(cols);
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.moveTo(left, y);
  ctx.lineTo(right, y);
  for (const [x, dir] of [
    [left, 1],
    [right, -1],
  ] as const) {
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y + 5);
    ctx.moveTo(x, y);
    ctx.lineTo(x + dir * 6, y - 3);
    ctx.moveTo(x, y);
    ctx.lineTo(x + dir * 6, y + 3);
  }
  ctx.stroke();
  return { src: canvas.toDataURL(), ...title };
}

/**
 * Parchment's title: the word in sepia ink, its strokes shaded by a hatching laid to
 * their south-east, on a ribbon of parchment with forked ends, as a map's cartouche.
 */
export function inkedTitle(text: string, art: ArtConfig): Title {
  const { grassMid, rockDark, rockMid, craterMid } = artForStyle(art, 'parchment').palette;
  const { canvas, ctx, cells, has } = drawnCanvas(text);
  const title = { cellPx: DRAWN_CELL, padPx: DRAWN_PAD, tailPx: 0, smooth: true, flicker: false };
  if (ctx === null) return { src: canvas.toDataURL(), ...title };
  const at = (v: number): number => DRAWN_PAD + v * DRAWN_CELL;
  const w = canvas.width;
  const h = canvas.height;
  // The ribbon, its ends forked.
  const top = DRAWN_PAD * 0.45;
  const bottom = h - DRAWN_PAD * 0.45;
  const notch = DRAWN_PAD * 0.8;
  ctx.beginPath();
  ctx.moveTo(1, top);
  ctx.lineTo(w - 1, top);
  ctx.lineTo(w - notch, (top + bottom) / 2);
  ctx.lineTo(w - 1, bottom);
  ctx.lineTo(1, bottom);
  ctx.lineTo(notch, (top + bottom) / 2);
  ctx.closePath();
  ctx.fillStyle = grassMid;
  ctx.fill();
  ctx.strokeStyle = rockMid;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // The hatching that shades each stroke, laid a little to its south-east.
  ctx.strokeStyle = craterMid;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const { x, y } of cells) {
    for (const s of hatch(
      { x: at(x) + 2.5, y: at(y) + 2.5, w: DRAWN_CELL, h: DRAWN_CELL },
      3,
      '/',
    )) {
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
    }
  }
  ctx.stroke();
  // The letters, in ink.
  ctx.globalAlpha = 1;
  ctx.fillStyle = rockDark;
  for (const { x, y } of cells) ctx.fillRect(at(x), at(y), DRAWN_CELL + 0.5, DRAWN_CELL + 0.5);
  ctx.strokeStyle = rockDark;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of wordOutline(cells, has)) {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();
  return { src: canvas.toDataURL(), ...title };
}

/**
 * Every style's title. A record over every style, so a new style cannot be added without
 * one: the menu shows the title of the look chosen last.
 */
/**
 * Toy bricks' title: each cell of the letters a brick with its stud, each letter in a
 * player's bright colour, a shade along each brick's foot and a glint on each stud.
 */
export function brickTitle(text: string, art: ArtConfig): Title {
  const own = artForStyle(art, 'bricks');
  const brick = STONE * 2;
  const cols = glyphsOf(text).length * 6 - 1;
  const p = new Pixels(cols * brick + 2, 7 * brick + 2);
  for (const { x, y, n } of cellsOf(glyphsOf(text))) {
    const ramp = own.players[n % own.players.length]!;
    const px = x * brick;
    const py = y * brick;
    p.rect(px + 2, py + 2, brick, brick, own.palette.shadow, 0.6);
    p.rect(px, py, brick, brick, ramp.base);
    p.rect(px, py + brick - 2, brick, 2, ramp.dark);
    p.rect(px + brick - 1, py, 1, brick, ramp.dark, 0.7);
    // The stud: a round boss, lit on its upper left.
    p.rect(px + 2, py + 2, brick - 4, brick - 5, ramp.light);
    p.set(px + 2, py + 2, ramp.base);
    p.set(px + brick - 3, py + 2, ramp.base);
    p.set(px + 3, py + 3, '#ffffff', 0.8);
  }
  return {
    src: p.canvas.toDataURL(),
    cellPx: brick,
    padPx: 0,
    tailPx: 2,
    smooth: false,
    flicker: false,
  };
}

/**
 * Stained glass's title: each cell of the letters a pane in a player's colour, lit from
 * behind, held in dark lead — a gap all round each pane — with a glint in its upper corner.
 */
export function glassTitle(text: string, art: ArtConfig): Title {
  const own = artForStyle(art, 'glass');
  const pane = STONE * 2;
  const cols = glyphsOf(text).length * 6 - 1;
  const p = new Pixels(cols * pane + 2, 7 * pane + 2);
  for (const { x, y, n } of cellsOf(glyphsOf(text))) {
    const ramp = own.players[n % own.players.length]!;
    const px = x * pane;
    const py = y * pane;
    p.rect(px, py, pane + 2, pane + 2, own.palette.shadow);
    p.rect(px + 1, py + 1, pane, pane, ramp.base);
    p.rect(px + 2, py + 2, pane - 4, pane - 4, ramp.light, 0.55);
    p.set(px + 2, py + 2, '#ffffff', 0.85);
    p.set(px + 3, py + 2, '#ffffff', 0.5);
    p.set(px + 2, py + 3, '#ffffff', 0.5);
  }
  return {
    src: p.canvas.toDataURL(),
    cellPx: pane,
    padPx: 0,
    tailPx: 2,
    smooth: false,
    flicker: false,
  };
}

/**
 * Chocolate's title: the word piped in milk chocolate, glossy, each stroke rounded, with
 * drips running off the foot of the letters.
 */
export function chocolateTitle(text: string, art: ArtConfig): Title {
  const { craterMid, craterDark, shadow, waterShallow } = artForStyle(art, 'chocolate').palette;
  const { canvas, ctx, cells, has } = drawnCanvas(text);
  const title = { cellPx: DRAWN_CELL, padPx: DRAWN_PAD, tailPx: 0, smooth: true, flicker: false };
  if (ctx === null) return { src: canvas.toDataURL(), ...title };
  const at = (v: number): number => DRAWN_PAD + v * DRAWN_CELL;
  const rng = new Rng(0xc0c0a);
  // The drips first, under the letters, from the foot of a stroke with nothing below it.
  ctx.fillStyle = craterMid;
  for (const { x, y } of cells) {
    if (has(x, y + 1) || rng.nextFloat() > 0.45) continue;
    const cx = at(x) + DRAWN_CELL * (0.3 + 0.4 * rng.nextFloat());
    const length = 3 + rng.nextFloat() * (DRAWN_PAD - 6);
    ctx.fillRect(cx - 2, at(y + 1) - 2, 4, length);
    ctx.beginPath();
    ctx.arc(cx, at(y + 1) - 2 + length, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  // The letters: a dark edge, the chocolate, then a lighter crown on each stroke.
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const stroke = (width: number, colour: string, dy = 0): void => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (const { x, y } of cells) {
      const cx = at(x) + DRAWN_CELL / 2;
      const cy = at(y) + DRAWN_CELL / 2 + dy;
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + 0.01, cy);
      for (const [dx, dy2] of [
        [1, 0],
        [0, 1],
      ] as const) {
        if (!has(x + dx, y + dy2)) continue;
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + dx * DRAWN_CELL, cy + dy2 * DRAWN_CELL);
      }
    }
    ctx.stroke();
  };
  stroke(DRAWN_CELL * 1.25, shadow, 1.5);
  stroke(DRAWN_CELL * 1.1, craterDark);
  stroke(DRAWN_CELL * 0.85, craterMid);
  stroke(DRAWN_CELL * 0.35, waterShallow, -2);
  // The gloss: a short white streak on the upper left of each stroke's corner.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  for (const { x, y } of cells) {
    if (has(x - 1, y) || has(x, y - 1)) continue;
    ctx.beginPath();
    ctx.arc(at(x) + DRAWN_CELL * 0.35, at(y) + DRAWN_CELL * 0.35, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  return { src: canvas.toDataURL(), ...title };
}

/**
 * Halloween's title: the word carved in pumpkin, each stroke rounded and ribbed in orange,
 * lit from inside so a candle glow shows down its middle; a green stem on a letter here and
 * there.
 */
export function halloweenTitle(text: string, _art: ArtConfig): Title {
  const { canvas, ctx, cells, has } = drawnCanvas(text);
  const title = { cellPx: DRAWN_CELL, padPx: DRAWN_PAD, tailPx: 0, smooth: true, flicker: false };
  if (ctx === null) return { src: canvas.toDataURL(), ...title };
  const at = (v: number): number => DRAWN_PAD + v * DRAWN_CELL;
  const rng = new Rng(0x5ca3e);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const stroke = (width: number, colour: string, glow = 0): void => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.shadowColor = colour;
    ctx.shadowBlur = glow;
    ctx.beginPath();
    for (const { x, y } of cells) {
      const cx = at(x) + DRAWN_CELL / 2;
      const cy = at(y) + DRAWN_CELL / 2;
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + 0.01, cy);
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ] as const) {
        if (!has(x + dx, y + dy)) continue;
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + dx * DRAWN_CELL, cy + dy * DRAWN_CELL);
      }
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  };
  // The stems, first, on the top of a stroke with nothing above it.
  ctx.strokeStyle = '#4a7a2a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (const { x, y } of cells) {
    if (has(x, y - 1) || rng.nextFloat() > 0.35) continue;
    const cx = at(x) + DRAWN_CELL / 2;
    ctx.moveTo(cx, at(y) + 2);
    ctx.quadraticCurveTo(cx + 2, at(y) - 4, cx + 5, at(y) - 5);
  }
  ctx.stroke();
  stroke(DRAWN_CELL * 1.25, '#3a1a08');
  stroke(DRAWN_CELL * 1.1, '#c2560e');
  stroke(DRAWN_CELL * 0.85, '#f07a12');
  // The candle inside, glowing through the carving.
  stroke(DRAWN_CELL * 0.3, '#ffe27a', 8);
  return { src: canvas.toDataURL(), ...title };
}

/**
 * Sakura's title: the word brushed in ink on a scroll of paper between two wooden rollers,
 * each stroke rounded and dry at its edges, and a red seal stamped in the corner, as an
 * artist signs a print.
 */
export function sakuraTitle(text: string, _art: ArtConfig): Title {
  const { canvas, ctx, cells, has } = drawnCanvas(text);
  const title = { cellPx: DRAWN_CELL, padPx: DRAWN_PAD, tailPx: 0, smooth: true, flicker: false };
  if (ctx === null) return { src: canvas.toDataURL(), ...title };
  const at = (v: number): number => DRAWN_PAD + v * DRAWN_CELL;
  const w = canvas.width;
  const h = canvas.height;
  const rng = new Rng(0x5a6c0a);
  // The paper, then a roller at either end.
  const top = DRAWN_PAD * 0.35;
  ctx.fillStyle = '#f3ead6';
  ctx.fillRect(6, top, w - 12, h - top * 2);
  ctx.strokeStyle = '#c9b48a';
  ctx.lineWidth = 1;
  ctx.strokeRect(6.5, top + 0.5, w - 13, h - top * 2 - 1);
  for (const x of [0, w - 8]) {
    ctx.fillStyle = '#4a3328';
    ctx.fillRect(x, 2, 8, h - 4);
    ctx.fillStyle = '#d9b24a';
    ctx.fillRect(x, 0, 8, 4);
    ctx.fillRect(x, h - 4, 8, 4);
  }
  // The strokes, from cell to cell, in ink.
  const strokes = (): void => {
    ctx.beginPath();
    for (const { x, y } of cells) {
      const cx = at(x) + DRAWN_CELL / 2;
      const cy = at(y) + DRAWN_CELL / 2;
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + 0.01, cy);
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ] as const) {
        if (!has(x + dx, y + dy)) continue;
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + dx * DRAWN_CELL, cy + dy * DRAWN_CELL);
      }
    }
  };
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#1c1a24';
  ctx.lineWidth = DRAWN_CELL * 1.15;
  strokes();
  ctx.stroke();
  // Dry brush: paper showing through in fine streaks here and there along the strokes.
  ctx.strokeStyle = '#f3ead6';
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const { x, y } of cells) {
    if (rng.nextFloat() > 0.3) continue;
    const across = has(x + 1, y) || has(x - 1, y);
    const cx = at(x) + DRAWN_CELL / 2;
    const cy = at(y) + DRAWN_CELL / 2;
    const off = (rng.nextFloat() - 0.5) * DRAWN_CELL * 0.8;
    if (across) {
      ctx.moveTo(cx - DRAWN_CELL * 0.5, cy + off);
      ctx.lineTo(cx + DRAWN_CELL * 0.4, cy + off);
    } else {
      ctx.moveTo(cx + off, cy - DRAWN_CELL * 0.5);
      ctx.lineTo(cx + off, cy + DRAWN_CELL * 0.4);
    }
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  // The seal, in the paper's lower right corner: vermilion, a character cut into it.
  const size = 12;
  const sx = w - 8 - size - 3;
  const sy = h - top - size - 1;
  ctx.fillStyle = '#c8321e';
  ctx.fillRect(sx, sy, size, size);
  ctx.strokeStyle = '#f3ead6';
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.strokeRect(sx + 1.5, sy + 1.5, size - 3, size - 3);
  ctx.moveTo(sx + 3.5, sy + 4.5);
  ctx.lineTo(sx + size - 3.5, sy + 4.5);
  ctx.moveTo(sx + size / 2, sy + 3);
  ctx.lineTo(sx + size / 2, sy + size - 3);
  ctx.moveTo(sx + 3.5, sy + size - 4.5);
  ctx.lineTo(sx + size - 3.5, sy + size - 4.5);
  ctx.stroke();
  return { src: canvas.toDataURL(), ...title };
}

/**
 * Oktoberfest's title: the word in gingerbread, as on the hearts sold at every stall —
 * thick brown strokes, piped round in white icing, dotted with pink, green and yellow.
 */
export function wiesnTitle(text: string, _art: ArtConfig): Title {
  const { canvas, ctx, cells, has } = drawnCanvas(text);
  const title = { cellPx: DRAWN_CELL, padPx: DRAWN_PAD, tailPx: 0, smooth: true, flicker: false };
  if (ctx === null) return { src: canvas.toDataURL(), ...title };
  const at = (v: number): number => DRAWN_PAD + v * DRAWN_CELL;
  const rng = new Rng(0x0c7b3f);
  const strokes = (): void => {
    ctx.beginPath();
    for (const { x, y } of cells) {
      const cx = at(x) + DRAWN_CELL / 2;
      const cy = at(y) + DRAWN_CELL / 2;
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + 0.01, cy);
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ] as const) {
        if (!has(x + dx, y + dy)) continue;
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + dx * DRAWN_CELL, cy + dy * DRAWN_CELL);
      }
    }
  };
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // The icing round the outside, then the gingerbread, then a line of icing piped along it.
  ctx.strokeStyle = '#fffaf0';
  ctx.lineWidth = DRAWN_CELL * 1.45;
  strokes();
  ctx.stroke();
  ctx.strokeStyle = '#5e3010';
  ctx.lineWidth = DRAWN_CELL * 1.25;
  strokes();
  ctx.stroke();
  ctx.strokeStyle = '#8a4a22';
  ctx.lineWidth = DRAWN_CELL * 1.05;
  strokes();
  ctx.stroke();
  ctx.strokeStyle = '#ffd6e4';
  ctx.lineWidth = 1.6;
  ctx.setLineDash([3, 2]);
  strokes();
  ctx.stroke();
  ctx.setLineDash([]);
  // Sugar dots on the turns.
  const dots = ['#ff8fb3', '#7fd47a', '#ffd23f'];
  for (const { x, y } of cells) {
    if (rng.nextFloat() > 0.18) continue;
    ctx.fillStyle = dots[Math.floor(rng.nextFloat() * dots.length)]!;
    ctx.beginPath();
    ctx.arc(at(x) + DRAWN_CELL / 2, at(y) + DRAWN_CELL / 2, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  return { src: canvas.toDataURL(), ...title };
}

/**
 * Opera's title: the word written in noteheads on a five-line staff — every cell of the
 * letters a note, ledger lines above and below for the rows off the staff — with a treble
 * clef at its head, in gold on the night.
 */
export function operaTitle(text: string, _art: ArtConfig): Title {
  const { canvas, ctx, cells, cols } = drawnCanvas(text);
  const title = { cellPx: DRAWN_CELL, padPx: DRAWN_PAD, tailPx: 0, smooth: true, flicker: false };
  if (ctx === null) return { src: canvas.toDataURL(), ...title };
  const at = (v: number): number => DRAWN_PAD + v * DRAWN_CELL;
  const mid = (v: number): number => at(v) + DRAWN_CELL / 2;
  // The staff, through the middle five rows of the letters.
  ctx.strokeStyle = '#c9a24a';
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let row = 1; row <= 5; row++) {
    ctx.moveTo(2, mid(row) + 0.5);
    ctx.lineTo(at(cols) + 6, mid(row) + 0.5);
  }
  // Ledger lines for the notes off it, above and below.
  for (const { x, y } of cells) {
    if (y !== 0 && y !== 6) continue;
    ctx.moveTo(at(x) - 1, mid(y) + 0.5);
    ctx.lineTo(at(x + 1) + 1, mid(y) + 0.5);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  // The treble clef, at the staff's head: the stroke up, its loop over the top, and the
  // spiral wound round the second line.
  ctx.strokeStyle = '#f1d27a';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(6, mid(6) + 2);
  ctx.quadraticCurveTo(4, mid(6) + 6, 8, mid(6) + 5);
  ctx.lineTo(9, mid(0) - 4);
  ctx.quadraticCurveTo(13, mid(0) + 4, 6, mid(2.5));
  ctx.quadraticCurveTo(0, mid(3.5), 3, mid(4.5));
  ctx.quadraticCurveTo(8, mid(5.2), 12, mid(4.3));
  ctx.quadraticCurveTo(13, mid(3.2), 8, mid(3.4));
  ctx.quadraticCurveTo(5, mid(3.8), 7, mid(4.2));
  ctx.stroke();
  // The notes: a tilted head on every cell of the letters.
  for (const { x, y } of cells) {
    ctx.beginPath();
    ctx.ellipse(mid(x), mid(y), DRAWN_CELL * 0.58, DRAWN_CELL * 0.4, -0.35, 0, Math.PI * 2);
    ctx.fillStyle = '#f1d27a';
    ctx.fill();
    ctx.strokeStyle = '#6a5018';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  return { src: canvas.toDataURL(), ...title };
}

/**
 * Office's title: the word on sticky notes, a letter to a note, each note a player's light
 * colour and stuck on a little askew, its top edge darker where the glue is, the letter
 * written on it in black marker.
 */
export function officeTitle(text: string, art: ArtConfig): Title {
  const { canvas, ctx, cells, has } = drawnCanvas(text);
  const title = { cellPx: DRAWN_CELL, padPx: DRAWN_PAD, tailPx: 0, smooth: true, flicker: false };
  if (ctx === null) return { src: canvas.toDataURL(), ...title };
  const at = (v: number): number => DRAWN_PAD + v * DRAWN_CELL;
  const rng = new Rng(0x0ff1ce);
  const letters = Math.max(1, Math.ceil(Math.max(0, ...cells.map((c) => c.x + 1)) / 6));
  for (let n = 0; n < letters; n++) {
    const note = art.players[n % art.players.length];
    const cx = at(n * 6 + 2.5);
    const cy = at(3.5);
    const hw = DRAWN_CELL * 3.2;
    const hh = DRAWN_CELL * 4.1;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((rng.nextFloat() - 0.5) * 0.22);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(-hw + 2, -hh + 3, hw * 2, hh * 2);
    ctx.fillStyle = note?.light ?? '#fff07a';
    ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(-hw, -hh, hw * 2, hh * 0.22);
    // The corner curling up, as a note stuck on in a hurry does.
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.moveTo(hw, hh - hw * 0.3);
    ctx.lineTo(hw - hw * 0.3, hh);
    ctx.lineTo(hw, hh);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  // The letters in marker: round strokes from every cell to the next along and below.
  ctx.strokeStyle = '#16181c';
  ctx.lineWidth = DRAWN_CELL * 0.95;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const { x, y } of cells) {
    const cx = at(x) + DRAWN_CELL / 2;
    const cy = at(y) + DRAWN_CELL / 2;
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + 0.01, cy);
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
    ] as const) {
      if (!has(x + dx, y + dy)) continue;
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + dx * DRAWN_CELL, cy + dy * DRAWN_CELL);
    }
  }
  ctx.stroke();
  return { src: canvas.toDataURL(), ...title };
}

/**
 * Under the sea's title: the word in bubbles, a bubble to every cell of the letters, each
 * lit from its upper left and glowing faintly, a glint in its corner, and a few small ones
 * rising off the tops of the letters.
 */
export function underseaTitle(text: string, _art: ArtConfig): Title {
  const { canvas, ctx, cells, has } = drawnCanvas(text);
  const title = { cellPx: DRAWN_CELL, padPx: DRAWN_PAD, tailPx: 0, smooth: true, flicker: false };
  if (ctx === null) return { src: canvas.toDataURL(), ...title };
  const at = (v: number): number => DRAWN_PAD + v * DRAWN_CELL;
  const rng = new Rng(0x5eab0b);
  const bubble = (x: number, y: number, r: number): void => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    const fill = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    fill.addColorStop(0, '#c8f4ff');
    fill.addColorStop(1, '#2a9cc0');
    ctx.fillStyle = fill;
    ctx.shadowColor = '#7fdcff';
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(1, r * 0.2);
    ctx.strokeStyle = '#f0fcff';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.25, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  };
  for (const { x, y } of cells) {
    bubble(
      at(x) + DRAWN_CELL / 2,
      at(y) + DRAWN_CELL / 2,
      DRAWN_CELL * (0.6 + rng.nextFloat() * 0.1),
    );
  }
  // Small ones rising off the tops of the letters, into the room above them.
  for (const { x, y } of cells) {
    if (has(x, y - 1) || rng.nextFloat() > 0.3) continue;
    const cx = at(x) + DRAWN_CELL / 2 + (rng.nextFloat() - 0.5) * 6;
    bubble(cx, at(y) - 4 - rng.nextFloat() * 6, 1.5 + rng.nextFloat() * 2);
  }
  return { src: canvas.toDataURL(), ...title };
}

/**
 * Electric's title: the word written in arcs, each stroke of a letter a jagged bolt from cell
 * to cell — a wide cool halo, a band of pale blue and a white-hot core — and a copper
 * electrode at every end of a stroke, where the current leaps from.
 */
export function electricTitle(text: string, _art: ArtConfig): Title {
  const { canvas, ctx, cells, has } = drawnCanvas(text);
  const title = { cellPx: DRAWN_CELL, padPx: DRAWN_PAD, tailPx: 0, smooth: true, flicker: true };
  if (ctx === null) return { src: canvas.toDataURL(), ...title };
  const at = (v: number): number => DRAWN_PAD + v * DRAWN_CELL + DRAWN_CELL / 2;
  const rng = new Rng(0xe1ec7);
  // Every join between two cells as a jagged arc, kept so each pass strokes the same bolt:
  // side by side, and corner to corner where no cell beside both joins them already — the
  // diagonal strokes of R, K and W and the rounded corners of B and O, which stood apart
  // with an electrode each when only cells side by side were joined.
  const arcs: [number, number][][] = [];
  const joins = new Map<string, number>();
  const join = (x: number, y: number): void => {
    joins.set(`${x},${y}`, (joins.get(`${x},${y}`) ?? 0) + 1);
  };
  for (const { x, y } of cells) {
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [1, 1],
      [-1, 1],
    ] as const) {
      if (!has(x + dx, y + dy)) continue;
      if (dx !== 0 && dy !== 0 && (has(x + dx, y) || has(x, y + dy))) continue;
      const length = Math.hypot(dx, dy);
      const points: [number, number][] = [[at(x), at(y)]];
      for (let k = 1; k < 3; k++) {
        // Pushed across the stroke, whichever way it runs.
        const push = ((rng.nextFloat() - 0.5) * DRAWN_CELL * 0.5) / length;
        points.push([
          at(x) + dx * (k / 3) * DRAWN_CELL - dy * push,
          at(y) + dy * (k / 3) * DRAWN_CELL + dx * push,
        ]);
      }
      points.push([at(x + dx), at(y + dy)]);
      arcs.push(points);
      join(x, y);
      join(x + dx, y + dy);
    }
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [width, colour, blur] of [
    [DRAWN_CELL * 0.9, 'rgba(138, 176, 255, 0.35)', 12],
    [DRAWN_CELL * 0.45, '#a8c4ff', 6],
    [DRAWN_CELL * 0.18, '#ffffff', 4],
  ] as const) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.shadowColor = '#8ab0ff';
    ctx.shadowBlur = blur;
    ctx.beginPath();
    for (const arc of arcs) {
      ctx.moveTo(arc[0]![0], arc[0]![1]);
      for (const [px, py] of arc.slice(1)) ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  // The electrodes: copper studs where a stroke ends.
  for (const { x, y } of cells) {
    if ((joins.get(`${x},${y}`) ?? 0) > 1) continue;
    ctx.beginPath();
    ctx.arc(at(x), at(y), DRAWN_CELL * 0.32, 0, Math.PI * 2);
    ctx.fillStyle = '#c87a3e';
    ctx.fill();
    ctx.strokeStyle = '#4a2a14';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  return { src: canvas.toDataURL(), ...title };
}

const TITLES: Record<ArtStyle, (text: string, art: ArtConfig) => Title> = {
  flat: blockTitle,
  pixel: stoneTitle,
  night: moonlitTitle,
  cyberpunk: neonTitle,
  blueprint: planTitle,
  parchment: inkedTitle,
  bricks: brickTitle,
  glass: glassTitle,
  chocolate: chocolateTitle,
  halloween: halloweenTitle,
  sakura: sakuraTitle,
  oktoberfest: wiesnTitle,
  opera: operaTitle,
  office: officeTitle,
  undersea: underseaTitle,
  electric: electricTitle,
};

/**
 * Each style's title, drawn once and kept: it is a canvas turned into an image, and the
 * menu's random half asks for a new one at every sweep. Nothing in it moves or varies.
 */
const titles = new WeakMap<ArtConfig, Map<ArtStyle, Title>>();

export function titleFor(style: ArtStyle, art: ArtConfig): Title {
  let drawn = titles.get(art);
  if (drawn === undefined) titles.set(art, (drawn = new Map()));
  let title = drawn.get(style);
  if (title === undefined) {
    title = TITLES[style](GAME_TITLE, art);
    drawn.set(style, title);
  }
  return title;
}

/** How wide the title's letters stand in the menu, in CSS pixels: 8 to a cell in every style. */
export function titleWidth(text = GAME_TITLE): number {
  return ((glyphsOf(text).length * 6 - 1) * TITLE_LETTERS_PX) / 7;
}
