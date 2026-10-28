import { defaultConfigBundle, type BotTower, type TowerVariant } from '@bollwerk/config';
import { drawnSpecial } from '@bollwerk/ai';
import { streamFor } from '@bollwerk/sim';
import type { MatchTable, Save } from '@bollwerk/tournament';

/**
 * Each seat's tower at a tournament's match (the user's, 2026-10-28): every bot's fixed for the
 * whole tournament, so a team met again brings the same. A save made since keeps each bot's
 * (`Member.tower`); in one from before, a bot draws one from the tournament's seed, its team
 * and its place in it — the same in every match too. Null for none; `drawn` for the host's
 * seat, whose person chooses, and for every seat where the tournament plays no towers.
 */
export function seatTowers(save: Save, table: MatchTable): BotTower[] {
  const specials = save.settings.specials === true;
  return table.seats.map((seat): BotTower => {
    if (!specials || seat.level === null) return 'drawn';
    if (seat.tower !== undefined) return seat.tower;
    const team = table.teams[seat.team] ?? 0;
    return drawnSpecial(
      streamFor(save.settings.seed, `tower:${team}`).nextU32(),
      seat.member,
      defaultConfigBundle.ruleset.specials,
    );
  });
}

/** A seat's tower as a tournament's table sends it to the room: none for a `drawn`. */
export function sentTower(tower: BotTower): { tower?: TowerVariant | null } {
  return tower === 'drawn' ? {} : { tower };
}
