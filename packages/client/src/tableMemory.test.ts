import { describe, expect, it } from 'vitest';

import { readTable } from './tableMemory.js';

const base = { maxRounds: 10, teamSize: 1, continues: 2, specials: true };
const bounds = {
  maxRounds: { min: 1, max: 15 },
  teamSize: { min: 1, max: 4 },
  continues: { min: 0, max: 4 },
};
const limits = { min: 2, max: 8 };
const read = (raw: unknown) => readTable(raw, base, bounds, limits, 5);

describe('the remembered table', () => {
  it('opens as it was left', () => {
    const table = read({
      maxRounds: 6,
      teamSize: 2,
      continues: 0,
      playerCount: 4,
      teams: [0, 1, 0, 1],
      bots: [3, 7, 9, 2],
      botTowers: ['drawn', null, 'bertha3', 'drawn'],
      hostSeat: 2,
    });
    expect(table?.settings).toEqual({ maxRounds: 6, teamSize: 2, continues: 0, specials: true });
    expect(table?.playerCount).toBe(4);
    expect(table?.teams).toEqual([0, 1, 0, 1]);
    expect(table?.bots).toEqual([3, 7, 9, 2, 5, 5, 5, 5]);
    expect(table?.botTowers.slice(0, 4)).toEqual(['drawn', null, 'bertha3', 'drawn']);
    expect(table?.hostSeat).toBe(2);
  });

  it('takes the special towers from today’s settings, never from the save', () => {
    expect(read({ specials: false })?.settings.specials).toBe(true);
  });

  it('falls back part by part on anything out of bounds or malformed', () => {
    const table = read({
      maxRounds: 99,
      teamSize: 'two',
      continues: -1,
      playerCount: 3,
      teams: [0, 0, 0],
      bots: [0, 11, 4.5, 6],
      botTowers: ['catapult', 'drawn'],
      hostSeat: 7,
    });
    expect(table?.settings).toEqual(base);
    expect(table?.playerCount).toBe(3);
    // Unequal teams are refused, as the lobby refuses them: seat order instead.
    expect(table?.teams).toEqual([0, 1, 2]);
    expect(table?.bots.slice(0, 4)).toEqual([5, 5, 5, 6]);
    expect(table?.botTowers.slice(0, 2)).toEqual(['drawn', 'drawn']);
    expect(table?.hostSeat).toBe(0);
  });

  it('fits the count to the team size, as the lobby does', () => {
    // Teams of three need six seats.
    const table = read({ teamSize: 3, playerCount: 4 });
    expect(table?.playerCount).toBe(6);
    expect(table?.teams).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it('is nothing at all for no save', () => {
    expect(read(null)).toBeNull();
    expect(read('a table')).toBeNull();
  });
});
