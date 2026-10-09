/**
 * Hue arithmetic for styles whose ground is itself a colour an owner may share — Blueprint's
 * blue paper, Halloween's violet dusk — so an owner of that hue can be lifted off it (S1).
 */

/** A colour's hue in degrees, and its chroma, 0 to 1. */
export function hueOf(colour: number): { hue: number; chroma: number } {
  const r = ((colour >> 16) & 0xff) / 255;
  const g = ((colour >> 8) & 0xff) / 255;
  const b = (colour & 0xff) / 255;
  const max = Math.max(r, g, b);
  const chroma = max - Math.min(r, g, b);
  if (chroma === 0) return { hue: 0, chroma };
  const sector =
    max === r
      ? ((g - b) / chroma + 6) % 6
      : max === g
        ? (b - r) / chroma + 2
        : (r - g) / chroma + 4;
  return { hue: sector * 60, chroma };
}

/**
 * How near a colour's hue is to the ground's: 1 for the same, falling to 0 at `span`
 * degrees apart. A colour too grey to have a hue is near nothing.
 */
export function hueNearness(colour: number, ground: number, span: number): number {
  const a = hueOf(colour);
  if (a.chroma < 0.1) return 0;
  const apart = Math.abs(((a.hue - hueOf(ground).hue + 540) % 360) - 180);
  return Math.max(0, 1 - apart / span);
}
