import { defaultConfigBundle, defaultSettings, defaultTeams, type TextKey } from '@bollwerk/config';

import { t } from './i18n.js';
import type { LookChoices } from './looks.js';
import type { Setup } from './session.js';

/** The demo's table and its idle clock, apart from the page so they can be tested (`demo.ts`). */

const DEMO = defaultConfigBundle.art.demo;

/** A match's settings as the menu's lobby starts them, under the demo's own. */
const SETTINGS = defaultSettings(
  defaultConfigBundle.ruleset,
  defaultConfigBundle.server.lobbySettings,
);

/** The tables a demo plays, alike in chance: small, so the islands are large on screen. */
export const DEMO_TABLES = [
  { players: 3, teamSize: 1 },
  { players: 4, teamSize: 1 },
  { players: 4, teamSize: 2 },
] as const;

export interface DemoTable {
  players: number;
  teamSize: number;
  specials: boolean;
  seed: number;
}

/** A demo match's table, from `roll` (0 to 1, the page's own: nothing here is simulated). */
export function rollDemoTable(roll: () => number): DemoTable {
  const pick = Math.min(DEMO_TABLES.length - 1, Math.floor(roll() * DEMO_TABLES.length));
  const shape = DEMO_TABLES[pick]!;
  return {
    players: shape.players,
    teamSize: shape.teamSize,
    specials: roll() < 0.5,
    seed: Math.floor(roll() * 0x1_0000_0000) >>> 0,
  };
}

/** The match a table makes: every seat a bot of the demo's level, each drawing its own tower. */
export function demoSetup(table: DemoTable, styles: LookChoices, name: string): Setup {
  return {
    seats: Array.from({ length: table.players }, () => DEMO.botLevel),
    seed: table.seed,
    styles,
    name,
    settings: {
      ...SETTINGS,
      maxRounds: DEMO.rounds,
      teamSize: table.teamSize,
      specials: table.specials,
    },
    ...(table.teamSize > 1 ? { teams: defaultTeams(table.players, table.teamSize) } : {}),
  };
}

/** The table's two lines, shown as a match starts. */
export function tableCaption(table: DemoTable): [string, string] {
  const shape =
    table.teamSize > 1 ? t('demo.tableTeams') : t('demo.tableFfa', { n: table.players });
  const towers: TextKey = table.specials ? 'demo.towersOn' : 'demo.towersOff';
  return [shape, t(towers)];
}

/**
 * Whether the demo starts now, `since` being the last mouse or key at the bare menu — or the
 * moment it became bare, or the window came to the front, whichever was latest.
 */
export function idleDue(since: number, now: number, idleMs: number): boolean {
  return now - since >= idleMs;
}
