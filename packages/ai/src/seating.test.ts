import { SPECIAL_KINDS, defaultTerrainConfig } from '@bollwerk/config';
import { describe, expect, it } from 'vitest';

import { dealSeats, drawnSpecial } from './seating.js';

describe('special towers at the table', () => {
  it('draws every bot a tower from the seed and its seat, never none', () => {
    const drawn = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      for (let seat = 0; seat < 8; seat++) {
        const special = drawnSpecial(seed, seat);
        expect(SPECIAL_KINDS).toContain(special);
        expect(drawnSpecial(seed, seat)).toBe(special);
        drawn.add(special);
      }
    }
    expect(drawn.size).toBe(SPECIAL_KINDS.length);
  });

  it("gives a person their choice and a bot its seat's draw, by the player each becomes", () => {
    const dealt = dealSeats(
      9,
      [
        { level: null, bot: false, special: 'architect' },
        { level: 5, bot: true, special: 'architect' },
        { level: 5, bot: false, special: null },
      ],
      defaultTerrainConfig,
    );
    const player = (seat: number): number => dealt.playerOfSeat[seat] as number;
    expect(dealt.specials[player(0)]).toBe('architect');
    // A bot brings its draw whatever the seat says.
    expect(dealt.specials[player(1)]).toBe(drawnSpecial(9, 1));
    // A person who chose none brings none, though a bot stands by to cover them.
    expect(dealt.specials[player(2)]).toBeNull();
  });
});
