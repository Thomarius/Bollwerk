// docs/BOT_LEARNING.md, step 1 (first pass): every piece placed in the testers' recordings,
// with the cheapest seal before and after it, and each build phase's outcome per player.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { SealPlanner } from '@bollwerk/ai';
import { matchOptionsOf, parseRecording, type RecordingHeader } from '@bollwerk/protocol';
import {
  applyAction,
  computeEnclosure,
  createMatch,
  drainEvents,
  step,
  type MatchState,
} from '@bollwerk/sim';

import { repoRoot } from './cli.js';

const dir = join(repoRoot, 'recordings');

/** Blocks still needed for the cheapest wall sealing at least `atLeast` of this player's castles. */
function sealCost(state: MatchState, player: number, atLeast: number): number | null {
  const island = state.players[player]?.islandId;
  const mine = state.castles.filter((c) => c.islandId === island).length;
  if (atLeast > mine) return null;
  return new SealPlanner(state, player).cheapest(atLeast, mine, false, 0)?.cost ?? null;
}

function held(state: MatchState, player: number): { castles: number; tiles: number } {
  const e = computeEnclosure(state);
  let tiles = 0;
  for (const t of e.territory) if (t === player + 1) tiles++;
  return { castles: e.enclosedCastlesByPlayer[player] ?? 0, tiles };
}

const who = (header: RecordingHeader, p: number): string => {
  const seat = header.players[p];
  if (seat === undefined) return `p${p}`;
  return seat.isBot ? `L${seat.level ?? '?'}` : seat.name;
};

const placements: string[] = [
  'match,player,who,round,secondsLeft,overtime,sealedBefore,tilesBefore,costBefore,costAfter,costMoreBefore,costMoreAfter,cost2Before,cost2After,cells',
];
const phases: string[] = [
  'match,player,who,round,castlesStart,tilesStart,costStart,pieces,neutralPieces,castlesEnd,tilesEnd,points,failed',
];

for (const file of readdirSync(dir)
  .filter((f) => f.endsWith('.jsonl'))
  .sort()) {
  let lines;
  try {
    lines = parseRecording(readFileSync(join(dir, file), 'utf8'));
  } catch {
    console.log(`skip ${file} (does not parse)`);
    continue;
  }
  const header = lines[0];
  if (header?.kind !== 'header') continue;
  const id = file.replace('.jsonl', '');
  const state = createMatch(matchOptionsOf(header));
  drainEvents(state);
  const n = state.players.length;
  // Each player's build phase: what they held as it opened, and their pieces in it.
  const phase = new Map<
    number,
    { castles: number; tiles: number; cost: number | null; pieces: number; neutral: number }
  >();
  let inBuild = false;

  const onStep = (): void => {
    const building = state.phase === 'build';
    if (building && !inBuild) {
      for (let p = 0; p < n; p++) {
        if (state.players[p]?.eliminated) continue;
        phase.set(p, { ...held(state, p), cost: sealCost(state, p, 1), pieces: 0, neutral: 0 });
      }
    }
    inBuild = building;
    for (const event of drainEvents(state)) {
      if (event.kind !== 'round_resolved') continue;
      for (const r of event.results) {
        const start = phase.get(r.player);
        if (start === undefined) continue;
        const end = held(state, r.player);
        phases.push(
          [
            id,
            r.player,
            who(header, r.player),
            event.round,
            start.castles,
            start.tiles,
            start.cost ?? '',
            start.pieces,
            start.neutral,
            r.enclosedCastles,
            end.tiles,
            r.territoryPoints + r.damagePoints,
            r.enclosedCastles === 0 ? 1 : 0,
          ].join(','),
        );
      }
      phase.clear();
    }
  };

  for (const line of lines.slice(1)) {
    if (line.kind === 'end') break;
    if (line.kind !== 'tick') continue;
    while (state.tick < line.t && state.phase !== 'game_over') {
      step(state);
      onStep();
    }
    for (const action of line.a) {
      if (action.kind === 'place_piece' && state.phase === 'build') {
        const p = action.player;
        const before = held(state, p);
        const more = before.castles + 1;
        const costBefore = sealCost(state, p, 1);
        const costMoreBefore = sealCost(state, p, more);
        const cost2Before = sealCost(state, p, 2);
        const secondsLeft = (state.phaseEndTick - state.tick) / state.ruleset.tickRateHz;
        const overtime = state.overtime;
        if (applyAction(state, action) !== null) continue;
        const costAfter = sealCost(state, p, 1);
        const costMoreAfter = sealCost(state, p, more);
        const cost2After = sealCost(state, p, 2);
        const placed = state.events.at(-1);
        const cells = placed?.kind === 'piece_placed' ? placed.cells.length : 0;
        placements.push(
          [
            id,
            p,
            who(header, p),
            state.round,
            secondsLeft.toFixed(1),
            overtime ? 1 : 0,
            before.castles,
            before.tiles,
            costBefore ?? '',
            costAfter ?? '',
            costMoreBefore ?? '',
            costMoreAfter ?? '',
            cost2Before ?? '',
            cost2After ?? '',
            cells,
          ].join(','),
        );
        const ph = phase.get(p);
        if (ph !== undefined) {
          ph.pieces++;
          if (
            costBefore !== null &&
            costAfter !== null &&
            costAfter >= costBefore &&
            costBefore > 0
          )
            ph.neutral++;
        }
      } else {
        applyAction(state, action);
      }
    }
    step(state);
    onStep();
  }
  console.log(`${id}: ${header.players.map((_, p) => who(header, p)).join(' ')}`);
}

mkdirSync('/tmp/bw', { recursive: true });
writeFileSync('/tmp/bw/placements.csv', placements.join('\n') + '\n');
writeFileSync('/tmp/bw/phases.csv', phases.join('\n') + '\n');
console.log(`${placements.length - 1} placements, ${phases.length - 1} player-phases`);
