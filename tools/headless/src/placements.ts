// docs/BOT_LEARNING.md, step 1: every piece placed in the testers' recordings, measured
// against every wall the player could have been building. Run `npx tsx src/placements.ts`
// in tools/headless; writes /tmp/bw/placements.csv and phases.csv and prints a summary.
//
// For each piece, before and after it, on the island it was laid on:
// - every candidate wall (each castle alone, each pair, all of them, at room radii 0-3),
//   its remaining cost in blocks and its value: enclosed tiles x enclosed castles, the
//   scoring formula, with the wall stood in on a copy of the board;
// - T, the cheapest of them, and the budget B: the time left at the owner's own rate of
//   laying cells, times their own efficiency (blocks of seal a repairing cell is worth);
// - reachableValue: max over walls of value x P(finish), P a ramp on cost against B.
// And in hindsight, at the resolution: whether each of the piece's cells ended up in the
// wall round the player's territory, standing elsewhere, or gone.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { SealPlanner } from '@bollwerk/ai';
import { matchOptionsOf, parseRecording, type RecordingHeader } from '@bollwerk/protocol';
import {
  NEIGHBOURS_8,
  Structure,
  applyAction,
  computeEnclosure,
  createMatch,
  drainEvents,
  step,
  type MatchState,
} from '@bollwerk/sim';

import { repoRoot } from './cli.js';

const dir = join(repoRoot, 'recordings');
const RADII = [0, 1, 2, 3];

interface Wall {
  key: string;
  cost: number;
  castles: number;
  tiles: number;
  value: number;
}

/** Every candidate wall for this player's island, as the board stands. */
function walls(state: MatchState, player: number): Wall[] {
  const island = state.players[player]?.islandId;
  const mine = state.castles.filter((c) => c.islandId === island).length;
  const planner = new SealPlanner(state, player);
  const scratch = state.structure.slice();
  const valued = new Map<string, { castles: number; tiles: number }>();
  const out: Wall[] = [];
  for (const radius of RADII) {
    for (const plan of planner.options(mine, false, radius)) {
      const tilesKey = [...plan.tiles].sort((a, b) => a - b).join('.');
      let v = valued.get(tilesKey);
      if (v === undefined) {
        for (const i of plan.tiles) scratch[i] = Structure.Wall;
        const e = computeEnclosure({ ...state, structure: scratch });
        let tiles = 0;
        for (const t of e.territory) if (t === island) tiles++;
        v = { castles: e.enclosedCastlesByPlayer[player] ?? 0, tiles };
        for (const i of plan.tiles) scratch[i] = state.structure[i] as number;
        valued.set(tilesKey, v);
      }
      out.push({
        key: `${radius}:${plan.castleIds.join('+')}`,
        cost: plan.cost,
        castles: v.castles,
        tiles: v.tiles,
        value: v.tiles * v.castles,
      });
    }
  }
  return out;
}

function held(state: MatchState, player: number): { castles: number; tiles: number } {
  const island = state.players[player]?.islandId;
  const e = computeEnclosure(state);
  let tiles = 0;
  for (const t of e.territory) if (t === island) tiles++;
  return { castles: e.enclosedCastlesByPlayer[player] ?? 0, tiles };
}

/** Wall of this island standing next to its territory, diagonals included: the seal. */
function sealingWall(state: MatchState, player: number): Set<number> {
  const island = state.players[player]?.islandId;
  const territory = computeEnclosure(state).territory;
  const out = new Set<number>();
  for (let i = 0; i < state.structure.length; i++) {
    if (state.structure[i] !== Structure.Wall || state.islandId[i] !== island) continue;
    const x = i % state.width;
    const y = (i - x) / state.width;
    for (const [ox, oy] of NEIGHBOURS_8) {
      const nx = x + ox;
      const ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= state.width || ny >= state.height) continue;
      if (territory[ny * state.width + nx] === island) {
        out.add(i);
        break;
      }
    }
  }
  return out;
}

