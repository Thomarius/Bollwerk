import { defaultRuleset, defaultTerrainConfig, type Ruleset } from '@bollwerk/config';
import { describe, expect, it } from 'vitest';

import { applyAction, createMatch, step } from './match.js';
import { canPlacePiece } from './placement.js';
import { fire, resolveImpacts } from './shots.js';
import { seatOrder, tableTeamSize, teamScore, denseTeams } from './teams.js';
import { generateTerrain, patternFor, planLayout } from './terrain.js';
import { stateFromAscii, withoutContinues } from './testing.js';
import { Structure, type MatchState } from './types.js';

/** Three sealed rings on three islands, twelve enclosed tiles apiece. */
const ART = `
  ........................
  .######..######..######.
  .#,,,,#..#,,,,#..#,,,,#.
  .#,@@,#..#,@@,#..#,@@,#.
  .#,@@,#..#,@@,#..#,@@,#.
  .######..######..######.
  ........................
`;
const ISLANDS = `
  ........................
  ........2222222233333333
  ........2222222233333333
  ........2222222233333333
  ........2222222233333333
  ........2222222233333333
  ........................
`;

const uncapped: Ruleset = {
  ...withoutContinues(defaultRuleset),
  scoring: { ...defaultRuleset.scoring, maxRounds: null },
};

/** Players 0 and 1 a team, player 2 alone, with `lives` in each pool. */
function teamed(ruleset: Ruleset = uncapped, lives = 0): MatchState {
  const state = stateFromAscii(ART, ruleset, ISLANDS);
  state.players[1]!.team = 0;
  state.players[2]!.team = 1;
  state.teams = [
    { id: 0, continuesRemaining: lives, continuesAtStart: lives },
    { id: 1, continuesRemaining: lives, continuesAtStart: lives },
  ];
  return state;
}

function resolve(state: MatchState, round = 1): void {
  state.ruleset = { ...state.ruleset, build: { ...state.ruleset.build, overtimeMs: 0 } };
  state.phase = 'build';
  state.round = round;
  state.phaseEndTick = state.tick + 1;
  step(state);
}

function breach(state: MatchState, player: number): void {
  const i = 1 * state.width + 3 + 8 * player;
  state.structure[i] = Structure.Empty;
  state.owner[i] = 0;
}

describe('forming teams', () => {
  it('pools every member’s continues, and leaves free-for-all as teams of one', () => {
    const players = (teams: (number | undefined)[]) =>
      teams.map((team, i) =>
        team === undefined ? { name: `p${i}`, isBot: true } : { name: `p${i}`, isBot: true, team },
      );
    const options = { seed: 1, ruleset: defaultRuleset, terrainConfig: defaultTerrainConfig };
    const { continues } = defaultRuleset.elimination;

    const twoByTwo = createMatch({ ...options, players: players([7, 9, 7, 9]) });
    expect(twoByTwo.players.map((p) => p.team)).toEqual([0, 1, 0, 1]);
    expect(twoByTwo.teams.map((t) => t.continuesRemaining)).toEqual([2 * continues, 2 * continues]);

    const ffa = createMatch({ ...options, players: players([undefined, undefined, undefined]) });
    expect(ffa.players.map((p) => p.team)).toEqual([0, 1, 2]);
    expect(ffa.teams.map((t) => t.continuesRemaining)).toEqual([continues, continues, continues]);
  });
});

describe('no attacking a teammate', () => {
  it('refuses a shot at a teammate’s island', () => {
    const state = teamed();
    state.phase = 'combat';
    state.cannons.push({ id: 0, owner: 0, x: 3, y: 3, w: 1, h: 1, active: true, shotId: null });
    expect(fire(state, 0, 11, 1)).toEqual({ rejection: 'teammate_island' });
    expect('shot' in fire(state, 0, 19, 1)).toBe(true); // the other team is fair game
  });

  it('never clears a teammate’s wall, even with a crater that reaches it', () => {
    const state = teamed({ ...uncapped, shots: { ...uncapped.shots, craterPattern: 'square9' } });
    // Player 0 aims at open water beside island 2; the 3x3 crater takes in island 2's
    // west wall, which is a teammate's.
    const i = 1 * state.width + 9;
    state.shots.push({
      id: 0,
      cannonId: 0,
      owner: 0,
      fromX: 3,
      fromY: 3,
      toX: 8,
      toY: 1,
      launchTick: 0,
      impactTick: 0,
    });
    resolveImpacts(state);
    expect(state.structure[i]).toBe(Structure.Wall);
    expect(state.players[0]!.wallsDestroyed).toBe(0);
  });
});

