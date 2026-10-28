import { defaultConfigBundle, type ArtLook } from '@bollwerk/config';
import { type RoomListing } from '@bollwerk/protocol';

import { howToPlaySeen, openHowToPlay } from './howToPlay.js';
import { withIcon } from './icons.js';
import { openCredits } from './credits.js';
import { openOptions } from './options.js';
import { lookName, lookPicture, LookRotation, openLookGallery, type LookChoices } from './looks.js';
import { escape } from './html.js';
import { REFRESH_MS, gamesMarkup, parseRoomList } from './browser.js';
import { t } from './i18n.js';
import { SplitTitle } from './decor.js';
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
 * A look's card in the menu, one button opening the gallery: which look, its picture, the
 * style's name and a Change chip, so it reads as something to click before the pointer is
 * on it. No arrows stepping in place: every player chose from the gallery anyway, and the
 * menu had too many controls (the user's, 2026-10-28).
 */
function lookCard(look: ArtLook): string {
  const build = look === 'build';
  return (
    `<button class="look" data-look="${look}" data-tip="${t(build ? 'menu.pickBuild' : 'menu.pickCombat')}">` +
    `<span class="look-label">${t(build ? 'menu.buildLook' : 'menu.combatLook')}</span>` +
    `<img class="style-preview" alt="" />` +
    `<span class="look-foot"><span class="look-name"></span>` +
    `<span class="look-change">${withIcon('gallery', t('menu.changeLook'))}</span></span>` +
    `</button>`
  );
}

function readCommon(): Common {
  const typed = document.querySelector<HTMLInputElement>('#name')?.value.trim() ?? '';
  const name = typed || t('menu.defaultName');
  // The default is a text in the reader's language, not a name anyone chose: saved as one,
  // it stayed English after a change to German. Saved empty, the next visit shows the
  // default in whichever language it is read.
  saveName(name === t('menu.defaultName') ? '' : name);
  // Every table is listed in the open games (the user's, 2026-10-28): the game is only ever
  // served among friends, and a room leaves the list once its match starts or it is full,
  // so a switch for it was one control too many. `&private=1` keeps one unlisted for tests.
  const isPublic = new URLSearchParams(location.search).get('private') !== '1';
  return { styles: readStyles(), name, isPublic };
}

/**
 * Keeps the menu's list of open games current while the menu is up: asks at once and
 * every few seconds, and stops by itself once the menu has gone. Without a server, or with
 * one this page cannot join, the section stays in its place and says so, and the room code's
 * field and Join are disabled — the window keeps its shape, as the lobby's rows do (ARCHIVE 15f).
 */
function watchOpenGames(): void {
  const section = document.querySelector<HTMLElement>('#open-games-section');
  const list = document.querySelector<HTMLElement>('#open-games');
  if (!section || !list) return;
  const joining = document.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
    '.join-row input, .join-row button',
  );
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
    for (const control of joining) control.disabled = rooms === null;
    const html = rooms === null ? `<p class="note">${t('menu.noServer')}</p>` : gamesMarkup(rooms);
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
 * The menu: only who you are and how the game looks — the ways into a game on the left, the
 * two looks as cards on the right (PLAN §11 item 4, MS3). Everything about the table —
 * players, teams, bots, rounds — is set in the lobby, which is one screen whether or
 * not a server is there.
 */
export function showMenu(notice: string | null = null): void {
  audio.music('music_menu');
  app!.innerHTML = `
    <div class="menu home">
      <section class="home-main">
      <h1 class="title"><span class="title-split" id="title"></span></h1>
      <p class="inspired">${escape(t('credits.inspiredBy'))} · <button id="credits" class="link">${t('menu.credits')}</button></p>
      <label>${t('menu.name')} <input id="name" type="text" maxlength="16" placeholder="${escape(t('menu.defaultName'))}" /></label>
      <div class="split play-row">
        <button id="play" class="primary">${withIcon('play', t('menu.singleMatch'))}</button>
      </div>
      <div class="split tournament-row">
        <button id="new-tournament">${withIcon('trophy', t('menu.newTournament'))}</button>
        <button id="resume-tournament"${savedTournaments().length === 0 ? ' disabled' : ''}>${withIcon('resume', t('menu.resumeTournament'))}</button>
      </div>
      <div class="split">
        <button id="how-to-play" class="quiet${howToPlaySeen() ? '' : ' fresh'}">${withIcon('help', t('menu.howToPlay'))}</button>
        <button id="options" class="quiet">${withIcon('gear', t('menu.options'))}</button>
      </div>
      <div class="split join-row">
        <input id="code" type="text" maxlength="8" placeholder="${t('menu.codePlaceholder')}" />
        <button id="join">${withIcon('join', t('menu.join'))}</button>
      </div>
      <section id="open-games-section" class="open-games-section">
        <h2>${t('menu.openGames')}</h2>
        ${notice === null ? '' : `<p class="notice">${escape(notice)}</p>`}
        <div id="open-games"><p class="note">${t('menu.lookingForServer')}</p></div>
      </section>
      </section>
      <section class="home-looks">
        <h2>${t('looks.title')}</h2>
        ${lookCard('build')}
        ${lookCard('combat')}
      </section>
    </div>
  `;
  watchOpenGames();
  // The banners either side of combat swap one look for the other as they cross the
  // board, as the original did; the same style for both switches nothing.
  const styles = preferredStyles();
  // Set as a property rather than written into the markup, so a saved name needs no escaping;
  // the default only as the field's placeholder, so it does not read as a name somebody typed.
  const nameField = document.querySelector<HTMLInputElement>('#name');
  const saved = storedName();
  if (nameField) nameField.value = saved === t('menu.defaultName') ? '' : saved;
  menuChoices = { ...styles };
  // Options (2026-10-24): the language, the Graphics, the Motion and the volumes, in a panel
  // over the menu. A name typed is read as it opens, while the default name is still the old
  // language's, since only a name somebody typed is kept.
  const typedBefore = (): string | null => {
    const typed = document.querySelector<HTMLInputElement>('#name')?.value.trim();
    return typed && typed !== t('menu.defaultName') ? typed : null;
  };
  document.querySelector('#options')?.addEventListener('click', () => {
    audio.play('select');
    const typed = typedBefore();
    openOptions({
      audio,
      // The language changed: the menu written afresh, keeping a name typed but not yet saved.
      languageChanged: () => {
        if (typed !== null) saveName(typed);
        showMenu(notice);
      },
    });
  });

  // The title in both chosen looks at once, split by a banner's line that sweeps across
  // as either choice changes — what the two choices mean, shown rather than said. A random
  // half takes a new style at every sweep, as a match's look does at every banner.
  const titleRoot = document.querySelector<HTMLElement>('#title');
  const title = titleRoot ? new SplitTitle(titleRoot, defaultConfigBundle.art) : null;
  if (title) {
    title.use(new LookRotation(styles));
    title.glide();
  }

  // A picture of each chosen look with its name, the gallery of them all behind a click on its
  // card (ARCHIVE 12b). The pictures wait a moment, so the menu is on screen before building
  // them holds it.
  let picturesShown = false;
  const showPicture = (look: ArtLook): void => {
    const choice = menuChoices?.[look];
    const row = document.querySelector<HTMLElement>(`.look[data-look="${look}"]`);
    if (choice === undefined || row === null) return;
    const name = row.querySelector<HTMLElement>('.look-name');
    if (name) name.textContent = lookName(choice);
    row.dataset.tip =
      choice === 'random'
        ? t('looks.randomHint')
        : t(look === 'build' ? 'menu.pickBuild' : 'menu.pickCombat');
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
    const card = document.querySelector<HTMLElement>(`.look[data-look="${look}"]`);
    showPicture(look);
    card?.addEventListener('click', () => {
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

  // Tournaments (ARCHIVE 13w): a new one set up, or a saved one to go on with.
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
