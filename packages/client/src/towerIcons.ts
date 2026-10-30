import type { SpecialKind } from '@bollwerk/config';

/**
 * The towers' emblems and the cannon's icon, as shapes in a unit box: drawn on the board by
 * `TowerMarks` and as SVG beside the cursor (`placeIconsHtml`), so both are one mark. No Pixi
 * here, so the page's labels can use it.
 */

/** Each emblem as a polygon in a unit box, its top left at 0,0: simple shapes a tile wide. */
export const EMBLEMS: Record<SpecialKind, readonly (readonly number[])[]> = {
  // A heavy shell standing on its base.
  bertha: [
    [0.32, 1, 0.68, 1, 0.68, 0.46, 0.62, 0.24, 0.5, 0.04, 0.38, 0.24, 0.32, 0.46],
    [0.26, 1, 0.74, 1, 0.74, 0.86, 0.26, 0.86],
  ],
  // A hammer: its head, and the handle under it.
  architect: [
    [0.12, 0.1, 0.88, 0.1, 0.88, 0.4, 0.12, 0.4],
    [0.41, 0.4, 0.59, 0.4, 0.59, 1, 0.41, 1],
  ],
  // Two chevrons, pointing up: speed.
  rapid: [
    [0.1, 0.42, 0.5, 0, 0.9, 0.42, 0.9, 0.62, 0.5, 0.22, 0.1, 0.62],
    [0.1, 0.8, 0.5, 0.38, 0.9, 0.8, 0.9, 1, 0.5, 0.6, 0.1, 1],
  ],
  // A lightning bolt, falling left to right.
  lightning: [[0.6, 0, 0.18, 0.56, 0.46, 0.56, 0.32, 1, 0.82, 0.38, 0.54, 0.38, 0.74, 0]],
  // A round bomb, its fuse lit: bigger than anything Bertha fires.
  biggest: [
    [
      0.78, 0.6, 0.753, 0.738, 0.675, 0.855, 0.558, 0.933, 0.42, 0.96, 0.282, 0.933, 0.165, 0.855,
      0.087, 0.738, 0.06, 0.6, 0.087, 0.462, 0.165, 0.345, 0.282, 0.267, 0.42, 0.24, 0.558, 0.267,
      0.675, 0.345, 0.753, 0.462,
    ],
    [0.6, 0.3, 0.72, 0.18, 0.84, 0.3, 0.72, 0.42],
    [
      0.86, 0, 0.888, 0.092, 0.99, 0.12, 0.888, 0.148, 0.86, 0.25, 0.832, 0.148, 0.73, 0.12, 0.832,
      0.092,
    ],
  ],
  // A lens at the foot, its beam drawn out to the top right corner.
  laser: [
    [0.06, 0.94, 0.06, 0.62, 0.38, 0.62, 0.38, 0.94],
    [0.3, 0.6, 0.86, 0.04, 0.96, 0.14, 0.4, 0.7],
    [0.56, 0.12, 0.62, 0.02, 0.66, 0.16, 0.76, 0.22, 0.64, 0.24, 0.6, 0.34, 0.56, 0.24, 0.46, 0.2],
  ],
  // A snowflake: three bars across, two branches at each arm's end.
  frost: [
    [0.445, 0.02, 0.445, 0.98, 0.555, 0.98, 0.555, 0.02],
    [0.888, 0.212, 0.057, 0.692, 0.112, 0.788, 0.943, 0.308],
    [0.943, 0.692, 0.112, 0.212, 0.057, 0.308, 0.888, 0.788],
    [0.472, 0.798, 0.592, 0.918, 0.648, 0.862, 0.528, 0.742],
    [0.472, 0.742, 0.352, 0.862, 0.408, 0.918, 0.528, 0.798],
    [0.228, 0.625, 0.184, 0.789, 0.261, 0.81, 0.305, 0.645],
    [0.277, 0.596, 0.112, 0.552, 0.092, 0.63, 0.256, 0.674],
    [0.256, 0.326, 0.092, 0.37, 0.112, 0.448, 0.277, 0.404],
    [0.305, 0.355, 0.261, 0.19, 0.184, 0.211, 0.228, 0.375],
    [0.528, 0.202, 0.408, 0.082, 0.352, 0.138, 0.472, 0.258],
    [0.528, 0.258, 0.648, 0.138, 0.592, 0.082, 0.472, 0.202],
    [0.772, 0.375, 0.816, 0.211, 0.739, 0.19, 0.695, 0.355],
    [0.723, 0.404, 0.888, 0.448, 0.908, 0.37, 0.744, 0.326],
    [0.744, 0.674, 0.908, 0.63, 0.888, 0.552, 0.723, 0.596],
    [0.695, 0.645, 0.739, 0.81, 0.816, 0.789, 0.772, 0.625],
  ],
  // A crescent moon: the Lullaby Tower's.
  lullaby: [
    [
      0.92, 0.687, 0.898, 0.73, 0.872, 0.77, 0.842, 0.808, 0.808, 0.842, 0.77, 0.872, 0.73, 0.898,
      0.687, 0.92, 0.642, 0.937, 0.596, 0.95, 0.548, 0.957, 0.5, 0.96, 0.452, 0.957, 0.404, 0.95,
      0.358, 0.937, 0.313, 0.92, 0.27, 0.898, 0.23, 0.872, 0.192, 0.842, 0.158, 0.808, 0.128, 0.77,
      0.102, 0.73, 0.08, 0.687, 0.063, 0.642, 0.05, 0.596, 0.043, 0.548, 0.04, 0.5, 0.043, 0.452,
      0.05, 0.404, 0.063, 0.358, 0.08, 0.313, 0.102, 0.27, 0.128, 0.23, 0.158, 0.192, 0.192, 0.158,
      0.23, 0.128, 0.27, 0.102, 0.313, 0.08, 0.358, 0.063, 0.404, 0.05, 0.452, 0.043, 0.477, 0.053,
      0.446, 0.078, 0.418, 0.106, 0.393, 0.137, 0.371, 0.17, 0.353, 0.205, 0.339, 0.243, 0.328,
      0.281, 0.322, 0.32, 0.32, 0.36, 0.322, 0.4, 0.328, 0.439, 0.339, 0.477, 0.353, 0.515, 0.371,
      0.55, 0.393, 0.583, 0.418, 0.614, 0.446, 0.642, 0.477, 0.667, 0.51, 0.689, 0.545, 0.707,
      0.583, 0.721, 0.621, 0.732, 0.66, 0.738, 0.7, 0.74, 0.74, 0.738, 0.779, 0.732, 0.817, 0.721,
      0.855, 0.707, 0.89, 0.689, 0.923, 0.667,
    ],
  ],
  // A loudspeaker sounding to the right: its magnet, its cone and two waves.
  subwoofer: [
    [0.06, 0.36, 0.22, 0.36, 0.22, 0.64, 0.06, 0.64],
    [0.22, 0.36, 0.44, 0.14, 0.44, 0.86, 0.22, 0.64],
    [
      0.601, 0.308, 0.649, 0.363, 0.679, 0.428, 0.69, 0.5, 0.679, 0.572, 0.649, 0.637, 0.601, 0.692,
      0.549, 0.63, 0.582, 0.593, 0.603, 0.549, 0.61, 0.5, 0.603, 0.451, 0.582, 0.407, 0.549, 0.37,
    ],
    [
      0.716, 0.171, 0.799, 0.264, 0.852, 0.377, 0.87, 0.5, 0.852, 0.623, 0.799, 0.736, 0.716, 0.829,
      0.659, 0.76, 0.724, 0.687, 0.766, 0.598, 0.78, 0.5, 0.766, 0.402, 0.724, 0.313, 0.659, 0.24,
    ],
  ],
};

