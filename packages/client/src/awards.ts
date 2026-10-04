import { streamFor, type MatchState } from '@bollwerk/sim';

import { ordinal, t } from './i18n.js';
import { standings } from './scores.js';
import type { MatchLog } from './summary.js';

/**
 * Awards at the end of a match (PLAN 11.18 Y5): a long list of categories, each judged
 * from the match itself — the log the client kept and the state — of which those that
 * apply are drawn, three shown, each to a different player where it can be. The draw is
 * from the match's seed, so every screen at the table names the same awards.
 *
 * An award whose best is shared is not given: handing it to one of two equal players
 * would say something the match did not.
 */
export interface Award {
  id: string;
  title: string;
  player: number;
  /** What earned it, in a few words: "312 wall blocks shot down". */
  detail: string;
}

/** The match as the awards read it. */
type Judged = Pick<MatchState, 'players' | 'teams' | 'winners' | 'endedBy' | 'seed'>;

/** The one player with the most of something, above a floor; null when shared or none. */
function soleBest(values: ReadonlyMap<number, number>, floor = 1): [number, number] | null {
  let best: [number, number] | null = null;
  let shared = false;
  for (const [player, value] of values) {
    if (value < floor) continue;
    if (best === null || value > best[1]) {
      best = [player, value];
      shared = false;
    } else if (value === best[1]) shared = true;
  }
  return shared ? null : best;
}

/** Places in the standings by these scores, 1 the best; a tie shares the better place. */
function placesBy(scores: readonly number[]): number[] {
  return scores.map((s) => 1 + scores.filter((other) => other > s).length);
}

