/**
 * Every shot followed from launch to landing — what its target held when fired and when it
 * landed — and how fast its shooter used their guns: for comparing how people and bots shoot
 * (ARCHIVE 13zj, 13r). From recordings, or from bot matches played here.
 *
 *   npx tsx tools/headless/src/shotStats.ts recordings/
 *   npx tsx tools/headless/src/shotStats.ts --bots 1,5,10 --matches 4 --players 4
 *
 * `--bots` plays, for each level listed, matches of that many bots all at that level, balanced.
 * A shot's own error is a double (the wall it aimed at taken by its shooter's earlier shot) or
 * a miss of the walls entirely; a wall taken first by anyone else is interference, not error.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { BALANCED, type ConfigBundle } from '@bollwerk/config';
import { loadConfigBundle } from '@bollwerk/config/node';
import { Bot, PlanningSlots, takeBotTurns } from '@bollwerk/ai';
import { parseRecording, replayRecording, setupOfRecorded } from '@bollwerk/protocol';
import {
  isLoaded,
  Rng,
  Structure,
  Terrain,
  createMatch,
  drainEvents,
  sameTeam,
  step,
  type MatchEvent,
  type MatchState,
  type Shot,
} from '@bollwerk/sim';

import { repoRoot } from './cli.js';

type Outcome =
  'hit' | 'goneSelf' | 'goneTeam' | 'goneOther' | 'near1' | 'near2' | 'far' | 'sea' | 'notLanded';

interface Acc {
  matches: Set<string>;
  shots: number;
  outcomes: Record<Outcome, number>;
  /** At launch, a shot of one's own already flying to the same tile; a teammate's. */
  dupSelf: number;
  dupTeam: number;
  /** For a shot at a tile one's own earlier shot is flying to: the time since that one. */
  dupGapMs: number[];
  /** Per combat phase played with an active gun: shots, and shots per gun at its start. */
  phaseShots: number[];
  perGun: number[];
  /** Ready active guns summed over combat ticks, against active guns summed. */
  readyGunTicks: number;
  activeGunTicks: number;
  /** From a gun being ready — its shot landed, or the phase begun — to its next shot. */
  readyToFireMs: number[];
  firstShotMs: number[];
  intervalsMs: number[];
  rangeTiles: number[];
  /** Landed shots by when in the combat phase they were fired: first, second, last third. */
  byThird: { landed: number; hit: number }[];
  /** Shots by their victim's rank among the live rivals by distance: nearest, second, ... */
  byRank: number[];
}

const newAcc = (): Acc => ({
  matches: new Set(),
  shots: 0,
  outcomes: {
    hit: 0,
    goneSelf: 0,
    goneTeam: 0,
    goneOther: 0,
    near1: 0,
    near2: 0,
    far: 0,
    sea: 0,
    notLanded: 0,
  },
  dupSelf: 0,
  dupTeam: 0,
  dupGapMs: [],
  phaseShots: [],
  perGun: [],
  readyGunTicks: 0,
  activeGunTicks: 0,
  readyToFireMs: [],
  firstShotMs: [],
  intervalsMs: [],
  rangeTiles: [],
  byThird: [0, 1, 2].map(() => ({ landed: 0, hit: 0 })),
  byRank: [0, 0, 0, 0],
});

const groups = new Map<string, Acc>();
const accOf = (key: string): Acc => {
  let acc = groups.get(key);
  if (acc === undefined) groups.set(key, (acc = newAcc()));
  return acc;
};
const pct = (n: number, d: number): string => (d === 0 ? '-' : `${((100 * n) / d).toFixed(0)}%`);
/** Per person and match: hit, double and near-miss shares. */
const perMatch: string[] = [];
/** Shots landed and wall cleared, by group and the kind of gun that fired. */
const byKind = new Map<string, { shots: number; walls: number }>();