/** A cannon seen from the side, for the icons: a barrel raised over a wheel, in a unit box. */
const CANNON: readonly (readonly number[])[] = [
  [0.08, 0.5, 0.78, 0.12, 0.92, 0.36, 0.22, 0.74],
  [0.18, 0.62, 0.5, 0.62, 0.5, 0.94, 0.18, 0.94],
];

function points(part: readonly number[]): string {
  const out: string[] = [];
  for (let i = 0; i < part.length; i += 2) {
    out.push(
      `${((part[i] as number) * 16).toFixed(1)},${((part[i + 1] as number) * 16).toFixed(1)}`,
    );
  }
  return out.join(' ');
}

/** A cannon's icon, 16 units square, in this CSS colour. */
export function cannonSvg(colour: string): string {
  return (
    `<svg class="icon cannon" viewBox="0 0 16 16" aria-hidden="true">` +
    CANNON.map((p) => `<polygon points="${points(p)}" fill="${colour}"/>`).join('') +
    `<circle cx="5.4" cy="12.4" r="3" fill="${colour}"/></svg>`
  );
}

/** A die showing five, for a bot's tower left to the draw (the lobby, the tower menu). */
export function dieSvg(colour: string): string {
  const pips = [
    [4.5, 4.5],
    [11.5, 4.5],
    [8, 8],
    [4.5, 11.5],
    [11.5, 11.5],
  ]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.4" fill="${colour}"/>`)
    .join('');
  return (
    `<svg class="icon die" viewBox="0 0 16 16" aria-hidden="true">` +
    `<rect x="1.5" y="1.5" width="13" height="13" rx="2.5" fill="none" stroke="${colour}" stroke-width="1.4"/>` +
    `${pips}</svg>`
  );
}

