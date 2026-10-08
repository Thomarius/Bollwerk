import { defaultArtConfig, type TextKey } from '@bollwerk/config';
import {
  Structure,
  Terrain,
  computeEnclosure,
  stateFromAscii,
  type EnclosureResult,
  type MatchState,
} from '@bollwerk/sim';

import { t } from './i18n.js';
import { motionReduced } from './motion.js';
import { store, stored } from './storage.js';

/**
 * How to play (PLAN 11.16 H1): a few pages opened from the menu, each a small looping
 * picture and a caption of a few words — nobody reads a manual, the user's rule. Drawn on
 * a canvas in the Minimal look's colours. The boards of the sealing pages are real boards,
 * judged by the sim's own `computeEnclosure`, so the flood and the leak are exactly what
 * the game does; a test holds them to it. Under reduced motion each page stands still at
 * its key moment.
 */

/** One page: a caption, the length of its loop, where it stands still, and its picture. */
export interface HowToPage {
  /** Looked up as the page is shown, so it is in the language in use then. */
  caption: TextKey;
  loopMs: number;
  stillMs: number;
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, ms: number): void;
}

const art = defaultArtConfig;
const pal = art.palette;
const RED = art.players[0]!;
const BLUE = art.players[1]!;
const INK = pal.uiInk;
const ACCENT = pal.uiAccent;
const GOOD = pal.uiValid;
const BAD = pal.uiInvalid;

/** 0 to 1 across a span of a loop, clamped. */
export function span(ms: number, from: number, to: number): number {
  return Math.max(0, Math.min(1, (ms - from) / (to - from)));
}

/** Smoothly in and out. */
const ease = (t: number): number => t * t * (3 - 2 * t);

// ------------------------------------------------------------------------ boards

/** A board for a page: its state, its enclosure, and the order sealed ground floods in. */
export interface Board {
  state: MatchState;
  enclosure: EnclosureResult;
  /** Steps from the castle, by tile, for sealed ground; -1 elsewhere. */
  flood: Int32Array;
  floodSteps: number;
}

export function board(picture: string, islands?: string): Board {
  const state = stateFromAscii(picture, undefined, islands);
  const enclosure = computeEnclosure(state);
  const { width: w } = state;
  const flood = new Int32Array(state.terrain.length).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < flood.length; i++) {
    if (state.structure[i] === Structure.Castle && enclosure.territory[i] !== 0) {
      flood[i] = 0;
      queue.push(i);
    }
  }
  let steps = 0;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head] as number;
    for (const j of [i - 1, i + 1, i - w, i + w]) {
      if (j < 0 || j >= flood.length || flood[j] !== -1 || enclosure.territory[j] === 0) continue;
      if (Math.abs((j % w) - (i % w)) > 1) continue;
      flood[j] = (flood[i] as number) + 1;
      steps = Math.max(steps, flood[j] as number);
      queue.push(j);
    }
  }
  return { state, enclosure, flood, floodSteps: steps };
}

/** A ring round a castle with one block missing; the piece goes in at `SEAL_GAP`. */
export const SEAL_OPEN = board(`
  ..........
  .,,,,,,,,.
  .,######,.
  .,#,,,,#,.
  .,#,@@,#,.
  .,#,@@,,,.
  .,#,,,,#,.
  .,######,.
  .,,,,,,,,.
  ..........
`);
export const SEAL_GAP = { x: 7, y: 5 };
export const SEAL_CLOSED = board(`
  ..........
  .,,,,,,,,.
  .,######,.
  .,#,,,,#,.
  .,#,@@,#,.
  .,#,@@,#,.
  .,#,,,,#,.
  .,######,.
  .,,,,,,,,.
  ..........
`);

/** The top-right corner joined only at a point: the sea gets in. */
export const CORNER_DIAGONAL = board(`
  ..........
  .,,,,,,,,.
  .,#####,,.
  .,#,,,,#,.
  .,#,@@,#,.
  .,#,@@,#,.
  .,######,.
  .,,,,,,,,.
  ..........
`);
/** The same with the corner turned: sealed. */
export const CORNER_TURNED = board(`
  ..........
  .,,,,,,,,.
  .,######,.
  .,#,,,,#,.
  .,#,@@,#,.
  .,#,@@,#,.
  .,######,.
  .,,,,,,,,.
  ..........
`);

