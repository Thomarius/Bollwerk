import type { ArtConfig } from '@bollwerk/config';
import { Rng } from '@bollwerk/sim';

import type { Texture } from 'pixi.js';

import { Atlas, Pixels } from './canvas.js';
import { SEA_NE, SEA_NW, SEA_SE, SEA_SW, coastDistance, filletDistance } from './coast.js';

/**
 * Every sprite in the game, drawn from code.
 *
 * Nothing here is authored art and nothing is loaded from disk. Terrain, walls,
 * castles and cannons are generated in neutral stone and grass and tinted per player
 * at draw time, which keeps the atlas small and means the two visual styles cannot
 * drift apart on colour: both read the same palette.
 *
 * Generation is seeded, so the same map always produces the same speckle.
 */

export const KEY = {
  water: (frame: number, variant: number) => `water.${variant}.${frame}`,
  grass: (variant: number) => `grass.${variant}`,
  rock: (variant: number) => `rock.${variant}`,
  shore: (mask: number) => `shore.${mask}`,
  beach: (mask: number) => `beach.${mask}`,
  fillet: (corner: number) => `fillet.${corner}`,
  wall: (mask: number, damage: number) => `wall.${mask}.${damage}`,
  rubble: (variant: number) => `rubble.${variant}`,
  court: (variant: number) => `court.${variant}`,
  foam: (mask: number) => `foam.${mask}`,
  scenery: (kind: string, variant: number) => `scenery.${kind}.${variant}`,
  castle: 'castle',
  banner: (frame: number) => `banner.${frame}`,
  cannon: 'cannon',
  barrel: (step: number, recoil: number) => `barrel.${step}.${recoil}`,
  carriage: (step: number, recoil: number) => `carriage.${step}.${recoil}`,
  droop: (step: number) => `droop.${step}`,
  shot: 'shot',
  crater: (variant: number) => `crater.${variant}`,
  blast: (frame: number) => `blast.${frame}`,
} as const;

/** Adjacency bitmask order: north, east, south, west. */
export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;

/** The corners a sea tile may be filled in at, as the shore mask's diagonal bits. */
export const FILLET_CORNERS = [SEA_NW, SEA_NE, SEA_SE, SEA_SW] as const;

/**
 * Where a castle's windows are, as fractions of its sprite: the keep's two and a slit in
 * each front tower. They are dark in the sprite and lit over it while the castle is
 * sealed, since a tinted sprite cannot hold a warm light in every owner's colour.
 */
export const CASTLE_WINDOWS: readonly { x: number; y: number; w: number; h: number }[] = [
  { x: 19 / 48, y: 31 / 48, w: 2 / 48, h: 2 / 48 },
  { x: 27 / 48, y: 31 / 48, w: 2 / 48, h: 2 / 48 },
  { x: 7 / 48, y: 40 / 48, w: 2 / 48, h: 3 / 48 },
  { x: 39 / 48, y: 40 / 48, w: 2 / 48, h: 3 / 48 },
];

/** Mixes two `#rrggbb` colours, `t` of the way from `a` to `b`. */
function mix(a: string, b: string, t: number): string {
  const ca = parseInt(a.slice(1), 16);
  const cb = parseInt(b.slice(1), 16);
  const channel = (shift: number): number =>
    Math.round(((ca >> shift) & 0xff) * (1 - t) + ((cb >> shift) & 0xff) * t);
  const out = (channel(16) << 16) | (channel(8) << 8) | channel(0);
  return `#${out.toString(16).padStart(6, '0')}`;
}

/**
 * A frame of sea. Each variant has flecks of its own, the same in every frame, so tiles
 * drawn from different variants break up the grid one tile repeated made across the
 * whole sea — and a tile does not flicker as its frames turn.
 */
export function water(
  art: ArtConfig,
  seed: number,
  size: number,
  frame: number,
  frames: number,
  variant: number,
): Pixels {
  const p = new Pixels(size, size);
  const { waterDeep, waterMid, waterShallow, waterFoam } = art.palette;
  p.fill(waterMid);

  // Slow horizontal swell, offset per frame so the sea drifts rather than flickers.
  const phase = (frame / frames) * size;
  for (let y = 0; y < size; y++) {
    const shift = Math.round(Math.sin(((y + phase) / size) * Math.PI * 2) * 2);
    for (let x = 0; x < size; x++) {
      const band = (x + shift + y * 3) % 7;
      if (band === 0) p.set(x, y, waterDeep, 0.5);
      else if (band === 3) p.set(x, y, waterShallow, 0.4);
    }
  }
  p.speckle(new Rng(seed * 31 + variant), waterFoam, 0.012);
  return p;
}

