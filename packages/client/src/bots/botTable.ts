import { defaultAiConfig } from '@bollwerk/config';
import { Bot, PlanningSlots } from '@bollwerk/ai';
import { HASH_EVERY_TICKS } from '@bollwerk/protocol';
import {
  Rng,
  applyAction,
  createMatch,
  drainEvents,
  hashMatchState,
  step,
  type MatchState,
} from '@bollwerk/sim';

import { botTurns } from './botTurns.js';
import { BOT_PROTOCOL_VERSION, type FromWorker, type ToWorker } from './protocol.js';

interface Table {
  match: number;
  mirror: MatchState;
  bots: Map<number, Bot>;
  humanPlayer: number;
  rng: Rng;
}

/**
 * The bots of a local match, kept beside a mirror of its state — the whole of what the
 * bots' worker does, with no worker in it, so it is tested as it is: a message in, the
 * answer out, or null for one dropped.
 *
 * The page stays the only authority over the match. The mirror is made from the same
 * options, takes the person's moves the page applied on a tick and then the bots' turns, in
 * `turnOrder` as a thread's driver takes them, and is stepped: so the two states go tick for
 * tick alike, which the hashes in the answers check.
 */
export class BotTable {
  private table: Table | null = null;

  handle(message: ToWorker): FromWorker | null {
    if (message.version !== BOT_PROTOCOL_VERSION) {
      return this.failed(
        message.match,
        -1,
        `protocol ${message.version} is not ${BOT_PROTOCOL_VERSION}`,
      );
    }
    switch (message.type) {
      case 'init': {
        const mirror = createMatch(message.options);
        // One `PlanningSlots` between the table's bots, as every driver gives them.
        const slots = new PlanningSlots(message.plansPerTick);
        const bots = new Map<number, Bot>();
        for (const { player, setup } of message.bots) {
          bots.set(player, new Bot(player, setup, defaultAiConfig, slots));
        }
        this.table = {
          match: message.match,
          mirror,
          bots,
          humanPlayer: message.humanPlayer,
          rng: new Rng(message.rngSeed),
        };
        return {
          type: 'ready',
          version: BOT_PROTOCOL_VERSION,
          match: message.match,
          hash: hashMatchState(mirror),
        };
      }
      case 'turn': {
        const table = this.table;
        // Another match's, or a tick the mirror is not on: stale, and dropped.
        if (table === null || table.match !== message.match) return null;
        const { mirror } = table;
        if (mirror.tick !== message.tick) return null;
        for (const action of message.before) {
          const rejection = applyAction(mirror, action);
          if (rejection !== null) {
            this.table = null;
            return this.failed(
              message.match,
              message.tick,
              `the person's move was refused: ${rejection}`,
            );
          }
        }
        const { actions } = botTurns(
          mirror,
          table.rng,
          (p) => table.bots.get(p),
          table.humanPlayer,
        );
        step(mirror);
        // Nothing reads the mirror's events; left, they would pile up for the whole match.
        drainEvents(mirror);
        return {
          type: 'turns',
          version: BOT_PROTOCOL_VERSION,
          match: message.match,
          tick: message.tick,
          actions,
          ...(message.tick % HASH_EVERY_TICKS === 0 ? { hash: hashMatchState(mirror) } : {}),
        };
      }
      case 'dispose':
        if (this.table?.match === message.match) this.table = null;
        return null;
    }
  }

  private failed(match: number, tick: number, message: string): FromWorker {
    return { type: 'failed', version: BOT_PROTOCOL_VERSION, match, tick, message };
  }
}