const who = (header: RecordingHeader, p: number): string => {
  const seat = header.players[p];
  if (seat === undefined) return `p${p}`;
  return seat.isBot ? `L${seat.level ?? '?'}` : seat.name;
};

interface Piece {
  match: string;
  placer: number;
  owner: number;
  placerWho: string;
  ownerWho: string;
  round: number;
  secondsLeft: number;
  overtime: boolean;
  cells: number[];
  sealedBefore: number;
  before: Wall[];
  after: Wall[];
  /** At the resolution: cells in the sealing wall, standing elsewhere, gone. */
  sealing: number;
  standing: number;
  gone: number;
  failed: boolean | null;
}

interface Phase {
  match: string;
  player: number;
  who: string;
  round: number;
  seconds: number;
  castlesStart: number;
  tilesStart: number;
  wallsStart: Wall[];
  /** The board as the phase opened, to price the wall finally sealed. */
  structureStart: Uint8Array;
  /** Blocks of the finally sealing wall that were not standing as the phase opened. */
  chosenCost: number;
  pieces: Piece[];
  castlesEnd: number;
  tilesEnd: number;
  points: number;
  failed: boolean;
}

const pieces: Piece[] = [];
const phases: Phase[] = [];

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
  const open = new Map<number, Phase>();
  let inBuild = false;

  const onStep = (): void => {
    const building = state.phase === 'build';
    if (building && !inBuild) {
      for (let p = 0; p < n; p++) {
        if (state.players[p]?.eliminated) continue;
        const h = held(state, p);
        open.set(p, {
          match: id,
          player: p,
          who: who(header, p),
          round: state.round,
          seconds: (state.phaseEndTick - state.tick) / state.ruleset.tickRateHz,
          castlesStart: h.castles,
          tilesStart: h.tiles,
          wallsStart: walls(state, p),
          structureStart: state.structure.slice(),
          chosenCost: 0,
          pieces: [],
          castlesEnd: 0,
          tilesEnd: 0,
          points: 0,
          failed: false,
        });
      }
    }
    inBuild = building;
    for (const event of drainEvents(state)) {
      if (event.kind !== 'round_resolved') continue;
      for (const r of event.results) {
        const ph = open.get(r.player);
        if (ph === undefined) continue;
        const end = held(state, r.player);
        ph.castlesEnd = r.enclosedCastles;
        ph.tilesEnd = end.tiles;
        ph.points = r.territoryPoints + r.damagePoints;
        ph.failed = r.enclosedCastles === 0;
        const seal = sealingWall(state, r.player);
        if (!ph.failed) {
          for (const i of seal) if (ph.structureStart[i] !== Structure.Wall) ph.chosenCost++;
        }
        for (const piece of ph.pieces) {
          piece.failed = ph.failed;
          for (const c of piece.cells) {
            if (seal.has(c)) piece.sealing++;
            else if (state.structure[c] === Structure.Wall) piece.standing++;
            else piece.gone++;
          }
        }
        phases.push(ph);
      }
      open.clear();
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
      if (action.kind !== 'place_piece' || state.phase !== 'build') {
        applyAction(state, action);
        continue;
      }
      // The island it lands on is only known once it has landed; measure every island the
      // placer may build on before, and keep the one it was.
      const placer = action.player;
      const candidates = state.players
        .filter((p) => !p.eliminated && p.team === state.players[placer]?.team)
        .map((p) => p.id);
      const beforeBy = new Map(candidates.map((p) => [p, walls(state, p)]));
      const sealedBy = new Map(candidates.map((p) => [p, held(state, p).castles]));
      const secondsLeft = Math.max(0, (state.phaseEndTick - state.tick) / state.ruleset.tickRateHz);
      const overtime = state.overtime;
      if (applyAction(state, action) !== null) continue;
      const placed = state.events.at(-1);
      if (placed?.kind !== 'piece_placed') continue;
      const owner = (state.islandId[placed.cells[0] as number] as number) - 1;
      const piece: Piece = {
        match: id,
        placer,
        owner,
        placerWho: who(header, placer),
        ownerWho: who(header, owner),
        round: state.round,
        secondsLeft,
        overtime,
        cells: placed.cells,
        sealedBefore: sealedBy.get(owner) ?? 0,
        before: beforeBy.get(owner) ?? [],
        after: walls(state, owner),
        sealing: 0,
        standing: 0,
        gone: 0,
        failed: null,
      };
      pieces.push(piece);
      open.get(owner)?.pieces.push(piece);
    }
    step(state);
    onStep();
  }
  console.log(`${id}: ${header.players.map((_, p) => who(header, p)).join(' ')}`);
}

