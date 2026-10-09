import { defaultConfigBundle, type ArtLook } from '@bollwerk/config';
import { type RoomListing } from '@bollwerk/protocol';

import { howToPlaySeen, openHowToPlay } from './howToPlay.js';
import { openCredits } from './credits.js';
import { volumeSliders } from './volume.js';
import {
  lookName,
  lookPicture,
  LookRotation,
  openLookGallery,
  stepLook,
  type LookChoices,
} from './looks.js';
import { escape } from './html.js';
import { REFRESH_MS, gamesMarkup, parseRoomList } from './browser.js';
import { isLanguage, languageOptions, saveLanguage, setLanguage, t } from './i18n.js';
import { SplitTitle } from './decor.js';
import { saveEffects, storedEffects } from './motion.js';
import { parseSharpness, saveSharpness, sharpnessOptions, storedSharpness } from './sharpness.js';
import { EFFECTS } from './pause.js';
import { app, showError, audio } from './app.js';
import { preferredStyles, saveStyles, storedName, saveName } from './prefs.js';
import { openLobby } from './lobbyFlow.js';
import { openNewTournament, openResumeList, type TournamentExits } from './tournamentMenu.js';
import { savedTournaments } from './tournamentSaves.js';
import { playTournament } from './tournamentFlow.js';

/** The menu: who you are and how the game looks. */

/** What the menu gathers before a table is set: who you are and how it looks. */
export interface Common {
  name: string;
  styles: LookChoices;
  /** Whether a table this player opens is listed in the games browser. */
  isPublic: boolean;
}

/**
 * How long the looks' pictures wait as the menu opens: building them takes a moment, which
 * once waited for the title's first sweep; the title glides without end now, so this is
 * only for the menu to be on screen first.
 */
const PICTURES_AFTER_MS = 600;

/** The menu's two looks as they stand, or null with no menu shown. */
let menuChoices: LookChoices | null = null;

/** The menu's two look choices, saved for next time as they are read. */
function readStyles(): LookChoices {
  const styles = menuChoices ?? preferredStyles();
  saveStyles(styles);
  return styles;
}

/**
 * A look's picker in the menu: its picture and name, which open the gallery, between
 * arrows that step to the previous and next style in place.
 */
function lookPicker(look: ArtLook): string {
  const build = look === 'build';
  return (
    `<span class="look-picker">` +
    `<button class="step prev" title="${t(build ? 'menu.prevBuild' : 'menu.prevCombat')}" aria-label="${t('menu.previous')}">&#9664;</button>` +
    `<button class="look-picture" title="${t(build ? 'menu.pickBuild' : 'menu.pickCombat')}">` +
    `<img class="style-preview" alt="" /><span class="look-name"></span></button>` +
    `<button class="step next" title="${t(build ? 'menu.nextBuild' : 'menu.nextCombat')}" aria-label="${t('menu.next')}">&#9654;</button>` +
    `</span>`
  );
}

function readCommon(): Common {
  const typed = document.querySelector<HTMLInputElement>('#name')?.value.trim() ?? '';
  const name = typed || t('menu.defaultName');
  // The default is a text in the reader's language, not a name anyone chose: saved as one,
  // it stayed English after a change to German. Saved empty, the next visit shows the
  // default in whichever language it is read.
  saveName(name === t('menu.defaultName') ? '' : name);
  const isPublic =
    document.querySelector<HTMLButtonElement>('#visibility')?.dataset.public !== 'false';
  return { styles: readStyles(), name, isPublic };
}

/**
 * Keeps the menu's list of open games current while the menu is up: asks at once and
 * every few seconds, and stops by itself once the menu has gone. Without a server, or with
 * one this page cannot join, the section stays hidden.
 */
function watchOpenGames(): void {
  const section = document.querySelector<HTMLElement>('#open-games-section');
  const list = document.querySelector<HTMLElement>('#open-games');
  if (!section || !list) return;
  list.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.join-open');
    const code = button?.dataset.code;
    if (code === undefined) return;
    audio.play('select');
    void openLobby(readCommon(), code).catch((e: unknown) => showError(t('error.couldNotJoin'), e));
  });
  let shown = '';
  const refresh = async (): Promise<void> => {
    let rooms: RoomListing[] | null;
    try {
      const response = await fetch('/api/rooms', { cache: 'no-store' });
      rooms = parseRoomList(await response.json());
    } catch {
      rooms = null;
    }
    if (!section.isConnected) return;
    section.hidden = rooms === null;
    const html = rooms === null ? '' : gamesMarkup(rooms);
    // Only when it changed, so a Join button is not replaced under a pressed mouse.
    if (html !== shown) list.innerHTML = shown = html;
  };
  void refresh();
  const timer = setInterval(() => {
    if (section.isConnected) void refresh();
    else clearInterval(timer);
  }, REFRESH_MS);
}

