import { artForStyle, type ArtConfig, type ArtLook, type ArtStyle } from '@rampart/config';
import { Rng } from '@rampart/sim';

import { Pixels } from './render/pixel/canvas.js';
import { water } from './render/pixel/generators.js';

/**
 * The menu and lobby's dressing: a pixel-art title in the stone of the game's walls, and
 * the game's own animated sea behind the panel. Generated from the palette like every
 * sprite in the game, so nothing binary is committed and the colours cannot drift.
 */

/**
 * Letters as 5x7 bitmaps, `#` for stone. Only those the title uses: this is a logo, not
 * a font, and a letter it lacks is left out rather than guessed at.
 */
const GLYPHS: Record<string, readonly string[]> = {
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
};

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

/** Pixel art's title: the word set in the stone of the game's walls, threaded in gold. */
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

/**
 * Every style's title. A record over every style, so a new style cannot be added without
 * one: the menu shows the title of the look chosen last.
 */
const TITLES: Record<ArtStyle, (text: string, art: ArtConfig) => Title> = {
  flat: blockTitle,
  pixel: stoneTitle,
  night: moonlitTitle,
  cyberpunk: neonTitle,
};

export function titleFor(style: ArtStyle, art: ArtConfig): Title {
  return TITLES[style]('Rampart', art);
}

/** How wide the title's letters stand in the menu, in CSS pixels: 8 to a cell in every style. */
export function titleWidth(text = 'Rampart'): number {
  return ((glyphsOf(text).length * 6 - 1) * TITLE_LETTERS_PX) / 7;
}

/** Where the line across the title is, and which look is above it. */
export interface TitleFrame {
  /** From the top of the letters, as a fraction of their height; outside 0..1 is off them. */
  split: number;
  /** The look above the line: the arriving one, as a banner crossing the board has it. */
  upper: ArtLook;
}

/** At rest the title is split through the middle, building above and combat below. */
export const TITLE_AT_REST: TitleFrame = { split: 0.5, upper: 'build' };

/** Just past the letters, so the line enters and leaves out of sight of them. */
const BEYOND = 0.12;

/**
 * The title's line, `ms` into a sweep of `span`: a round of the game in miniature. The
 * line carries on down out of the letters with building above it, so the whole word is
 * the build look; a banner then crosses it top to bottom bringing combat, as "Fire!"
 * does; and a last one brings building back and stops halfway. Each stage starts where
 * the last left the word, so nothing on it changes except under the line.
 */
export function titleSweep(ms: number, span: number): TitleFrame {
  const t = ms / span;
  if (t <= 0 || t >= 1) return TITLE_AT_REST;
  const ease = (u: number): number => 1 - (1 - u) * (1 - u);
  // A fifth to clear the word, two fifths for each banner.
  if (t < 0.2) return { split: 0.5 + (0.5 + BEYOND) * ease(t / 0.2), upper: 'build' };
  if (t < 0.6) return { split: -BEYOND + (1 + 2 * BEYOND) * ((t - 0.2) / 0.4), upper: 'combat' };
  return { split: -BEYOND + (0.5 + BEYOND) * ease((t - 0.6) / 0.4), upper: 'build' };
}

/**
 * The menu's title as both chosen looks at once: the build look's title above a banner's
 * gold line and the combat look's below it, the letters of the two coinciding, so the
 * word reads as one cut through by the line. The line sweeps across as either choice
 * changes and now and again while the menu is open; the same style for both is one
 * title and no line, as a banner then changes nothing.
 */
