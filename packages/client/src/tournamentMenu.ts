import { defaultConfigBundle } from '@bollwerk/config';
import { createTournament } from '@bollwerk/tournament';

import { app, audio, showError } from './app.js';
import { t } from './i18n.js';
import type { Common } from './menu.js';
import {
  TOURNAMENT_LIMITS,
  defaultForm,
  formProblems,
  randomNames,
  reshapeForm,
  settingsOf,
  setupMarkup,
  type TournamentForm,
} from './tournamentSetup.js';
import {
  deleteTournament,
  newTournamentId,
  savedTournaments,
  writeTournament,
} from './tournamentSaves.js';
import { resumeMarkup } from './tournamentResume.js';

/** The menu's way into tournaments: a new one set up, or a saved one picked to go on with. */

/** Where the screens go back to, and on to: the menu, and a tournament to play. */
export interface TournamentExits {
  menu: () => void;
  play: (id: string) => void;
}

/** The form a new tournament was last set up with, kept while the page is open. */
let lastForm: TournamentForm | null = null;

export function openNewTournament(common: Common, exits: TournamentExits): void {
  const names = randomNames();
  let form = lastForm ?? defaultForm(names);
  const draw = (): void => {
    app!.innerHTML = setupMarkup(form, common.name);
  };
  const change = (next: Partial<TournamentForm>): void => {
    form = reshapeForm(form, next, names);
    lastForm = form;
    draw();
  };
  draw();

  // One listener for the whole screen, which is drawn afresh at every change.
  const root = app!;
  const number = (target: HTMLElement): number => Number((target as HTMLSelectElement).value);
  const onChange = (event: Event): void => {
    const target = event.target as HTMLElement;
    if (!root.contains(target)) return;
    audio.play('select');
    const mate = Number(target.dataset.mate);
    switch (target.id || target.className) {
      case 'team-size':
        return change({ teamSize: number(target) });
      case 'length':
        return change({ length: (target as HTMLSelectElement).value as TournamentForm['length'] });
      case 'league':
        return change({ league: (target as HTMLSelectElement).value === 'yes' });
      case 'knockout':
        return change({
          knockout: (target as HTMLSelectElement).value === 'double' ? 'double' : 'single',
        });
      case 'archnemesis':
        return change({ archnemesis: (target as HTMLSelectElement).value === 'yes' });
      case 'match-teams-min':
        return change({ matchTeams: { ...form.matchTeams, min: number(target) } });
      case 'match-teams-max':
        return change({ matchTeams: { ...form.matchTeams, max: number(target) } });
      case 'levels-min':
        return change({ levels: { ...form.levels, min: number(target) } });
      case 'levels-max':
        return change({ levels: { ...form.levels, max: number(target) } });
      case 'max-rounds':
        return change({ maxRounds: number(target) });
      case 'mate-level':
        return change({
          teamBots: form.teamBots.map((b, i) => (i === mate ? { ...b, level: number(target) } : b)),
        });
    }
  };
  // Names are kept as they are typed, without drawing the screen afresh under the caret.
  const onInput = (event: Event): void => {
    const target = event.target as HTMLInputElement;
    const value = target.value;
    if (target.id === 'team-name') form = { ...form, teamName: value };
    else if (target.id === 'arch-name') form = { ...form, archName: value };
    else if (target.classList.contains('mate-name')) {
      const mate = Number(target.dataset.mate);
      form = {
        ...form,
        teamBots: form.teamBots.map((b, i) => (i === mate ? { ...b, name: value } : b)),
      };
    } else return;
    lastForm = form;
  };
  const onClick = (event: Event): void => {
    const target = (event.target as HTMLElement).closest('button');
    if (target === null || !root.contains(target)) return;
    if (target.id === 'back') {
      audio.play('select');
      leave();
      exits.menu();
    } else if (target.id === 'create') {
      audio.play('select');
      if (formProblems(form, common.name).length > 0) return;
      const now = new Date();
      try {
        const save = createTournament(
          settingsOf(form, common.name, Math.floor(Math.random() * 0x100000000)),
          defaultConfigBundle.tournament,
          TOURNAMENT_LIMITS,
          { id: newTournamentId(now), now: now.toISOString() },
        );
        leave();
        if (!writeTournament(save)) {
          openResumeList(exits, t('tournament.couldNotSave'));
          return;
        }
        exits.play(save.id);
      } catch (error) {
        leave();
        showError(t('error.couldNotOpen'), error);
      }
    }
  };
  const leave = (): void => {
    root.removeEventListener('change', onChange);
    root.removeEventListener('input', onInput);
    root.removeEventListener('click', onClick);
  };
  root.addEventListener('change', onChange);
  root.addEventListener('input', onInput);
  root.addEventListener('click', onClick);
}

export function openResumeList(exits: TournamentExits, notice: string | null = null): void {
  let confirming: string | null = null;
  const root = app!;
  const draw = (): void => {
    root.innerHTML = resumeMarkup(savedTournaments(), confirming, notice);
  };
  draw();
  const onClick = (event: Event): void => {
    const button = (event.target as HTMLElement).closest('button');
    if (button === null || !root.contains(button)) return;
    audio.play('select');
    const id = button.dataset.id ?? null;
    if (button.id === 'back') {
      root.removeEventListener('click', onClick);
      exits.menu();
    } else if (button.classList.contains('resume') && id !== null) {
      root.removeEventListener('click', onClick);
      exits.play(id);
    } else if (button.classList.contains('delete')) {
      confirming = id;
      draw();
    } else if (button.classList.contains('cancel-delete')) {
      confirming = null;
      draw();
    } else if (button.classList.contains('confirm-delete') && id !== null) {
      deleteTournament(id);
      confirming = null;
      notice = null;
      draw();
    }
  };
  root.addEventListener('click', onClick);
}
