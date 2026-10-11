/**
 * Plays a recorded local match again with live bots in the bots' seats — the person's moves
 * from the recording, the bots thinking as they did — and checks every bot action against the
 * recorded one, so a bot's choices in a real match can be questioned afterwards (PLAN §11 item
 * 1). Only a recording made by the same bot code reproduces; a local match seeds its bots' random
 * stream from the match seed (`botRngSeed`), and applies a tick's person's moves before the bots'
 * turns, as here.
 *
 *   npx tsx tools/headless/src/botReplay.ts recordings/<id>.jsonl --watch 2 --rounds 4-7
 *
 * `--watch P` logs each plan bot P's builder makes in the rounds given: the plan's size, the
 * castles it holds sealed, its guns owned and firing, and the pieces it can still lay.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { Bot, PlanningSlots, turnOrder } from '@bollwerk/ai';
// Not exported: reached by its file, the same module the bots load, so the patch below holds.
import { Builder } from '../../../packages/ai/src/building.js';
import { defaultAiConfig } from '@bollwerk/config';
import { matchOptionsOf, parseRecording, setupOfRecorded } from '@bollwerk/protocol';
import {
  Rng,
  applyAction,
  computeEnclosure,
  createMatch,
  drainEvents,
  step,
  type Action,
  type MatchState,
} from '@bollwerk/sim';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    watch: { type: 'string' },
    rounds: { type: 'string', default: '1-99' },
  },
});
const file = positionals[0];
if (file === undefined) throw new Error('give a recording');
const lines = parseRecording(readFileSync(file, 'utf8'));
const header = lines[0];
if (header?.kind !== 'header') throw new Error('no header');

const watched = values.watch === undefined ? -1 : Number(values.watch);
const [fromRound, toRound] = values.rounds.split('-').map(Number) as [number, number];

const state = createMatch(matchOptionsOf(header));
drainEvents(state);
const slots = new PlanningSlots(defaultAiConfig.plansPerTick);
const bots = new Map<number, Bot>();
header.players.forEach((_, p) => {
  const setup = setupOfRecorded(header.players[p]);
  if (setup !== null) bots.set(p, new Bot(p, setup, defaultAiConfig, slots));
});
// `botRngSeed` in the client's bot driver.
const rng = new Rng(header.seed ^ 0x5f3759df);

// What the watched bot's builder decides, logged as it decides it.
const decide = (Builder.prototype as unknown as Record<string, unknown>)['decide'] as (
  this: { playerId: number },
  s: MatchState,
  look: unknown,
) => number[];
let lastLogged = '';
(Builder.prototype as unknown as Record<string, unknown>)['decide'] = function (
  this: { playerId: number; piecesAffordable: (s: MatchState) => number },
  s: MatchState,
  look: unknown,
): number[] {
  const plan = decide.call(this, s, look);
  if (this.playerId === watched && s.round >= fromRound && s.round <= toRound) {
    const enclosure = computeEnclosure(s);
    const sealed = enclosure.enclosedCastlesByPlayer[watched] ?? 0;
    const guns = s.cannons.filter((c) => c.owner === watched);
    const firing = guns.filter((c) => c.active).length;
    const castles = s.castles
      .filter((c) => s.islandId[c.y * s.width + c.x] === s.players[watched]?.islandId)
      .map((c) => `${c.id}@${c.x},${c.y}${enclosure.castleEnclosed[c.id] === true ? '*' : ''}`);
    const near = (i: number): string => {
      const x = i % s.width;
      const y = (i - x) / s.width;
      let best = '';
      let bd = Infinity;
      for (const c of s.castles) {
        const d = Math.abs(c.x - x) + Math.abs(c.y - y);
        if (d < bd) {
          bd = d;
          best = String(c.id);
        }
      }
      return best;
    };
    const around = [...new Set(plan.map(near))].join('/');
    const line = `sealed ${sealed} castles ${castles.join(' ')} guns ${guns.length} firing ${firing} | plan ${plan.length} cells near castle ${around} | pieces left ${this.piecesAffordable(s).toFixed(1)}`;
    if (line !== lastLogged) {
      console.log(`  r${s.round} ${s.phase} t${s.tick}: ${line}`);
      lastLogged = line;
    }
  }
  return plan;
};

const key = (a: Action): string => JSON.stringify(a);
let mismatches = 0;
let lastPhase = '';
for (const line of lines.slice(1)) {
  if (line.kind === 'end') break;
  if (line.kind !== 'tick') continue;
  while (state.tick < line.t && state.phase !== 'game_over') {
    takeTurns([]);
    step(state);
    note();
  }
  takeTurns(line.a);
  step(state);
  note();
}

function note(): void {
  for (const event of drainEvents(state)) {
    if (event.kind === 'phase_changed' && watched >= 0) {
      const tag = `${event.round} ${event.phase}`;
      if (tag !== lastPhase && event.round >= fromRound && event.round <= toRound) {
        console.log(`round ${event.round}: ${event.phase}`);
        lastPhase = tag;
      }
    }
  }
}

/** The person's moves of this tick first, then each bot's turn, compared with the recording. */
function takeTurns(recorded: readonly Action[]): void {
  const recordedBots: string[] = [];
  for (const action of recorded) {
    if (bots.has(action.player)) recordedBots.push(key(action));
    else applyAction(state, action);
  }
  const made: string[] = [];
  for (const player of turnOrder(state.players, state.round)) {
    if (player.eliminated) continue;
    const bot = bots.get(player.id);
    if (bot === undefined) continue;
    const action = bot.think(state, rng);
    if (action !== null && applyAction(state, action) === null) made.push(key(action));
  }
  if (made.join() !== recordedBots.join()) {
    mismatches++;
    if (mismatches <= 3) {
      console.log(
        `tick ${state.tick}: bots made ${made.join(' ')} where the recording has ${recordedBots.join(' ')}`,
      );
    }
  }
}

console.log(
  mismatches === 0
    ? `reproduced exactly: every bot action as recorded (${state.round} rounds)`
    : `${mismatches} tick(s) differ from the recording — not the code that made it`,
);