function grass(art: ArtConfig, rng: Rng, size: number): Pixels {
  const p = new Pixels(size, size);
  const { grassDark, grassMid, grassLight } = art.palette;
  p.fill(grassMid);
  p.speckle(rng, grassDark, 0.18);
  p.speckle(rng, grassLight, 0.1);
  // A few tufts, so the ground is not pure noise.
  for (let i = 0; i < 3; i++) {
    const x = rng.nextInt(size);
    const y = rng.nextInt(size);
    p.set(x, y, grassLight);
    p.set(x, y - 1, grassLight);
  }
  return p;
}

function rock(art: ArtConfig, rng: Rng, size: number): Pixels {
  const p = new Pixels(size, size);
  const { rockDark, rockMid, rockLight } = art.palette;
  p.fill(rockMid);
  p.speckle(rng, rockDark, 0.22);
  p.speckle(rng, rockLight, 0.12);
  return p;
}

/**
 * Land that meets water, keyed by which sides the sea is on: grass, cut back to the
 * coast where its corners are rounded (`coast.ts`), so the sea drawn beneath shows.
 * The sand is a sprite of its own (`beach`), since the grass carries its owner's tint
 * and sand tinted as hard turned the coast into a coloured rim.
 *
 * Generated for all 256 neighbour combinations rather than the usual reduced blob set:
 * at 16 pixels a tile the whole run costs a few kilobytes, and covering every case
 * outright is far less error-prone than mapping corners onto a 47-tile set.
 */
function shore(art: ArtConfig, rng: Rng, size: number, mask: number): Pixels {
  const p = grass(art, rng, size);
  const radius = art.generators.terrain.coastRadiusPx;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (coastDistance(mask, x, y, size, radius) < 0) p.clear(x, y);
    }
  }
  return p;
}

/**
 * Sand along a coast, `distance` giving each pixel's distance from the sea: wet and
 * flecked with foam at the water's edge, dry above it, and ragged where it gives way to
 * the grass so the coast does not look stamped.
 */
function sandFrom(
  art: ArtConfig,
  rng: Rng,
  size: number,
  distance: (x: number, y: number) => number,
): Pixels {
  const p = new Pixels(size, size);
  const { sand, craterMid, waterFoam, grassLight } = art.palette;
  const band = art.generators.terrain.beachPx;
  const wet = mix(sand, craterMid, 0.35);
  const bright = mix(sand, '#ffffff', 0.25);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = distance(x, y);
      if (d < 0 || d >= band) continue;
      if (d >= band - 1 && rng.nextFloat() < 0.45) continue;
      if (d < 1) {
        p.set(x, y, rng.nextFloat() < 0.3 ? waterFoam : wet);
        continue;
      }
      const roll = rng.nextFloat();
      p.set(x, y, roll < 0.1 ? bright : roll < 0.16 ? grassLight : sand);
    }
  }
  return p;
}

function beach(art: ArtConfig, rng: Rng, size: number, mask: number): Pixels {
  const radius = art.generators.terrain.coastRadiusPx;
  return sandFrom(art, rng, size, (x, y) => coastDistance(mask, x, y, size, radius));
}

/** Land filling one corner of a sea tile where the coast turns inward: all beach. */
function fillet(art: ArtConfig, rng: Rng, size: number, corner: number): Pixels {
  const radius = art.generators.terrain.coastRadiusPx;
  return sandFrom(art, rng, size, (x, y) => {
    const d = filletDistance(corner, x, y, size, radius);
    // Nothing of the sand's ragged edge here: the fillet is shallower than the beach.
    return d > 0 ? Math.min(d, 1.5) : -1;
  });
}

/**
 * A wall block, keyed by which sides it joins and how battered it is.
 *
 * The join mask is what makes a run of blocks read as a continuous wall: a block
 * carries a dark seam on every side with nothing next to it, and none where it meets
 * its neighbour.
 */
