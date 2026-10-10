import { defaultAiConfig } from '@bollwerk/config';
import { Bot, PlanningSlots, takeBotTurns } from '@bollwerk/ai';
import { Rng, createMatch, hashMatchState, step, type Action } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { LocalMatch } from '../localMatch.js';
import { BotTable } from './botTable.js';
import { BOT_PROTOCOL_VERSION, type InitMessage, type ToWorker } from './protocol.js';
import type { BotTransport } from './workerDriver.js';

/** The `init` a local match sends its worker, caught, with the match it came from. */
function initOf(seats: (number | null)[], seed: number): { init: InitMessage; match: LocalMatch } {
  const sent: ToWorker[] = [];
  const transport: BotTransport = {
    post: (message) => sent.push(structuredClone(message)),
    listen: () => undefined,
    terminate: () => undefined,
  };
  const match = new LocalMatch({ seed, seats, worker: transport });
  const init = sent[0];
  if (init?.type !== 'init') throw new Error('no init sent');
  return { init, match };
}

const turn = (match: number, tick: number, before: Action[] = []): ToWorker => ({
  type: 'turn',
  version: BOT_PROTOCOL_VERSION,
  match,
  tick,
  before,
});

describe('the bots’ table, as the worker keeps it', () => {
  it('makes a mirror with the page’s hash', () => {
    const { init, match } = initOf([null, 5, 3, 8], 12);
    const answer = new BotTable().handle(init);
    expect(answer).toEqual({
      type: 'ready',
      version: BOT_PROTOCOL_VERSION,
      match: init.match,
      hash: hashMatchState(match.state),
    });
  });

  it('answers a turn with exactly the actions `takeBotTurns` has accepted', () => {
    const { init } = initOf([4, 6, 8], 7);
    const table = new BotTable();
    table.handle(init);
    // The same table, driven as a room drives its bots.
    const state = createMatch(init.options);
    const slots = new PlanningSlots(init.plansPerTick);
    const bots = new Map(
      init.bots.map(({ player, setup }) => [
        player,
        new Bot(player, setup, defaultAiConfig, slots),
      ]),
    );
    const rng = new Rng(init.rngSeed);
    let acted = 0;
    for (let tick = 0; tick < 1500; tick++) {
      const expected = takeBotTurns(state, rng, (p) => bots.get(p))
        .filter((t) => t.rejection === null)
        .map((t) => t.action);
      step(state);
      const answer = table.handle(turn(init.match, tick));
      expect(answer?.type).toBe('turns');
      if (answer?.type !== 'turns') return;
      expect(answer.actions).toEqual(expected);
      acted += expected.length;
      if (tick % 30 === 0) expect(answer.hash).toBe(hashMatchState(state));
      else expect(answer.hash).toBeUndefined();
    }
    expect(acted).toBeGreaterThan(20);
  });

  it('drops a turn for another match, or for a tick the mirror is not on', () => {
    const { init } = initOf([4, 6], 3);
    const table = new BotTable();
    table.handle(init);
    expect(table.handle(turn(init.match + 1, 0))).toBeNull();
    expect(table.handle(turn(init.match, 5))).toBeNull();
    expect(table.handle(turn(init.match, 0))?.type).toBe('turns');
    expect(table.handle(turn(init.match, 0))).toBeNull();
    table.handle({ type: 'dispose', version: BOT_PROTOCOL_VERSION, match: init.match });
    expect(table.handle(turn(init.match, 1))).toBeNull();
  });

  it('fails when the person’s move cannot be applied to the mirror', () => {
    const { init } = initOf([null, 5], 3);
    const table = new BotTable();
    table.handle(init);
    // A shot in the castle phase: refused, so the mirror is no longer the page's.
    const answer = table.handle(
      turn(init.match, 0, [{ kind: 'fire', player: init.humanPlayer, x: 1, y: 1 }]),
    );
    expect(answer?.type).toBe('failed');
    expect(table.handle(turn(init.match, 0))).toBeNull();
  });
});