/** Chebyshev distance from (x, y) to the nearest live opponent's wall, up to 3; 3 means farther. */
function nearestOpponentWall(state: MatchState, shooter: number, x: number, y: number): number {
  for (let r = 1; r <= 2; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = x + dx;
        const ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= state.width || ty >= state.height) continue;
        const i = ty * state.width + tx;
        if (state.structure[i] !== Structure.Wall) continue;
        const owner = (state.owner[i] as number) - 1;
        if (owner >= 0 && !sameTeam(state, shooter, owner)) return r;
      }
    }
  }
  return 3;
}

/**
 * Watches one match, fed each tick's state and events after it is stepped; `finish` takes its
 * last state. `keyOf` names each seat's group: a person's name, or `bot L5`.
 */
function shotObserver(
  id: string,
  keyOf: readonly string[],
  ruleset: MatchState['ruleset'],
): {
  observe: (state: MatchState, events: readonly MatchEvent[]) => void;
  finish: (state: MatchState) => void;
} {
  const msPerTick = 1000 / ruleset.tickRateHz;
  const combatTicks = (ruleset.phases.combatMs * ruleset.tickRateHz) / 1000;
  /** Per shot in flight: its target's state at launch. */
  const launched = new Map<
    number,
    { shot: Shot; wasWall: boolean; near: number; sea: boolean; third: number }
  >();
  const matchAcc = new Map<number, { shots: number; hit: number; dup: number; near: number }>();
  /** Who last destroyed each tile. */
  const destroyedBy = new Map<number, number>();
  /** Each island's centre, for ranking rivals by distance. */
  const centres = new Map<number, { x: number; y: number }>();
  const centreOf = (state: MatchState, island: number): { x: number; y: number } => {
    let c = centres.get(island);
    if (c === undefined) {
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (let i = 0; i < state.islandId.length; i++) {
        if (state.islandId[i] !== island) continue;
        sx += i % state.width;
        sy += Math.floor(i / state.width);
        n++;
      }
      centres.set(island, (c = { x: sx / n, y: sy / n }));
    }
    return c;
  };
  /** Per gun, the tick it became ready in this combat phase. */
  const readySince = new Map<number, number>();
  let combatStart = -1;
  let phase: { shots: number[]; last: number[]; first: number[]; guns: number[] } | null = null;

  const closePhase = (): void => {
    if (phase === null) return;
    const { shots, first, guns } = phase;
    guns.forEach((n, p) => {
      if (n === 0) return;
      const acc = accOf(keyOf[p] as string);
      acc.phaseShots.push(shots[p] as number);
      acc.perGun.push((shots[p] as number) / n);
      if ((first[p] as number) >= 0) acc.firstShotMs.push(first[p] as number);
    });
    phase = null;
    readySince.clear();
  };

  const observe = (state: MatchState, events: readonly MatchEvent[]): void => {
    for (const event of events) {
      if (event.kind === 'phase_changed') {
        closePhase();
        if (event.phase !== 'combat') continue;
        combatStart = event.tick;
        const guns = state.players.map((player, p) =>
          player.eliminated ? 0 : state.cannons.filter((c) => c.owner === p && c.active).length,
        );
        phase = {
          shots: guns.map(() => 0),
          last: guns.map(() => -1),
          first: guns.map(() => -1),
          guns,
        };
        for (const c of state.cannons)
          if (c.active && isLoaded(c)) readySince.set(c.id, event.tick);
      } else if (event.kind === 'shot_fired') {
        const { shot } = event;
        const p = shot.owner;
        const acc = accOf(keyOf[p] as string);
        acc.matches.add(id);
        acc.shots++;
        const i = shot.toY * state.width + shot.toX;
        const wasWall = state.structure[i] === Structure.Wall;
        const sea = state.terrain[i] === Terrain.Water;
        const near = wasWall ? 0 : nearestOpponentWall(state, p, shot.toX, shot.toY);
        const third = Math.min(2, Math.floor((3 * (event.tick - combatStart)) / combatTicks));
        launched.set(shot.id, { shot, wasWall, near, sea, third });
        const victimIsland = state.islandId[i] as number;
        if (victimIsland > 0) {
          const me = centreOf(state, state.players[p]?.islandId ?? 0);
          const d = (island: number): number => {
            const c = centreOf(state, island);
            return (c.x - me.x) ** 2 + (c.y - me.y) ** 2;
          };
          const rivals = state.players.filter((q) => !q.eliminated && !sameTeam(state, p, q.id));
          const mine = d(victimIsland);
          const rank = rivals.filter((q) => d(q.islandId) < mine - 1e-6).length;
          acc.byRank[Math.min(3, rank)] = (acc.byRank[Math.min(3, rank)] as number) + 1;
        }
        for (const other of state.shots) {
          if (other.id === shot.id || other.toX !== shot.toX || other.toY !== shot.toY) continue;
          if (other.owner === p) {
            acc.dupSelf++;
            acc.dupGapMs.push((shot.launchTick - other.launchTick) * msPerTick);
          } else if (sameTeam(state, p, other.owner)) acc.dupTeam++;
        }
        acc.rangeTiles.push(Math.hypot(shot.toX + 0.5 - shot.fromX, shot.toY + 0.5 - shot.fromY));
        const since = readySince.get(shot.cannonId);
        if (since !== undefined) acc.readyToFireMs.push((event.tick - since) * msPerTick);
        readySince.delete(shot.cannonId);
        if (phase !== null) {
          phase.shots[p] = (phase.shots[p] as number) + 1;
          if ((phase.first[p] as number) < 0)
            phase.first[p] = (event.tick - combatStart) * msPerTick;
          if ((phase.last[p] as number) >= 0) {
            acc.intervalsMs.push((event.tick - (phase.last[p] as number)) * msPerTick);
          }
          phase.last[p] = event.tick;
        }
      } else if (event.kind === 'shot_impact') {
        const entry = launched.get(event.shotId);
        if (entry === undefined) continue;
        launched.delete(event.shotId);
        const { shot, wasWall, near, sea, third } = entry;
        if (phase !== null) readySince.set(shot.cannonId, event.tick);
        const i = shot.toY * state.width + shot.toX;
        const acc = accOf(keyOf[shot.owner] as string);
        let outcome: Outcome;
        if (event.destroyed.includes(i)) outcome = 'hit';
        else if (wasWall) {
          const by = destroyedBy.get(i);
          outcome =
            by === shot.owner
              ? 'goneSelf'
              : by !== undefined && sameTeam(state, shot.owner, by)
                ? 'goneTeam'
                : 'goneOther';
        } else if (sea) outcome = 'sea';
        else outcome = near === 1 ? 'near1' : near === 2 ? 'near2' : 'far';
        acc.outcomes[outcome]++;
        const slot = acc.byThird[third] as { landed: number; hit: number };
        slot.landed++;
        if (outcome === 'hit') slot.hit++;
        let m = matchAcc.get(shot.owner);
        if (m === undefined) matchAcc.set(shot.owner, (m = { shots: 0, hit: 0, dup: 0, near: 0 }));
        m.shots++;
        if (outcome === 'hit') m.hit++;
        if (outcome === 'goneSelf') m.dup++;
        if (outcome === 'near1' || outcome === 'near2') m.near++;
        for (const d of event.destroyed) destroyedBy.set(d, shot.owner);
        // By the gun's kind too: a Big Bertha's crater takes more than its aim.
        const gun = shot.kind === 'cannon' ? 'cannon' : `${shot.kind}${shot.cost}`;
        const kind = `${keyOf[shot.owner] as string} ${gun}`;
        const k = byKind.get(kind) ?? { shots: 0, walls: 0 };
        k.shots++;
        k.walls += event.destroyed.length;
        byKind.set(kind, k);
      } else if (event.kind === 'lightning_struck' || event.kind === 'laser_fired') {
        // Struck as they fire, so counted by their kind here and nowhere else: their shot lands
        // nothing, so it is neither a hit nor a miss of the tile clicked, nor one never landed.
        for (const d of event.destroyed) destroyedBy.set(d, event.owner);
        const entry = launched.get(event.shotId);
        if (entry === undefined) continue;
        launched.delete(event.shotId);
        const gun = `${entry.shot.kind}${entry.shot.cost}`;
        const kind = `${keyOf[event.owner] as string} ${gun}`;
        const k = byKind.get(kind) ?? { shots: 0, walls: 0 };
        k.shots++;
        k.walls += event.destroyed.length;
        byKind.set(kind, k);
      }
    }
    if (state.phase === 'combat' && phase !== null) {
      for (const c of state.cannons) {
        if (!c.active || (phase.guns[c.owner] as number) === 0) continue;
        const acc = accOf(keyOf[c.owner] as string);
        acc.activeGunTicks++;
        if (isLoaded(c)) acc.readyGunTicks++;
      }
    }
  };

  const finish = (state: MatchState): void => {
    closePhase();
    for (const { shot } of launched.values())
      accOf(keyOf[shot.owner] as string).outcomes.notLanded++;
    for (const [p, m] of matchAcc) {
      if ((keyOf[p] as string).startsWith('bot')) continue;
      const opp = keyOf.filter((k, q) => k.startsWith('bot') && !sameTeam(state, p, q));
      perMatch.push(
        `${id.slice(0, 8)} ${(keyOf[p] as string).padEnd(8)} shots ${String(m.shots).padStart(4)}  hit ${pct(m.hit, m.shots).padStart(4)}  ownDouble ${pct(m.dup, m.shots).padStart(4)}  besideWall ${pct(m.near, m.shots).padStart(4)}   vs ${opp.join(',')}`,
      );
    }
  };
  return { observe, finish };
}