function wall(art: ArtConfig, rng: Rng, size: number, mask: number, damage: number): Pixels {
  const p = new Pixels(size, size);
  const { rockDark, rockMid, rockLight, shadow, craterDark } = art.palette;
  p.fill(rockMid);

  // Courses of stone, offset row to row.
  const course = 5;
  for (let y = 0; y < size; y++) {
    if (y % course === 0) {
      for (let x = 0; x < size; x++) p.set(x, y, rockDark, 0.75);
    }
    const band = Math.floor(y / course);
    for (let x = band % 2 === 0 ? 0 : 4; x < size; x += 8) {
      for (let d = 0; d < course; d++) p.set(x, y - d, rockDark, 0.5);
    }
  }
  p.speckle(rng, rockLight, 0.08);

  // Outer seam on unconnected sides, highlight on the north face.
  if ((mask & N) === 0) for (let x = 0; x < size; x++) p.set(x, 0, shadow, 0.8);
  if ((mask & S) === 0) for (let x = 0; x < size; x++) p.set(x, size - 1, shadow, 0.8);
  if ((mask & W) === 0) for (let y = 0; y < size; y++) p.set(0, y, shadow, 0.8);
  if ((mask & E) === 0) for (let y = 0; y < size; y++) p.set(size - 1, y, shadow, 0.8);
  if ((mask & N) === 0) for (let x = 0; x < size; x++) p.set(x, 1, rockLight, 0.45);

  // A block with nothing to its south shows its front face, which is what gives the
  // wall height: the light lip of its top, then darker dressed stone below it. Light
  // falls from the north, as on the castle, and the drop shadow is drawn beside it.
  if ((mask & S) === 0) {
    const face = art.generators.wall.frontFacePx;
    const top = size - face;
    for (let x = 0; x < size; x++) p.set(x, top - 1, rockLight, 0.7);
    p.rect(0, top, size, face, rockDark);
    p.rect(0, top, size, face, shadow, 0.3);
    for (let y = top; y < size; y++) {
      const offset = y - top < face / 2 ? 0 : 3;
      for (let x = offset; x < size; x += 6) p.set(x, y, shadow, 0.6);
    }
    for (let x = 0; x < size; x++) p.set(x, top + Math.floor(face / 2), shadow, 0.45);
    for (let x = 0; x < size; x++) p.set(x, size - 1, shadow, 0.9);
    if ((mask & W) === 0) for (let y = top; y < size; y++) p.set(0, y, shadow, 0.8);
    if ((mask & E) === 0) for (let y = top; y < size; y++) p.set(size - 1, y, shadow, 0.8);
  }

  // Damage chews the block from its edges inward.
  for (let level = 0; level < damage; level++) {
    for (let i = 0; i < size; i++) {
      const x = rng.nextInt(size);
      const y = rng.nextInt(size);
      const edgeish = x < 3 || y < 3 || x > size - 4 || y > size - 4;
      if (!edgeish && rng.nextFloat() < 0.6) continue;
      p.set(x, y, level === 0 ? craterDark : shadow, 0.85);
    }
  }
  return p;
}

/**
 * What is left of an eliminated player's wall: loose stones on open ground, with no
 * courses and no face, so it reads as a ruin and not as a wall somebody still holds.
 * Transparent between the stones, so the grass shows through.
 */
function rubble(art: ArtConfig, rng: Rng, size: number): Pixels {
  const p = new Pixels(size, size);
  const { rockDark, rockMid, rockLight, shadow } = art.palette;
  const stones = 5 + rng.nextInt(3);
  for (let i = 0; i < stones; i++) {
    const x = 2 + rng.nextInt(size - 4);
    const y = 2 + rng.nextInt(size - 4);
    const r = 1 + rng.nextFloat() * 1.6;
    p.disc(x + 0.6, y + 0.8, r, shadow);
    p.disc(x, y, r, i % 2 === 0 ? rockMid : rockDark);
    p.set(x - 1, y - 1, rockLight, 0.7);
  }
  return p;
}

/**
 * Flagstones for sealed ground, in pale neutral stone to be tinted by the owner. A
 * courtyard reads as held ground at a glance where a wash of colour did not, and it
 * must not read as wall: no courses, no seams, flat and pale.
 */
function court(art: ArtConfig, rng: Rng, size: number): Pixels {
  const p = new Pixels(size, size);
  const { sand, rockLight, craterMid } = art.palette;
  p.fill(rockLight);
  p.speckle(rng, sand, 0.35);
  // Irregular slabs: a grout line across at a varying height, and down at varying
  // places above and below it.
  const across = 6 + rng.nextInt(4);
  for (let x = 0; x < size; x++) p.set(x, across, craterMid, 0.35);
  for (let x = 0; x < size; x++) p.set(x, 0, craterMid, 0.35);
  const upper = 3 + rng.nextInt(size - 6);
  const lower = 3 + rng.nextInt(size - 6);
  for (let y = 0; y < across; y++) p.set(upper, y, craterMid, 0.35);
  for (let y = across; y < size; y++) p.set(lower, y, craterMid, 0.35);
  p.set(0, 0, craterMid, 0.2);
  return p;
}

/**
 * Surf on a water tile, along the sides that meet land (`mask`, N E S W). Faded in and
 * out per tile at draw time, so the coast seems to breathe.
 */
function foam(art: ArtConfig, rng: Rng, size: number, mask: number): Pixels {
  const p = new Pixels(size, size);
  const { waterFoam, uiInk } = art.palette;
  const edge = (side: number, at: (i: number, depth: number) => [number, number]): void => {
    if ((mask & side) === 0) return;
    for (let i = 0; i < size; i++) {
      for (let depth = 0; depth < 3; depth++) {
        const chance = [0.8, 0.4, 0.12][depth] as number;
        if (rng.nextFloat() >= chance) continue;
        const [x, y] = at(i, depth);
        p.set(x, y, depth === 0 && rng.nextFloat() < 0.4 ? uiInk : waterFoam, 0.9 - depth * 0.25);
      }
    }
  };
  edge(N, (i, d) => [i, d]);
  edge(S, (i, d) => [i, size - 1 - d]);
  edge(W, (i, d) => [d, i]);
  edge(E, (i, d) => [size - 1 - d, i]);
  return p;
}

