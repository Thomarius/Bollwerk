import type { Graphics } from 'pixi.js';

import type { Clan } from './figures.js';

/**
 * Each clan's emblem, for its magic circles (ARCHIVE 14w): a fist, a flame, a teacup,
 * glasses, a crosshair, crossed swords, a gear and a star. Drawn in white at (`x`, `y`), `r`
 * across, so a stamp of the circle takes the owner's colour as its tint.
 */
export function drawEmblem(g: Graphics, clan: Clan, x: number, y: number, r: number): void {
  const w = Math.max(1, r * 0.22);
  const line = { width: w, color: 0xffffff, cap: 'round', join: 'round' } as const;
  switch (clan) {
    case 'karate':
      // A fist: knuckles over a palm.
      g.roundRect(x - r * 0.6, y - r * 0.35, r * 1.2, r * 0.9, r * 0.25);
      g.stroke(line);
      for (const k of [-0.3, 0, 0.3]) {
        g.moveTo(x + k * r, y - r * 0.35).lineTo(x + k * r, y + r * 0.05);
      }
      g.stroke({ ...line, width: w * 0.7 });
      break;
    case 'mage':
      g.moveTo(x, y - r)
        .quadraticCurveTo(x + r * 0.75, y - r * 0.1, x + r * 0.45, y + r * 0.6)
        .quadraticCurveTo(x, y + r * 0.9, x - r * 0.45, y + r * 0.6)
        .quadraticCurveTo(x - r * 0.75, y - r * 0.1, x, y - r);
      g.stroke(line);
      break;
    case 'maid':
      g.moveTo(x - r * 0.6, y - r * 0.3)
        .lineTo(x + r * 0.5, y - r * 0.3)
        .lineTo(x + r * 0.35, y + r * 0.45)
        .lineTo(x - r * 0.45, y + r * 0.45)
        .closePath();
      g.stroke(line);
      g.circle(x + r * 0.62, y, r * 0.22);
      g.stroke(line);
      g.moveTo(x - r * 0.85, y + r * 0.65).lineTo(x + r * 0.75, y + r * 0.65);
      g.stroke(line);
      break;
    case 'genius':
      for (const s of [-1, 1]) {
        g.roundRect(x + s * r * 0.5 - r * 0.38, y - r * 0.28, r * 0.76, r * 0.56, r * 0.15);
      }
      g.stroke(line);
      g.moveTo(x - r * 0.12, y).lineTo(x + r * 0.12, y);
      g.stroke(line);
      break;
    case 'soldier':
      g.circle(x, y, r * 0.65);
      g.stroke(line);
      g.moveTo(x - r, y).lineTo(x - r * 0.3, y);
      g.moveTo(x + r * 0.3, y).lineTo(x + r, y);
      g.moveTo(x, y - r).lineTo(x, y - r * 0.3);
      g.moveTo(x, y + r * 0.3).lineTo(x, y + r);
      g.stroke(line);
      break;
    case 'sword':
      g.moveTo(x - r * 0.75, y + r * 0.75).lineTo(x + r * 0.75, y - r * 0.75);
      g.moveTo(x + r * 0.75, y + r * 0.75).lineTo(x - r * 0.75, y - r * 0.75);
      g.stroke(line);
      g.moveTo(x - r * 0.75, y + r * 0.2).lineTo(x - r * 0.2, y + r * 0.75);
      g.moveTo(x + r * 0.75, y + r * 0.2).lineTo(x + r * 0.2, y + r * 0.75);
      g.stroke(line);
      break;
    case 'mecha': {
      const pts: number[] = [];
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const k = i % 2 === 0 ? 1 : 0.72;
        pts.push(x + Math.cos(a) * r * k, y + Math.sin(a) * r * k);
      }
      g.poly(pts);
      g.stroke(line);
      g.circle(x, y, r * 0.28);
      g.stroke(line);
      break;
    }
    case 'idol': {
      const pts: number[] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
        const k = i % 2 === 0 ? 1 : 0.45;
        pts.push(x + Math.cos(a) * r * k, y + Math.sin(a) * r * k);
      }
      g.poly(pts);
      g.stroke(line);
      break;
    }
  }
}