describe('lives, together', () => {
  it('spends a failing member’s life from the team’s pool', () => {
    const state = teamed(uncapped, 2);
    breach(state, 1);
    resolve(state);
    expect(state.players[1]!.eliminated).toBe(false);
    expect(state.teams[0]!.continuesRemaining).toBe(1);
    expect(state.teams[1]!.continuesRemaining).toBe(2);
  });

  it('puts the whole team out when a member fails with the pool empty', () => {
    const state = teamed(uncapped, 0);
    breach(state, 1);
    resolve(state);
    // Player 0 sealed perfectly, and is out with their teammate.
    expect(state.players[0]!.eliminated).toBe(true);
    expect(state.players[1]!.eliminated).toBe(true);
    expect(state.phase).toBe('game_over');
    expect(state.winners).toEqual([2]);
  });

  it('counts the team’s lives spent for the continue bonus, and caps it', () => {
    const ruleset: Ruleset = {
      ...uncapped,
      elimination: { ...uncapped.elimination, extraCannonsPerContinue: 2, maxExtraCannons: 3 },
    };
    const state = teamed(ruleset, 4);
    breach(state, 0);
    resolve(state);
    const { startingCount } = ruleset.cannons;
    expect(state.players[0]!.cannonsToPlace).toBe(startingCount + 2); // one spent
    // Next round both members fail — player 0's island was wiped — spending the team's
    // second and third lives: 2 x 3 = 6, capped at 3.
    breach(state, 1);
    resolve(state, 2);
    expect(state.players[1]!.cannonsToPlace).toBe(startingCount + 3);
  });
});

describe('winning as a team', () => {
  it('sums the members’ scores at the cap, and every member of the best team wins', () => {
    const state = teamed({ ...uncapped, scoring: { ...uncapped.scoring, maxRounds: 1 } });
    // Player 2 alone outscores either member of team 0, but not the two together.
    state.players[2]!.wallsDestroyed = 5;
    resolve(state, 1);
    expect(state.players[2]!.score).toBeGreaterThan(state.players[0]!.score);
    expect(teamScore(state, 0)).toBeGreaterThan(teamScore(state, 1));
    expect(state.winners).toEqual([0, 1]);
    expect(state.endedBy).toBe('round_cap');
  });
});

describe('building on a teammate’s island', () => {
  /** Somewhere on `island` this player's current piece is allowed to go, or null. */
  function spotOn(state: MatchState, player: number, island: number) {
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        if (state.islandId[y * state.width + x] !== island) continue;
        for (let rotation = 0; rotation < 4; rotation++) {
          if (canPlacePiece(state, player, rotation, x, y) === null) return { x, y, rotation };
        }
      }
    }
    return null;
  }

  function building(crossIslandBuild: 'none' | 'humans' | 'all'): MatchState {
    const state = teamed({ ...uncapped, teams: { crossIslandBuild } });
    // Open ground on every island, so a piece has somewhere to go.
    for (let i = 0; i < state.structure.length; i++) {
      if (state.structure[i] === Structure.Wall) {
        state.structure[i] = Structure.Empty;
        state.owner[i] = 0;
      }
    }
    state.phase = 'build';
    state.players[0]!.isBot = false;
    return state;
  }

  it('lets a person build for a teammate, and the wall is the teammate’s', () => {
    const state = building('humans');
    const spot = spotOn(state, 0, 2);
    expect(spot).not.toBeNull();
    expect(applyAction(state, { kind: 'place_piece', player: 0, ...spot! })).toBeNull();
    const placed = [...state.structure.keys()].filter((i) => state.structure[i] === Structure.Wall);
    expect(placed.length).toBeGreaterThan(0);
    // Owned by island 2, player 1, so it behaves as their own wall in every rule.
    for (const i of placed) expect(state.owner[i]).toBe(2);
  });

  it('never lets anybody build on an opponent’s island', () => {
    const state = building('all');
    expect(spotOn(state, 0, 3)).toBeNull();
  });

  it('keeps bots off a teammate’s island unless the rules say all may help', () => {
    expect(spotOn(building('humans'), 1, 1)).toBeNull();
    expect(spotOn(building('all'), 1, 1)).not.toBeNull();
  });

  it('can be turned off for everyone', () => {
    expect(spotOn(building('none'), 0, 2)).toBeNull();
  });
});