function analyseRecording(file: string): void {
  const lines = parseRecording(readFileSync(file, 'utf8'));
  const header = lines[0];
  if (header?.kind !== 'header') return;
  const keyOf = header.players.map((p, id) => {
    const setup = setupOfRecorded(header.players[id]);
    return setup === null ? p.name : `bot L${setup.level}`;
  });
  const watcher = shotObserver(header.id, keyOf, header.ruleset);
  const replay = replayRecording(lines, watcher.observe);
  watcher.finish(replay.state);
  const exact = replay.mismatches.length === 0 && replay.refused === 0;
  console.log(`${header.id} ${exact ? 'exact' : 'DIVERGED'}  ${keyOf.join(' | ')}`);
}

function playBots(bundle: ConfigBundle, level: number, matches: number, players: number): void {
  for (let m = 0; m < matches; m++) {
    const seed = 1000 + m;
    const state = createMatch({
      seed,
      ruleset: bundle.ruleset,
      terrainConfig: bundle.terrain,
      players: Array.from({ length: players }, (_, p) => ({
        name: `L${level} ${p}`,
        isBot: true,
        team: p,
      })),
    });
    const rng = new Rng(seed);
    const slots = new PlanningSlots(bundle.ai.plansPerTick);
    const bots = state.players.map(
      (p) => new Bot(p.id, { level, personality: BALANCED }, bundle.ai, slots),
    );
    const keyOf = state.players.map(() => `bot L${String(level).padStart(2)}`);
    const watcher = shotObserver(`sim-L${level}-${seed}`, keyOf, state.ruleset);
    drainEvents(state);
    while (state.phase !== 'game_over' && state.tick < 200_000) {
      takeBotTurns(state, rng, (player) => bots[player]);
      step(state);
      watcher.observe(state, drainEvents(state));
    }
    watcher.finish(state);
  }
  console.log(`played ${matches} match(es) of ${players} bots at L${level}`);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    bots: { type: 'string' },
    matches: { type: 'string', default: '4' },
    players: { type: 'string', default: '4' },
  },
});