/** The icons' side in the row, `.place-icons .icon`'s 1.3rem, in CSS pixels; read once. */
let iconPx = 0;

/** The side, in CSS pixels, a cannon's icon is rendered at for the row (`cannonImg`). */
export function placeIconPx(): number {
  if (iconPx === 0) {
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    iconPx = Math.round(1.3 * (Number.isFinite(rem) && rem > 0 ? rem : 16));
  }
  return iconPx;
}

/**
 * A cannon's icon in the style on screen: an image the scene rendered (`Scene.cannonIcon`),
 * sized as the generic one is by the same class, so the two compare at one size.
 */
export function cannonImg(url: string): string {
  return `<img class="icon cannon styled" src="${url}" alt="" aria-hidden="true">`;
}

/** A tower's emblem on its dark badge, as the board shows it, in this CSS colour. */
export function towerSvg(kind: SpecialKind, colour: string): string {
  // The emblem at 68% of the badge, as on the board (`INNER`).
  const inner = EMBLEMS[kind]
    .map((p) => `<polygon points="${points(p)}" fill="${colour}"/>`)
    .join('');
  return (
    `<svg class="icon tower" viewBox="0 0 16 16" aria-hidden="true">` +
    `<circle cx="8" cy="8" r="7.4" fill="#0a0a12" fill-opacity="0.85" stroke="${colour}" stroke-width="1"/>` +
    `<g transform="translate(2.56 2.56) scale(0.68)">${inner}</g></svg>`
  );
}

/** A mouse with its right button lit: what the hint asks to be pressed. */
export function rightClickSvg(colour: string): string {
  return (
    `<svg class="icon mouse" viewBox="0 0 16 16" aria-hidden="true">` +
    `<rect x="3.5" y="1" width="9" height="14" rx="4.5" fill="none" stroke="currentColor" stroke-width="1.2"/>` +
    `<path d="M8 1.2 V6.6 H12.4 V5.5 A4.4 4.4 0 0 0 8 1.2 Z" fill="${colour}"/>` +
    `<line x1="8" y1="1.4" x2="8" y2="6.6" stroke="currentColor" stroke-width="1"/>` +
    `<line x1="3.6" y1="6.6" x2="12.4" y2="6.6" stroke="currentColor" stroke-width="1"/></svg>`
  );
}

/** Most icons shown in the row; more are told as a number after them. */
const MAX_ICONS = 8;

/**
 * The cannon phase beside the cursor (play-testing, 2026-10-16): a row of icons, one a cannon
 * still to place, where a number had looked like the combat's count of guns ready. With the
 * tower chosen, the next placement is the tower's icon and the cannons it costs leave the
 * row. None left, or no room for one: a single grey cannon, struck through.
 */
export function placeIconsHtml(
  cannons: number,
  tower: { kind: SpecialKind; cost: number } | null,
  colour: string,
  cannon: string | null = null,
): string {
  // The style's own gun greyed by the page (`.none .styled`), the generic one drawn grey.
  if (cannons <= 0) return `<span class="none">${cannon ?? cannonSvg('#8a8a9a')}</span>`;
  const icons: string[] = [];
  let left = cannons;
  if (tower !== null && left >= tower.cost) {
    icons.push(towerSvg(tower.kind, colour));
    left -= tower.cost;
  }
  const shown = Math.min(left, MAX_ICONS - icons.length);
  const one = cannon ?? cannonSvg(colour);
  for (let k = 0; k < shown; k++) icons.push(one);
  if (left > shown) icons.push(`<b>+${left - shown}</b>`);
  return icons.join('');
}

/**
 * The right button's hint under the icons, while it would switch: the mouse, a turning arrow,
 * and what a click switches to — the tower's emblem, or a cannon back from it, `cannon` where
 * given (the row's own, `placeIconsHtml`).
 */
export function switchHintHtml(
  kind: SpecialKind,
  toTower: boolean,
  colour: string,
  cannon: string | null = null,
): string {
  return (
    rightClickSvg(colour) +
    `<span class="turn" aria-hidden="true">↻</span>` +
    (toTower ? towerSvg(kind, colour) : (cannon ?? cannonSvg(colour)))
  );
}