/** A gun inside sealed ground and one outside it. */
export const GUNS = board(`
  ..............
  .,,,,,,,,,,,,.
  .,########,,,.
  .,#,,,,,,#,,,.
  .,#,@@,**#,**.
  .,#,@@,**#,**.
  .,#,,,,,,#,,,.
  .,########,,,.
  .,,,,,,,,,,,,.
  ..............
`);

/** Order in which the sea pours into a leaking ring, from the border, by tile. */
function seaOrder(b: Board): Int32Array {
  const { state } = b;
  const w = state.width;
  const h = state.height;
  const order = new Int32Array(state.terrain.length).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < order.length; i++) {
    const x = i % w;
    const y = (i - x) / w;
    if (state.terrain[i] !== Terrain.Land && (x === 0 || y === 0 || x === w - 1 || y === h - 1)) {
      order[i] = 0;
      queue.push(i);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head] as number;
    const x = i % w;
    const y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (order[j] !== -1 || state.structure[j] === Structure.Wall) continue;
        if (state.structure[j] !== Structure.Empty) continue;
        order[j] = (order[i] as number) + 1;
        queue.push(j);
      }
    }
  }
  return order;
}
/**
 * The sea pouring in, shown only where it gets in: the open corner and the ring's inside,
 * which the turned corner seals. Washing the whole island outside the wall in water read
 * as the land flooding.
 */
const CORNER_SEA = ((): Int32Array => {
  const order = seaOrder(CORNER_DIAGONAL);
  const corner = 2 * CORNER_DIAGONAL.state.width + 7;
  return order.map((step, i) =>
    i === corner || (CORNER_TURNED.flood[i] as number) >= 0 ? step : -1,
  );
})();

// ----------------------------------------------------------------------- drawing

interface BoardLook {
  /** Tiles of sealed ground to show, by flood step; Infinity for all. */
  floodTo?: number;
  /** Tiles to leave out of the wall, by index. */
  missing?: ReadonlySet<number>;
  /** Water pouring in, by sea step, up to this one. */
  seaTo?: number;
  sea?: Int32Array;
  /** Guns to grey out, by index in `state.cannons`. */
  silent?: ReadonlySet<number>;
}

/** Fits a board into a box, returning the tile size and its top left. */
function fit(
  b: Board,
  x: number,
  y: number,
  w: number,
  h: number,
): { t: number; ox: number; oy: number } {
  const t = Math.floor(Math.min(w / b.state.width, h / b.state.height));
  return {
    t,
    ox: Math.round(x + (w - t * b.state.width) / 2),
    oy: Math.round(y + (h - t * b.state.height) / 2),
  };
}

