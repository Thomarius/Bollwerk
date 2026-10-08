import { stepsOf, type Save, type Step, type TournamentSettings } from '@bollwerk/tournament';

import { language, t } from './i18n.js';

/** A tournament in words, for the resume list, the standings and the end. */

/**
 * A step's name as people say it: the knockout's last rounds by their names, Final,
 * Semi-final, Quarter-final, counted back from the final whatever their match sizes, and
 * the rest by number.
 */
export function stageName(save: Save, step: number): string {
  const steps = stepsOf(save);
  const at = steps[step] as Step;
  switch (at.kind) {
    case 'league':
      return t('tournament.stage.league', {
        n: at.matchday + 1,
        of: save.plan.matchdays.length,
      });
    case 'knockout': {
      const fromEnd = save.plan.rounds.length - 1 - at.round;
      if (save.settings.knockout === 'double') {
        if (fromEnd === 0) return t('tournament.stage.winnersFinal');
        if (fromEnd === 1) return t('tournament.stage.winnersSemi');
        return t('tournament.stage.winnersRound', { n: at.round + 1 });
      }
      if (fromEnd === 0) return t('tournament.stage.final');
      if (fromEnd === 1) return t('tournament.stage.semi');
      if (fromEnd === 2) return t('tournament.stage.quarter');
      return t('tournament.stage.round', { n: at.round + 1 });
    }
    case 'losers':
      return at.round === save.plan.losers.length - 1
        ? t('tournament.stage.losersFinal')
        : t('tournament.stage.losersRound', { n: at.round + 1 });
    case 'final':
      return t('tournament.stage.final');
  }
}

/** The settings that shape a tournament, in a line: "Medium · League · Double elimination". */
export function settingsLine(settings: TournamentSettings): string {
  const parts = [
    t(`tournament.length.${settings.length}`),
    settings.teamSize === 1 ? t('tournament.alone') : t('lobby.teamsOf', { n: settings.teamSize }),
  ];
  if (settings.league) parts.push(t('tournament.withLeague'));
  parts.push(settings.knockout === 'double' ? t('tournament.double') : t('tournament.single'));
  return parts.join(' · ');
}

/** When a tournament was last played, as a date and time in the reader's language. */
export function playedWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(language(), { dateStyle: 'medium', timeStyle: 'short' }).format(
    date,
  );
}