/** Where the tournament screens lead: back to the menu, or on into a tournament. */
export function tournamentExits(isPublic: boolean): TournamentExits {
  const exits: TournamentExits = {
    isPublic,
    menu: () => showMenu(),
    play: (id) =>
      void playTournament(id, exits).catch((e: unknown) => showError(t('error.couldNotOpen'), e)),
    list: (notice) => openResumeList(exits, notice),
  };
  return exits;
}

/**
 * The menu: only who you are and how the game looks. Everything about the table —
 * players, teams, bots, rounds — is set in the lobby, which is one screen whether or
 * not a server is there.
 */
export function showMenu(notice: string | null = null): void {
  audio.music('music_menu');
  app!.innerHTML = `
    <div class="menu">
      <h1 class="title"><span class="title-split" id="title"></span></h1>
      <p class="inspired">${escape(t('credits.inspiredBy'))} · <button id="credits" class="link">${t('menu.credits')}</button></p>
      <label>${t('menu.name')} <input id="name" type="text" maxlength="16" value="${escape(t('menu.defaultName'))}" /></label>
      <div class="look" data-look="build">${t('menu.buildLook')} ${lookPicker('build')}</div>
      <div class="look" data-look="combat">${t('menu.combatLook')} ${lookPicker('combat')}</div>
      <label>${t('settings.language')} <select id="language">${languageOptions()}</select></label>
      <label>${t('settings.effects')} <select id="effects">${EFFECTS.map(([value, key]) => `<option value="${value}">${t(key)}</option>`).join('')}</select></label>
      <label>${t('settings.sharpness')} <select id="sharpness">${sharpnessOptions()}</select></label>
      <div class="split tournament-row">
        <button id="new-tournament">${t('menu.newTournament')}</button>
        <button id="resume-tournament"${savedTournaments().length === 0 ? ' disabled' : ''}>${t('menu.resumeTournament')}</button>
      </div>
      <div class="split play-row">
        <button id="play">${t('menu.singleMatch')}</button>
        <button id="visibility" data-public="true" title="${t('menu.visibilityTitle')}">${t('menu.public')}</button>
      </div>
      <button id="how-to-play" class="quiet${howToPlaySeen() ? '' : ' fresh'}">${t('menu.howToPlay')}</button>
      <div class="split">
        <input id="code" type="text" maxlength="8" placeholder="${t('menu.codePlaceholder')}" />
        <button id="join">${t('menu.join')}</button>
      </div>
      <section id="open-games-section" class="open-games-section"${notice === null ? ' hidden' : ''}>
        <h2>${t('menu.openGames')}</h2>
        ${notice === null ? '' : `<p class="notice">${escape(notice)}</p>`}
        <div id="open-games"></div>
      </section>
    </div>
  `;
  // Public or private, chosen as the table is made: a switch beside Play.
  const visibility = document.querySelector<HTMLButtonElement>('#visibility');
  visibility?.addEventListener('click', () => {
    audio.play('select');
    const isPublic = visibility.dataset.public === 'false';
    visibility.dataset.public = String(isPublic);
    visibility.textContent = isPublic ? t('menu.public') : t('menu.private');
  });
  watchOpenGames();
  // The banners either side of combat swap one look for the other as they cross the
  // board, as the original did; the same style for both switches nothing.
  const styles = preferredStyles();
  // Set as a property rather than written into the markup, so a saved name needs no escaping.
  const nameField = document.querySelector<HTMLInputElement>('#name');
  if (nameField) nameField.value = storedName();
  menuChoices = { ...styles };
  // A change of language writes the menu afresh, keeping a name typed but not yet saved.
  const languageField = document.querySelector<HTMLSelectElement>('#language');
  languageField?.addEventListener('change', () => {
    audio.play('select');
    if (!isLanguage(languageField.value)) return;
    // The default name is the language's own, so only a name somebody typed is kept.
    const typed = document.querySelector<HTMLInputElement>('#name')?.value.trim();
    if (typed && typed !== t('menu.defaultName')) saveName(typed);
    saveLanguage(languageField.value);
    setLanguage(languageField.value);
    showMenu(notice);
  });
  const effectsField = document.querySelector<HTMLSelectElement>('#effects');
  const sharpnessField = document.querySelector<HTMLSelectElement>('#sharpness');
  // The two volumes, under the looks, the Effects and the Sharpness (PLAN 11.18 Y4).
  sharpnessField?.closest('label')?.after(volumeSliders(audio));
  if (sharpnessField) {
    sharpnessField.value = storedSharpness();
    sharpnessField.addEventListener('change', () =>
      saveSharpness(parseSharpness(sharpnessField.value)),
    );
  }
  if (effectsField) {
    effectsField.value = storedEffects();
    effectsField.addEventListener('change', () =>
      saveEffects(
        effectsField.value === 'reduced' || effectsField.value === 'high'
          ? effectsField.value
          : 'full',
      ),
    );
  }

  // The title in both chosen looks at once, split by a banner's line that sweeps across
  // as either choice changes — what the two choices mean, shown rather than said. A random
  // half takes a new style at every sweep, as a match's look does at every banner.
  const titleRoot = document.querySelector<HTMLElement>('#title');
  const title = titleRoot ? new SplitTitle(titleRoot, defaultConfigBundle.art) : null;
  if (title) {
    title.use(new LookRotation(styles));
    title.glide();
  }

  // A picture of each chosen look with its name, arrows either side to step through the
  // styles in place, and the gallery of them all behind a click on the picture (ARCHIVE
  // 12b). The pictures wait a moment, so the menu is on screen before building them holds it.
  let picturesShown = false;
  const showPicture = (look: ArtLook): void => {
    const choice = menuChoices?.[look];
    const row = document.querySelector<HTMLElement>(`.look[data-look="${look}"]`);
    if (choice === undefined || row === null) return;
    const name = row.querySelector<HTMLElement>('.look-name');
    if (name) name.textContent = lookName(choice);
    row.title = choice === 'random' ? t('looks.randomHint') : '';
    const image = row.querySelector<HTMLImageElement>('img');
    if (image === null || !picturesShown) return;
    image.classList.remove('ready');
    void lookPicture(choice).then(
      (url) => {
        // Only if the choice still stands: a slow picture must not replace a newer one.
        if (menuChoices?.[look] !== choice) return;
        image.src = url;
        image.classList.add('ready');
      },
      () => undefined,
    );
  };
  const choose = (next: LookChoices): void => {
    const changed = (['build', 'combat'] as const).filter(
      (look) => next[look] !== menuChoices?.[look],
    );
    menuChoices = { ...next };
    saveStyles(next);
    for (const look of changed) showPicture(look);
    if (changed.length > 0) title?.use(new LookRotation(next));
  };
  for (const look of ['build', 'combat'] as const) {
    const row = document.querySelector<HTMLElement>(`.look[data-look="${look}"]`);
    showPicture(look);
    row?.querySelector('.prev')?.addEventListener('click', () => {
      audio.play('select');
      if (menuChoices) choose({ ...menuChoices, [look]: stepLook(look, menuChoices[look], -1) });
    });
    row?.querySelector('.next')?.addEventListener('click', () => {
      audio.play('select');
      if (menuChoices) choose({ ...menuChoices, [look]: stepLook(look, menuChoices[look], 1) });
    });
    row?.querySelector('.look-picture')?.addEventListener('click', () => {
      audio.play('select');
      if (!menuChoices) return;
      openLookGallery({
        choices: menuChoices,
        active: look,
        onChange: choose,
        click: () => audio.play('select'),
      });
    });
  }
  setTimeout(() => {
    picturesShown = true;
    showPicture('build');
    showPicture('combat');
  }, PICTURES_AFTER_MS);

  // Tournaments (docs/TOURNAMENT.md): a new one set up, or a saved one to go on with.
  const exits = (): TournamentExits => tournamentExits(readCommon().isPublic);
  document.querySelector('#new-tournament')?.addEventListener('click', () => {
    audio.play('select');
    openNewTournament(readCommon(), exits());
  });
  document.querySelector('#resume-tournament')?.addEventListener('click', () => {
    audio.play('select');
    openResumeList(exits());
  });

  document.querySelector('#play')?.addEventListener('click', () => {
    audio.play('select');
    void openLobby(readCommon(), null).catch((e: unknown) => showError(t('error.couldNotOpen'), e));
  });
  // How to play (PLAN 11.16 H1): pages of pictures over the menu, marked until first opened.
  const howTo = document.querySelector<HTMLButtonElement>('#how-to-play');
  howTo?.addEventListener('click', () => {
    audio.play('select');
    howTo.classList.remove('fresh');
    howTo.blur();
    openHowToPlay(undefined, () => audio.play('select'));
  });
  document.querySelector('#credits')?.addEventListener('click', () => {
    audio.play('select');
    openCredits(defaultConfigBundle.audio, () => audio.play('select'));
  });
  document.querySelector('#join')?.addEventListener('click', () => {
    audio.play('select');
    const code = document.querySelector<HTMLInputElement>('#code')?.value.trim() ?? '';
    if (code.length === 0) return;
    void openLobby(readCommon(), code).catch((e: unknown) => showError(t('error.couldNotJoin'), e));
  });
}