/** Every award that applies to this match, in a fixed order, before the draw. */
export function awardCandidates(log: MatchLog, state: Judged): Award[] {
  const out: Award[] = [];
  const players = state.players;
  const rounds = log.scores;
  const seen = rounds.length;
  if (seen === 0) return out;
  const give = (id: string, title: string, player: number, detail: string): void => {
    out.push({ id, title, player, detail });
  };
  const byPlayer = (f: (p: number) => number): Map<number, number> =>
    new Map(players.map((p) => [p.id, f(p.id)]));
  const gainIn = (k: number, p: number): number =>
    (rounds[k]?.byPlayer[p] ?? 0) - (k === 0 ? 0 : (rounds[k - 1]?.byPlayer[p] ?? 0));
  const finalPlace = new Map(standings(state as MatchState).map((s, k) => [s.player, k + 1]));
  const outAtEnd = (p: number): boolean => players[p]?.eliminated ?? false;

  const wrecker = soleBest(log.destroyed);
  if (wrecker) {
    give('wrecker', t('award.wrecker'), wrecker[0], t('award.wrecker.detail', { n: wrecker[1] }));
  }

  // The best single round's points from held ground, and which round it was.
  let landlord: { player: number; points: number; round: number; shared: boolean } | null = null;
  log.territoryPoints.forEach((round, k) =>
    round.forEach((points, player) => {
      if (points <= 0) return;
      if (landlord === null || points > landlord.points) {
        landlord = { player, points, round: rounds[k]?.round ?? k + 1, shared: false };
      } else if (points === landlord.points && player !== landlord.player) landlord.shared = true;
    }),
  );
  const land = landlord as {
    player: number;
    points: number;
    round: number;
    shared: boolean;
  } | null;
  if (land !== null && !land.shared) {
    give(
      'landlord',
      t('award.landlord'),
      land.player,
      t('award.landlord.detail', { n: land.points, round: land.round }),
    );
  }

  const collector = soleBest(
    byPlayer((p) => Math.max(0, ...rounds.map((r) => r.castles[p] ?? 0))),
    2,
  );
  if (collector)
    give(
      'collector',
      t('award.collector'),
      collector[0],
      t('award.collector.detail', { n: collector[1] }),
    );

  for (const p of players) {
    const sealedEvery = rounds.every((r) => (r.castles[p.id] ?? 0) > 0);
    if (sealedEvery && (log.livesSpent.get(p.id) ?? 0) === 0 && !p.eliminated && seen >= 3) {
      give('iron-wall', t('award.ironWall'), p.id, t('award.ironWall.detail'));
    }
  }

  // From where they stood after round 5 to where they finished.
  const fifth = rounds.find((r) => r.round === 5);
  if (fifth !== undefined && rounds[rounds.length - 1] !== fifth) {
    const then = placesBy(players.map((p) => fifth.byPlayer[p.id] ?? 0));
    const climb = soleBest(
      byPlayer((p) => (outAtEnd(p) ? 0 : (then[p] ?? 0) - (finalPlace.get(p) ?? 0))),
    );
    if (climb) {
      const p = climb[0];
      give(
        'comeback',
        t('award.comeback'),
        p,
        t('award.comeback.detail', {
          before: ordinal(then[p] ?? 0),
          after: ordinal(finalPlace.get(p) ?? 0),
        }),
      );
    }
  }

  // Led alone after the most resolutions, at least half of them.
  const leads = byPlayer(() => 0);
  for (const r of rounds) {
    const top = Math.max(...players.map((p) => r.byPlayer[p.id] ?? 0));
    const leaders = players.filter((p) => (r.byPlayer[p.id] ?? 0) === top);
    if (leaders.length === 1 && top > 0) {
      const p = leaders[0]!.id;
      leads.set(p, (leads.get(p) ?? 0) + 1);
    }
  }
  const front = soleBest(leads, Math.max(2, Math.ceil(seen / 2)));
  if (front)
    give(
      'front-runner',
      t('award.frontRunner'),
      front[0],
      t('award.frontRunner.detail', { n: front[1], rounds: seen }),
    );

  // A close win at the cap, for each winner: by under 5% of their score.
  if (state.endedBy === 'round_cap' && state.winners.length > 0) {
    const scores = standings(state as MatchState)
      .filter((s) => !s.eliminated)
      .map((s) => s.score);
    const [first = 0, second = 0] = scores;
    const winnerSet = new Set(state.winners);
    const runnerUp = standings(state as MatchState).find(
      (s) => !winnerSet.has(s.player) && !s.eliminated,
    );
    const margin = first - (runnerUp?.score ?? second);
    if (runnerUp !== undefined && first > 0 && margin > 0 && margin < first * 0.05) {
      for (const w of state.winners)
        give(
          'photo-finish',
          t('award.photoFinish'),
          w,
          t('award.photoFinish.detail', { n: margin }),
        );
    }
  }

  for (const p of players) {
    const spent = log.livesSpent.get(p.id) ?? 0;
    const pool = state.teams[p.team];
    if (p.eliminated || spent === 0) continue;
    if ((pool?.continuesRemaining ?? 0) === 0)
      give('last-stand', t('award.lastStand'), p.id, t('award.lastStand.detail'));
    const place = finalPlace.get(p.id) ?? players.length;
    if (place <= Math.floor(players.length / 2)) {
      give(
        'phoenix',
        t('award.phoenix'),
        p.id,
        t('award.phoenix.detail', { n: spent, place: ordinal(place) }),
      );
    }
  }

  // The biggest single round's score among the last three seen.
  if (seen >= 3) {
    const late = new Map<number, { gain: number; round: number }>();
    for (let k = seen - 3; k < seen; k++) {
      for (const p of players) {
        const gain = gainIn(k, p.id);
        if (gain > (late.get(p.id)?.gain ?? 0))
          late.set(p.id, { gain, round: rounds[k]?.round ?? k + 1 });
      }
    }
    const bloom = soleBest(new Map([...late].map(([p, v]) => [p, v.gain])));
    if (bloom) {
      give(
        'late-bloomer',
        t('award.lateBloomer'),
        bloom[0],
        t('award.lateBloomer.detail', { points: bloom[1], round: late.get(bloom[0])?.round ?? 0 }),
      );
    }
  }

  const artillery = soleBest(
    byPlayer((p) => Math.max(0, ...log.guns.map((r) => r[p] ?? 0))),
    1,
  );
  if (artillery) {
    give(
      'artillerist',
      t('award.artillerist'),
      artillery[0],
      t('award.artillerist.detail', { n: artillery[1] }),
    );
  }

  if (seen >= 3) {
    for (const p of players) {
      if (rounds.every((_, k) => gainIn(k, p.id) > 0))
        give('steady', t('award.steady'), p.id, t('award.steady.detail'));
    }
  }

  // The one pairing: most of one opponent's wall broken by one player.
  let nemesis: { shooter: number; victim: number; blocks: number; shared: boolean } | null = null;
  for (const [shooter, victims] of log.brokeOf) {
    for (const [victim, blocks] of victims) {
      if (victim === shooter || blocks < 5) continue;
      if (nemesis === null || blocks > nemesis.blocks)
        nemesis = { shooter, victim, blocks, shared: false };
      else if (blocks === nemesis.blocks) nemesis.shared = true;
    }
  }
  const foe = nemesis as {
    shooter: number;
    victim: number;
    blocks: number;
    shared: boolean;
  } | null;
  if (foe !== null && !foe.shared) {
    const name = players[foe.victim]?.name ?? t('award.nemesis.rival');
    give(
      'nemesis',
      t('award.nemesis', { name }),
      foe.shooter,
      t('award.nemesis.detail', { n: foe.blocks, name }),
    );
  }

  const mason = soleBest(log.pieces);
  if (mason) give('mason', t('award.mason'), mason[0], t('award.mason.detail', { n: mason[1] }));

  return out;
}

/**
 * Up to `count` of the awards that apply, drawn from the match's seed so every screen draws
 * the same: each a different award, and each to a different player where it can be — the
 * honours go round the table before anybody gets a second.
 */
export function drawAwards(candidates: readonly Award[], seed: number, count = 3): Award[] {
  const shuffled = streamFor(seed, 'awards').shuffle([...candidates]);
  const chosen: Award[] = [];
  const take = (spread: boolean): void => {
    for (const award of shuffled) {
      if (chosen.length >= count) return;
      if (chosen.some((c) => c.id === award.id || c === award)) continue;
      if (spread && chosen.some((c) => c.player === award.player)) continue;
      chosen.push(award);
    }
  };
  take(true);
  take(false);
  return chosen;
}