// ---- The player's own rate and efficiency ----------------------------------------

const cheapest = (ws: Wall[]): number => Math.min(...ws.map((w) => w.cost));
const group = (label: string): string => label;

/** Cells laid a second of build phase, by the player laying them. */
const rate = new Map<string, number>();
/** Blocks of the cheapest seal a repairing cell removes, on average. */
const efficiency = new Map<string, number>();
{
  const cells = new Map<string, number>();
  const seconds = new Map<string, number>();
  const gain = new Map<string, number>();
  const spent = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, v: number): void => {
    m.set(k, (m.get(k) ?? 0) + v);
  };
  for (const ph of phases) add(seconds, `${ph.match}/${ph.player}`, ph.seconds);
  for (const pc of pieces) {
    add(cells, `${pc.match}/${pc.placer}`, pc.cells.length);
    const d = cheapest(pc.before) - cheapest(pc.after);
    if (d > 0) {
      add(gain, group(pc.placerWho), d);
      add(spent, group(pc.placerWho), pc.cells.length);
    }
  }
  for (const [k, s] of seconds) rate.set(k, (cells.get(k) ?? 0) / Math.max(1, s));
  for (const [k, g] of gain) efficiency.set(k, g / (spent.get(k) ?? 1));
}

/** Budget in blocks of seal: time left at the owner's rate, at the owner's efficiency. */
function budget(pc: Piece, after: boolean): number {
  const r = rate.get(`${pc.match}/${pc.owner}`) ?? 0;
  const eff = efficiency.get(pc.ownerWho) ?? 0.5;
  const inHand = after ? 0 : pc.cells.length;
  const cells = pc.overtime ? inHand : pc.secondsLeft * r + inHand;
  return cells * eff;
}

/**
 * Chance of finishing a wall of this cost on this budget, by cost over budget: read off
 * these recordings, every piece laid while unsealed, pooled over people and bots - the
 * share whose phase sealed, by the cheapest seal over the budget at the time (bin middles).
 */
const FINISH: readonly (readonly [number, number])[] = [
  [0, 1],
  [0.1, 0.97],
  [0.3, 0.85],
  [0.5, 0.66],
  [0.7, 0.58],
  [0.9, 0.58],
  [1.25, 0.49],
  [2, 0.12],
  [3, 0],
];
function finish(cost: number, b: number): number {
  if (cost === 0) return 1;
  if (b <= 0) return 0;
  const x = cost / b;
  for (let k = 1; k < FINISH.length; k++) {
    const [x1, p1] = FINISH[k] as readonly [number, number];
    if (x > x1) continue;
    const [x0, p0] = FINISH[k - 1] as readonly [number, number];
    return p0 + ((p1 - p0) * (x - x0)) / (x1 - x0);
  }
  return 0;
}

function reachable(ws: Wall[], b: number): { value: number; key: string } {
  let best = { value: 0, key: '' };
  for (const w of ws) {
    const v = w.value * finish(w.cost, b);
    if (v > best.value) best = { value: v, key: w.key };
  }
  return best;
}

