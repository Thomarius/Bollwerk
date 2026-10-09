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
  /** Night's shot, a burning ball. */
  burningShot: 'shot.burning',
  /** A puff of smoke in white, tinted where it is used: a shot's trail, a chimney's wisp. */
  smoke: (variant: number) => `smoke.${variant}`,
  ember: 'ember',
  /** The main castle: a larger keep, and its gilding laid over it untinted. */
  mainCastle: 'castle.main',
  gilt: 'castle.gilt',
  /** A sealed castle's lit windows and slits, laid over it untinted. */
  lights: (main: boolean) => `castle.lights.${main ? 'main' : 'plain'}`,
  sandbags: (direction: number) => `sandbags.${direction}`,
  balls: (count: number) => `balls.${count}`,
  field: (kind: 'tilled' | 'crop', variant: number) => `field.${kind}.${variant}`,
  /** A tile of track, bending `shift` sprite pixels across it (-4, 0 or 4), or running out. */
  track: (shift: number, end: boolean) => `track.${shift}.${end ? 'end' : 'run'}`,
  sheep: (pose: number, left: boolean) => `sheep.${pose}.${left ? 'l' : 'r'}`,
  mason: (frame: number, left: boolean) => `mason.${frame}.${left ? 'l' : 'r'}`,
  brazier: 'brazier',
  flame: (frame: number) => `flame.${frame}`,
  lighthouse: 'lighthouse',
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

/**
 * Arrow slits in the curtain's front face either side of the gate, dark in the sprite and
 * lit with the windows: more lit points to a sealed castle, so Night reads it from afar.
 */
const CASTLE_SLITS: readonly { x: number; y: number; w: number; h: number }[] = [
  { x: 15 / 48, y: 41 / 48, w: 1 / 48, h: 3 / 48 },
  { x: 32 / 48, y: 41 / 48, w: 1 / 48, h: 3 / 48 },
];

/** The main castle's keep has a third window, between the two. */
const MAIN_WINDOW = { x: 23 / 48, y: 31 / 48, w: 2 / 48, h: 2 / 48 };

