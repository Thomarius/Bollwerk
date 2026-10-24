import { computeEnclosure, type MatchState, type Phase } from '@bollwerk/sim';
import { defaultArtConfig } from '@bollwerk/config';

import { t } from './i18n.js';
import { clanOf, heroHair } from './render/anime/clans.js';
import { portraitSvg, type Expression } from './render/anime/portraits.js';
import { playerColour } from './render/theme.js';

/**
 * The Anime style's banners as episode cards (ARCHIVE 14w): the round's episode, and
 * your hero — your clan's, in your hair colour — with the face your situation calls for.
 */

/** What decides the hero's face as a banner crosses. */
export interface HeroMoment {
  /** The phase the banner brings: `castle_select` where a castle is to be chosen. */
  phase: Phase;
  /** A life was just spent: the castle chosen again after a continue. */
  continued: boolean;
  /** One of the hero's sealed castles was breached in the combat just over. */
  breached: boolean;
}

/**
 * The face for a banner: determined going into a fight and choosing a castle, in tears choosing
 * one again after a life spent, shocked rebuilding after a breach and determined rebuilding
 * after none, relaxed placing guns once the round is held. None between rounds or at the end.
 */
export function heroExpression(moment: HeroMoment): Expression | null {
  switch (moment.phase) {
    case 'castle_select':
      return moment.continued ? 'tears' : 'determined';
    case 'combat':
      return 'determined';
    case 'build':
      return moment.breached ? 'shocked' : 'determined';
    case 'cannon_place':
      return 'relaxed';
    default:
      return null;
  }
}

/**
 * Whose hero a page shows: its person's while they play, else the player standing best — the
 * one watched, or the one a player who is out goes on watching.
 */
export function heroPlayer(state: MatchState, human: number): number {
  const me = state.players[human];
  if (me !== undefined && !me.eliminated) return human;
  let best = -1;
  for (const [p, player] of state.players.entries()) {
    if (player.eliminated) continue;
    if (best < 0 || player.score > (state.players[best]?.score ?? 0)) best = p;
  }
  return best;
}

/**
 * The episode card for a banner bringing `phase`, as HTML: the episode's number and the hero's
 * portrait, or an empty string where none is shown. `choosing` is a castle to choose after a
 * continue, which the banner announces in place of the cannon phase.
 */
export function heroCard(
  state: MatchState,
  human: number,
  phase: Phase,
  choosing: boolean,
): string {
  const player = heroPlayer(state, human);
  if (player < 0) return '';
  const breached =
    phase === 'build' && state.castles.some((c) => c.islandId === player + 1 && c.enclosed)
      ? (() => {
          const now = computeEnclosure(state).castleEnclosed;
          return state.castles.some(
            (c) => c.islandId === player + 1 && c.enclosed && now[c.id] !== true,
          );
        })()
      : false;
  const expression = heroExpression({
    phase: choosing ? 'castle_select' : phase,
    continued: choosing && state.round > 1,
    breached,
  });
  if (expression === null) return '';
  const clan = clanOf(state, player);
  const hair = {
    base: playerColour(defaultArtConfig, player, 'base'),
    light: playerColour(defaultArtConfig, player, 'light'),
    dark: playerColour(defaultArtConfig, player, 'dark'),
  };
  const episode = t('anime.episode', { n: Math.max(1, state.round) });
  return (
    `<span class="hero"><span class="episode">${episode}</span>` +
    `${portraitSvg(clan, heroHair(clan, player, state.seed), hair, expression)}</span>`
  );
}