// ---- Output ----------------------------------------------------------------------

const rows = [
  'match,placer,owner,who,round,secondsLeft,overtime,cells,sealedBefore,tBefore,tAfter,budgetBefore,budgetAfter,slackBefore,rvBefore,rvAfter,rvKeyBefore,rvKeyAfter,bigCut,sealing,standing,gone,failed',
];
interface Derived {
  pc: Piece;
  tB: number;
  tA: number;
  slack: number;
  dRV: number;
  /** Blocks it took off walls worth more than the cheapest one. */
  bigCut: number;
}
const derived: Derived[] = [];
for (const pc of pieces) {
  if (pc.before.length === 0) continue;
  const tB = cheapest(pc.before);
  const tA = cheapest(pc.after);
  const bB = budget(pc, false);
  const bA = budget(pc, true);
  const rvB = reachable(pc.before, bB);
  const rvA = reachable(pc.after, bA);
  // The cheapest wall's value, and the most any wall worth more lost in cost.
  const tight = pc.before.reduce((a, w) => (w.cost < a.cost ? w : a));
  const afterBy = new Map(pc.after.map((w) => [w.key, w]));
  let bigCut = 0;
  for (const w of pc.before) {
    if (w.value <= tight.value) continue;
    const a = afterBy.get(w.key);
    if (a !== undefined) bigCut = Math.max(bigCut, w.cost - a.cost);
  }
  const d = { pc, tB, tA, slack: bB - tB, dRV: rvA.value - rvB.value, bigCut };
  derived.push(d);
  rows.push(
    [
      pc.match,
      pc.placer,
      pc.owner,
      pc.placerWho,
      pc.round,
      pc.secondsLeft.toFixed(1),
      pc.overtime ? 1 : 0,
      pc.cells.length,
      pc.sealedBefore,
      tB,
      tA,
      bB.toFixed(1),
      bA.toFixed(1),
      d.slack.toFixed(1),
      rvB.value.toFixed(0),
      rvA.value.toFixed(0),
      rvB.key,
      rvA.key,
      bigCut,
      pc.sealing,
      pc.standing,
      pc.gone,
      pc.failed === null ? '' : pc.failed ? 1 : 0,
    ].join(','),
  );
}
const phaseRows = [
  'match,player,who,round,castlesStart,tilesStart,tStart,budgetStart,tightValue,bestValueAffordable,maxValue,chosenCost,pieces,castlesEnd,tilesEnd,valueEnd,points,failed',
];
for (const ph of phases) {
  const r = rate.get(`${ph.match}/${ph.player}`) ?? 0;
  const b = ph.seconds * r * (efficiency.get(ph.who) ?? 0.5);
  const tight = ph.wallsStart.reduce((a, w) => (w.cost < a.cost ? w : a), ph.wallsStart[0] as Wall);
  phaseRows.push(
    [
      ph.match,
      ph.player,
      ph.who,
      ph.round,
      ph.castlesStart,
      ph.tilesStart,
      tight?.cost ?? '',
      b.toFixed(1),
      tight?.value ?? '',
      reachable(ph.wallsStart, b).value.toFixed(0),
      Math.max(0, ...ph.wallsStart.map((w) => w.value)),
      ph.failed ? '' : ph.chosenCost,
      ph.pieces.length,
      ph.castlesEnd,
      ph.tilesEnd,
      ph.castlesEnd * ph.tilesEnd,
      ph.points,
      ph.failed ? 1 : 0,
    ].join(','),
  );
}
mkdirSync('/tmp/bw', { recursive: true });
writeFileSync('/tmp/bw/placements.csv', rows.join('\n') + '\n');
writeFileSync('/tmp/bw/phases.csv', phaseRows.join('\n') + '\n');
console.log(`${derived.length} placements, ${phases.length} player-phases`);

// ---- Summary ---------------------------------------------------------------------

