import { tileX, tileY, type Cell, type ViewTransform } from './theme.js';

/**
 * Wall geometry shared by the styles drawn from shapes rather than sprites, so every one
 * of them stands its walls up as the pixel style does, to the same height, and the looks
 * agree as a banner swaps them.
 */

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A wall block on screen: its tile, its top's edges, and whether it shows a face. */
export interface WallBlock {
  x: number;
  y: number;
  left: number;
  top: number;
  /** Where its top meets its face; its foot when it has none. */
  lip: number;
  faced: boolean;
}

export interface WallGeometry {
  blocks: WallBlock[];
  /** The top of each block, down to its lip. */
  tops: Rect[];
  /** The front face of each block with nothing to its south. */
  faces: Rect[];
  /** The outline of the tops where they do not run on into each other. */
  rim: Segment[];
  /** Where faces meet the ground, and their open ends. */
  faceEdges: Segment[];
  /** Across the middle of each face, for a style's strip of light or course of stone. */
  strips: Segment[];
  /** Height of a face, in screen pixels. */
  face: number;
}

/**
 * Stands a set of wall cells up: a block with nothing to its south shows a front face of
 * `faceFraction` of a tile below its top — the pixel style's `frontFacePx` over its tile
 * size. `joins` says which tiles count as the same wall, both for the outline and for
 * whether anything stands to a block's south.
 */
export function wallGeometry(
  cells: readonly Cell[],
  joins: (x: number, y: number) => boolean,
  view: ViewTransform,
  faceFraction: number,
): WallGeometry {
  const t = view.tile;
  const face = t * faceFraction;
  const faced = (x: number, y: number): boolean => joins(x, y) && !joins(x, y + 1);
  const blocks = cells.map(({ x, y }): WallBlock => {
    const top = tileY(view, y);
    const has = faced(x, y);
    return { x, y, left: tileX(view, x), top, lip: top + t - (has ? face : 0), faced: has };
  });
  const seg = (x1: number, y1: number, x2: number, y2: number): Segment => ({ x1, y1, x2, y2 });
  const rim: Segment[] = [];
  const faceEdges: Segment[] = [];
  const strips: Segment[] = [];
  for (const b of blocks) {
    const right = b.left + t;
    const bottom = b.top + t;
    // The top's outline: its north side, its lip, its open sides down to the lip, and
    // the stretch of a shared side where the neighbour has a face and it does not,
    // since there its top meets that face.
    if (!joins(b.x, b.y - 1)) rim.push(seg(b.left, b.top, right, b.top));
    if (b.faced) rim.push(seg(b.left, b.lip, right, b.lip));
    for (const [dx, at] of [
      [-1, b.left],
      [1, right],
    ] as const) {
      if (!joins(b.x + dx, b.y)) rim.push(seg(at, b.top, at, b.lip));
      else if (!b.faced && faced(b.x + dx, b.y)) rim.push(seg(at, bottom - face, at, bottom));
    }
    if (!b.faced) continue;
    strips.push(seg(b.left, b.lip + face / 2, right, b.lip + face / 2));
    faceEdges.push(seg(b.left, bottom, right, bottom));
    if (!faced(b.x - 1, b.y)) faceEdges.push(seg(b.left, b.lip, b.left, bottom));
    if (!faced(b.x + 1, b.y)) faceEdges.push(seg(right, b.lip, right, bottom));
  }
  return {
    blocks,
    tops: blocks.map((b) => ({ x: b.left, y: b.top, w: t, h: b.lip - b.top })),
    faces: blocks.filter((b) => b.faced).map((b) => ({ x: b.left, y: b.lip, w: t, h: face })),
    rim,
    faceEdges,
    strips,
    face,
  };
}

/**
 * Parallel diagonal lines across a rectangle, `spacing` apart, rising to the right
 * (`'/'`) or falling (`'\'`). The lines lie on one lattice across the whole screen, so
 * the hatching of neighbouring rectangles runs on unbroken, as one fill.
 */
export function hatch(rect: Rect, spacing: number, direction: '/' | '\\'): Segment[] {
  const { x, y, w, h } = rect;
  const lines: Segment[] = [];
  if (w <= 0 || h <= 0 || spacing <= 0) return lines;
  if (direction === '/') {
    // Lines x + y = c.
    const lo = x + y;
    const hi = x + w + y + h;
    for (let c = Math.ceil(lo / spacing) * spacing; c <= hi; c += spacing) {
      const xa = Math.max(x, c - (y + h));
      const xb = Math.min(x + w, c - y);
      if (xb > xa) lines.push({ x1: xa, y1: c - xa, x2: xb, y2: c - xb });
    }
  } else {
    // Lines x - y = c.
    const lo = x - (y + h);
    const hi = x + w - y;
    for (let c = Math.ceil(lo / spacing) * spacing; c <= hi; c += spacing) {
      const xa = Math.max(x, c + y);
      const xb = Math.min(x + w, c + y + h);
      if (xb > xa) lines.push({ x1: xa, y1: xa - c, x2: xb, y2: xb - c });
    }
  }
  return lines;
}

/** Traces segments into a Graphics path, ready for one stroke. */
export function trace(
  g: { moveTo(x: number, y: number): unknown; lineTo(x: number, y: number): unknown },
  segments: readonly Segment[],
): void {
  for (const s of segments) {
    g.moveTo(s.x1, s.y1);
    g.lineTo(s.x2, s.y2);
  }
}

/** A segment as dashes, `on` drawn and `off` left between, for plans and borders. */
export function dashed(segment: Segment, on: number, off: number): Segment[] {
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  const length = Math.hypot(dx, dy);
  if (length === 0) return [];
  const out: Segment[] = [];
  for (let s = 0; s < length; s += on + off) {
    const e = Math.min(length, s + on);
    out.push({
      x1: segment.x1 + (dx * s) / length,
      y1: segment.y1 + (dy * s) / length,
      x2: segment.x1 + (dx * e) / length,
      y2: segment.y1 + (dy * e) / length,
    });
  }
  return out;
}

/** The sides of a set of tiles that face out of it, for outlining a region or a piece. */
export function outline(
  cells: readonly Cell[],
  inside: (x: number, y: number) => boolean,
  view: ViewTransform,
): Segment[] {
  const out: Segment[] = [];
  for (const { x, y } of cells) {
    const left = tileX(view, x);
    const top = tileY(view, y);
    const right = left + view.tile;
    const bottom = top + view.tile;
    if (!inside(x, y - 1)) out.push({ x1: left, y1: top, x2: right, y2: top });
    if (!inside(x + 1, y)) out.push({ x1: right, y1: top, x2: right, y2: bottom });
    if (!inside(x, y + 1)) out.push({ x1: left, y1: bottom, x2: right, y2: bottom });
    if (!inside(x - 1, y)) out.push({ x1: left, y1: top, x2: left, y2: bottom });
  }
  return out;
}
