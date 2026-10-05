import { detectLanguage, type Language } from '@bollwerk/config/languages';

import de from '../../../config/locale/de.json' with { type: 'json' };
import en from '../../../config/locale/en.json' with { type: 'json' };

import type { ControlState } from './control.js';
import type { DesktopApi } from './preload.js';

/**
 * The window's page (PLAN 11.17 A2): what the server is doing, the addresses to give the
 * other players, and a button for everything — mouse only, as the game is.
 */
declare global {
  interface Window {
    bollwerk: DesktopApi;
  }
}

/**
 * The window speaks the system's language, if the game does (PLAN 11.20): Electron gives the
 * page the system's languages. The game in its own window follows its menu, as everywhere.
 */
const language = detectLanguage(navigator.languages);

/**
 * The locale files themselves rather than the configuration's parsed copy, which would bring
 * every config file and its schemas into this page — 2.5 kB of script became 870 kB.
 */
type Key = keyof typeof en;
const TEXTS: Record<Language, Partial<Record<Key, unknown>>> = { en, de };

/** A text in that language — English where it lacks one — its `{placeholders}` filled. */
function say(key: Key, params: Record<string, string | number> = {}): string {
  const text = TEXTS[language][key] ?? en[key];
  const form = typeof text === 'string' ? text : key;
  return form.replace(/\{(\w+)\}/g, (whole, name: string) => String(params[name] ?? whole));
}

// The page's fixed texts, written in its language once.
document.documentElement.lang = language;
for (const node of Array.from(document.querySelectorAll<HTMLElement>('[data-t]'))) {
  node.textContent = say(node.dataset.t as Key);
}

const api = window.bollwerk;
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const status = $('status');
const detail = $('detail');
const urls = $<HTMLUListElement>('urls');
const toggle = $<HTMLButtonElement>('toggle');
const browser = $<HTMLButtonElement>('browser');
const play = $<HTMLButtonElement>('play');
const next = $<HTMLButtonElement>('next');
const upnp = $<HTMLInputElement>('upnp');
const internet = $('internet');
const publicList = $<HTMLUListElement>('public');

upnp.addEventListener('change', () => void api.setUpnp(upnp.checked));

/** What the router said, in words for the host (PLAN 11.21). */
export function describeInternet(state: ControlState): string {
  if (!state.upnp || state.status !== 'running')
    return state.upnp ? '' : say('desktop.internetOff');
  const s = state.internet;
  const port = state.port;
  switch (s.state) {
    case 'off':
    case 'searching':
      return say('desktop.searching', { port });
    case 'open':
      return s.ipv6 === null
        ? say('desktop.internetOpen')
        : `${say('desktop.internetOpen')} ${say('desktop.ipv6', { address: s.ipv6, port })}`;
    case 'no_router':
      return say('desktop.noRouter', { port });
    case 'refused':
      return say('desktop.refused', { port, detail: s.detail });
    case 'no_public_address':
      return say('desktop.noPublic', { address: s.address });
  }
}

/** An address with a button that copies it. */
function copyItem(url: string): HTMLLIElement {
  const item = document.createElement('li');
  const text = document.createElement('code');
  text.textContent = url;
  const copy = document.createElement('button');
  copy.className = 'quiet';
  copy.textContent = say('desktop.copy');
  copy.addEventListener('click', () => {
    void api.copy(url);
    copy.textContent = say('desktop.copied');
    setTimeout(() => (copy.textContent = say('desktop.copy')), 1200);
  });
  item.append(text, copy);
  return item;
}

/** What the status line says, and how it is coloured, for each state. */
export function describe(state: ControlState): { text: string; tone: string; detail: string } {
  switch (state.status) {
    case 'running':
      return { text: say('desktop.running'), tone: 'good', detail: say('desktop.runningDetail') };
    case 'starting':
      return {
        text: say('desktop.starting'),
        tone: 'busy',
        detail: say('desktop.startingDetail', { port: state.port }),
      };
    case 'stopping':
      return { text: say('desktop.stopping'), tone: 'busy', detail: '' };
    case 'stopped':
      return { text: say('desktop.stopped'), tone: 'idle', detail: say('desktop.stoppedDetail') };
    case 'failed':
      return {
        text: say('desktop.failed'),
        tone: 'bad',
        detail:
          state.reason === 'port_in_use'
            ? say('desktop.portInUse', { port: state.port })
            : state.reason === 'no_permission'
              ? say('desktop.noPermission', { port: state.port })
              : say('desktop.couldNotStart'),
      };
  }
}

function show(state: ControlState): void {
  const said = describe(state);
  status.textContent = said.text;
  status.className = `status ${said.tone}`;
  detail.textContent = said.detail;
  const running = state.status === 'running';
  const busy = state.status === 'starting' || state.status === 'stopping';
  toggle.textContent = running ? say('desktop.stop') : say('desktop.start');
  toggle.disabled = busy;
  browser.disabled = !running;
  play.disabled = !running;
  next.hidden = !(state.status === 'failed' && state.reason === 'port_in_use');
  next.textContent = say('desktop.tryPort', { port: state.port + 1 });
  urls.replaceChildren(...(state.status === 'running' ? state.urls : []).map(copyItem));
  upnp.checked = state.upnp;
  internet.textContent = describeInternet(state);
  publicList.replaceChildren(
    ...(state.status === 'running' && state.upnp && state.internet.state === 'open'
      ? [copyItem(state.internet.url)]
      : []),
  );
}

let current: ControlState | null = null;
api.onState((state) => {
  current = state;
  show(state);
});
toggle.addEventListener('click', () => {
  void (current?.status === 'running' ? api.stop() : api.start());
});
browser.addEventListener('click', () => void api.openBrowser());
play.addEventListener('click', () => void api.playHere());
next.addEventListener('click', () => void api.nextPort());