const pct = (a: number, b: number): string => (b === 0 ? '-' : `${Math.round((100 * a) / b)}%`);
const median = (xs: number[]): string => {
  if (xs.length === 0) return '-';
  const s = [...xs].sort((a, b) => a - b);
  return (s[Math.floor(s.length / 2)] as number).toFixed(1);
};
const labels = [...new Set(derived.map((d) => d.pc.placerWho))].sort();

console.log('\nRate (cells/s, by match) and efficiency (seal blocks per repairing cell):');
for (const l of labels) {
  const rs = [...rate.entries()]
    .filter(([k]) => phases.some((ph) => `${ph.match}/${ph.player}` === k && ph.who === l))
    .map(([, v]) => v);
  console.log(
    `  ${l.padEnd(8)} rate ${median(rs)}  efficiency ${(efficiency.get(l) ?? 0).toFixed(2)}`,
  );
}

console.log('\nCalibration: breached phase openings, tight cost / budget -> sealed by the end');
const bins = [0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.6, Infinity];
for (const l of [...labels, 'all']) {
  const cells: string[] = [];
  for (let b = 0; b + 1 < bins.length; b++) {
    const lo = bins[b] as number;
    const hi = bins[b + 1] as number;
    const inBin = phases.filter((ph) => {
      if (l !== 'all' && ph.who !== l) return false;
      if (ph.castlesStart > 0) return false;
      const r = rate.get(`${ph.match}/${ph.player}`) ?? 0;
      const budgetStart = ph.seconds * r * (efficiency.get(ph.who) ?? 0.5);
      const t = cheapest(ph.wallsStart);
      const x = t / Math.max(0.01, budgetStart);
      return x >= lo && x < hi;
    });
    const ok = inBin.filter((ph) => !ph.failed).length;
    cells.push(`${lo}-${hi === Infinity ? '' : hi}: ${ok}/${inBin.length}`);
  }
  console.log(`  ${l.padEnd(8)} ${cells.join('  ')}`);
}

console.log('\nPieces laid while the island was unsealed, by placer:');
console.log(
  '  who      n     repair  neutral | neutral: dRV>0  bigCut>=2  | sealing cells, sealed phases: repair / neutral | median slack: repair / neutral',
);
for (const l of labels) {
  const mine = derived.filter((d) => d.pc.placerWho === l && d.pc.sealedBefore === 0 && d.tB > 0);
  const repair = mine.filter((d) => d.tA < d.tB);
  const neutral = mine.filter((d) => d.tA >= d.tB);
  const sealShare = (ds: Derived[]): string => {
    const ok = ds.filter((d) => d.pc.failed === false);
    const s = ok.reduce((a, d) => a + d.pc.sealing, 0);
    const c = ok.reduce((a, d) => a + d.pc.cells.length, 0);
    return pct(s, c);
  };
  console.log(
    `  ${l.padEnd(8)} ${String(mine.length).padEnd(5)} ${pct(repair.length, mine.length).padEnd(7)} ${pct(neutral.length, mine.length).padEnd(7)} | ${pct(neutral.filter((d) => d.dRV > 0).length, neutral.length).padEnd(14)} ${pct(neutral.filter((d) => d.bigCut >= 2).length, neutral.length).padEnd(10)} | ${sealShare(repair).padEnd(6)} / ${sealShare(neutral).padEnd(30)} | ${median(repair.map((d) => d.slack))} / ${median(neutral.map((d) => d.slack))}`,
  );
}