/**
 * The castle: a curtain wall round a paved court, a round tower at each corner, a keep
 * in the middle under a hipped roof, and a gate in the front face. Seen from above with
 * light from the north, as the walls are: tops lit, faces toward the viewer in shade.
 * Drawn at 48 pixels, three sprite tiles, which the board scales to the castle's size;
 * the windows (`CASTLE_WINDOWS`) are left dark here and lit over it.
 *
 * A sealed castle flies a banner in its owner's colour, drawn over this as its own
 * sprite so it can wave and come down when the wall is breached.
 */
function castle(art: ArtConfig, rng: Rng, size: number): Pixels {
  const p = new Pixels(size, size);
  const { rockMid, rockLight, rockDark, shadow, sand } = art.palette;
  const merlon = art.generators.castle.battlementPeriodPx;
  const k = size / 48;
  const at = (v: number): number => Math.round(v * k);
  const face = art.generators.wall.frontFacePx + 2;
  const foot = size - 1;
  const lip = foot - face;

  // The curtain wall's top, outlined, and its front face below the roofline.
  p.rect(at(3), at(5), at(42), lip - at(5) + 1, shadow);
  p.rect(at(4), at(6), at(40), lip - at(6), rockMid);
  p.speckle(rng, rockDark, 0.1, (x, y) => x > at(4) && x < at(43) && y > at(6) && y < lip);
  for (let x = at(4); x < at(44); x++) {
    // Battlements on its outer rim, lit from the north.
    const solid = Math.floor(x / merlon) % 2 === 0;
    p.set(x, at(6), solid ? rockLight : rockDark);
  }
  p.rect(at(4), lip, at(40), face, rockDark);
  p.rect(at(4), lip, at(40), face, shadow, 0.35);
  for (let x = at(4); x < at(44); x++) p.set(x, lip - 1, rockLight, 0.6);
  for (let x = at(4); x < at(44); x += 4) p.rect(x, lip + 1, 1, face - 2, shadow, 0.4);
  for (let x = at(3); x < at(45); x++) p.set(x, foot, shadow, 0.9);

  // The court inside it, paved.
  p.rect(at(9), at(11), at(30), at(25), shadow, 0.6);
  p.rect(at(10), at(12), at(28), at(23), mix(rockLight, sand, 0.4));
  p.speckle(rng, rockMid, 0.12, (x, y) => x >= at(10) && x < at(38) && y >= at(12) && y < at(35));

  // The keep: a hipped roof over a shaded front with two windows.
  const kx0 = at(15);
  const kx1 = at(33);
  const ky0 = at(12);
  const ky1 = at(29);
  const kFace = at(34);
  p.rect(kx0 - 1, ky0 - 1, kx1 - kx0 + 2, kFace - ky0 + 2, shadow);
  const midX = (kx0 + kx1 - 1) / 2;
  const midY = (ky0 + ky1 - 1) / 2;
  for (let y = ky0; y < ky1; y++) {
    for (let x = kx0; x < kx1; x++) {
      // Four slopes meeting at a ridge: the north and west lit, the others in shade.
      const fx = (x - midX) / ((kx1 - kx0) / 2);
      const fy = (y - midY) / ((ky1 - ky0) / 2);
      const colour =
        Math.abs(fy) >= Math.abs(fx)
          ? fy < 0
            ? rockLight
            : rockDark
          : fx < 0
            ? mix(rockLight, rockMid, 0.5)
            : rockMid;
      p.set(x, y, colour);
    }
  }
  for (let x = kx0 + 2; x < kx1 - 2; x++) p.set(x, Math.round(midY), shadow, 0.5);
  p.rect(kx0, ky1, kx1 - kx0, kFace - ky1, rockDark);
  p.rect(kx0, ky1, kx1 - kx0, kFace - ky1, shadow, 0.3);
  for (const w of CASTLE_WINDOWS.slice(0, 2)) {
    p.rect(
      Math.round(w.x * size),
      Math.round(w.y * size),
      Math.max(1, at(2)),
      Math.max(1, at(2)),
      shadow,
    );
  }

  // Round towers at the corners, standing up: a shaded drum, crenellated top, dark hatch.
  const tower = (cx: number, cy: number, drop: number): void => {
    const r = 6.5 * k;
    p.rect(cx - r, cy, 2 * r + 1, drop, shadow);
    p.rect(cx - r + 1, cy, 2 * r - 1, drop - 1, rockDark);
    p.disc(cx, cy, r + 1, shadow);
    p.disc(cx, cy, r, rockMid);
    for (let a = 0; a < 12; a++) {
      if (a % 2 === 1) continue;
      const angle = (a / 12) * Math.PI * 2;
      p.set(cx + Math.cos(angle) * (r - 0.8), cy + Math.sin(angle) * (r - 0.8), rockLight);
    }
    p.disc(cx, cy, r * 0.5, rockDark);
    p.set(cx - r * 0.5, cy - r * 0.6, rockLight);
  };
  tower(at(8), at(9), at(5));
  tower(at(39), at(9), at(5));
  tower(at(8), at(36), foot - at(36));
  tower(at(39), at(36), foot - at(36));
  for (const w of CASTLE_WINDOWS.slice(2)) {
    p.rect(
      Math.round(w.x * size),
      Math.round(w.y * size),
      Math.max(1, at(2)),
      Math.max(1, at(3)),
      shadow,
    );
  }

  // The gate: an arch in the front face with its portcullis down.
  const gate = Math.floor(size / 2);
  const gw = at(6);
  p.rect(gate - gw / 2, lip - at(1), gw, foot - lip + at(1), shadow);
  p.disc(gate - 0.5, lip - at(1), gw / 2, shadow);
  for (let x = gate - gw / 2 + 1; x < gate + gw / 2; x += 2)
    p.rect(x, lip - at(2), 1, foot - lip + at(1), rockMid, 0.55);
  return p;
}