/** The chimney on the keep's roof, as a fraction of the castle's sprite: where smoke rises. */
export const CASTLE_CHIMNEY = { x: 17 / 48, y: 13.5 / 48 };

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
  const { rockMid, rockLight, craterMid } = art.palette;
  p.fill(rockLight);
  // Sparse grey grain: a dense speckle of sand read, on a lone tile, as gravel in a breach.
  p.speckle(rng, rockMid, 0.12);
  // Irregular slabs: a grout line across at a varying height, and down at varying
  // places above and below it.
  const across = 6 + rng.nextInt(4);
  for (let x = 0; x < size; x++) p.set(x, across, craterMid, 0.45);
  for (let x = 0; x < size; x++) p.set(x, 0, craterMid, 0.45);
  const upper = 3 + rng.nextInt(size - 6);
  const lower = 3 + rng.nextInt(size - 6);
  for (let y = 0; y < across; y++) p.set(upper, y, craterMid, 0.45);
  for (let y = across; y < size; y++) p.set(lower, y, craterMid, 0.45);
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
function castle(art: ArtConfig, rng: Rng, size: number, main = false): Pixels {
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

  // The keep: a hipped roof over a shaded front with two windows. The main castle's is
  // larger, filling more of the court and rising higher, so it reads as the seat of the
  // island in the sprite itself and not only by the crown at its foot.
  const { kx0, kx1, ky0, ky1, kFace } = keepBox(size, main);
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
  for (const w of main
    ? [...CASTLE_WINDOWS.slice(0, 2), MAIN_WINDOW]
    : CASTLE_WINDOWS.slice(0, 2)) {
    p.rect(
      Math.round(w.x * size),
      Math.round(w.y * size),
      Math.max(1, at(2)),
      Math.max(1, at(2)),
      shadow,
    );
  }
  chimney(art, p);

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
  for (const w of CASTLE_SLITS) {
    p.rect(Math.round(w.x * size), Math.round(w.y * size), 1, Math.max(1, at(3)), shadow);
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

/** The chimney on the keep's roof, where a sealed castle's smoke rises from. */
function chimney(art: ArtConfig, p: Pixels): void {
  const { shadow, rockDark, rockLight } = art.palette;
  const k = p.width / 48;
  const x = Math.round(CASTLE_CHIMNEY.x * p.width - 1);
  const y = Math.round(CASTLE_CHIMNEY.y * p.height);
  const side = Math.max(2, Math.round(3 * k));
  p.rect(x + 1, y + 1, side, side, shadow, 0.5);
  p.rect(x, y, side, side, rockDark);
  p.rect(x, y, side, 1, rockLight);
  p.set(x + 1, y + 1, shadow);
}

/** The keep's roof and face in a castle sprite of `size`: larger for the main castle. */
function keepBox(
  size: number,
  main: boolean,
): { kx0: number; kx1: number; ky0: number; ky1: number; kFace: number } {
  const at = (v: number): number => Math.round((v * size) / 48);
  return main
    ? { kx0: at(13), kx1: at(35), ky0: at(9), ky1: at(29), kFace: at(35) }
    : { kx0: at(15), kx1: at(33), ky0: at(12), ky1: at(29), kFace: at(34) };
}

/**
 * The main castle's gilding, laid over its sprite untinted, since gold tinted by the owner's
 * colour is no longer gold: the keep's whole roof in gold leaf, its four slopes lit and
 * shaded as the stone one under it is, and a finial on the apex. Only the roof, so the
 * curtain and towers keep the owner's colour. Gilding the hips alone drew an X across the
 * keep, which reads as struck through.
 */
function gilt(art: ArtConfig, size: number): Pixels {
  const p = new Pixels(size, size);
  const { emberHot, uiAccent, craterMid, shadow } = art.palette;
  // Old gold rather than bright: as yellow as the UI's, a roof read as a marker.
  const lit = mix(uiAccent, emberHot, 0.25);
  const west = mix(uiAccent, craterMid, 0.15);
  const east = mix(uiAccent, craterMid, 0.4);
  const south = mix(uiAccent, craterMid, 0.6);
  const { kx0, kx1, ky0, ky1 } = keepBox(size, true);
  const midX = (kx0 + kx1 - 1) / 2;
  const midY = (ky0 + ky1 - 1) / 2;
  for (let y = ky0; y < ky1; y++) {
    for (let x = kx0; x < kx1; x++) {
      const fx = (x - midX) / ((kx1 - kx0) / 2);
      const fy = (y - midY) / ((ky1 - ky0) / 2);
      const colour = Math.abs(fy) >= Math.abs(fx) ? (fy < 0 ? lit : south) : fx < 0 ? west : east;
      p.set(x, y, colour);
    }
  }
  // Courses of the gold leaf across each slope, faint, so it is a roof and not a plate.
  for (let y = ky0 + 2; y < ky1; y += 3) {
    for (let x = kx0; x < kx1; x++) p.set(x, y, shadow, 0.12);
  }
  // The finial on the apex: a gilded ball with its light on the north-west and its shadow
  // falling south-east onto the roof.
  const cx = Math.round(midX);
  const cy = Math.round(midY);
  p.disc(cx + 1, cy + 1, 1.7, shadow);
  p.disc(cx, cy, 1.8, mix(uiAccent, shadow, 0.35));
  p.disc(cx - 0.4, cy - 0.4, 1.2, emberHot);
  p.set(cx - 1, cy - 1, '#ffffff');
  // The chimney stands up through the gold, as through the stone.
  chimney(art, p);
  return p;
}

/**
 * A sealed castle's lights: the keep's windows, the front towers' and the slits in the
 * curtain, warm whatever the owner's colour, laid over the tinted sprite while it is sealed
 * — lit means sealed (PLAN §7), in the pixel style and more so at Night.
 */
function lights(art: ArtConfig, size: number, main: boolean): Pixels {
  const p = new Pixels(size, size);
  const { emberHot, emberMid } = art.palette;
  const windows = [...CASTLE_WINDOWS, ...CASTLE_SLITS, ...(main ? [MAIN_WINDOW] : [])];
  for (const w of windows) {
    const x = Math.round(w.x * size);
    const y = Math.round(w.y * size);
    const width = Math.max(1, Math.round(w.w * size));
    const height = Math.max(1, Math.round(w.h * size));
    p.rect(x, y, width, height, emberMid);
    p.rect(x, y, width, Math.max(1, height - 1), emberHot);
  }
  return p;
}

/**
 * Sandbags round the outward side of a gun pit, facing `direction` of eight (0 east, then
 * clockwise as the screen runs): laid over the pit's stone ring, so they stay inside the
 * gun's own square and hide nothing of the board round it. Burlap, untinted, so the gun's
 * colour stays on its barrel; each bag lit on its northern face as everything is.
 */
function sandbags(art: ArtConfig, size: number, direction: number): Pixels {
  const p = new Pixels(size, size);
  const { sand, craterMid, shadow } = art.palette;
  // Dull, a shade under the sand: brighter, the arcs read as gold rings, as if marking a gun.
  const burlap = mix(sand, craterMid, 0.55);
  const lit = mix(sand, craterMid, 0.3);
  const seam = mix(craterMid, shadow, 0.35);
  const c = size / 2 - 0.5;
  const facing = (direction * Math.PI) / 4;
  const outer = size / 2 - 0.6;
  const inner = outer - 4.2;
  const bags = 22;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - c;
      const dy = y - c;
      const r = Math.hypot(dx, dy);
      if (r > outer || r < inner) continue;
      const angle = Math.atan2(dy, dx);
      const off = Math.abs(((angle - facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (off > Math.PI * 0.36) continue;
      // Two courses of bags, the outer offset half a bag against the inner.
      const course = r > (inner + outer) / 2 ? 1 : 0;
      const along = ((((angle / (Math.PI * 2)) * bags + course * 0.5) % 1) + 1) % 1;
      const depth = (r - inner) / (outer - inner);
      let colour = burlap;
      if (along < 0.14 || Math.abs(depth - 0.5) < 0.08) colour = seam;
      else if (dy < 0 && along < 0.55) colour = lit;
      else if (r > outer - 1) colour = seam;
      p.set(x, y, colour);
    }
  }
  return p;
}

/**
 * A pile of `count` iron balls, stacked two and one, beside a gun ready to fire: the
 * bottom right taken first, so two left stand one on the other rather than side by side,
 * which with their lit pixels looked out of the dark as a pair of eyes.
 */
function balls(art: ArtConfig, count: number): Pixels {
  const p = new Pixels(8, 8);
  const { shadow, rockMid, rockDark } = art.palette;
  const iron = mix(rockDark, shadow, 0.45);
  const rockLight = mix(rockMid, rockDark, 0.3);
  const spots = [
    [1.8, 5.2],
    [3.5, 2.6],
    [5.2, 5.2],
  ]
    .slice(0, count)
    // The lower first, so the top ball lies over them.
    .sort((a, b) => (b[1] as number) - (a[1] as number));
  for (const [x, y] of spots as [number, number][]) {
    p.disc(x + 0.5, y + 0.6, 1.8, shadow);
    p.disc(x, y, 1.6, iron);
    p.set(x - 0.6, y - 0.6, rockLight);
  }
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

/**
 * An iron ball: dark, a pixel of light on its northern shoulder and a rim of it beneath, so
 * it reads over dark sea as over grass. Pale grey chips read as stone, not shot.
 */
function shot(art: ArtConfig, size: number): Pixels {
  const p = new Pixels(size, size);
  const { shadow, rockDark, rockMid, uiInk } = art.palette;
  const c = size / 2 - 0.5;
  p.disc(c, c, size / 2 - 0.5, shadow);
  p.disc(c, c, size / 2 - 1.5, mix(rockDark, shadow, 0.35));
  // The light the sky throws back up under it, along the lower right of the rim.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x - c, y - c);
      if (r > size / 2 - 1.5 && r <= size / 2 - 0.5 && x - c + (y - c) > 1.5) p.set(x, y, rockMid);
    }
  }
  p.set(c - 1, c - 1, uiInk);
  p.set(c, c - 1.5, rockMid);
  return p;
}

/** Night's shot, burning: a white-hot heart in a ball of flame. */
function burningShot(art: ArtConfig, size: number): Pixels {
  const p = new Pixels(size, size);
  const { emberHot, emberMid, emberCool } = art.palette;
  const c = size / 2 - 0.5;
  p.disc(c, c, size / 2 - 0.5, emberCool);
  p.disc(c, c, size / 2 - 1.3, emberMid);
  p.disc(c - 0.4, c - 0.4, size / 2 - 2.3, emberHot);
  p.set(c - 1, c - 1, '#ffffff');
  return p;
}

/**
 * A puff of smoke in white, to be tinted and faded where it is used: a round body, shaded on
 * its south side, its edge broken so a row of them is a trail and not a string of beads.
 */
function smoke(rng: Rng, size: number): Pixels {
  const p = new Pixels(size, size);
  const c = size / 2 - 0.5;
  const r = size / 2 - 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      if (d > r) continue;
      if (d > r - 1 && rng.nextFloat() < 0.5) continue;
      p.set(x, y, y > c + 1 ? '#c4c6cc' : '#ffffff', d > r - 1 ? 0.6 : 1);
    }
  }
  return p;
}

