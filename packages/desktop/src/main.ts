import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfigBundle } from '@bollwerk/config/node';
import { startServer } from '@bollwerk/server';
import { BrowserWindow, app, clipboard, ipcMain, shell } from 'electron';

import { ServerControl, nextPort } from './control.js';

/**
 * The desktop app (PLAN 11.17 A2): the server behind a minimal window, for a host with no
 * Node, repository or terminal. Start and Stop, the addresses to give the other players,
 * Open in browser, and Play here — the game in a window of the app's own. Closing the
 * window stops the server. Recordings go to a folder of the user's and are never shown:
 * they are for tuning, not for players.
 *
 * Where things are differs between running from the repository and running packaged
 * (A3): packaged, the config, the client and the audio are the app's resources.
 */
/** The commit the app was built from, put in by `build.js`; null when it could not tell. */
declare const __BOLLWERK_COMMIT__: string | null;
const BUILT_FROM = __BOLLWERK_COMMIT__;

const here = dirname(fileURLToPath(import.meta.url));
const root = app.isPackaged ? process.resourcesPath : resolve(here, '..', '..', '..');
const clientDir = app.isPackaged
  ? join(process.resourcesPath, 'client')
  : join(root, 'packages', 'client', 'dist');

// Named, so its data — the recordings — sits in a folder called Bollwerk, not @bollwerk/desktop.
app.setName('Bollwerk');

/** One copy at a time: a second would only find the first's port taken. */
if (!app.requestSingleInstanceLock()) app.quit();

/**
 * The window's one remembered choice, "Open to the internet" (PLAN 11.21): off until the
 * host switches it on, then on at every start until they switch it off.
 */
const settingsFile = join(app.getPath('userData'), 'settings.json');
function savedUpnp(): boolean {
  try {
    return (JSON.parse(readFileSync(settingsFile, 'utf8')) as { upnp?: unknown }).upnp === true;
  } catch {
    return false;
  }
}

const bundle = loadConfigBundle(root);
const control = new ServerControl(
  (port) =>
    startServer({
      root,
      clientDir,
      recordingsDir: join(app.getPath('userData'), 'recordings'),
      port,
      // Packaged, there is no repository to ask: the commit is baked in as it was built.
      ...(app.isPackaged ? { commit: BUILT_FROM } : {}),
    }),
  bundle.server.port,
  savedUpnp(),
);

let window: BrowserWindow | null = null;
let quitting = false;

function createWindow(): void {
  window = new BrowserWindow({
    width: 440,
    height: 640,
    resizable: false,
    title: 'Bollwerk server',
    backgroundColor: '#12131c',
    autoHideMenuBar: true,
    webPreferences: { preload: join(here, 'preload.cjs') },
  });
  void window.loadFile(join(here, '..', 'ui', 'index.html'));
  window.webContents.on('did-finish-load', () => window?.webContents.send('state', control.state));
  // Closing the window stops the server before the app goes, so the port is free after.
  window.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    void control.stop().finally(() => app.quit());
  });
}

control.onChange((state) => window?.webContents.send('state', state));

ipcMain.handle('start', (_event, port?: number) => control.startOn(port));
ipcMain.handle('stop', () => control.stop());
ipcMain.handle('next-port', () => control.startOn(nextPort(control.state.port)));
ipcMain.handle('set-upnp', (_event, on: boolean) => {
  try {
    writeFileSync(settingsFile, JSON.stringify({ upnp: on === true }));
  } catch {
    // Not remembered: it still applies until the app closes.
  }
  return control.setUpnp(on === true);
});
ipcMain.handle('copy', (_event, text: string) => clipboard.writeText(text));
ipcMain.handle('open-browser', () => {
  const state = control.state;
  if (state.status === 'running') void shell.openExternal(`http://localhost:${state.port}`);
});
ipcMain.handle('play-here', () => {
  const state = control.state;
  if (state.status !== 'running') return;
  const play = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Bollwerk',
    backgroundColor: '#0a0a12',
    autoHideMenuBar: true,
    // The app's own window may play sound unasked, so the music starts as the game opens
    // rather than at the first click, as a browser insists (the users' wish, 2026-10-09).
    webPreferences: { autoplayPolicy: 'no-user-gesture-required' },
  });
  // The Credits' links lead off the game, to a licence or an author's page: the
  // person's own browser, not another window of the app.
  play.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  void play.loadURL(`http://localhost:${state.port}`);
});

app.on('second-instance', () => {
  if (window === null) return;
  if (window.isMinimized()) window.restore();
  window.focus();
});

void app.whenReady().then(() => {
  createWindow();
  // Started at once: starting the server is what the app is opened for.
  void control.startOn();
});
