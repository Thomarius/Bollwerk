import type { MatchState } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { watchingText } from './watching.js';

/** Only the fields the strip reads. */
function state(players: { eliminated: boolean; team: number }[], phase = 'build'): MatchState {
  return {
    phase,
    players: players.map((p, id) => ({ id, name: `p${id}`, score: 0, ...p })),
  } as unknown as MatchState;
}

describe('the strip for a player who is out', () => {
  it('shows from the knockout until the end, for the player knocked out', () => {
    const s = state([
      { eliminated: true, team: 0 },
      { eliminated: false, team: 1 },
      { eliminated: false, team: 2 },
    ]);
    expect(watchingText(s, 0)).toBe("You're out — watching");
    expect(watchingText(s, 1)).toBeNull();
  });

  it('says the team in a team match', () => {
    const s = state([
      { eliminated: true, team: 0 },
      { eliminated: true, team: 0 },
      { eliminated: false, team: 1 },
      { eliminated: false, team: 1 },
    ]);
    expect(watchingText(s, 1)).toBe('Your team is out — watching');
  });

  it('goes at the end, and never shows for a spectator', () => {
    const over = state(
      [
        { eliminated: true, team: 0 },
        { eliminated: false, team: 1 },
      ],
      'game_over',
    );
    expect(watchingText(over, 0)).toBeNull();
    expect(watchingText(state([{ eliminated: true, team: 0 }]), -1)).toBeNull();
  });
});
