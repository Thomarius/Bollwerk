import type { ArtLook, ArtStyle } from '@bollwerk/config';

import { LookRotation, type LookChoices } from './looks.js';
import { HUD_SKIN } from './skins.js';

/**
 * The menus in the game's looks (PLAN §11 item 4, MS4, the user's design): every new window —
 * the menu, a table, a tournament's screens — in the next look, the chosen build look and
 * combat look in turn, as the banners bring them in a match, and under Random a style from
 * the favourites drawn as the game draws them, none again until all have been shown
 * (`LookRotation`). A panel opened over a window keeps its look.
 *
 * What a look brings is "Medium", the user's choice from the mockup: its HUD skin's accent,
 * the edge and glow of its panels and its lettering for headings and the main buttons, over
 * the menus' own neutral base — not the skin's panels and ink throughout, which read badly in
 * many styles and changed too much from window to window.
 */

/** A skin's values the menus take, as the page resolves them. */
export interface LookDress {
  accent: string;
  onAccent: string;
  edge: string;
  shadow: string;
  /** The skin's own lettering, or null where it has none and the menus keep theirs. */
  font: string | null;
}

/** The base's shadow, under any glow a skin adds to it. */
const BASE_SHADOW = '0 24px 64px rgb(0 0 0 / 50%), 0 2px 8px rgb(0 0 0 / 35%)';

/**
 * A skin's values made the menus' own: the edge a hairline where the skin draws none, the
 * shadow the base's with the skin's glow over it, the lettering only where the skin has its
 * own — an empty value is the page's way of saying a variable is unset.
 */
export function dressFrom(read: (name: string) => string): LookDress {
  const value = (name: string): string => read(name).trim();
  const edge = value('--hud-box-edge');
  const glow = value('--hud-box-shadow');
  const font = value('--hud-font');
  return {
    // The accent for dark panels: the skin's own, or a brighter one where it is dark.
    accent: value('--panel-accent'),
    onAccent: value('--panel-on-accent'),
    edge: edge === '' || edge === 'none' ? '1px solid rgb(255 255 255 / 9%)' : edge,
    shadow: glow === '' || glow === 'none' ? BASE_SHADOW : `${glow}, ${BASE_SHADOW}`,
    font: font === '' || font === 'inherit' ? null : font,
  };
}

/** The rotation, made afresh when the choices or the favourites it draws from change. */
let rotation: { choices: string; rotation: LookRotation } | null = null;
let shown = 0;
let current: ArtStyle | null = null;

/** The look the next window takes: the build look and the combat look in turn. */
export function nextMenuStyle(choices: LookChoices): ArtStyle {
  const key = JSON.stringify(choices);
  if (rotation?.choices !== key) rotation = { choices: key, rotation: new LookRotation(choices) };
  const look: ArtLook = shown % 2 === 0 ? 'build' : 'combat';
  shown++;
  current = rotation.rotation.next(look, current);
  return current;
}

/** Reads a skin's values by wearing its class for an instant, nothing drawn between. */
function readDress(style: ArtStyle): LookDress {
  const body = document.body;
  const skin = HUD_SKIN[style];
  const had = body.classList.contains(skin);
  body.classList.add(skin);
  const computed = getComputedStyle(body);
  const dress = dressFrom((name) => computed.getPropertyValue(name));
  if (!had) body.classList.remove(skin);
  return dress;
}

/** Dresses the menus in a look, or takes the dress off (`null`), as a match begins. */
export function wearMenuLook(style: ArtStyle | null): void {
  const body = document.body;
  const vars = ['--look-accent', '--look-on-accent', '--look-edge', '--look-shadow', '--look-font'];
  showCorner(style);
  if (style === null) {
    body.classList.remove('looked');
    for (const name of vars) body.style.removeProperty(name);
    delete body.dataset.menuLook;
    return;
  }
  const dress = readDress(style);
  body.style.setProperty('--look-accent', dress.accent);
  body.style.setProperty('--look-on-accent', dress.onAccent);
  body.style.setProperty('--look-edge', dress.edge);
  body.style.setProperty('--look-shadow', dress.shadow);
  if (dress.font === null) body.style.removeProperty('--look-font');
  else body.style.setProperty('--look-font', dress.font);
  // Named on the page, for a test or a look at the page to say which look it wears.
  body.dataset.menuLook = style;
  body.classList.add('looked');
}

/**
 * The look's corner piece in the screen's corner, as it stands in the sea's corner in a match —
 * the buoy, the compass rose, the Ferris wheel… (`cornerPicture`), framed in the look's edge;
 * taken away with the dress. Loaded only when asked for, so this module needs no renderer.
 */
function showCorner(style: ArtStyle | null): void {
  let image = document.querySelector<HTMLImageElement>('#menu-corner');
  if (style === null) {
    image?.remove();
    return;
  }
  if (image === null) {
    image = document.createElement('img');
    image.id = 'menu-corner';
    image.alt = '';
    document.body.append(image);
  }
  const shown = image;
  shown.dataset.style = style;
  shown.classList.remove('ready');
  void import('./stylePreview.js')
    .then(({ cornerPicture }) => cornerPicture(style))
    .then(
      (url) => {
        // Only if the look still stands: a slow picture must not replace a newer one.
        if (!shown.isConnected || shown.dataset.style !== style || url === null) return;
        shown.src = url;
        shown.classList.add('ready');
      },
      () => undefined,
    );
}