/**
 * A gun pit: a ring of dressed stone round a sunken floor, lit on its northern rim, on a
 * square slab that fills the footprint — a round pit alone hid its corners from a player
 * building round it (test-session feedback, 2026-10-05). The carriage and barrel are
 * sprites of their own, so they can turn.
 */
function cannon(art: ArtConfig, size: number): Pixels {
  const p = new Pixels(size, size);
  const { rockDark, rockMid, rockLight, shadow } = art.palette;
  const c = size / 2 - 0.5;
  const outer = size / 2 - 1;
  const inner = outer - 3.5;
  p.rect(1, 1, size - 2, size - 2, rockDark);
  p.rect(2, 2, size - 4, size - 4, rockLight);
  p.disc(c, c, outer + 0.6, shadow);
  p.disc(c, c, outer, rockMid);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - c;
      const dy = y - c;
      const r = Math.hypot(dx, dy);
      if (r > outer || r < inner) continue;
      const angle = Math.atan2(dy, dx);
      // Joints between the stones, and the light on whichever face turns north.
      if (((((angle / (Math.PI * 2)) * 14) % 1) + 1) % 1 < 0.12) p.set(x, y, rockDark);
      else if (dy < -outer * 0.35 && r > inner + 1) p.set(x, y, rockLight, 0.7);
      else if (dy > outer * 0.45) p.set(x, y, rockDark, 0.5);
    }
  }
  p.disc(c, c, inner, shadow);
  p.disc(c, c + 0.6, inner - 1, rockDark);
  return p;
}

/**
 * A gun's wooden carriage, turned with its barrel `step` of `steps` from north and run
 * back by `recoil`: two cheeks, a transom, and a wheel either side. Untinted, since wood
 * in the owner's colour stopped reading as wood; the barrel above carries the colour.
 */
function carriage(
  art: ArtConfig,
  size: number,
  step: number,
  steps: number,
  recoil: number,
): Pixels {
  const p = new Pixels(size, size);
  const { craterMid, sand, shadow } = art.palette;
  const wood = mix(craterMid, sand, 0.35);
  const woodLight = mix(craterMid, sand, 0.6);
  const woodDark = craterMid;
  const angle = (2 * Math.PI * step) / steps;
  const ux = Math.sin(angle);
  const uy = -Math.cos(angle);
  const centre = size / 2 - 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const rx = x - centre;
      const ry = y - centre;
      const along = rx * ux + ry * uy + recoil;
      const across = -rx * uy + ry * ux;
      const side = Math.abs(across);
      let colour: string | null = null;
      if (along >= -1.5 && along <= 3.5 && side >= 4.2 && side <= 6.4) {
        // A wheel, its tread darker and a light spoke across it.
        colour = Math.abs(along - 1) < 0.6 ? woodLight : side > 5.8 ? shadow : woodDark;
      } else if (along >= -4.5 && along <= 7 && side >= 2.4 && side <= 4.2) {
        colour = across < 0 ? woodLight : wood;
      } else if (along >= -4.5 && along <= -2.8 && side < 2.4) {
        colour = wood;
      } else if (Math.abs(along - 1) < 0.5 && side < 4.2) {
        colour = shadow;
      }
      if (colour !== null) p.set(x, y, colour);
    }
  }
  return p;
}

