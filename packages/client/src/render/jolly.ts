import type { Graphics } from 'pixi.js';

/**
 * What the Pirates style shares with the finish every style draws (ARCHIVE 14q): the skull and
 * crossbones of the Jolly Roger, a gold doubloon and a jewel. Gold and bone are no player's
 * colour; the jewels are the owner's.
 */

/** Doubloon gold, its rim and its shine. */
export const DOUBLOON = 0xf0c048;
export const DOUBLOON_RIM = 0x8a6414;
export const DOUBLOON_SHINE = 0xfff0b0;
/** Bone, for the skull and crossbones. */
export const BONE = 0xf6f0e0;
/** Tarred timber: masts, poles, a fort's darkest beams. */
export const TAR = 0x3a2614;

/**
 * A skull over crossed bones, centred at (x, y), `r` the skull's radius: in `colour`, its eyes
 * and nose holes in `hole`, the cloth it is sewn on.
 */
export function drawSkullAndBones(
  g: Graphics,
  x: number,
  y: number,
  r: number,
  colour: number,
  hole: number,
  alpha = 1,
): void {
  // The bones, crossed behind the skull's jaw, each with a knuckle at both ends.
  const reach = r * 1.35;
  const by = y + r * 0.55;
  for (const side of [-1, 1]) {
    g.moveTo(x - reach, by - side * reach * 0.62).lineTo(x + reach, by + side * reach * 0.62);
  }
  g.stroke({ width: Math.max(1, r * 0.34), color: colour, alpha, cap: 'round' });
  for (const [ex, ey] of [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ] as const) {
    const kx = x + ex * reach;
    const ky = by + ey * reach * 0.62;
    g.circle(kx, ky - r * 0.12, r * 0.2);
    g.circle(kx, ky + r * 0.12, r * 0.2);
  }
  g.fill({ color: colour, alpha });
  // The skull: a dome and a narrower jaw.
  g.circle(x, y - r * 0.1, r);
  g.roundRect(x - r * 0.6, y + r * 0.3, r * 1.2, r * 0.6, r * 0.15);
  g.fill({ color: colour, alpha });
  g.circle(x - r * 0.38, y, r * 0.28);
  g.circle(x + r * 0.38, y, r * 0.28);
  g.poly([x, y + r * 0.25, x - r * 0.12, y + r * 0.5, x + r * 0.12, y + r * 0.5]);
  g.fill({ color: hole, alpha });
}

/**
 * A doubloon at (x, y), `r` its radius, spinning: `turn` its angle about its upright axis, so
 * it narrows to its edge and widens again.
 */
export function drawDoubloon(
  g: Graphics,
  x: number,
  y: number,
  r: number,
  turn: number,
  alpha = 1,
): void {
  const w = Math.max(r * 0.12, r * Math.abs(Math.cos(turn)));
  g.ellipse(x, y, w, r);
  g.fill({ color: DOUBLOON, alpha });
  g.stroke({ width: Math.max(1, r * 0.22), color: DOUBLOON_RIM, alpha });
  if (w > r * 0.4) {
    g.ellipse(x - w * 0.2, y - r * 0.2, w * 0.35, r * 0.3);
    g.fill({ color: DOUBLOON_SHINE, alpha: alpha * 0.8 });
  }
}

/** A cut jewel at (x, y), `r` across, turned by `angle`, in `colour` with a white glint. */
export function drawJewel(
  g: Graphics,
  x: number,
  y: number,
  r: number,
  angle: number,
  colour: number,
  alpha = 1,
): void {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const at = (u: number, v: number): [number, number] => [x + c * u - s * v, y + s * u + c * v];
  g.poly([...at(0, -r), ...at(r * 0.8, -r * 0.2), ...at(0, r), ...at(-r * 0.8, -r * 0.2)]);
  g.fill({ color: colour, alpha });
  g.poly([...at(0, -r), ...at(r * 0.35, -r * 0.2), ...at(0, r * 0.1), ...at(-r * 0.35, -r * 0.2)]);
  g.fill({ color: 0xffffff, alpha: alpha * 0.45 });
}
