/**
 * The menus' new look, as a mockup (2026-10-28): the menu, the lobby and Options in a
 * neutral, modern base, each window wearing a look of the game — the chosen build look and
 * combat look in turn, a window each, and under Random a style from the favourites as the
 * game draws them, none again until all have been shown (`LookRotation`). What the look
 * brings is the style's HUD skin at one of three strengths, chosen in the mockup's bar.
 * Static screens: the buttons change the window and the switches switch, nothing more.
 */
import '@fontsource-variable/inter';
import '@fontsource-variable/rubik';
import '../src/style.css';
import './menus.css';

import { defaultConfigBundle, type ArtLook, type ArtStyle } from '@bollwerk/config';

import { installBackdrop } from '../src/decor.js';
import { HUD_SKIN } from '../src/skins.js';
import { setLanguage, startingLanguage } from '../src/i18n.js';
import {
  LookRotation,
  lookName,
  lookPicture,
  storedFavourites,
  type LookChoice,
} from '../src/looks.js';
import { preferredStyles } from '../src/prefs.js';
import { drawPreview, tablePreview } from '../src/preview.js';
import { playerShape, shapeSvg } from '../src/shapes.js';
import { titleFor, titleLayout } from '../src/titles.js';

setLanguage(startingLanguage(null));
const art = defaultConfigBundle.art;
installBackdrop(art);

type Window = 'menu' | 'lobby' | 'options';
type Strength = 'light' | 'medium' | 'full';

const choices = preferredStyles();
const rotation = new LookRotation(choices);
const root = document.querySelector<HTMLElement>('#mock-root')!;

/** How many windows have been shown: even ones in the build look, odd in the combat look. */
let shownCount = 0;
let current: { look: ArtLook; style: ArtStyle } | null = null;
let strength: Strength = 'medium';
/** The window on screen, for the mockup's Next look. */
let shown: Window = 'menu';

// ------------------------------------------------------------------------ icons

