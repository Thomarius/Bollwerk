import { TOWER_VARIANTS, defaultRuleset, defaultTerrainConfig } from '@bollwerk/config';
import { describe, expect, it } from 'vitest';

import { dealSeats, drawnSpecial } from './seating.js';

describe('special towers at the table', () => {
  const { specials } = defaultRuleset;

  it('draws every bot a tower at a cost from the seed and its seat, never none', () => {
    const drawn = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      for (let seat = 0; seat < 8; seat++) {
        const special = drawnSpecial(seed, seat, specials);
        expect(TOWER_VARIANTS).toContain(special);
        expect(drawnSpecial(seed, seat, specials)).toBe(special);
        drawn.add(special);
      }
    }
    expect(drawn.size).toBe(TOWER_VARIANTS.length);
  });

  it('draws only among the variants the ruleset offers', () => {
    const only = { ...specials, bertha: { '2': specials.bertha['2'] } };
    for (let seed = 0; seed < 40; seed++) {
      for (let seat = 0; seat < 8; seat++)
        expect(drawnSpecial(seed, seat, only)).not.toBe('bertha3');
    }
  });

  it("gives a person their choice and a bot its seat's draw, by the player each becomes", () => {
    const dealt = dealSeats(
      9,
      [
        { level: null, bot: false, special: 'architect3' },
        { level: 5, bot: true, special: 'architect3' },
        { level: 5, bot: false, special: null },
      ],
      defaultTerrainConfig,
      specials,
    );
    const player = (seat: number): number => dealt.playerOfSeat[seat] as number;
    expect(dealt.specials[player(0)]).toBe('architect3');
    // A bot brings its draw whatever the seat says.
    expect(dealt.specials[player(1)]).toBe(drawnSpecial(9, 1, specials));
    // A person who chose none brings none, though a bot stands by to cover them.
    expect(dealt.specials[player(2)]).toBeNull();
  });

  it("gives a bot the host's choice, none included, and its draw where the host left it", () => {
    const dealt = dealSeats(
      9,
      [
        { level: 5, bot: true, botTower: 'frost3' },
        { level: 5, bot: true, botTower: null },
        { level: 5, bot: true, botTower: 'drawn' },
        // A person's choice is theirs; a bot's is never read for them.
        { level: null, bot: false, special: 'laser2', botTower: null },
      ],
      defaultTerrainConfig,
      specials,
    );
    const player = (seat: number): number => dealt.playerOfSeat[seat] as number;
    expect(dealt.specials[player(0)]).toBe('frost3');
    expect(dealt.specials[player(1)]).toBeNull();
    expect(dealt.specials[player(2)]).toBe(drawnSpecial(9, 2, specials));
    expect(dealt.specials[player(3)]).toBe('laser2');
  });
});