export class SplitTitle {
  private readonly layers: Record<ArtLook, HTMLElement>;
  private readonly line: HTMLElement;
  private shown: Partial<Record<ArtLook, ArtStyle>> = {};
  private same = false;
  private sweepStart: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly art: ArtConfig,
  ) {
    root.style.width = `${titleWidth()}px`;
    root.style.height = `${TITLE_LETTERS_PX}px`;
    const layer = (look: ArtLook): HTMLElement => {
      const el = document.createElement('span');
      el.className = 'title-layer';
      const img = document.createElement('img');
      img.alt = look === 'build' ? 'Rampart' : '';
      el.append(img);
      return el;
    };
    this.layers = { build: layer('build'), combat: layer('combat') };
    this.line = document.createElement('span');
    this.line.className = 'title-line';
    root.append(this.layers.build, this.layers.combat, this.line);
    this.frame(TITLE_AT_REST);
  }

  /** Shows these two looks, sweeping the line across if either has changed. */
  show(styles: Record<ArtLook, ArtStyle>): void {
    const changed = styles.build !== this.shown.build || styles.combat !== this.shown.combat;
    const first = this.shown.build === undefined;
    for (const look of ['build', 'combat'] as const) {
      if (styles[look] === this.shown[look]) continue;
      const title = titleFor(styles[look], this.art);
      const { height, margin } = titleLayout(title);
      const img = this.layers[look].querySelector('img')!;
      img.src = title.src;
      img.style.height = `${height}px`;
      img.style.left = img.style.top = `${margin}px`;
      img.style.imageRendering = title.smooth ? 'auto' : 'pixelated';
      img.classList.toggle('flicker', title.flicker);
    }
    this.shown = { ...styles };
    this.same = styles.build === styles.combat;
    this.frame(TITLE_AT_REST);
    if (changed && !first) this.sweep();
  }

  /** Sweeps the line across once, unless motion is unwelcome or one style shows both. */
  sweep(): void {
    if (this.same || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const already = this.sweepStart !== null;
    this.sweepStart = performance.now();
    if (!already) requestAnimationFrame(this.tick);
  }

  /** Sweeps now and then while the title is on the page, and stops once it has gone. */
  repeat(): void {
    this.timer ??= setInterval(() => {
      if (!this.root.isConnected) {
        clearInterval(this.timer!);
        this.timer = null;
        return;
      }
      this.sweep();
    }, this.art.menu.titleSweepEveryMs);
  }

  private readonly tick = (now: number): void => {
    if (this.sweepStart === null || !this.root.isConnected) return;
    const ms = now - this.sweepStart;
    this.frame(titleSweep(ms, this.art.menu.titleSweepMs));
    if (ms < this.art.menu.titleSweepMs) requestAnimationFrame(this.tick);
    else this.sweepStart = null;
  };

  private frame(frame: TitleFrame): void {
    const lower: ArtLook = frame.upper === 'build' ? 'combat' : 'build';
    if (this.same) {
      this.layers.build.dataset.side = 'whole';
      this.layers.combat.hidden = true;
      this.line.hidden = true;
      return;
    }
    this.layers.combat.hidden = false;
    this.layers[frame.upper].dataset.side = 'above';
    this.layers[lower].dataset.side = 'below';
    this.root.style.setProperty('--split', `${frame.split * TITLE_LETTERS_PX}px`);
    this.line.hidden = frame.split < 0 || frame.split > 1;
  }
}

/**
 * Lays the game's sea behind the whole page and sets it drifting. Once per page: the
 * match's canvas covers it entirely, so it can stay put underneath.
 */
export function installBackdrop(art: ArtConfig): void {
  if (document.querySelector('#backdrop') !== null) return;
  const frames = 4;
  const size = art.tileSizePx;
  // Several tiles side by side, so the pattern repeats less obviously than one would.
  const sheet = new Pixels(size * frames, size);
  const rng = new Rng(7);
  const ctx = sheet.canvas.getContext('2d');
  for (let f = 0; f < frames; f++) {
    ctx?.drawImage(water(art, rng, size, f, frames).canvas, f * size, 0);
  }
  const backdrop = document.createElement('div');
  backdrop.id = 'backdrop';
  backdrop.style.backgroundImage = `url(${sheet.canvas.toDataURL()})`;
  backdrop.style.backgroundSize = `${size * frames * 3}px ${size * 3}px`;
  document.body.prepend(backdrop);
}
