import {
  BotTowerSchema,
  MAX_LEVEL,
  MIN_LEVEL,
  defaultTeams,
  reshapeTable,
  type BotTower,
  type MatchSettings,
  type SettingBounds,
  type Table,
} from '@bollwerk/config';

import { store, stored } from './storage.js';

/**
 * The last table this person set as its host, local or a room (PLAN §11 item 4, UP3): the
 * seats, the teams and the bots' levels and towers, so a regular does not set them all again
 * at every visit. Never the map, which is new each time; the special towers are remembered on
 * their own (`towers.ts`), and a tournament's tables are its own. Nor the rounds and lives,
 * no longer offered (2026-10-28): always the config's, so a value saved before is dropped.
 */
export interface RememberedTable extends Table {
  /** Each seat's bot level, by seat, every seat the table may have. */
  bots: number[];
  botTowers: BotTower[];
  /** Where the host sat: the seat decides the team. */
  hostSeat: number;
}

const KEY = 'bollwerk.table';

export function saveTable(table: RememberedTable): void {
  store(
    KEY,
    JSON.stringify({
      teamSize: table.settings.teamSize,
      playerCount: table.playerCount,
      teams: table.teams,
      bots: table.bots,
      botTowers: table.botTowers,
      hostSeat: table.hostSeat,
    }),
  );
}

/** The table last saved, or null for none. */
export function storedTable(
  base: MatchSettings,
  bounds: SettingBounds,
  limits: { min: number; max: number },
  defaultBot: number,
): RememberedTable | null {
  try {
    return readTable(JSON.parse(stored(KEY) ?? 'null'), base, bounds, limits, defaultBot);
  } catch {
    return null;
  }
}

/**
 * A saved table read back, every part checked: a value out of today's bounds — a save from
 * an older version, or one edited by hand — falls back to the default for that part, and
 * the seats and teams are shaped by the rule the lobby itself follows (`reshapeTable`).
 * `base` holds what is not remembered here: the special towers, the rounds and the lives.
 */
export function readTable(
  raw: unknown,
  base: MatchSettings,
  bounds: SettingBounds,
  limits: { min: number; max: number },
  defaultBot: number,
): RememberedTable | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const saved = raw as Record<string, unknown>;
  const within = (value: unknown, range: { min: number; max: number }, fallback: number) =>
    Number.isInteger(value) && (value as number) >= range.min && (value as number) <= range.max
      ? (value as number)
      : fallback;
  const settings: MatchSettings = {
    ...base,
    teamSize: within(saved.teamSize, bounds.teamSize, base.teamSize),
  };
  const teams = Array.isArray(saved.teams) ? (saved.teams as unknown[]) : [];
  const table = reshapeTable(
    { settings: base, playerCount: limits.min, teams: defaultTeams(limits.min, base.teamSize) },
    {
      settings,
      playerCount: within(saved.playerCount, limits, limits.min),
      ...(teams.every((team) => Number.isInteger(team)) ? { teams: teams as number[] } : {}),
    },
    limits,
    1,
  );
  const bots = Array.isArray(saved.bots) ? (saved.bots as unknown[]) : [];
  const towers = Array.isArray(saved.botTowers) ? (saved.botTowers as unknown[]) : [];
  return {
    ...table,
    bots: Array.from({ length: limits.max }, (_, seat) =>
      within(bots[seat], { min: MIN_LEVEL, max: MAX_LEVEL }, defaultBot),
    ),
    botTowers: Array.from({ length: limits.max }, (_, seat): BotTower => {
      const tower = BotTowerSchema.safeParse(towers[seat]);
      return tower.success ? tower.data : 'drawn';
    }),
    hostSeat: within(saved.hostSeat, { min: 0, max: table.playerCount - 1 }, 0),
  };
}