/**
 * A barrel alone, pointing `step` of `steps` clockwise from north and drawn back by
 * `recoil` pixels. Rasterised at each angle rather than rotating one sprite, which at
 * this size smears the pixels into mush.
 */
function barrel(
  art: ArtConfig,
  size: number,
  step: number,
  steps: number,
  recoil: number,
  length = art.generators.cannon.barrelLengthPx,
  lit = true,
): Pixels {
  const p = new Pixels(size, size);
  const { rockMid, rockLight, shadow, emberMid } = art.palette;
  const angle = (2 * Math.PI * step) / steps;
  const ux = Math.sin(angle);
  const uy = -Math.cos(angle);
  const centre = size / 2 - 0.5;
  // Thick at the breech, tapering along the chase, swelling again at the muzzle.
  const halfAt = (along: number): number =>
    along > length - 1.8 ? 2.3 : 2.9 - (0.9 * Math.max(0, along)) / Math.max(1, length);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const rx = x - centre;
      const ry = y - centre;
      const along = rx * ux + ry * uy + recoil;
      const across = -rx * uy + ry * ux;
      // The knob at the breech.
      if (Math.hypot(along + 3, across) <= 1.4) {
        p.set(x, y, across < 0 ? rockLight : rockMid);
        continue;
      }
      const half = halfAt(along);
      if (along < -2 || along > length || Math.abs(across) > half) continue;
      // Lighter than the carriage and pit under it, or it disappears into them.
      let colour = rockMid;
      if (across < -half + 1) colour = rockLight;
      else if (across > half - 1) colour = shadow;
      // Reinforcing bands, and the lip of the muzzle.
      if (Math.abs(along - 1) < 0.5 || Math.abs(along - length * 0.5) < 0.5) colour = rockLight;
      if (along > length - 1) colour = Math.abs(across) < 1.1 ? shadow : rockLight;
      p.set(x, y, colour);
      if (lit && along > length - 1 && Math.abs(across) < 1.1) p.set(x, y, emberMid, 0.6);
    }
  }
  return p;
}

/**
 * A banner, in white so it can be tinted to its owner. Each frame shifts the wave a
 * little further along, so cycling them makes it fly.
 */
function banner(width: number, height: number, frame: number, frames: number): Pixels {
  const p = new Pixels(width, height + 2);
  for (let x = 0; x < width; x++) {
    // Fixed at the pole, rippling more toward the free end.
    const swing = Math.round(Math.sin((x / width + frame / frames) * 2 * Math.PI) * (x / width));
    for (let y = 0; y < height; y++) {
      const shade = y === height - 1 || x === width - 1 ? '#c8c8c8' : '#ffffff';
      p.set(x, y + 1 + swing, shade);
    }
  }
  return p;
}

function shot(art: ArtConfig, size: number): Pixels {
  const p = new Pixels(size, size);
  p.disc(size / 2 - 0.5, size / 2 - 0.5, size / 2 - 0.5, art.palette.shadow);
  p.disc(size / 2 - 0.5, size / 2 - 0.5, size / 2 - 1.5, art.palette.rockLight);
  p.set(size / 2 - 1, size / 2 - 1, art.palette.uiInk);
  return p;
}

function crater(art: ArtConfig, rng: Rng, size: number): Pixels {
  const p = new Pixels(size, size);
  const { craterDark, craterMid } = art.palette;
  p.disc(size / 2 - 0.5, size / 2 - 0.5, size / 2 - 2, craterMid);
  p.disc(size / 2 - 0.5, size / 2 - 0.5, size / 2 - 4, craterDark);
  p.speckle(rng, craterDark, 0.25);
  return p;
}

/** One frame of an expanding blast, hot core fading to smoke. */
function blast(art: ArtConfig, rng: Rng, size: number, frame: number, frames: number): Pixels {
  const p = new Pixels(size, size);
  const { emberHot, emberMid, emberCool, shadow } = art.palette;
  const t = frame / (frames - 1);
  const radius = (size / 2) * (0.25 + t * 0.75);
  const centre = size / 2 - 0.5;

  p.disc(centre, centre, radius, t < 0.6 ? emberCool : shadow);
  p.disc(centre, centre, radius * 0.7, t < 0.5 ? emberMid : emberCool);
  if (t < 0.45) p.disc(centre, centre, radius * 0.4, emberHot);

  for (let i = 0; i < 10; i++) {
    const angle = rng.nextFloat() * Math.PI * 2;
    const d = radius * (0.8 + rng.nextFloat() * 0.4);
    p.set(
      Math.round(centre + Math.cos(angle) * d),
      Math.round(centre + Math.sin(angle) * d),
      emberMid,
    );
  }
  return p;
}

/** Variants drawn of each kind of scenery. */
export const SCENERY_VARIANTS = 4;