/** An ember, three pixels across: a hot heart and a cooler cross round it. */
function ember(art: ArtConfig): Pixels {
  const p = new Pixels(3, 3);
  for (const [x, y] of [
    [1, 0],
    [0, 1],
    [2, 1],
    [1, 2],
  ] as const) {
    p.set(x, y, art.palette.emberMid, 0.75);
  }
  p.set(1, 1, art.palette.emberHot);
  return p;
}

/**
 * A strip of field, a tile of it: furrows across, tilled earth or a crop coming up. Laid in
 * strips of alternating rows, as open-field farming had, on open land — terrain under
 * everything built, never in an owner's colour, and flat and pale where a wall is raised.
 */
function field(art: ArtConfig, rng: Rng, size: number, kind: 'tilled' | 'crop'): Pixels {
  const p = new Pixels(size, size);
  const { craterMid, sand, grassMid, grassLight, shadow } = art.palette;
  const base = kind === 'tilled' ? mix(craterMid, sand, 0.5) : mix(grassLight, sand, 0.45);
  const furrow = kind === 'tilled' ? mix(craterMid, shadow, 0.15) : mix(grassMid, craterMid, 0.3);
  const ridge = kind === 'tilled' ? mix(sand, craterMid, 0.25) : mix(grassLight, sand, 0.7);
  p.fill(base);
  // Furrows broken here and there, as a plough leaves them; unbroken, they read as planks.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (rng.nextFloat() < 0.18) continue;
      if (y % 4 === 1) p.set(x, y, furrow, 0.7);
      else if (y % 4 === 2) p.set(x, y, ridge, 0.45);
    }
  }
  p.speckle(rng, kind === 'tilled' ? craterMid : grassMid, 0.1);
  p.speckle(rng, kind === 'tilled' ? sand : grassLight, 0.05);
  return p;
}