const icon = (path: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const ICONS = {
  play: icon('<path d="M7 4v16l13-8z" fill="currentColor"/>'),
  trophy: icon(
    '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>',
  ),
  resume: icon('<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>'),
  help: icon(
    '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"/>',
  ),
  gear: icon(
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  ),
  join: icon('<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>'),
  copy: icon(
    '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  ),
  sound: icon(
    '<path d="M11 5 6 9H2v6h4l5 4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  ),
  expand: icon('<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>'),
  left: icon('<path d="m15 18-6-6 6-6"/>'),
  right: icon('<path d="m9 18 6-6-6-6"/>'),
  back: icon('<path d="M19 12H5M12 19l-7-7 7-7"/>'),
  dice: icon(
    '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  ),
};

// ------------------------------------------------------------------------ the look

/** Every HUD skin's class, to take the last one off before the next goes on. */
const SKINS = [...new Set(Object.values(HUD_SKIN))];

/**
 * The look's elements, from its HUD skin, at the strength chosen: Light takes its accent
 * alone; Medium its panels' edge and shadow and its lettering for headings and the main
 * button too; Full its panels' colour, ink and lettering throughout.
 */
function applySkin(style: ArtStyle): void {
  const body = document.body;
  body.classList.remove(...SKINS);
  body.classList.add(HUD_SKIN[style]);
  const skin = getComputedStyle(body);
  const read = (name: string): string => skin.getPropertyValue(name).trim();
  const set = (name: string, value: string | null): void => {
    if (value === null || value === '') body.style.removeProperty(name);
    else body.style.setProperty(name, value);
  };
  const font = read('--hud-font');
  const ownFont = font !== '' && font !== 'inherit' ? font : null;
  const shadow = read('--hud-box-shadow');
  set('--m-accent', read('--hud-accent'));
  set('--m-on-accent', read('--hud-on-accent'));
  const medium = strength !== 'light';
  const full = strength === 'full';
  set('--m-edge', medium ? read('--hud-box-edge') : null);
  set(
    '--m-shadow',
    medium && shadow !== '' && shadow !== 'none' ? `${shadow}, 0 24px 64px rgb(0 0 0 / 50%)` : null,
  );
  set('--m-heading-font', medium ? ownFont : null);
  set('--m-heading', medium ? read('--hud-accent') : null);
  set('--m-surface', full ? read('--hud-box') : null);
  set('--m-text', full ? read('--hud-ink') : null);
  set('--m-muted', full ? read('--hud-muted') : null);
  set('--m-text-font', full ? ownFont : null);
}

/** The next window's look: build and combat in turn, as the game's banners bring them. */
function nextLook(): { look: ArtLook; style: ArtStyle } {
  const look: ArtLook = shownCount % 2 === 0 ? 'build' : 'combat';
  shownCount++;
  return { look, style: rotation.next(look, current?.style ?? null) };
}

// ------------------------------------------------------------------------ pieces

function title(style: ArtStyle): string {
  const drawn = titleFor(style, art);
  const { height, margin } = titleLayout(drawn);
  return `<img class="${drawn.smooth ? '' : 'pixel'}" src="${drawn.src}" alt="Bollwerk" style="height:${height}px;margin:${margin}px" />`;
}

const seg = (options: readonly string[], on: number, attributes = ''): string =>
  `<div class="m-seg" ${attributes}>${options
    .map((label, i) => `<button${i === on ? ' class="on"' : ''}>${label}</button>`)
    .join('')}</div>`;

const stepper = (value: number): string =>
  `<div class="m-stepper"><button data-step="-1">−</button><output>${value}</output><button data-step="1">+</button></div>`;

const why = (tip: string): string => `<span class="why" data-tip="${tip}">?</span>`;

/** Under Random, the style the look has on screen now, beside the word. */
function drawn(look: ArtLook, choice: LookChoice): string {
  return choice === 'random' && current?.look === look ? ` · ${lookName(current.style)}` : '';
}

function lookCard(look: ArtLook, choice: LookChoice): string {
  const showing = current?.look === look ? ' showing' : '';
  return `<div class="m-card${showing}" data-look="${look}">
      <button class="m-btn m-ghost m-icon" aria-label="Previous">${ICONS.left}</button>
      <figure><img alt="" /><figcaption><small>${look === 'build' ? 'Building look' : 'Combat look'}</small>${lookName(choice)}${drawn(look, choice)}</figcaption></figure>
      <button class="m-btn m-ghost m-icon" aria-label="Next">${ICONS.right}</button>
    </div>`;
}

// ------------------------------------------------------------------------ windows

function menuWindow(style: ArtStyle): string {
  const favourites = storedFavourites().length;
  return `<main class="m-screen m-menu">
    <section class="m-panel m-hero">
      <div class="m-title">${title(style)}</div>
      <p class="m-inspired">Inspired by Atari’s Rampart (1990) · <a href="#">Credits</a></p>
      <label class="m-field">Name <input class="m-input" value="Player" maxlength="16" /></label>
      <div class="m-play">
        <button class="m-btn m-primary m-big" data-go="lobby">${ICONS.play} Single match</button>
        <div class="m-seg m-vert" data-tip="Public tables are listed under Open games; a private one is joined by its code alone">
          <button class="on" data-public="true">Public</button><button data-public="false">Private</button>
        </div>
      </div>
      <div class="m-row">
        <button class="m-btn">${ICONS.trophy} New tournament</button>
        <button class="m-btn" disabled data-tip="No tournament saved yet">${ICONS.resume} Resume</button>
      </div>
      <div class="m-row">
        <button class="m-btn m-ghost">${ICONS.help} How to play</button>
        <button class="m-btn m-ghost" data-go="options">${ICONS.gear} Options</button>
      </div>
      <div class="m-join">
        <input class="m-input" placeholder="Room code" maxlength="8" />
        <button class="m-btn">${ICONS.join} Join</button>
      </div>
    </section>
    <section class="m-panel m-looks">
      <h3>Looks</h3>
      ${lookCard('build', choices.build)}
      ${lookCard('combat', choices.combat)}
      <p class="m-note">${favourites > 0 ? `♥ ${favourites} favourites — Random draws from them` : 'Random draws from every style'}</p>
    </section>
  </main>`;
}

const SEATS = [
  { name: 'Player', level: null },
  { name: 'Bot 2', level: 5 },
  { name: 'Bot 3', level: 7 },
  { name: 'Bot 4', level: 3 },
];

function seatRow(seat: (typeof SEATS)[number], index: number): string {
  const colour = art.players[index]?.base ?? '#888';
  const you = seat.level === null;
  const control = you
    ? `<span></span>`
    : `<span class="m-pips">${Array.from({ length: 10 }, (_, k) => `<i${k < (seat.level ?? 0) ? ' class="on"' : ''}></i>`).join('')}</span>`;
  const right = you ? seg(['I play', 'A bot'], 0) : stepper(seat.level ?? 5);
  return `<li class="m-seat${you ? ' you' : ''}" style="--who:${colour}">
      <span class="num">${index + 1}</span>
      <span class="shape">${shapeSvg(playerShape(index), colour)}</span>
      <span class="name">${seat.name}${you ? '<span class="tag">You · Host</span>' : ''}</span>
      ${control}${right}
    </li>`;
}

function lobbyWindow(): string {
  return `<main class="m-screen m-panel m-lobby">
    <div class="m-head">
      <h2>Table</h2>
      <span class="m-code" data-tip="Friends join with this code">AK5GZL <button class="m-btn m-ghost m-icon" aria-label="Copy">${ICONS.copy}</button></span>
    </div>
    <div class="m-lobby-grid">
      <div>
        <div class="m-map"><canvas></canvas></div>
        <div class="m-map-row"><input class="m-input" value="3945575348" aria-label="Map" /><button class="m-btn">${ICONS.dice} New map</button></div>
        <div class="m-settings">
          <div class="m-setting"><span>Teams ${why('Free-for-all, or teams that share their score and lives and may build on each other’s islands')}</span>${seg(['Solo', '2', '3', '4'], 0)}</div>
          <div class="m-setting"><span>Players</span>${stepper(4)}</div>
          <div class="m-setting"><span>Rounds ${why('The match ends after this many rounds, and the most points win')}</span>${stepper(10)}</div>
          <div class="m-setting"><span>Lives ${why('Ending a build phase with no castle sealed costs a life; with none left, you are out')}</span>${seg(['1', '2', '3', '4', '5'], 2)}</div>
          <div class="m-setting"><span>Special towers ${why('Each player may buy one special tower in the cannon phase, for two or three of its cannons')}</span><button class="m-switch" aria-label="Special towers"></button></div>
        </div>
      </div>
      <div>
        <h3>Seats</h3>
        <ol class="m-seats">${SEATS.map(seatRow).join('')}</ol>
      </div>
    </div>
    <div class="m-lobby-foot">
      <button class="m-btn m-primary m-big">${ICONS.play} Start match</button>
      <button class="m-btn m-ghost" data-go="menu">${ICONS.back} Leave</button>
    </div>
  </main>`;
}

function optionsWindow(): string {
  return `<main class="m-screen m-panel m-options">
    <h2>Options</h2>
    <div class="m-settings">
      <div class="m-setting"><span>Language</span>${seg(['English', 'Deutsch'], 0)}</div>
      <div class="m-setting"><span>Graphics</span>${seg(['Low', 'Medium', 'High'], 1)}</div>
      <div class="m-setting"><span>Motion</span>${seg(['Full', 'Reduced'], 0)}</div>
      <div class="m-setting"><span>Style music</span>${seg(['Always', 'Half', 'Never'], 0)}</div>
      <hr />
      <div class="m-setting"><span>Music</span><input class="m-slider" type="range" value="70" style="width:14rem" /></div>
      <div class="m-setting"><span>Sounds</span><input class="m-slider" type="range" value="85" style="width:14rem" /></div>
    </div>
    <button class="m-btn close" data-go="menu">${ICONS.back} Back</button>
  </main>`;
}

// ------------------------------------------------------------------------ showing

function wire(): void {
  for (const go of root.querySelectorAll<HTMLElement>('[data-go]')) {
    go.addEventListener('click', () => show(go.dataset.go as Window));
  }
  // The switches switch, so their states can be seen.
  for (const group of root.querySelectorAll<HTMLElement>('.m-seg')) {
    for (const button of group.querySelectorAll('button')) {
      button.addEventListener('click', () => {
        for (const other of group.querySelectorAll('button')) {
          other.classList.toggle('on', other === button);
        }
      });
    }
  }
  for (const toggle of root.querySelectorAll<HTMLElement>('.m-switch')) {
    toggle.addEventListener('click', () => toggle.classList.toggle('on'));
  }
  for (const step of root.querySelectorAll<HTMLElement>('.m-stepper')) {
    const out = step.querySelector('output')!;
    for (const button of step.querySelectorAll<HTMLElement>('button')) {
      button.addEventListener('click', () => {
        out.textContent = String(
          Math.max(1, Number(out.textContent) + Number(button.dataset.step)),
        );
      });
    }
  }
  // The look pictures, drawn by each style's own theme.
  for (const look of ['build', 'combat'] as const) {
    const img = root.querySelector<HTMLImageElement>(`.m-card[data-look="${look}"] img`);
    // Under Random, the style on screen now is shown rather than the question mark.
    const choice =
      choices[look] === 'random' && current?.look === look ? current.style : choices[look];
    if (img !== null) void lookPicture(choice).then((url) => (img.src = url));
  }
  // The map as the lobby shows it.
  const canvas = root.querySelector<HTMLCanvasElement>('.m-map canvas');
  if (canvas !== null) {
    const preview = tablePreview(3945575348, 4, [0, 1, 2, 3], art, defaultConfigBundle.terrain);
    drawPreview(canvas, preview, 0, art, 288);
  }
}

let leaving: number | undefined;

/** A window, in the next look: the old one fades, the look changes, the new one rises. */
function show(window: Window): void {
  const old = root.querySelector('.m-screen');
  old?.classList.add('leaving');
  clearTimeout(leaving);
  leaving = setTimeout(
    () => {
      current = nextLook();
      applySkin(current.style);
      root.innerHTML =
        window === 'menu'
          ? menuWindow(current.style)
          : window === 'lobby'
            ? lobbyWindow()
            : optionsWindow();
      const screen = root.querySelector('.m-screen');
      screen?.classList.add('leaving');
      wire();
      requestAnimationFrame(() => requestAnimationFrame(() => screen?.classList.remove('leaving')));
      shown = window;
      mockBar();
    },
    old === null ? 0 : 200,
  ) as unknown as number;
}

// ------------------------------------------------------------------------ the mockup's bar

const bar = document.createElement('div');
bar.className = 'mock-bar';
document.body.append(bar);

function mockBar(): void {
  const look = current === null ? '' : `${current.look === 'build' ? 'Building' : 'Combat'} look`;
  const style = current === null ? '' : lookName(current.style);
  const random = current !== null && choices[current.look] === 'random' ? ' (Random)' : '';
  bar.innerHTML = `<span>MOCKUP · window ${shownCount} · ${look}: <strong>${style}</strong>${random}</span>
    <span>Style elements</span>
    ${seg(['Light', 'Medium', 'Full'], ['light', 'medium', 'full'].indexOf(strength), 'id="strength"')}
    <button class="m-btn" id="again">Next look</button>
    <a class="m-btn" href="/" target="_blank">Today’s menu ↗</a>`;
  bar.querySelectorAll<HTMLButtonElement>('#strength button').forEach((button, i) =>
    button.addEventListener('click', () => {
      strength = (['light', 'medium', 'full'] as const)[i] ?? 'medium';
      if (current !== null) applySkin(current.style);
      mockBar();
    }),
  );
  bar.querySelector('#again')?.addEventListener('click', () => show(shown));
}

// ------------------------------------------------------------------------ the corner

const corner = document.createElement('div');
corner.className = 'm-corner';
corner.innerHTML = `<button class="m-btn">${ICONS.sound} Sound on</button><button class="m-btn">${ICONS.expand} Full screen</button>`;
document.body.append(corner);

if (globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  document.body.classList.add('reduced');
}
show('menu');