console.log('\nNeutral pieces while unsealed, by slack before (blocks): share of phases sealed');
const slackBins = [-Infinity, 0, 5, 10, 20, Infinity];
for (const l of labels) {
  const mine = derived.filter(
    (d) => d.pc.placerWho === l && d.pc.sealedBefore === 0 && d.tB > 0 && d.tA >= d.tB,
  );
  const cells: string[] = [];
  for (let b = 0; b + 1 < slackBins.length; b++) {
    const lo = slackBins[b] as number;
    const hi = slackBins[b + 1] as number;
    const inBin = mine.filter((d) => d.slack >= lo && d.slack < hi && d.pc.failed !== null);
    const ok = inBin.filter((d) => d.pc.failed === false).length;
    cells.push(`[${lo},${hi}): ${inBin.length} pcs, ${pct(ok, inBin.length)} sealed`);
  }
  console.log(`  ${l.padEnd(8)} ${cells.join('  ')}`);
}

console.log('\nPieces once sealed, by placer: where the cells ended (sealed phases)');
for (const l of labels) {
  const mine = derived.filter(
    (d) => d.pc.placerWho === l && d.pc.sealedBefore > 0 && d.pc.failed === false,
  );
  const c = mine.reduce((a, d) => a + d.pc.cells.length, 0);
  const s = mine.reduce((a, d) => a + d.pc.sealing, 0);
  const st = mine.reduce((a, d) => a + d.pc.standing, 0);
  const g = mine.reduce((a, d) => a + d.pc.gone, 0);
  console.log(
    `  ${l.padEnd(8)} ${String(mine.length).padEnd(5)} pieces: sealing ${pct(s, c)}, standing ${pct(st, c)}, swept ${pct(g, c)}; dRV>0 ${pct(mine.filter((d) => d.dRV > 0).length, mine.length)}`,
  );
}

console.log(
  '\nPhases, by player: tight value at opening vs value at the resolution (sealed phases)',
);
for (const l of labels) {
  const mine = phases.filter((ph) => ph.who === l);
  const ok = mine.filter((ph) => !ph.failed && ph.wallsStart.length > 0);
  const tightV = ok.map((ph) => ph.wallsStart.reduce((a, w) => (w.cost < a.cost ? w : a)).value);
  const endV = ok.map((ph) => ph.castlesEnd * ph.tilesEnd);
  const bigger = ok.filter((ph, k) => ph.castlesEnd * ph.tilesEnd > 1.5 * (tightV[k] as number));
  console.log(
    `  ${l.padEnd(8)} ${String(mine.length).padEnd(3)} phases, failed ${pct(mine.length - ok.length, mine.length)}; median tight value ${median(tightV)}, end value ${median(endV)}; ended >1.5x the tight wall ${pct(bigger.length, ok.length)}`,
  );
}

console.log(
  '\nThe wall finally sealed (sealed phases opened breached): its cost at the opening, against the tight seal and the budget',
);
for (const l of labels) {
  const mine = phases.filter((ph) => ph.who === l && !ph.failed && ph.castlesStart === 0);
  const t = mine.map((ph) => cheapest(ph.wallsStart));
  const b = mine.map(
    (ph) =>
      ph.seconds * (rate.get(`${ph.match}/${ph.player}`) ?? 0) * (efficiency.get(ph.who) ?? 0.5),
  );
  const c = mine.map((ph) => ph.chosenCost);
  const over = mine.filter((_, k) => (c[k] as number) > 1.5 * (t[k] as number) + 2);
  const v = mine.map((ph) => ph.castlesEnd * ph.tilesEnd);
  const m = mine.map((ph) => Math.max(0, ...ph.wallsStart.map((w) => w.value)));
  console.log(
    `  ${l.padEnd(8)} ${String(mine.length).padEnd(3)} phases: median tight ${median(t)}, chosen ${median(c)}, budget ${median(b)}; chosen/budget ${median(c.map((x, k) => x / Math.max(1, b[k] as number)))}; chose a wall >1.5x the tight one ${pct(over.length, mine.length)}; end value ${median(v)} vs best candidate ${median(m)}`,
  );
}

const cross = pieces.filter((pc) => pc.placer !== pc.owner).length;
console.log(`\n${cross} pieces laid on a teammate's island (measured for the island's owner).`);