/**
 * A dirt track running south, a tile of it, starting at the middle of the tile's top and
 * bending `shift` pixels aside by its foot, so tiles laid with their offsets carried on make
 * it wander: two ruts in packed earth, its edges ragged into the grass. `end` is where it
 * runs out, narrowing to nothing. Straight, a track read as a pole lying under the castle.
 */
function track(art: ArtConfig, rng: Rng, size: number, shift: number, end: boolean): Pixels {
  const p = new Pixels(size, size);
  const { sand, craterMid, grassLight } = art.palette;
  const earth = mix(sand, craterMid, 0.25);
  const rut = mix(craterMid, sand, 0.35);
  for (let y = 0; y < size; y++) {
    const c = size / 2 - 0.5 + (shift * y) / size;
    const narrowing = end ? Math.max(0, 1 - Math.max(0, y - size * 0.35) / (size * 0.5)) : 1;
    const half = 4.2 * narrowing + (rng.nextFloat() < 0.3 ? 0.7 : 0);
    if (half < 0.6) continue;
    for (let x = 0; x < size; x++) {
      const d = Math.abs(x - c);
      if (d > half) continue;
      const edge = d > half - 1;
      if (edge && rng.nextFloat() < 0.35) continue;
      p.set(x, y, edge ? mix(earth, grassLight, 0.4) : earth, edge ? 0.7 : 0.9);
    }
    if (narrowing > 0.5) {
      p.set(c - 1.8, y, rut, 0.7);
      p.set(c + 1.8, y, rut, 0.7);
    }
  }
  return p;
}

/**
 * A sheep, side on, facing right or `left`, 12 by 10 pixels: a pale fleece, a dark face and
 * legs. Poses: standing, two steps of walking, and grazing with its head down. Pale and
 * woolly against the dark iron of a shot, and lying under the walls, never over them.
 */
