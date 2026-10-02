import type { BotSetup } from '@bollwerk/config';
import type { MatchState } from '@bollwerk/sim';

/**
 * How one match ended, one row per match beside the per-round table.
 *
 * The rounds alone cannot say who won: a match's last row is its last resolution, and the
 * rule for a winner — the best team score among teams still in, ties shared — is the
 * sim's to apply, not the reader's to re-derive. So the harness writes what the sim
 * decided, with each seat's team, level and personality, and a soak's summary reads it.
 */
export interface MatchOutcome {
  match: string;
  seed: number;
  players: number;
  /** By player id. */
  teams: number[];
  levels: number[];
  /** Trait values joined by `-`, `parsePersonality` reading them back. */
  personalities: string[];
  rounds: number;
  endedBy: 'round_cap' | 'elimination' | 'unfinished';
  draw: boolean;
  winners: number[];
  /** Final banked scores, by player id. */
  scores: number[];
  hash: string;
}

const COLUMNS = [
  'match',
  'seed',
  'players',
  'teams',
  'levels',
  'personalities',
  'rounds',
  'endedBy',
  'draw',
  'winners',
  'scores',
  'hash',
] as const;

export function outcomeOf(
  match: string,
  state: MatchState,
  setupOf: (player: number) => BotSetup,
  hash: string,
): MatchOutcome {
  const setups = state.players.map((p) => setupOf(p.id));
  return {
    match,
    seed: state.seed,
    players: state.players.length,
    teams: state.players.map((p) => p.team),
    levels: setups.map((s) => s.level),
    personalities: setups.map((s) => {
      const { risk, targeting, cannons } = s.personality;
      return `${risk}-${targeting}-${cannons}`;
    }),
    rounds: state.round,
    endedBy: state.phase === 'game_over' ? (state.endedBy ?? 'elimination') : 'unfinished',
    draw: state.draw,
    winners: [...state.winners],
    scores: state.players.map((p) => p.score),
    hash,
  };
}

/** Lists inside a cell are joined by `;`, so the file stays plain comma-separated. */
export function outcomesCsv(outcomes: readonly MatchOutcome[]): string {
  const lines = [COLUMNS.join(',')];
  for (const o of outcomes) {
    lines.push(
      COLUMNS.map((column) => {
        const value = o[column];
        return Array.isArray(value) ? value.join(';') : String(value);
      }).join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

export function parseOutcomesCsv(text: string): MatchOutcome[] {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  if (header !== COLUMNS.join(',')) throw new Error('not an outcomes table');
  const numbers = (cell: string): number[] => (cell === '' ? [] : cell.split(';').map(Number));
  return lines.map((line) => {
    const c = line.split(',');
    const cell = (column: (typeof COLUMNS)[number]): string => c[COLUMNS.indexOf(column)] ?? '';
    return {
      match: cell('match'),
      seed: Number(cell('seed')),
      players: Number(cell('players')),
      teams: numbers(cell('teams')),
      levels: numbers(cell('levels')),
      personalities: cell('personalities').split(';'),
      rounds: Number(cell('rounds')),
      endedBy: cell('endedBy') as MatchOutcome['endedBy'],
      draw: cell('draw') === 'true',
      winners: numbers(cell('winners')),
      scores: numbers(cell('scores')),
      hash: cell('hash'),
    };
  });
}
