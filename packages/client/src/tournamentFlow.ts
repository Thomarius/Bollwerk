import { defaultConfigBundle } from '@bollwerk/config';
import {
  Progress,
  coinFor,
  mapSeed,
  matchTable,
  placedFrom,
  recordMatch,
  type Save,
} from '@bollwerk/tournament';

import { PHASES, type Phase } from '@bollwerk/sim';

import { app, audio, params, showError } from './app.js';
import { t } from './i18n.js';
import { runSession } from './matchScreen.js';
import { preferredStyles } from './prefs.js';
import { localMatchFor, localSession, type Setup } from './session.js';
import type { TournamentExits } from './tournamentMenu.js';
import { deleteTournament, loadTournament, writeTournament } from './tournamentSaves.js';
import { endingMarkup, tournamentMarkup } from './tournamentView.js';

/**
 * Playing a tournament, offline (TOURNAMENT T5): the screen between matches, the match,
 * its result recorded and saved as it ends, and the tournament's end.
 *
 * Only a finished match counts. One left — paused and left, or the page closed — leaves the
 * save as it was, so the same match, on the same map, is played again (§1.7).
 */

/** Opens a saved tournament where it stands. */
export function playTournament(id: string, exits: TournamentExits): void {
  const save = loadTournament(id);
  if (save === null) {
    exits.list(t('tournament.gone'));
    return;
  }
  showTournament(save, exits, null);
}

/** The screen between matches, or the end once the tournament has one. */
function showTournament(save: Save, exits: TournamentExits, notice: string | null): void {
  audio.music('music_menu');
  const progress = new Progress(save);
  if (progress.status.kind !== 'playing') {
    showEnding(save, progress, exits);
    return;
  }
  app!.innerHTML = tournamentMarkup(save, progress, notice);
  app!.querySelector('#play')?.addEventListener('click', () => {
    audio.play('select');
    startMatch(save, progress, exits);
  });
  app!.querySelector('#back')?.addEventListener('click', () => {
    audio.play('select');
    exits.menu();
  });
}

/**
 * The end, won or out. The save goes now, as it is shown: a tournament ended but never
 * shown its end — the page closed on the match's summary — is still saved, and opening it
 * shows the end then.
 */
function showEnding(save: Save, progress: Progress, exits: TournamentExits): void {
  deleteTournament(save.id);
  app!.innerHTML = endingMarkup(save, progress);
  audio.music(progress.status.kind === 'won' ? 'music_victory' : 'music_defeat');
  app!.querySelector('#back')?.addEventListener('click', () => {
    audio.play('select');
    exits.menu();
  });
}

/** The host's next match, as a local match at the tournament's table. */
function startMatch(save: Save, progress: Progress, exits: TournamentExits): void {
  const step = progress.done;
  const teams = progress.next?.matches[progress.hostMatch];
  if (teams === undefined) return;
  const table = matchTable(save, teams);
  const setup: Setup = {
    seats: table.seats.map((s) => s.level),
    seed: mapSeed(save, step),
    styles: preferredStyles(),
    name: save.settings.hostName,
    settings: { maxRounds: save.settings.maxRounds, teamSize: save.settings.teamSize },
    teams: table.seats.map((s) => s.team),
    names: table.seats.map((s) => s.name),
    personalities: table.seats.map((s) => s.personality),
    tournament: { id: save.id, step },
  };
  // `&snapshot=PHASE` (and `&round=`, `&idle=1`) as `?autostart` has them, for looking at a
  // tournament's match deep in — `game_over` plays it out at once, its result counted.
  const phase = params.get('snapshot');
  const match = localMatchFor(setup, phase === null);
  if (phase !== null && PHASES.includes(phase as Phase)) {
    match.fastForwardTo(
      phase as Phase,
      Number(params.get('round') ?? 0),
      params.get('idle') === '1',
    );
  }
  let saved = true;
  void runSession(localSession(match, null), setup, {
    // Recorded and saved the moment the match is over, before its summary shows, so
    // nothing after it — the page closed on the summary — can lose the result.
    finished: (state) => {
      const placed = placedFrom(state, table, coinFor(save, step));
      recordMatch(save, defaultConfigBundle.tournament, placed, new Date().toISOString());
      saved = writeTournament(save);
    },
    // Left before the end: nothing was recorded, and the match waits to be played again.
    leave: () => showTournament(save, exits, t('tournament.replayNote')),
    leaveConfirm: 'tournament.leaveConfirm',
    next: {
      label: 'tournament.continue',
      go: () => showTournament(save, exits, saved ? null : t('tournament.couldNotSave')),
    },
    back: () => exits.menu(),
  }).catch((error: unknown) => showError(t('error.failedToStart'), error));
}
