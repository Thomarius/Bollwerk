import { defaultConfigBundle } from '@bollwerk/config';
import { captureSnapshot } from '@bollwerk/protocol';
import { createMatch, hashMatchState, step, type MatchState } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import type { ServerConnection } from './connection.js';
import { CATCH_UP_MARGIN_TICKS, NetworkMatch } from './networkMatch.js';

const tickMs = 1000 / defaultConfigBundle.ruleset.tickRateHz;

/** The server's side: a match stepped tick by tick, each tick sent as a commit. */
function server(): { state: MatchState; commit(match: NetworkMatch): void } {
  const state = createMatch({
    seed: 3,
    ruleset: defaultConfigBundle.ruleset,
    terrainConfig: defaultConfigBundle.terrain,
    players: [
      { name: 'Ada', isBot: false },
      { name: 'Bo', isBot: false },
    ],
  });
  return {
    state,
    commit(match) {
      const tick = state.tick;
      step(state);
      match.receive({
        type: 'commit',
        tick,
        actions: [],
        ...(tick % 30 === 0 ? { hash: hashMatchState(state) } : {}),
      });
    },
  };
}

function client(host: { state: MatchState }): NetworkMatch {
  const match = new NetworkMatch({ send: () => undefined } as unknown as ServerConnection);
  match.receive({ type: 'snapshot', snapshot: captureSnapshot(host.state) });
  return match;
}

describe('a network match keeping up with the server', () => {
  it('works off the commits that arrived while the board was being built', () => {
    const host = server();
    const match = client(host);
    // About a second of commits before the first frame, as building the board takes as
    // the match opens. Under 60 ticks, this used to stay as a delay on every click.
    for (let i = 0; i < 30; i++) host.commit(match);
    expect(match.behind).toBe(30);

    match.advance(1000 / 60);
    expect(match.behind).toBeLessThanOrEqual(CATCH_UP_MARGIN_TICKS);

    // And stays caught up, one commit a tick, frames at 60 a second.
    for (let frame = 0; frame < 600; frame++) {
      if (frame % 2 === 0) host.commit(match);
      match.advance(1000 / 60);
      expect(match.behind).toBeLessThanOrEqual(CATCH_UP_MARGIN_TICKS);
    }
    expect(match.desynced).toBe(false);
    // Never past what the server confirmed.
    expect(match.state?.tick).toBeLessThanOrEqual(host.state.tick);
  });

  it('catches up after a frame too slow to count in full', () => {
    const host = server();
    const match = client(host);
    host.commit(match);
    match.advance(tickMs);
    // A frame of over a second: its time is capped, the commits are not.
    for (let i = 0; i < 40; i++) host.commit(match);
    match.advance(1200);
    expect(match.behind).toBeLessThanOrEqual(CATCH_UP_MARGIN_TICKS);
  });

  it('plays commits arriving in pairs at its own pace, not in bursts', () => {
    const host = server();
    const match = client(host);
    const stepped: number[] = [];
    for (let frame = 0; frame < 120; frame++) {
      // Two commits every 66 ms, as a network may batch them.
      if (frame % 4 === 0) {
        host.commit(match);
        host.commit(match);
      }
      const before = match.state?.tick ?? 0;
      match.advance(1000 / 60);
      stepped.push((match.state?.tick ?? 0) - before);
    }
    expect(Math.max(...stepped.slice(8))).toBe(1);
  });
});
