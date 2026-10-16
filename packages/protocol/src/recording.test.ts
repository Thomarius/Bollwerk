import { defaultTerrainConfig } from '@bollwerk/config';
import {
  applyAction,
  beginMatch,
  createMatch,
  fastRuleset,
  legalCannonPlacements,
  step,
  withSpecials,
  type Action,
  type MatchState,
} from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import {
  MatchRecorder,
  RecordingHeaderSchema,
  matchOptionsOf,
  replayRecording,
  type RecordingLine,
} from './recording.js';

describe('a recording with special towers', () => {
  it('names each player’s tower in its header and replays exactly', () => {
    const ruleset = withSpecials(fastRuleset());
    const players = [
      { name: 'Ada', isBot: false, team: 0, special: 'rapid2' as const },
      { name: 'Bo', isBot: false, team: 1, special: null },
    ];
    const lines: RecordingLine[] = [];
    const recorder = new MatchRecorder((line) => lines.push(line), {
      id: 'test-recording-1',
      source: 'local',
      startedAt: '2026-10-14T00:00:00Z',
      code: null,
      seed: 3,
      ruleset,
      terrain: defaultTerrainConfig,
      players: players.map((p) => ({ ...p, level: null, personality: null })),
    });
    const state: MatchState = createMatch({
      seed: 3,
      ruleset,
      terrainConfig: defaultTerrainConfig,
      players,
    });
    const play = (actions: Action[]): void => {
      for (const action of actions) expect(applyAction(state, action)).toBeNull();
      step(state);
      recorder.stepped(state.tick - 1, actions, state);
    };
    // Read through a function: the loops change the phase behind the compiler's back.
    const phase = (): string => state.phase;
    while (phase() !== 'castle_select') play([]);
    play(
      state.players.map((p) => ({
        kind: 'select_castle',
        player: p.id,
        castleId: state.castles.find((c) => c.islandId === p.islandId)!.id,
      })),
    );
    // Through the opening and round one, to the cannon phase where a tower may be bought.
    while (!(phase() === 'cannon_place' && state.round === 1)) play([]);
    const spot = legalCannonPlacements(state, 0)[0]!;
    play([{ kind: 'place_cannon', player: 0, ...spot, special: true }]);
    expect(state.cannons.some((c) => c.kind === 'rapid')).toBe(true);
    for (let i = 0; i < 300; i++) play([]);

    const header = lines[0]!;
    expect(header.kind === 'header' && header.players.map((p) => p.special)).toEqual([
      'rapid2',
      null,
    ]);
    const replay = replayRecording(lines);
    expect(replay.mismatches).toEqual([]);
    expect(replay.refused).toBe(0);
    expect(replay.state.cannons.some((c) => c.kind === 'rapid')).toBe(true);
  });

  it('refuses format 3, the towers at one cost, never released', () => {
    const header = {
      kind: 'header',
      id: 'old-recording-1',
      source: 'server',
      startedAt: '2026-10-14T00:00:00Z',
      code: 'ABCD',
      seed: 1,
      ruleset: fastRuleset(),
      terrain: defaultTerrainConfig,
      players: [{ name: 'a', isBot: true, team: 0 }],
    };
    expect(RecordingHeaderSchema.safeParse({ ...header, format: 3 }).success).toBe(false);
    expect(RecordingHeaderSchema.safeParse({ ...header, format: 4 }).success).toBe(true);
  });

  it('reads a header from before towers as bringing none', () => {
    const header = RecordingHeaderSchema.parse({
      kind: 'header',
      format: 2,
      id: 'old-recording-1',
      source: 'server',
      startedAt: '2026-10-01T00:00:00Z',
      code: 'ABCD',
      seed: 1,
      ruleset: fastRuleset(),
      terrain: defaultTerrainConfig,
      players: [
        { name: 'a', isBot: true, team: 0 },
        { name: 'b', isBot: true, team: 1 },
      ],
    });
    expect(matchOptionsOf(header).players.map((p) => p.special)).toEqual([null, null]);
    expect(beginMatch(createMatch(matchOptionsOf(header))).ruleset.specials.enabled).toBe(false);
  });
});
