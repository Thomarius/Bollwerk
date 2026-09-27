import { hashMatchState, step, type Action } from '@rampart/sim';
import { replayRecording, type RecordingLine } from '@rampart/protocol';
import { describe, expect, it } from 'vitest';

import { LocalMatch } from './localMatch.js';

describe('a local match, recorded', () => {
  it('replays to exactly the match that was played, the person’s moves included', () => {
    const lines: RecordingLine[] = [];
    const match = new LocalMatch({
      seed: 11,
      seats: [null, 'gunner', 'recruit'],
      record: (line) => lines.push(line),
    });
    // The person picks a castle between frames, as a click does — ahead of the bots'
    // moves on that tick, which is the order a replay must keep.
    let picked = false;
    for (let frame = 0; frame < 2000 && !match.finished; frame++) {
      if (!picked && match.state.phase === 'castle_select') {
        const mine = match.state.castles.find(
          (c) => c.islandId === match.state.players[match.humanPlayer]?.islandId,
        );
        if (mine !== undefined) {
          const action: Action = {
            kind: 'select_castle',
            player: match.humanPlayer,
            castleId: mine.id,
          };
          expect(match.submit(action)).toBeNull();
          picked = true;
        }
      }
      match.advance(1000 / 30);
    }
    expect(picked).toBe(true);

    const header = lines[0];
    expect(header?.kind).toBe('header');
    if (header?.kind === 'header') {
      expect(header.source).toBe('local');
      expect(header.players[match.humanPlayer]?.difficulty).toBeNull();
      expect(header.players.filter((p) => p.difficulty !== null)).toHaveLength(2);
    }
    const replay = replayRecording(lines);
    expect(replay.refused).toBe(0);
    expect(replay.mismatches).toEqual([]);
    // The recording stops at the last tick anything happened on; stepped on to where the
    // match stands — nothing more was done — it must be the same match exactly.
    while (replay.state.tick < match.state.tick) step(replay.state);
    expect(hashMatchState(replay.state)).toBe(hashMatchState(match.state));
  });

  it('records nothing of a dev fast-forward', () => {
    const lines: RecordingLine[] = [];
    const match = new LocalMatch({
      seed: 3,
      seats: [null, 'gunner'],
      record: (l) => lines.push(l),
    });
    match.fastForwardTo('build', 1);
    match.advance(1000);
    expect(lines.filter((l) => l.kind === 'tick')).toEqual([]);
    expect(hashMatchState(match.state)).toBeTruthy();
  });
});