describe('which seat gets which island', () => {
  const config = defaultTerrainConfig;
  const free = [0, 1, 2, 3, 4, 5, 6, 7];

  it('is a shuffle, the same for the same seed and different for another', () => {
    const order = seatOrder(7, free, config);
    expect([...order].sort((a, b) => a - b)).toEqual(free);
    expect(seatOrder(7, free, config)).toEqual(order);
    const differs = [1, 2, 3, 4, 5].some(
      (seed) => seatOrder(seed, free, config).join() !== order.join(),
    );
    expect(differs).toBe(true);
  });

  it('knows a table by the size its teams share', () => {
    expect(tableTeamSize([0, 0, 1, 1, 2, 2])).toBe(2);
    expect(tableTeamSize([0, 1, 1, 0])).toBe(2);
    expect(tableTeamSize([0, 1, 2])).toBe(1);
    expect(tableTeamSize([0, 0, 1])).toBe(1);
    expect(tableTeamSize([undefined, undefined])).toBe(1);
  });

  /** Each team's islands as the deal gave them, by team label. */
  function islandsOf(order: number[], teams: number[]): number[][] {
    return [...new Set(teams)].map((label) =>
      order.filter((_, seat) => teams[seat] === label).sort((a, b) => a - b),
    );
  }

  /** A layout's teams, each as its sorted islands, in a stable order to compare by. */
  const key = (groups: readonly (readonly number[])[]): string =>
    groups
      .map((g) => [...g].sort((a, b) => a - b).join('+'))
      .sort()
      .join(' ');

  for (const [players, teams] of [
    [6, [0, 0, 1, 1, 2, 2]],
    [8, [0, 1, 0, 1, 2, 2, 3, 3]],
  ] as const) {
    it(`deals ${players / 2} teams of two onto one of the fair layouts, each in turn`, () => {
      const pattern = patternFor(config, players, 2);
      const layouts = new Map((pattern.teamLayouts ?? []).map((l) => [key(l.teams), 0]));
      expect(layouts.size).toBeGreaterThan(1);
      for (let seed = 0; seed < 400; seed++) {
        const order = seatOrder(seed, [...teams], config);
        expect([...order].sort((a, b) => a - b)).toEqual(free.slice(0, players));
        const dealt = key(islandsOf(order, [...teams]));
        expect(layouts.has(dealt), `seed ${seed}: ${dealt}`).toBe(true);
        layouts.set(dealt, (layouts.get(dealt) ?? 0) + 1);
      }
      // Drawn by weight: in the ring of six, neighbours half the time and opposite half.
      const total = 400;
      for (const layout of pattern.teamLayouts ?? []) {
        const share = (layouts.get(key(layout.teams)) ?? 0) / total;
        const weights = (pattern.teamLayouts ?? []).reduce((sum, l) => sum + l.weight, 0);
        expect(share).toBeGreaterThan((layout.weight / weights) * 0.7);
        expect(share).toBeLessThan((layout.weight / weights) * 1.3);
      }
    });
  }

  it('lays out three teams of two on a hex, and anyone else at six on the grid', () => {
    expect(patternFor(config, 6, 2).kind).toBe('hex');
    expect(patternFor(config, 6, 1).kind).toBe('grid');
    expect(patternFor(config, 6, 3).kind).toBe('grid');
    expect(patternFor(config, 8, 2).kind).toBe('grid');
    expect(patternFor(config, 8, 4).teamLayouts).toBeUndefined();
  });

  it('gives every team of a fair layout the same standing on the map', () => {
    // Each team's distances, centre to centre: between its own islands, and from each of
    // them to every other — on real maps, whose islands are trimmed to their land. Alike
    // for every team on the grid of four teams of two. Three teams of two play on a compact
    // hex whose seats are unalike, the users' choice of room over that (2026-10-09).
    for (const [players, seed] of [8].flatMap((n) => [1, 2, 3, 4, 5].map((s) => [n, s] as const))) {
      const plan = generateTerrain(config, players, seed, 2).layout;
      const centre = (i: number) => {
        const p = plan.placements[i] as { x: number; y: number };
        return { x: p.x + plan.boxWidth / 2, y: p.y + plan.boxHeight / 2 };
      };
      const apart = (a: number, b: number) => {
        const [p, q] = [centre(a), centre(b)];
        return Math.hypot(p.x - q.x, p.y - q.y);
      };
      for (const layout of patternFor(config, players, 2).teamLayouts ?? []) {
        const standings = layout.teams.map((team) => {
          const others = free.slice(0, players).filter((i) => !team.includes(i));
          return [
            apart(team[0] as number, team[1] as number),
            ...team.flatMap((i) => others.map((o) => apart(i, o))).sort((a, b) => a - b),
          ];
        });
        for (const standing of standings.slice(1)) {
          standing.forEach((d, i) => {
            expect(
              Math.abs(d - (standings[0]?.[i] ?? 0)),
              JSON.stringify(layout.teams),
            ).toBeLessThanOrEqual(1.5);
          });
        }
      }
    }
  });

  it('lays a hex flat: a pair above and below, an island each side, the rows a gap apart', () => {
    const hex = (rowGapTiles: number) =>
      planLayout(
        {
          ...config,
          patterns: [{ players: 6, teamSize: 2, kind: 'hex', rowGapTiles }],
        },
        6,
        2,
        26,
        22,
      ).placements;
    for (const gap of [2, 8]) {
      const p = hex(gap);
      // Clockwise from the top right: the side islands centred between the rows.
      expect((p[0] as { y: number }).y).toBe((p[5] as { y: number }).y);
      expect((p[2] as { y: number }).y - (p[0] as { y: number }).y).toBe(22 + gap);
      expect((p[1] as { y: number }).y).toBe(
        ((p[0] as { y: number }).y + (p[2] as { y: number }).y) / 2,
      );
      expect((p[1] as { x: number }).x).toBeGreaterThan((p[0] as { x: number }).x);
    }
    // Rows an island's height and two channels apart: a flat hexagon, neighbours alike.
    const flat = hex(26);
    const at = (i: number) => flat[i] as { x: number; y: number };
    const apart = (a: number, b: number) => Math.hypot(at(a).x - at(b).x, at(a).y - at(b).y);
    for (let i = 0; i < 6; i++)
      expect(Math.abs(apart(i, (i + 1) % 6) - apart(0, 5))).toBeLessThan(2);
  });

  it('builds the map a table of three teams of two plays on as the hex, wide', () => {
    const players = [0, 0, 1, 1, 2, 2].map((team, i) => ({ name: `P${i}`, isBot: true, team }));
    const ring = createMatch({ seed: 3, ruleset: defaultRuleset, terrainConfig: config, players });
    const grid = createMatch({
      seed: 3,
      ruleset: defaultRuleset,
      terrainConfig: config,
      players: players.map((p, i) => ({ ...p, team: i })),
    });
    expect(ring.width).toBeGreaterThan(grid.width);
  });
});

describe('team ids from the table labels', () => {
  it('numbers teams in label order, whichever player comes first', () => {
    // Player 0 was dealt a Team B seat: Team A must still be team 0, so the letter the
    // lobby showed is the letter the match shows.
    expect(denseTeams([1, 0, 0, 1])).toEqual([1, 0, 0, 1]);
    expect(denseTeams([2, 0, 1])).toEqual([2, 0, 1]);
  });

  it('closes gaps between labels', () => {
    expect(denseTeams([5, 9, 5, 9])).toEqual([0, 1, 0, 1]);
  });

  it('makes each unlabelled player a team of their own, in player order', () => {
    expect(denseTeams([undefined, undefined, undefined])).toEqual([0, 1, 2]);
    expect(denseTeams([undefined, 0, undefined, 0])).toEqual([1, 0, 2, 0]);
  });
});
