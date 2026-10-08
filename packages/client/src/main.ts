import { defaultConfigBundle, defaultTeams, MAX_LEVEL, MIN_LEVEL } from '@bollwerk/config';
import { PHASES, type Phase } from '@bollwerk/sim';

import { t } from './i18n.js';
import { showError, params } from './app.js';
import { preferredStyles, chosenSeed, storedName } from './prefs.js';
import type { Setup } from './session.js';
import {
  localMatchFor,
  DEFAULT_BOT,
  DEFAULT_PLAYERS,
  localSession,
  settingsFromParams,
} from './session.js';
import type { Common } from './menu.js';
import { showMenu, tournamentExits } from './menu.js';
import { openNewTournament, openResumeList } from './tournamentMenu.js';
import { writeTournament } from './tournamentSaves.js';
import { TOURNAMENT_LIMITS } from './tournamentSetup.js';
import { createTournament } from '@bollwerk/tournament';
import { openLobby } from './lobbyFlow.js';
import { runSession } from './matchScreen.js';

/**
 * Bollwerk client.
 *
 * A match is played either locally against bots or against an authoritative server.
 * Both drive the same renderer, controls and HUD through one session interface, so the
 * netcode changes where the state comes from and nothing about how the game is presented.
 *
 * This file only starts the page: `app.ts` sets it up, and the query decides whether the
 * menu, a lobby or a match comes first.
 */

if (params.get('autostart') === '1') {
  const count = Number(params.get('players') ?? 3);
  // ?watch=1 fills every seat with a bot, which is how a match is observed rather
  // than played.
  const watching = params.get('watch') === '1';
  // &level=N sets every bot's skill level, 1 to 10.
  const asked = Number(params.get('level'));
  const level =
    Number.isInteger(asked) && asked >= MIN_LEVEL && asked <= MAX_LEVEL ? asked : DEFAULT_BOT;
  const setup: Setup = {
    seats: Array.from({ length: count }, (_, i) => (i === 0 && !watching ? null : level)),
    seed: chosenSeed(),
    styles: preferredStyles(),
    name: t('menu.defaultName'),
    settings: settingsFromParams(),
    // &teams=N puts the seats in teams of N, in seat order, when N divides the table.
    ...(Number(params.get('teams') ?? 1) > 1 && count % Number(params.get('teams')) === 0
      ? { teams: defaultTeams(count, Number(params.get('teams'))) }
      : {}),
  };
  const phase = params.get('snapshot');
  const match = localMatchFor(setup, phase === null);
  // &round=N stops at that phase in round N or later, for looking at a match deep in.
  if (phase !== null && PHASES.includes(phase as Phase)) {
    match.fastForwardTo(
      phase as Phase,
      Number(params.get('round') ?? 0),
      params.get('idle') === '1',
    );
  }
  void runSession(localSession(match), setup).catch((error: unknown) =>
    showError(t('error.failedToStart'), error),
  );
} else if (params.get('host') !== null || params.get('join') !== null) {
  // The lobby had no way in except clicking through the menu, which meant it could not
  // be looked at the way `?autostart=1` lets a match be looked at — and it went
  // un-inspected at more than four seats for exactly that long.
  const joining = params.get('join');
  const common: Common = {
    styles: preferredStyles(),
    name: params.get('name') ?? storedName(),
    isPublic: params.get('private') !== '1',
  };
  void openLobby(common, joining, Number(params.get('host') ?? DEFAULT_PLAYERS)).catch(
    (error: unknown) =>
      showError(t(joining !== null ? 'error.couldNotJoin' : 'error.couldNotHost'), error),
  );
} else if (params.get('tournament') === 'new') {
  // The tournament screens, reachable as the lobby is, for looking at them.
  openNewTournament(
    {
      styles: preferredStyles(),
      name: params.get('name') ?? storedName(),
      isPublic: params.get('private') !== '1',
    },
    tournamentExits(params.get('private') !== '1'),
  );
} else if (params.get('tournament') === 'resume') {
  openResumeList(tournamentExits(params.get('private') !== '1'));
} else if (params.get('tournament') === 'demo') {
  // A tournament to look at: teams of two, a league and an archnemesis, from `&seed=`, saved
  // under one id so that looking again replaces it rather than piling saves up.
  const now = new Date();
  const save = createTournament(
    {
      seed: chosenSeed(),
      teamSize: 2,
      hostName: params.get('name') ?? storedName(),
      teamName: 'Bastion',
      teamBots: [{ name: 'Mira', level: 5 }],
      levels: { min: 4, max: 6 },
      archnemesis: 'Nemesis',
      length: 'medium',
      league: true,
      knockout: 'double',
      matchTeams: { min: 2, max: 4 },
      maxRounds: 10,
    },
    defaultConfigBundle.tournament,
    TOURNAMENT_LIMITS,
    { id: 't-demo', now: now.toISOString() },
  );
  writeTournament(save);
  tournamentExits(params.get('private') !== '1').play(save.id);
} else {
  showMenu();
}
