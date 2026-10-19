import { hash } from '../noise.js';

/**
 * The Sports style's sea: the stands, a crowd seen from above in rows of seats, drawn once on a
 * small canvas and laid into the sea as a repeating fill, in screen space — a few vertices for
 * the whole sea, as Noir's hatching (ARCHIVE 12zn). Drawn again only when the tile size
 * changes, so a spectator is always a tile's fraction.
 *
 * The same crowd is drawn twice: seated, and on its feet with its arms up. The wave going round
 * when a castle is sealed is a band of the second laid over the first, both in screen space, so
 * every spectator stands up where they sat.
 */

/** Seats across one repeat of the pattern, between two aisles. */
const SEATS = 16;
/** An aisle's width, in seats. */
const AISLE = 1.3;
/** Rows of seats in one repeat. */
const ROWS = 6;

const SHIRTS: readonly string[] = [
  '#c84a4a',
  '#3a6ac0',
  '#e0c050',
  '#e8e8e8',
  '#3a3a3a',
  '#4aa070',
  '#e07a30',
  '#8a5ac0',
  '#d070a0',
  '#e8e8e8',
];
const HAIR: readonly string[] = ['#2a1d14', '#4a3020', '#141414', '#c8a050', '#8a8a8a', '#7a3a1a'];
const SKIN: readonly string[] = ['#f0c8a0', '#d8a878', '#a87048', '#704828'];
const SEAT = '#2c4c8c';
const SEAT_DARK = '#1c3264';
const CONCRETE = '#9a9ca2';
const RISER = '#6a6c72';

/** One repeat of the stands for a tile of `tile` pixels: width and height of the canvas. */
export function standsSize(tile: number): { width: number; height: number } {
  const pitch = tile * 0.56;
  return {
    width: Math.round(pitch * (SEATS + AISLE)),
    height: Math.round(tile * 0.72 * ROWS),
  };
}

/**
 * Draws one repeat of the stands into `ctx`, from its origin: seated, or on its feet with its
 * arms up (`standing`). The same people either way, by their seat.
 */
export function drawStands(ctx: CanvasRenderingContext2D, tile: number, standing: boolean): void {
  const { width, height } = standsSize(tile);
  const pitch = width / (SEATS + AISLE);
  const row = height / ROWS;
  ctx.fillStyle = CONCRETE;
  ctx.fillRect(0, 0, width, height);
  for (let r = 0; r < ROWS; r++) {
    const y = r * row;
    // The step: concrete in front, the riser's shadow at its back, the row of seats on it.
    ctx.fillStyle = RISER;
    ctx.fillRect(0, y, width, row * 0.1);
    ctx.fillStyle = SEAT_DARK;
    ctx.fillRect(0, y + row * 0.1, SEATS * pitch, row * 0.62);
    for (let s = 0; s < SEATS; s++) {
      const cx = (s + 0.5) * pitch;
      const h = (k: number): number => hash(s, r, k);
      ctx.fillStyle = SEAT;
      roundRect(ctx, cx - pitch * 0.4, y + row * 0.16, pitch * 0.8, row * 0.5, pitch * 0.12);
      if (h(1) < 0.1) continue;
      const shirt = pick(SHIRTS, h(2));
      const hair = pick(HAIR, h(3));
      const skin = pick(SKIN, h(4));
      const up = standing ? row * 0.2 : 0;
      const sway = (h(5) - 0.5) * pitch * 0.12;
      if (standing) {
        // Arms up, a line each side above the shoulders.
        ctx.strokeStyle = skin;
        ctx.lineWidth = Math.max(1, pitch * 0.14);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx + sway - pitch * 0.3, y + row * 0.42 - up);
        ctx.lineTo(cx + sway - pitch * 0.38, y + row * 0.02 - up);
        ctx.moveTo(cx + sway + pitch * 0.3, y + row * 0.42 - up);
        ctx.lineTo(cx + sway + pitch * 0.38, y + row * 0.02 - up);
        ctx.stroke();
      }
      ctx.fillStyle = shirt;
      ctx.beginPath();
      ctx.ellipse(cx + sway, y + row * 0.5 - up, pitch * 0.4, row * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = h(6) < 0.15 ? shirt : hair;
      ctx.beginPath();
      ctx.arc(cx + sway, y + row * 0.36 - up, pitch * 0.21, 0, Math.PI * 2);
      ctx.fill();
    }
    // The aisle's steps, half a row each.
    const ax = SEATS * pitch;
    for (let k = 0; k < 2; k++) {
      ctx.fillStyle = k === 0 ? '#b0b2b8' : CONCRETE;
      ctx.fillRect(ax, y + k * row * 0.5, width - ax, row * 0.5);
    }
    ctx.fillStyle = '#e8d040';
    ctx.fillRect(ax, y + row * 0.46, width - ax, Math.max(1, row * 0.04));
  }
  // Toned into the stands' navy, so the crowd is a ground for the pitches and not a rival to
  // them; less on its feet, so the wave stands out of it.
  ctx.fillStyle = standing ? 'rgba(18, 26, 52, 0.18)' : 'rgba(18, 26, 52, 0.42)';
  ctx.fillRect(0, 0, width, height);
}

function pick(list: readonly string[], at: number): string {
  return list[Math.floor(at * list.length)] ?? '#808080';
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}
