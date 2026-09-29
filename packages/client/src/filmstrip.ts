import type { ArtConfig, PlayerPalette } from '@rampart/config';
import { Structure, Terrain, type MatchState } from '@rampart/sim';

/**
 * The filmstrip in the end-of-match summary (PLAN 11.11 W6): the board at each round's
 * resolution, one pixel per tile, beside the score chart — so where a match turned can
 * be seen as well as read. Drawn from the state alone, in the shared colours the summary
 * uses, as a pure function so it is tested without a browser; the HUD scales it up.
 */

type Rgb = readonly [number, number, number];

export interface FilmColours {
  water: Rgb;
  land: Rgb;
  /** An eliminated player's wall, which is nobody's. */
  rubble: Rgb;
  players: readonly { base: Rgb; light: Rgb; dark: Rgb }[];
}

function rgb(hex: string): Rgb {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** The summary's colours: the shared palette and the match's player ramps. */
export function filmColours(art: ArtConfig, players: readonly PlayerPalette[]): FilmColours {
  return {
    water: rgb(art.palette.waterDeep),
    land: rgb(art.palette.grassDark),
    rubble: rgb(art.palette.rockMid),
    players: players.map((p) => ({ base: rgb(p.base), light: rgb(p.light), dark: rgb(p.dark) })),
  };
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/**
 * RGBA, `width × height`, one pixel a tile: sea, land, sealed ground washed in its owner's
 * colour, walls in it outright, castles and guns in its dark shade.
 */
export function boardPicture(state: MatchState, colours: FilmColours): Uint8ClampedArray {
  const out = new Uint8ClampedArray(state.width * state.height * 4);
  const ramp = (island: number) => colours.players[(island - 1) % colours.players.length];
  for (let i = 0; i < state.width * state.height; i++) {
    let c: Rgb = state.terrain[i] === Terrain.Land ? colours.land : colours.water;
    const held = state.territory[i] as number;
    if (held > 0) c = mix(colours.land, ramp(held)?.light ?? c, 0.45);
    const structure = state.structure[i];
    if (structure === Structure.Wall) {
      const owner = state.owner[i] as number;
      c = owner > 0 ? (ramp(owner)?.base ?? c) : colours.rubble;
    } else if (structure === Structure.Castle || structure === Structure.Cannon) {
      c = ramp(state.islandId[i] as number)?.dark ?? c;
    }
    out.set([c[0], c[1], c[2], 255], i * 4);
  }
  return out;
}

/** One frame of the strip. */
export interface Frame {
  round: number;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}
