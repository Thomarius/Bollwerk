import type { ControlState } from './control.js';
import type { DesktopApi } from './preload.js';

/**
 * The window's page (PLAN 11.17 A2): what the server is doing, the addresses to give the
 * other players, and a button for everything — mouse only, as the game is.
 */
declare global {
  interface Window {
    rampart: DesktopApi;
  }
}

const api = window.rampart;
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const status = $('status');
const detail = $('detail');
const urls = $<HTMLUListElement>('urls');
const toggle = $<HTMLButtonElement>('toggle');
const browser = $<HTMLButtonElement>('browser');
const play = $<HTMLButtonElement>('play');
const next = $<HTMLButtonElement>('next');

/** What the status line says, and how it is coloured, for each state. */
export function describe(state: ControlState): { text: string; tone: string; detail: string } {
  switch (state.status) {
    case 'running':
      return { text: 'Running', tone: 'good', detail: 'Other players open one of these:' };
    case 'starting':
      return { text: 'Starting…', tone: 'busy', detail: `On port ${state.port}` };
    case 'stopping':
      return { text: 'Stopping…', tone: 'busy', detail: '' };
    case 'stopped':
      return { text: 'Stopped', tone: 'idle', detail: 'Nobody can join until it is started.' };
    case 'failed':
      return {
        text: 'Not started',
        tone: 'bad',
        detail:
          state.reason === 'port_in_use'
            ? `Port ${state.port} is in use — another server may be running.`
            : state.reason === 'no_permission'
              ? `Not allowed to use port ${state.port}.`
              : 'The server could not start.',
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
  toggle.textContent = running ? 'Stop' : 'Start';
  toggle.disabled = busy;
  browser.disabled = !running;
  play.disabled = !running;
  next.hidden = !(state.status === 'failed' && state.reason === 'port_in_use');
  next.textContent = `Try port ${state.port + 1}`;
  urls.replaceChildren(
    ...(state.status === 'running' ? state.urls : []).map((url) => {
      const item = document.createElement('li');
      const text = document.createElement('code');
      text.textContent = url;
      const copy = document.createElement('button');
      copy.className = 'quiet';
      copy.textContent = 'Copy';
      copy.addEventListener('click', () => {
        void api.copy(url);
        copy.textContent = 'Copied';
        setTimeout(() => (copy.textContent = 'Copy'), 1200);
      });
      item.append(text, copy);
      return item;
    }),
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