/**
 * Scenery on open land, in one tile: a broadleaf tree, a pine, a bush or a boulder, each
 * standing on its own shadow cast to the south-east as the walls' are. Round and green
 * where a wall is square and stone, so none of it can be taken for wall; the boulder,
 * the one thing of stone, is a single rounded rock with moss on it, not loose stones as
 * rubble is.
 */
function scenery(art: ArtConfig, rng: Rng, size: number, kind: string, variant: number): Pixels {
  const p = new Pixels(size, size);
  const { grassDark, grassMid, grassLight, craterMid, shadow, rockMid, rockLight, rockDark } =
    art.palette;
  const k = size / 16;
  const jitter = (variant % 2) * 0.8 - 0.4;
  const shade = (cx: number, cy: number, rx: number, ry: number): void => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) p.set(x, y, shadow, 0.3);
      }
    }
  };
  const leafy = (cx: number, cy: number, r: number, base: string): void => {
    p.disc(cx, cy, r + 0.8 * k, mix(base, shadow, 0.45));
    p.disc(cx, cy, r, base);
    p.disc(cx - r * 0.3, cy - r * 0.35, r * 0.55, mix(base, grassLight, 0.55));
    p.speckle(rng, grassLight, 0.08, (x, y) => Math.hypot(x - cx, y - cy) < r - 0.5);
    p.speckle(rng, mix(base, shadow, 0.3), 0.1, (x, y) => Math.hypot(x - cx, y - cy) < r && y > cy);
  };

  if (kind === 'tree') {
    const r = (4.6 + (variant % 3) * 0.5) * k;
    const cx = 8 * k + jitter * k;
    const cy = 6.5 * k;
    shade(cx + 2 * k, 12.5 * k, r * 0.95, 2.4 * k);
    p.rect(cx - 1 * k, cy + r - 2 * k, 2 * k, 4 * k, craterMid);
    leafy(cx, cy, r, grassDark);
  } else if (kind === 'pine') {
    const cx = Math.round(8 * k + jitter * k);
    const top = 1.5 * k;
    const foot = 12.5 * k;
    shade(cx + 2.5 * k, 13 * k, 4 * k, 1.8 * k);
    p.rect(cx - 1 * k, foot - 1 * k, 2 * k, 3 * k, craterMid);
    const dark = mix(grassDark, shadow, 0.25);
    // Three tiers, each wider than the one above, lit on the west.
    for (let tier = 0; tier < 3; tier++) {
      const y0 = top + tier * 3.2 * k;
      const y1 = y0 + 4.6 * k;
      for (let y = Math.floor(y0); y < y1; y++) {
        const half = ((y - y0) / (y1 - y0)) * (2.4 + tier * 1.3) * k + 0.6;
        for (let x = Math.floor(cx - half); x <= cx + half; x++) {
          const edge = x <= cx - half + 1 || y >= y1 - 1;
          p.set(x, y, edge ? mix(dark, shadow, 0.4) : x < cx ? mix(dark, grassMid, 0.5) : dark);
        }
      }
    }
  } else if (kind === 'bush') {
    const cy = 10 * k;
    shade(9.5 * k, 12.5 * k, 5 * k, 1.8 * k);
    const base = mix(grassDark, grassMid, 0.4);
    leafy(6 * k + jitter * k, cy, 2.6 * k, base);
    leafy(10 * k + jitter * k, cy + 0.5 * k, 2.3 * k, base);
    if (variant >= 2) leafy(8 * k, cy - 2 * k, 2.2 * k, base);
  } else {
    // Low and wide, two stones side by side, earthy and mossed: a round grey rock was
    // a cannonball's double.
    const blob = (cx: number, cy: number, rx: number, ry: number, colour: string): void => {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dx = (x + 0.5 - cx) / rx;
          const dy = (y + 0.5 - cy) / ry;
          if (dx * dx + dy * dy <= 1) p.set(x, y, colour);
        }
      }
    };
    const cx = 7.5 * k + jitter * k;
    const cy = 10 * k;
    const stone = mix(rockMid, craterMid, 0.35);
    shade(cx + 1.5 * k, cy + 2 * k, 5.5 * k, 1.8 * k);
    blob(cx + 3 * k, cy - 0.5 * k, 2.6 * k, 2 * k, rockDark);
    blob(cx + 3 * k, cy - 0.8 * k, 2 * k, 1.5 * k, stone);
    blob(cx, cy, 4 * k, 2.6 * k, rockDark);
    blob(cx, cy - 0.3 * k, 3.3 * k, 2 * k, stone);
    blob(cx - 0.8 * k, cy - 1 * k, 1.8 * k, 0.9 * k, mix(stone, rockLight, 0.45));
    blob(cx + 0.8 * k, cy - 1.6 * k, 1.6 * k, 0.7 * k, grassMid);
  }
  return p;
}

