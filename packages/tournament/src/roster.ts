import {
  TRAIT_VALUES,
  variantKind,
  type Personality,
  type TournamentConfig,
  type TowerVariant,
} from '@bollwerk/config';
import { streamFor, type Rng } from '@bollwerk/sim';

import type { Member, Team } from './save.js';
import type { TournamentSettings } from './settings.js';

/**
 * The field: the host's team as the host set it up, then every other team drawn from the
 * seed — names, levels and personalities, fixed for the whole tournament (TOURNAMENT §1.1).
 *
 * Where towers are played (`towers`, the variants on offer), every bot's tower is fixed too,
 * so a team met again brings the same (the user's, 2026-10-28): the host's teammates the ones
 * the host chose, or a draw; of the other teams, about half bring one tower between all their
 * members and go by a name of that tower's (`names.towerTeams`), and the rest a tower each,
 * named as ever. Teams of one are each their bot's, so every bot simply draws its own. Drawn
 * from streams of their own, so a tournament without towers is the one it always was.
 */
export function createTeams(
  settings: TournamentSettings,
  config: TournamentConfig,
  field: number,
  towers: readonly TowerVariant[] = [],
): Team[] {
  const { seed, teamSize, levels } = settings;
  const deal = personalityDealer(streamFor(seed, 'personalities'));
  const levelRng = streamFor(seed, 'levels');
  const playsTowers = settings.specials === true && towers.length > 0;
  const towerRng = streamFor(seed, 'towers');
  const drawTower = (): TowerVariant => towers[towerRng.nextInt(towers.length)] as TowerVariant;

  const host: Team = {
    name: teamSize > 1 ? settings.teamName : settings.hostName,
    members: [
      { name: settings.hostName, level: null, personality: null },
      ...settings.teamBots.map((bot) => ({
        name: bot.name,
        level: bot.level,
        personality: deal(),
        ...(playsTowers
          ? { tower: bot.tower === undefined || bot.tower === 'drawn' ? drawTower() : bot.tower }
          : {}),
      })),
    ],
    archnemesis: false,
  };

  // The other teams that bring one tower between them: half, rounded up, where teams have
  // more than one member.
  const others = Array.from({ length: field - 1 }, (_, i) => i + 1);
  const themed = new Set(
    playsTowers && teamSize > 1
      ? streamFor(seed, 'tower-teams')
          .shuffle(others)
          .slice(0, Math.ceil(others.length / 2))
      : [],
  );

  // Names already the host's are not dealt again, the archnemesis's included.
  const taken = host.members.map((m) => m.name);
  if (settings.archnemesis !== null) taken.push(settings.archnemesis);
  const players = new NameDrawer(config.names.players, streamFor(seed, 'names'), taken);
  const teamNames = new NameDrawer(config.names.teams, streamFor(seed, 'team-names'), [host.name]);
  const towerNames = new Map<string, NameDrawer>();
  const towerName = (tower: TowerVariant): string => {
    const kind = variantKind(tower);
    let drawer = towerNames.get(kind);
    if (drawer === undefined) {
      drawer = new NameDrawer(
        config.names.towerTeams[kind],
        streamFor(seed, `tower-names:${kind}`),
        [host.name],
      );
      towerNames.set(kind, drawer);
    }
    return drawer.next();
  };

  const archTeam =
    settings.archnemesis === null ? -1 : 1 + streamFor(seed, 'archnemesis').nextInt(field - 1);

  const teams: Team[] = [host];
  for (let id = 1; id < field; id++) {
    const members: Member[] = [];
    for (let seat = 0; seat < teamSize; seat++) {
      const level = levels.min + levelRng.nextInt(levels.max - levels.min + 1);
      members.push({ name: '', level, personality: deal() });
    }
    const leader = members[0] as Member;
    if (id === archTeam) {
      // The archnemesis leads its team, a level above anyone else the field was dealt, and
      // his teammates are the strongest the range allows (the user's, 2026-10-08).
      for (const member of members) member.level = levels.max;
      leader.name = settings.archnemesis as string;
      leader.level = levels.max + 1;
    }
    for (const member of members) if (member.name === '') member.name = players.next();
    let name = teamSize > 1 ? '' : leader.name;
    if (playsTowers) {
      const shared = themed.has(id) ? drawTower() : null;
      for (const member of members) member.tower = shared ?? drawTower();
      if (shared !== null) name = towerName(shared);
    }
    teams.push({
      name: name === '' ? teamNames.next() : name,
      members,
      archnemesis: id === archTeam,
    });
  }
  return teams;
}

/**
 * Personalities dealt from bags of each trait's values, so a field of any size gets them
 * in even measure, as a match deals its bots' (`dealPersonalities` in the bots' package).
 */
function personalityDealer(rng: Rng): () => Personality {
  const bag = <T>(values: readonly T[]): (() => T) => {
    let left: T[] = [];
    return () => {
      if (left.length === 0) left = rng.shuffle([...values]);
      return left.pop() as T;
    };
  };
  const risk = bag(TRAIT_VALUES.risk);
  const targeting = bag(TRAIT_VALUES.targeting);
  const cannons = bag(TRAIT_VALUES.cannons);
  return () => ({ risk: risk(), targeting: targeting(), cannons: cannons() });
}

const NUMERALS = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/**
 * Names from a pool in a shuffled order, none twice and none already taken (compared
 * without case). A pool used up goes round again with a numeral, "Anna II", so a field
 * larger than the pool still gets unique names; past "X" the numbers are plain.
 */
export class NameDrawer {
  private readonly order: string[];
  private readonly taken: Set<string>;
  private index = 0;

  constructor(pool: readonly string[], rng: Rng, taken: readonly string[]) {
    this.order = rng.shuffle([...pool]);
    this.taken = new Set(taken.map((name) => name.toLowerCase()));
  }

  next(): string {
    for (;;) {
      const lap = Math.floor(this.index / this.order.length);
      const base = this.order[this.index % this.order.length] as string;
      this.index++;
      const name = lap === 0 ? base : `${base} ${NUMERALS[lap - 1] ?? String(lap + 1)}`;
      if (this.taken.has(name.toLowerCase())) continue;
      this.taken.add(name.toLowerCase());
      return name;
    }
  }
}
