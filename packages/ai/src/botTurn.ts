import { sameTeam, type MatchState } from '@bollwerk/sim';

/**
 * What a bot's guns, walls and siting share: its pace in ticks, who its rivals are, and
 * where each island's middle lies.
 */

/** A span of time as whole ticks, never none: bots act at a person's pace, in milliseconds. */
export function ticksFor(ms: number, state: MatchState): number {
  return Math.max(1, Math.round((ms * state.ruleset.tickRateHz) / 1000));
}

/** Rivals still in it: never a teammate. */
export function rivalsOf(state: MatchState, playerId: number): MatchState['players'] {
  return state.players.filter((p) => !p.eliminated && !sameTeam(state, playerId, p.id));
}

/** Island middles, measured once each: islands never move. */
export class IslandCentres {
  private readonly centres = new Map<number, { x: number; y: number }>();

  centre(state: MatchState, island: number): { x: number; y: number } {
    let centre = this.centres.get(island);
    if (centre === undefined) {
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (let i = 0; i < state.islandId.length; i++) {
        if (state.islandId[i] !== island) continue;
        sx += i % state.width;
        sy += Math.floor(i / state.width);
        n++;
      }
      centre = { x: sx / Math.max(1, n), y: sy / Math.max(1, n) };
      this.centres.set(island, centre);
    }
    return centre;
  }
}