/** Generates every sprite and packs them into one texture. */
export function buildAtlas(art: ArtConfig, seed: number): Map<string, Texture> {
  const atlas = new Atlas();
  const sprites = drawSprites(atlas, art, seed);
  while (sprites.next().done !== true) continue;
  return atlas.build(art.atlasSizePx);
}

/**
 * The same atlas, drawn a slice a frame where `pace` says so: whole, it is 160 to 180 ms,
 * which a look made in the pause between phases should not spend in one (PLAN 11.23).
 */
export async function buildAtlasPaced(
  art: ArtConfig,
  seed: number,
  pace: () => Promise<void>,
): Promise<Map<string, Texture>> {
  const atlas = new Atlas();
  const sprites = drawSprites(atlas, art, seed);
  while (sprites.next().done !== true) await pace();
  return atlas.build(art.atlasSizePx);
}

/** Draws every sprite into `atlas`, one at a time, in an order the seed's draws depend on. */
function* drawSprites(atlas: Atlas, art: ArtConfig, seed: number): Generator<void> {
  const tile = art.tileSizePx;
  const gen = art.generators;
  const rng = new Rng(seed);

  for (let v = 0; v < gen.terrain.waterVariants; v++) {
    for (let f = 0; f < gen.terrain.waterAnimFrames; f++) {
      yield atlas.add(KEY.water(f, v), water(art, seed, tile, f, gen.terrain.waterAnimFrames, v));
    }
  }
  for (let v = 0; v < gen.terrain.grassVariants; v++)
    yield atlas.add(KEY.grass(v), grass(art, rng, tile));
  for (let v = 0; v < gen.terrain.rockVariants; v++)
    yield atlas.add(KEY.rock(v), rock(art, rng, tile));
  for (let mask = 0; mask < 256; mask++) {
    yield atlas.add(KEY.shore(mask), shore(art, rng, tile, mask));
    yield atlas.add(KEY.beach(mask), beach(art, rng, tile, mask));
  }
  for (const corner of FILLET_CORNERS)
    yield atlas.add(KEY.fillet(corner), fillet(art, rng, tile, corner));

  for (let mask = 0; mask < 16; mask++) {
    for (let damage = 0; damage < gen.wall.damageStates; damage++) {
      yield atlas.add(KEY.wall(mask, damage), wall(art, rng, tile, mask, damage));
    }
  }

  for (let v = 0; v < gen.wall.rubbleVariants; v++)
    yield atlas.add(KEY.rubble(v), rubble(art, rng, tile));
  for (let v = 0; v < gen.terrain.courtyardVariants; v++)
    yield atlas.add(KEY.court(v), court(art, rng, tile));
  for (let mask = 1; mask < 16; mask++) yield atlas.add(KEY.foam(mask), foam(art, rng, tile, mask));

  for (const kind of ['tree', 'pine', 'bush', 'rock']) {
    for (let v = 0; v < SCENERY_VARIANTS; v++) {
      yield atlas.add(KEY.scenery(kind, v), scenery(art, rng, tile, kind, v));
    }
  }
  yield atlas.add(KEY.castle, castle(art, rng, tile * 3));
  for (let f = 0; f < gen.castle.bannerWaveFrames; f++) {
    const width = gen.castle.bannerWidthPx;
    yield atlas.add(
      KEY.banner(f),
      banner(width, Math.round(width * 0.6), f, gen.castle.bannerWaveFrames),
    );
  }
  yield atlas.add(KEY.cannon, cannon(art, tile * 2));
  for (let step = 0; step < gen.cannon.rotationSteps; step++) {
    for (let r = 0; r < gen.cannon.recoilFrames; r++) {
      yield atlas.add(
        KEY.barrel(step, r),
        barrel(art, tile * 2, step, gen.cannon.rotationSteps, r),
      );
      yield atlas.add(
        KEY.carriage(step, r),
        carriage(art, tile * 2, step, gen.cannon.rotationSteps, r),
      );
    }
  }
  // An inert gun's barrel, slumped: short, as a barrel tipped toward the ground looks
  // from above, and with no glow at the muzzle.
  const slump = Math.round(gen.cannon.barrelLengthPx * 0.45);
  for (let step = 0; step < gen.cannon.rotationSteps; step++) {
    yield atlas.add(
      KEY.droop(step),
      barrel(art, tile * 2, step, gen.cannon.rotationSteps, 0, slump, false),
    );
  }
  yield atlas.add(KEY.shot, shot(art, 8));
  for (let v = 0; v < gen.fx.craterDecalVariants; v++)
    yield atlas.add(KEY.crater(v), crater(art, rng, tile));
  for (let f = 0; f < gen.fx.explosionFrames; f++) {
    yield atlas.add(KEY.blast(f), blast(art, rng, tile * 2, f, gen.fx.explosionFrames));
  }
}