function sheep(art: ArtConfig, pose: number, left: boolean): Pixels {
  const p = new Pixels(12, 10);
  const { shadow, uiInk, rockLight, craterDark } = art.palette;
  const at = (x: number): number => (left ? 11 - x : x);
  const dot = (x: number, y: number, colour: string, alpha = 1): void =>
    p.set(at(x), y, colour, alpha);
  const fleece = mix(uiInk, '#ffffff', 0.45);
  const face = mix(craterDark, '#5a4a40', 0.4);
  // Its shadow on the grass.
  for (let x = 2; x <= 9; x++) dot(x, 9, shadow, 0.3);
  // Legs: standing, or the two steps of a walk.
  const legs = pose === 1 ? [2, 6] : pose === 2 ? [3, 7] : [2, 3, 6, 7];
  for (const x of legs) {
    dot(x, 7, face);
    dot(x, 8, face);
  }
  // The fleece, round, its underside in shade, a few curls lit on top.
  for (let y = 2; y <= 7; y++) {
    for (let x = 1; x <= 8; x++) {
      const dx = (x - 4.6) / 4;
      const dy = (y - 4.4) / 2.7;
      if (dx * dx + dy * dy > 1) continue;
      dot(x, y, y >= 6 ? rockLight : fleece);
    }
  }
  dot(3, 2, '#ffffff');
  dot(6, 3, '#ffffff');
  // The head, dark, up looking about or down at the grass.
  const headY = pose === 3 ? 6 : 3;
  dot(8, headY, face);
  dot(9, headY, face);
  dot(9, headY + 1, face);
  dot(10, headY + 1, face);
  dot(8, headY - 1, face);
  return p;
}

/**
 * A mason, 8 by 12 pixels, facing right or `left`, a step of two: a hooded figure in a
 * brown tunic with a hod of grey stones on his shoulder, behind him as he walks.
 */
function mason(art: ArtConfig, frame: number, left: boolean): Pixels {
  const p = new Pixels(8, 12);
  const { shadow, craterMid, craterDark, sand, rockLight, rockMid } = art.palette;
  const at = (x: number): number => (left ? 7 - x : x);
  const dot = (x: number, y: number, colour: string, alpha = 1): void =>
    p.set(at(x), y, colour, alpha);
  const tunic = mix(craterMid, sand, 0.35);
  const skin = '#e0b088';
  for (let x = 2; x <= 6; x++) dot(x, 11, shadow, 0.3);
  // Legs, apart and together.
  if (frame === 0) {
    dot(3, 9, craterDark);
    dot(3, 10, craterDark);
    dot(5, 9, craterDark);
    dot(5, 10, craterDark);
  } else {
    dot(4, 9, craterDark);
    dot(4, 10, craterDark);
  }
  for (let y = 5; y <= 8; y++) for (let x = 3; x <= 5; x++) dot(x, y, tunic);
  dot(5, 6, mix(tunic, shadow, 0.3));
  dot(6, 6, skin);
  dot(4, 3, skin);
  dot(5, 3, skin);
  dot(4, 4, skin);
  dot(5, 4, skin);
  dot(4, 2, tunic);
  dot(3, 3, tunic);
  // The hod over his shoulder: its pole, and the trough of stones behind his head.
  dot(3, 5, craterDark);
  dot(2, 4, craterDark);
  for (let x = 0; x <= 2; x++) dot(x, 3, craterDark);
  dot(0, 2, rockLight);
  dot(1, 2, rockMid);
  dot(2, 2, rockLight);
  dot(1, 1, rockLight);
  return p;
}

/** A brazier, 8 pixels: an iron bowl of coals on three legs, the coals dull until lit. */
function brazier(art: ArtConfig): Pixels {
  const p = new Pixels(8, 8);
  const { shadow, rockDark, rockMid, emberCool } = art.palette;
  p.set(1, 7, shadow);
  p.set(6, 7, shadow);
  p.set(2, 6, rockDark);
  p.set(5, 6, rockDark);
  p.set(3, 6, rockDark);
  p.set(4, 6, rockDark);
  p.rect(1, 3, 6, 2, rockDark);
  p.rect(2, 5, 4, 1, rockDark);
  p.rect(1, 3, 6, 1, rockMid);
  p.rect(2, 3, 4, 1, emberCool);
  return p;
}