function drawBoard(
  ctx: CanvasRenderingContext2D,
  b: Board,
  at: { t: number; ox: number; oy: number },
  look: BoardLook = {},
): void {
  const { state } = b;
  const { t, ox, oy } = at;
  const w = state.width;
  for (let i = 0; i < state.terrain.length; i++) {
    const x = i % w;
    const y = (i - x) / w;
    const px = ox + x * t;
    const py = oy + y * t;
    const land = state.terrain[i] === Terrain.Land;
    const colour = state.islandId[i] === 2 ? BLUE : RED;
    ctx.fillStyle = land ? colour.dark : pal.waterMid;
    ctx.globalAlpha = land ? 0.55 : 1;
    ctx.fillRect(px, py, t, t);
    ctx.globalAlpha = 1;
    if (!land) continue;
    const step = b.flood[i] as number;
    if (step >= 0 && step <= (look.floodTo ?? Infinity)) {
      ctx.fillStyle = colour.light;
      ctx.globalAlpha = 0.45;
      ctx.fillRect(px, py, t, t);
      ctx.globalAlpha = 1;
    }
    const sea = look.sea?.[i] ?? -1;
    if (look.sea !== undefined && sea > 0 && sea <= (look.seaTo ?? -1)) {
      ctx.fillStyle = pal.waterShallow;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(px, py, t, t);
      ctx.globalAlpha = 1;
    }
    if (state.structure[i] === Structure.Wall && !look.missing?.has(i)) {
      ctx.fillStyle = colour.base;
      ctx.fillRect(px + 1, py + 1, t - 2, t - 2);
    }
  }
  for (const castle of state.castles) {
    const px = ox + castle.x * t;
    const py = oy + castle.y * t;
    ctx.fillStyle = RED.base;
    ctx.fillRect(px + 1, py + 1, castle.w * t - 2, castle.h * t - 2);
    ctx.fillStyle = RED.dark;
    ctx.fillRect(px + t * 0.6, py + t * 0.6, castle.w * t - t * 1.2, castle.h * t - t * 1.2);
  }
  state.cannons.forEach((cannon, k) => {
    const cx = ox + (cannon.x + 1) * t;
    const cy = oy + (cannon.y + 1) * t;
    const silent = look.silent?.has(k) === true;
    const colour = state.islandId[cannon.y * w + cannon.x] === 2 ? BLUE : RED;
    ctx.fillStyle = silent ? pal.rockMid : colour.base;
    ctx.beginPath();
    ctx.arc(cx, cy, t * 0.85, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = silent ? pal.rockDark : colour.dark;
    ctx.beginPath();
    ctx.arc(cx, cy, t * 0.4, 0, Math.PI * 2);
    ctx.fill();
    if (silent) {
      ctx.strokeStyle = BAD;
      ctx.lineWidth = Math.max(2, t * 0.15);
      ctx.beginPath();
      ctx.moveTo(cx - t * 0.8, cy + t * 0.8);
      ctx.lineTo(cx + t * 0.8, cy - t * 0.8);
      ctx.stroke();
    }
  });
}

/** A big tick or cross under a board, so the verdict needs no words. */
function verdict(
  ctx: CanvasRenderingContext2D,
  good: boolean,
  x: number,
  y: number,
  size: number,
): void {
  ctx.strokeStyle = good ? GOOD : BAD;
  ctx.lineWidth = Math.max(3, size * 0.18);
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (good) {
    ctx.moveTo(x - size * 0.4, y);
    ctx.lineTo(x - size * 0.1, y + size * 0.3);
    ctx.lineTo(x + size * 0.45, y - size * 0.35);
  } else {
    ctx.moveTo(x - size * 0.35, y - size * 0.35);
    ctx.lineTo(x + size * 0.35, y + size * 0.35);
    ctx.moveTo(x + size * 0.35, y - size * 0.35);
    ctx.lineTo(x - size * 0.35, y + size * 0.35);
  }
  ctx.stroke();
  ctx.lineCap = 'butt';
}

/** The piece most shown, an L of three, at a tile size. */
function drawPiece(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  t: number,
  angle: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = RED.base;
  for (const [cx, cy] of [
    [-1, 0],
    [0, 0],
    [0, -1],
  ] as const) {
    ctx.fillRect(cx * t - t / 2 + 1, cy * t - t / 2 + 1, t - 2, t - 2);
  }
  ctx.restore();
}

function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  colour: string,
): void {
  ctx.fillStyle = colour;
  ctx.font = `700 ${Math.round(size)}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
}

// ------------------------------------------------------------------------- pages

/** 1. The mouse: left places and fires, right or the wheel turns, Esc pauses. */
const mousePage: HowToPage = {
  caption: 'howTo.mouse',
  loopMs: 4000,
  stillMs: 1000,
  draw(ctx, w, h, ms) {
    const cx = w * 0.32;
    const cy = h * 0.5;
    const mw = h * 0.42;
    const mh = h * 0.68;
    const left = ms < 2000;
    const pressed = ms % 2000 > 600 && ms % 2000 < 900;
    // The mouse, two buttons and a wheel between them.
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(cx - mw / 2, cy - mh / 2, mw, mh, mw / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - mw / 2, cy - mh * 0.12);
    ctx.lineTo(cx + mw / 2, cy - mh * 0.12);
    ctx.moveTo(cx, cy - mh / 2);
    ctx.lineTo(cx, cy - mh * 0.12);
    ctx.stroke();
    ctx.fillStyle = ACCENT;
    ctx.globalAlpha = pressed ? 0.95 : 0.45;
    ctx.beginPath();
    if (left) {
      ctx.moveTo(cx - 2, cy - mh * 0.14);
      ctx.lineTo(cx - mw / 2 + 2, cy - mh * 0.14);
      ctx.arc(cx, cy - mh / 2 + mw / 2, mw / 2 - 2, Math.PI, Math.PI * 1.5);
      ctx.lineTo(cx - 2, cy - mh / 2 + 2);
    } else {
      ctx.moveTo(cx + 2, cy - mh * 0.14);
      ctx.lineTo(cx + mw / 2 - 2, cy - mh * 0.14);
      ctx.arc(cx, cy - mh / 2 + mw / 2, mw / 2 - 2, 0, -Math.PI * 0.5, true);
      ctx.lineTo(cx + 2, cy - mh / 2 + 2);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = left ? INK : ACCENT;
    ctx.fillRect(cx - 3, cy - mh * 0.4, 6, mh * 0.18);
    // What it does: a piece dropping into place, or turning.
    const t = h * 0.11;
    const px = w * 0.7;
    const py = h * 0.5;
    if (left) {
      const fall = ease(span(ms % 2000, 600, 1000));
      ctx.globalAlpha = 0.25;
      drawPiece(ctx, px, py, t, 0);
      ctx.globalAlpha = 1;
      drawPiece(ctx, px, py - (1 - fall) * t * 2, t, 0);
    } else {
      const turn = ease(span(ms % 2000, 600, 1000));
      drawPiece(ctx, px, py, t, (Math.PI / 2) * turn);
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, t * 2.1, -Math.PI * 0.4, Math.PI * 0.1);
      ctx.stroke();
    }
    // Esc, the one key: it pauses.
    const kx = w * 0.88;
    const ky = h * 0.84;
    ctx.strokeStyle = pal.rockMid;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(kx - h * 0.09, ky - h * 0.06, h * 0.18, h * 0.12, 4);
    ctx.stroke();
    text(ctx, 'Esc', kx, ky, h * 0.06, pal.rockLight);
    text(ctx, '❚❚', kx - h * 0.17, ky, h * 0.06, pal.rockLight);
  },
};

/** 2. The round: choose a castle, place cannons, fire, rebuild — ten times. */
const roundPage: HowToPage = {
  caption: 'howTo.round',
  loopMs: 4800,
  stillMs: 2500,
  draw(ctx, w, h, ms) {
    const lit = Math.floor(ms / 1200) % 4;
    const y = h * 0.45;
    const size = h * 0.2;
    const xs = [0.14, 0.38, 0.62, 0.86].map((f) => f * w);
    xs.forEach((x, k) => {
      ctx.globalAlpha = k === lit ? 1 : 0.35;
      ctx.strokeStyle = k === lit ? ACCENT : pal.rockMid;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, size * 0.8, 0, Math.PI * 2);
      ctx.stroke();
      if (k === 0) {
        // A castle.
        ctx.fillStyle = RED.base;
        ctx.fillRect(x - size * 0.45, y - size * 0.35, size * 0.9, size * 0.8);
        for (let b = 0; b < 3; b++)
          ctx.fillRect(x - size * 0.45 + b * size * 0.35, y - size * 0.55, size * 0.2, size * 0.25);
      } else if (k === 1) {
        // A cannon.
        ctx.fillStyle = RED.base;
        ctx.beginPath();
        ctx.arc(x, y + size * 0.1, size * 0.45, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = RED.dark;
        ctx.save();
        ctx.translate(x, y + size * 0.1);
        ctx.rotate(-Math.PI / 4);
        ctx.fillRect(-size * 0.1, -size * 0.75, size * 0.2, size * 0.6);
        ctx.restore();
      } else if (k === 2) {
        // A cannonball on its arc.
        ctx.strokeStyle = INK;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(x - size * 0.6, y + size * 0.4);
        ctx.quadraticCurveTo(x, y - size * 0.8, x + size * 0.6, y + size * 0.4);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.arc(x + size * 0.15, y - size * 0.15, size * 0.18, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Wall blocks.
        ctx.fillStyle = RED.base;
        for (let b = 0; b < 3; b++)
          ctx.fillRect(x - size * 0.6 + b * size * 0.42, y - size * 0.2, size * 0.36, size * 0.36);
        ctx.fillRect(x - size * 0.6, y + size * 0.2, size * 0.36, size * 0.36);
      }
      ctx.globalAlpha = 1;
      if (k < 3) {
        ctx.strokeStyle = pal.rockMid;
        ctx.lineWidth = 2;
        ctx.beginPath();
        const tip = xs[k + 1]! - size * 0.9;
        ctx.moveTo(x + size * 0.9, y);
        ctx.lineTo(tip, y);
        ctx.moveTo(tip - size * 0.18, y - size * 0.15);
        ctx.lineTo(tip, y);
        ctx.lineTo(tip - size * 0.18, y + size * 0.15);
        ctx.stroke();
      }
    });
    // Back round again, ten times.
    ctx.strokeStyle = pal.rockMid;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const top = y + size * 0.95;
    ctx.moveTo(xs[3]!, top);
    ctx.lineTo(xs[3]!, h * 0.85);
    ctx.lineTo(w / 2 + h * 0.12, h * 0.85);
    ctx.moveTo(w / 2 - h * 0.12, h * 0.85);
    ctx.lineTo(xs[0]!, h * 0.85);
    ctx.lineTo(xs[0]!, top);
    ctx.moveTo(xs[0]! - size * 0.15, top + size * 0.18);
    ctx.lineTo(xs[0]!, top);
    ctx.lineTo(xs[0]! + size * 0.15, top + size * 0.18);
    ctx.stroke();
    text(ctx, '×10', w / 2, h * 0.85, h * 0.09, ACCENT);
  },
};

const gapIndex = SEAL_GAP.y * SEAL_OPEN.state.width + SEAL_GAP.x;

/** 3. Close the wall round a castle: the last piece drops in, the ground floods. */
const sealPage: HowToPage = {
  caption: 'howTo.seal',
  loopMs: 4500,
  stillMs: 3200,
  draw(ctx, w, h, ms) {
    const at = fit(SEAL_CLOSED, w * 0.15, h * 0.04, w * 0.7, h * 0.92);
    const fall = ease(span(ms, 700, 1200));
    const landed = ms >= 1200;
    const b = landed ? SEAL_CLOSED : SEAL_OPEN;
    drawBoard(ctx, b, at, {
      floodTo: landed ? span(ms, 1300, 2600) * SEAL_CLOSED.floodSteps : -1,
      missing: landed ? new Set() : new Set([gapIndex]),
    });
    if (!landed) {
      // The block falling into the gap from above.
      const x = at.ox + SEAL_GAP.x * at.t;
      const y = at.oy + (SEAL_GAP.y - 3 * (1 - fall)) * at.t;
      ctx.fillStyle = RED.base;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(x + 1, y + 1, at.t - 2, at.t - 2);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2;
      ctx.strokeRect(
        at.ox + SEAL_GAP.x * at.t + 1,
        at.oy + SEAL_GAP.y * at.t + 1,
        at.t - 2,
        at.t - 2,
      );
    }
  },
};

/** 4. Walls must turn their corners: a join at a point lets the sea in. */
const cornerPage: HowToPage = {
  caption: 'howTo.corners',
  loopMs: 4000,
  stillMs: 2600,
  draw(ctx, w, h, ms) {
    const left = fit(CORNER_DIAGONAL, w * 0.03, h * 0.02, w * 0.45, h * 0.78);
    const right = fit(CORNER_TURNED, w * 0.52, h * 0.02, w * 0.45, h * 0.78);
    const maxSea = Math.max(...CORNER_SEA);
    const firstSea = Math.min(...[...CORNER_SEA].filter((s) => s >= 0));
    drawBoard(ctx, CORNER_DIAGONAL, left, {
      sea: CORNER_SEA,
      seaTo: firstSea + span(ms, 400, 2400) * (maxSea - firstSea),
      floodTo: -1,
    });
    drawBoard(ctx, CORNER_TURNED, right, {
      floodTo: span(ms, 400, 1800) * CORNER_TURNED.floodSteps,
    });
    // Ring the two corners being compared.
    for (const [b, at] of [
      [CORNER_DIAGONAL, left],
      [CORNER_TURNED, right],
    ] as const) {
      void b;
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(at.ox + 7.5 * at.t, at.oy + 2.5 * at.t, at.t * 1.3, 0, Math.PI * 2);
      ctx.stroke();
    }
    verdict(ctx, false, w * 0.25, h * 0.89, h * 0.13);
    verdict(ctx, true, w * 0.75, h * 0.89, h * 0.13);
  },
};

/** 5. Guns fire only from sealed ground; the crowned castle earns two. */
const gunsPage: HowToPage = {
  caption: 'howTo.guns',
  loopMs: 2400,
  stillMs: 900,
  draw(ctx, w, h, ms) {
    const at = fit(GUNS, w * 0.04, h * 0.04, w * 0.92, h * 0.92);
    const silent = new Set(GUNS.enclosure.cannonActive.flatMap((on, k) => (on ? [] : [k])));
    drawBoard(ctx, GUNS, at, { silent });
    // The live gun fires: a ball arcing up and away, off the board.
    GUNS.state.cannons.forEach((cannon, k) => {
      if (silent.has(k)) return;
      const t = span(ms, 300, 1500);
      if (t <= 0 || t >= 1) return;
      const x0 = at.ox + (cannon.x + 1) * at.t;
      const y0 = at.oy + (cannon.y + 1) * at.t;
      const x = x0 + t * at.t * 3;
      const y = y0 - Math.sin(Math.PI * t) * at.t * 3.5 - t * at.t * 3;
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(x, y, at.t * 0.3, 0, Math.PI * 2);
      ctx.fill();
      if (t < 0.2) {
        ctx.fillStyle = ACCENT;
        ctx.globalAlpha = 1 - t * 5;
        ctx.beginPath();
        ctx.arc(x0, y0, at.t * 1.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    });
    // The main castle's crown, and the guns it earns.
    const castle = GUNS.state.castles[0]!;
    const cx = at.ox + (castle.x + castle.w / 2) * at.t;
    const cy = at.oy + castle.y * at.t - at.t * 0.4;
    ctx.fillStyle = ACCENT;
    ctx.beginPath();
    ctx.moveTo(cx - at.t * 0.7, cy + at.t * 0.3);
    ctx.lineTo(cx - at.t * 0.7, cy - at.t * 0.3);
    ctx.lineTo(cx - at.t * 0.35, cy);
    ctx.lineTo(cx, cy - at.t * 0.45);
    ctx.lineTo(cx + at.t * 0.35, cy);
    ctx.lineTo(cx + at.t * 0.7, cy - at.t * 0.3);
    ctx.lineTo(cx + at.t * 0.7, cy + at.t * 0.3);
    ctx.fill();
    text(ctx, '+2', cx, cy - at.t * 1.1, at.t * 0.9, ACCENT);
  },
};

/** 6. Click to fire: a ball arcs onto an opponent's wall and one block breaks out. */
export const COMBAT = board(
  `
  ..............
  .,,,,,..,,,,,.
  .,,,,,..,#,,,.
  .,**,,..,#,,,.
  .,**,,..,#,,,.
  .,,,,,..,#,,,.
  .,,,,,..,,,,,.
  ..............
`,
  `
  ..............
  ........22222.
  ........22222.
  ........22222.
  ........22222.
  ........22222.
  ........22222.
  ..............
`,
);
export const COMBAT_TARGET = { x: 9, y: 3 };
const combatPage: HowToPage = {
  caption: 'howTo.fire',
  loopMs: 3600,
  stillMs: 1900,
  draw(ctx, w, h, ms) {
    const at = fit(COMBAT, w * 0.04, h * 0.04, w * 0.92, h * 0.92);
    const hit = ms >= 1700;
    const target = COMBAT_TARGET.y * COMBAT.state.width + COMBAT_TARGET.x;
    drawBoard(ctx, COMBAT, at, { missing: hit ? new Set([target]) : new Set() });
    const tx = at.ox + (COMBAT_TARGET.x + 0.5) * at.t;
    const ty = at.oy + (COMBAT_TARGET.y + 0.5) * at.t;
    // The cursor on the target, then the click.
    const click = ms > 300 && ms < 600;
    ctx.strokeStyle = click ? ACCENT : INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(tx, ty, at.t * (click ? 0.6 : 0.8), 0, Math.PI * 2);
    ctx.moveTo(tx - at.t, ty);
    ctx.lineTo(tx + at.t, ty);
    ctx.moveTo(tx, ty - at.t);
    ctx.lineTo(tx, ty + at.t);
    ctx.stroke();
    // The ball on its way.
    const flight = span(ms, 500, 1700);
    if (flight > 0 && flight < 1) {
      const x0 = at.ox + 3 * at.t;
      const y0 = at.oy + 4 * at.t;
      const x = x0 + (tx - x0) * flight;
      const y = y0 + (ty - y0) * flight - Math.sin(Math.PI * flight) * at.t * 3;
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(x, y, at.t * 0.3 * (1 + 0.5 * Math.sin(Math.PI * flight)), 0, Math.PI * 2);
      ctx.fill();
    }
    // The block breaking out: a flash and pieces flying.
    const burst = span(ms, 1700, 2500);
    if (burst > 0 && burst < 1) {
      ctx.fillStyle = ACCENT;
      ctx.globalAlpha = 1 - burst;
      ctx.beginPath();
      ctx.arc(tx, ty, at.t * (0.5 + burst), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = BLUE.base;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const d = at.t * 1.6 * burst;
        ctx.fillRect(
          tx + Math.cos(a) * d - at.t * 0.15,
          ty + Math.sin(a) * d - at.t * 0.15 + burst * burst * at.t,
          at.t * 0.3,
          at.t * 0.3,
        );
      }
    }
  },
};

/** 7. Score and lives: sealed ground scores; a ring left open costs a life. */
const scorePage: HowToPage = {
  caption: 'howTo.score',
  loopMs: 4400,
  stillMs: 3000,
  draw(ctx, w, h, ms) {
    const left = fit(SEAL_CLOSED, w * 0.02, h * 0.18, w * 0.46, h * 0.64);
    const right = fit(SEAL_OPEN, w * 0.52, h * 0.18, w * 0.46, h * 0.64);
    drawBoard(ctx, SEAL_CLOSED, left);
    drawBoard(ctx, SEAL_OPEN, right, { missing: new Set([gapIndex]), floodTo: -1 });
    // Points rising off the sealed ring into the score.
    const rise = span(ms, 300, 1500);
    const score = Math.round(60 + 64 * ease(span(ms, 900, 1800)));
    text(ctx, String(score), w * 0.25, h * 0.09, h * 0.1, INK);
    if (rise > 0 && rise < 1) {
      ctx.globalAlpha = 1 - rise;
      text(ctx, '+64', w * 0.25, h * 0.5 - rise * h * 0.35, h * 0.08, ACCENT);
      ctx.globalAlpha = 1;
    }
    // Lives under the open ring: the last of three goes dark, with a flash of red.
    const lost = ms >= 2000;
    for (let k = 0; k < 3; k++) {
      const x = w * 0.75 + (k - 1) * h * 0.09;
      const y = h * 0.09;
      const on = k < 2 || !lost;
      ctx.fillStyle = on ? INK : 'transparent';
      ctx.strokeStyle = on ? INK : BAD;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, h * 0.03, 0, Math.PI * 2);
      if (on) ctx.fill();
      ctx.stroke();
    }
    const flash = span(ms, 2000, 2700);
    if (flash > 0 && flash < 1) {
      ctx.strokeStyle = BAD;
      ctx.globalAlpha = 1 - flash;
      ctx.lineWidth = 4;
      ctx.strokeRect(
        right.ox,
        right.oy,
        right.t * SEAL_OPEN.state.width,
        right.t * SEAL_OPEN.state.height,
      );
      ctx.globalAlpha = 1;
    }
    verdict(ctx, true, w * 0.25, h * 0.92, h * 0.11);
    verdict(ctx, false, w * 0.75, h * 0.92, h * 0.11);
  },
};

/**
 * 8. Tournaments (docs/TOURNAMENT.md): a bracket of eight, the player's team in blue winning
 * its way along to the final, each other match's winner going on in grey, the cup lit last.
 */
const tournamentPage: HowToPage = {
  caption: 'howTo.tournament',
  loopMs: 5200,
  stillMs: 4200,
  draw(ctx, w, h, ms) {
    const rounds = [8, 4, 2, 1];
    const boxW = w * 0.14;
    const boxH = h * 0.075;
    const columnX = (r: number): number => w * (0.06 + r * 0.24);
    const rowY = (r: number, i: number): number => {
      const n = rounds[r] as number;
      return h * 0.1 + ((i + 0.5) * (h * 0.8)) / n;
    };
    // The player's team is the third of the first round; it wins every match.
    const mine = (r: number): number => Math.floor(2 / 2 ** r);
    // A round's winners come in one after the other, the player's last of all.
    const reached = (r: number): number => span(ms, 600 + (r - 1) * 1200, 1300 + (r - 1) * 1200);
    rounds.forEach((n, r) => {
      for (let i = 0; i < n; i++) {
        const x = columnX(r);
        const y = rowY(r, i);
        const shown = r === 0 ? 1 : reached(r);
        if (r > 0) {
          // The lines from the two boxes of the round before.
          ctx.strokeStyle = INK;
          ctx.globalAlpha = 0.35;
          ctx.lineWidth = 2;
          for (const from of [2 * i, 2 * i + 1]) {
            ctx.beginPath();
            ctx.moveTo(columnX(r - 1) + boxW, rowY(r - 1, from));
            ctx.lineTo(x - w * 0.03, rowY(r - 1, from));
            ctx.lineTo(x - w * 0.03, y);
            ctx.lineTo(x, y);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
        if (shown <= 0) continue;
        const ours = i === mine(r);
        ctx.globalAlpha = shown;
        ctx.fillStyle = ours ? BLUE.base : 'rgba(255,255,255,0.18)';
        ctx.fillRect(x, y - boxH / 2, boxW, boxH);
        if (ours) {
          ctx.strokeStyle = ACCENT;
          ctx.lineWidth = 2;
          ctx.strokeRect(x, y - boxH / 2, boxW, boxH);
        }
        ctx.globalAlpha = 1;
      }
    });
    // The cup over the final, once the player's team is in it and has won it.
    const cup = span(ms, 4000, 4600);
    if (cup > 0) {
      ctx.globalAlpha = cup;
      text(ctx, '\u{1F3C6}', columnX(3) + boxW / 2, rowY(3, 0) - h * 0.14, h * 0.13, ACCENT);
      ctx.globalAlpha = 1;
    }
  },
};

export const HOW_TO_PLAY: readonly HowToPage[] = [
  mousePage,
  roundPage,
  sealPage,
  cornerPage,
  gunsPage,
  combatPage,
  scorePage,
  tournamentPage,
];

// ----------------------------------------------------------------------- overlay

const SEEN_KEY = 'bollwerk.howToPlaySeen';

/** Whether the pages have ever been opened here: until then the menu's button stands out. */
export function howToPlaySeen(): boolean {
  return stored(SEEN_KEY) === '1';
}

/**
 * Opens the pages over whatever is on screen. Mouse only: Back and Next, a page count,
 * Close, and a click outside the panel closes it too.
 */
export function openHowToPlay(onClose: () => void = () => {}, click: () => void = () => {}): void {
  store(SEEN_KEY, '1');
  const root = document.createElement('div');
  root.className = 'how-to-play';
  root.innerHTML = `
    <div class="panel">
      <canvas width="480" height="300"></canvas>
      <p class="caption"></p>
      <div class="nav">
        <button class="back" aria-label="${t('howTo.back')}">‹</button>
        <span class="count"></span>
        <button class="next" aria-label="${t('howTo.next')}">›</button>
      </div>
      <button class="close quiet">${t('howTo.close')}</button>
    </div>`;
  document.body.append(root);
  const canvas = root.querySelector('canvas')!;
  const caption = root.querySelector<HTMLElement>('.caption')!;
  const count = root.querySelector<HTMLElement>('.count')!;
  const back = root.querySelector<HTMLButtonElement>('.back')!;
  const next = root.querySelector<HTMLButtonElement>('.next')!;
  const ratio = Math.max(1, Math.round(globalThis.devicePixelRatio ?? 1));
  const cssW = 480;
  const cssH = 300;
  canvas.width = cssW * ratio;
  canvas.height = cssH * ratio;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext('2d')!;
  let page = 0;
  let since = performance.now();
  let frame = 0;

  const show = (to: number): void => {
    page = Math.max(0, Math.min(HOW_TO_PLAY.length - 1, to));
    since = performance.now();
    const current = HOW_TO_PLAY[page]!;
    caption.textContent = t(current.caption);
    count.textContent = `${page + 1} / ${HOW_TO_PLAY.length}`;
    back.disabled = page === 0;
    next.disabled = page === HOW_TO_PLAY.length - 1;
  };
  const draw = (now: number): void => {
    const current = HOW_TO_PLAY[page]!;
    const ms = motionReduced() ? current.stillMs : (now - since) % current.loopMs;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = pal.waterDeep;
    ctx.fillRect(0, 0, cssW, cssH);
    current.draw(ctx, cssW, cssH, ms);
    frame = requestAnimationFrame(draw);
  };
  const close = (): void => {
    cancelAnimationFrame(frame);
    root.remove();
    onClose();
  };
  back.addEventListener('click', () => {
    click();
    show(page - 1);
  });
  next.addEventListener('click', () => {
    click();
    show(page + 1);
  });
  root.querySelector('.close')?.addEventListener('click', () => {
    click();
    close();
  });
  root.addEventListener('click', (event) => {
    if (event.target === root) close();
  });
  show(0);
  frame = requestAnimationFrame(draw);
}