if (values.bots !== undefined) {
  const bundle = loadConfigBundle(repoRoot);
  for (const level of values.bots.split(',').map(Number)) {
    playBots(bundle, level, Number(values.matches), Number(values.players));
  }
} else {
  const dir = positionals[0] ?? join(repoRoot, 'recordings');
  for (const name of readdirSync(dir)
    .filter((n) => n.endsWith('.jsonl'))
    .sort()) {
    try {
      analyseRecording(join(dir, name));
    } catch {
      console.log(`${name}: not replayable`);
    }
  }
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? NaN : (s[Math.floor(s.length / 2)] as number);
};
const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

console.log(
  '\ngroup        matches  shots  hit  own | goneSelf goneOther near1 near2 far sea | shots/gun walls/gun idleReady | readyToFire med mean | first interval range',
);
const order = [...groups.keys()].sort();
for (const key of order) {
  const a = groups.get(key) as Acc;
  const o = a.outcomes;
  const landed = a.shots - o.notLanded;
  // Own error: a double, or a miss of the walls; interference by anyone else is not counted.
  const ownErrors = o.goneSelf + o.near1 + o.near2 + o.far + o.sea;
  const hitShare = landed === 0 ? 0 : o.hit / landed;
  console.log(
    [
      key.padEnd(12),
      String(a.matches.size).padStart(7),
      String(a.shots).padStart(6),
      pct(o.hit, landed).padStart(4),
      pct(landed - ownErrors, landed).padStart(4),
      '|',
      pct(o.goneSelf, landed).padStart(8),
      pct(o.goneOther + o.goneTeam, landed).padStart(9),
      pct(o.near1, landed).padStart(5),
      pct(o.near2, landed).padStart(5),
      pct(o.far, landed).padStart(3),
      pct(o.sea, landed).padStart(3),
      '|',
      mean(a.perGun).toFixed(2).padStart(9),
      (mean(a.perGun) * hitShare).toFixed(2).padStart(9),
      pct(a.readyGunTicks, a.activeGunTicks).padStart(9),
      '|',
      median(a.readyToFireMs).toFixed(0).padStart(15),
      mean(a.readyToFireMs).toFixed(0).padStart(5),
      '|',
      median(a.firstShotMs).toFixed(0).padStart(5),
      median(a.intervalsMs).toFixed(0).padStart(8),
      mean(a.rangeTiles).toFixed(1).padStart(5),
    ].join(' '),
  );
}