/** A brazier's flame, a frame of three: the tongue leaning and stretching as it burns. */
function flame(art: ArtConfig, frame: number): Pixels {
  const p = new Pixels(6, 8);
  const { emberHot, emberMid, emberCool } = art.palette;
  const lean = [0, 1, -1][frame] as number;
  const tall = [7, 6, 7][frame] as number;
  for (let y = 0; y < 8; y++) {
    const up = 7 - y;
    if (up >= tall) continue;
    const half = 2.6 * (1 - up / tall);
    const cx = 2.5 + (lean * up) / tall;
    for (let x = 0; x < 6; x++) {
      const d = Math.abs(x - cx);
      if (d > half) continue;
      p.set(
        x,
        y,
        d < half * 0.4 && up < tall * 0.6 ? emberHot : up > tall * 0.7 ? emberCool : emberMid,
      );
    }
  }
  return p;
}

/**
 * Night's lighthouse, a tile wide and two high: a rock at its foot, a tower banded red and
 * white narrowing as it rises, lit on the west, a gallery, and the lamp room under its cap
 * with the lamp burning in it.
 */
function lighthouse(art: ArtConfig): Pixels {
  const p = new Pixels(16, 32);
  const { shadow, rockDark, rockMid, rockLight, emberCool, emberHot, emberMid } = art.palette;
  const red = mix(emberCool, '#d04030', 0.5);
  // The rock it stands on, at the water.
  for (let y = 26; y < 32; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = (x - 7.5) / 7.5;
      const dy = (y - 28.5) / 3.5;
      if (dx * dx + dy * dy > 1) continue;
      p.set(x, y, y < 28 ? rockMid : rockDark);
    }
  }
  // The tower, banded, narrowing toward the top.
  for (let y = 9; y < 29; y++) {
    const half = 2.6 + ((y - 9) / 20) * 1.6;
    const band = Math.floor((y - 9) / 4) % 2 === 0 ? red : rockLight;
    for (let x = 0; x < 16; x++) {
      const d = x - 7.5;
      if (Math.abs(d) > half) continue;
      const side = d / half;
      p.set(
        x,
        y,
        side < -0.5 ? mix(band, '#ffffff', 0.25) : side > 0.35 ? mix(band, shadow, 0.45) : band,
      );
    }
  }
  p.rect(7, 20, 2, 3, shadow);
  // The gallery, its rail, and the lamp room with the lamp in it.
  p.rect(3, 8, 10, 1, shadow);
  p.rect(4, 7, 8, 1, rockDark);
  p.rect(5, 3, 6, 4, shadow);
  p.rect(6, 4, 4, 3, emberMid);
  p.rect(6, 4, 4, 2, emberHot);
  p.set(7, 4, '#ffffff');
  // The cap, pointed, and its vane.
  p.rect(4, 2, 8, 1, rockDark);
  p.rect(5, 1, 6, 1, rockDark);
  p.rect(7, 0, 2, 1, rockMid);
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
const SCENERY_VARIANTS = 4;

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

  // The style pass's additions (ARCHIVE 12zx), drawn last so the seed's draws for every
  // sprite above are as they were.
  yield atlas.add(KEY.mainCastle, castle(art, rng, tile * 3, true));
  yield atlas.add(KEY.gilt, gilt(art, tile * 3));
  for (const main of [false, true]) yield atlas.add(KEY.lights(main), lights(art, tile * 3, main));
  for (let d = 0; d < 8; d++) yield atlas.add(KEY.sandbags(d), sandbags(art, tile * 2, d));
  for (let n = 1; n <= 3; n++) yield atlas.add(KEY.balls(n), balls(art, n));
  yield atlas.add(KEY.burningShot, burningShot(art, 8));
  for (let v = 0; v < 2; v++) yield atlas.add(KEY.smoke(v), smoke(rng, 8));
  yield atlas.add(KEY.ember, ember(art));
  for (const kind of ['tilled', 'crop'] as const) {
    for (let v = 0; v < 2; v++) yield atlas.add(KEY.field(kind, v), field(art, rng, tile, kind));
  }
  for (const shift of [-4, 0, 4]) {
    for (const end of [false, true]) {
      yield atlas.add(KEY.track(shift, end), track(art, rng, tile, shift, end));
    }
  }
  for (const left of [false, true]) {
    for (let pose = 0; pose < 4; pose++)
      yield atlas.add(KEY.sheep(pose, left), sheep(art, pose, left));
    for (let f = 0; f < 2; f++) yield atlas.add(KEY.mason(f, left), mason(art, f, left));
  }
  yield atlas.add(KEY.brazier, brazier(art));
  for (let f = 0; f < 3; f++) yield atlas.add(KEY.flame(f), flame(art, f));
  yield atlas.add(KEY.lighthouse, lighthouse(art));
}