console.log(
  "\nshots by the victim's rank among live rivals by distance: nearest, 2nd, 3rd, farther",
);
for (const key of order) {
  const a = groups.get(key) as Acc;
  const total = a.byRank.reduce((x, y) => x + y, 0);
  console.log(`${key.padEnd(12)} ${a.byRank.map((n) => pct(n, total).padStart(5)).join(' ')}`);
}

console.log('\nhit rate by third of the combat phase; the gap before a second shot at one tile');
for (const key of order) {
  const a = groups.get(key) as Acc;
  const g = a.dupGapMs;
  const share = (lo: number, hi: number): string =>
    pct(g.filter((x) => x >= lo && x < hi).length, g.length);
  console.log(
    `${key.padEnd(12)} ${a.byThird.map((t) => pct(t.hit, t.landed).padStart(4)).join(' ')}   doubles ${String(g.length).padStart(4)}: <150ms ${share(0, 150)}  150-300 ${share(150, 300)}  300-600 ${share(300, 600)}  >600 ${share(600, 1e9)}`,
  );
}
const kinds = [...byKind.keys()].sort();
if (kinds.some((k) => !k.endsWith(' cannon'))) {
  console.log('\nshots landed and walls cleared, by the kind of gun that fired');
  for (const key of kinds) {
    const k = byKind.get(key) as { shots: number; walls: number };
    console.log(
      `${key.padEnd(24)} shots ${String(k.shots).padStart(6)}  walls ${String(k.walls).padStart(6)}  a shot ${(k.walls / (k.shots || 1)).toFixed(2)}`,
    );
  }
}
if (perMatch.length > 0) {
  console.log('\neach match, people only');
  for (const line of perMatch) console.log(line);
}
