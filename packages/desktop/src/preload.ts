import { contextBridge, ipcRenderer } from 'electron';

import type { ControlState } from './control.js';

/**
 * What the window may ask of the main process, and nothing more: the window's own page is
 * sandboxed and never touches Node. See `main.ts` for each.
 */
const api = {
  start: (): Promise<void> => ipcRenderer.invoke('start'),
  stop: (): Promise<void> => ipcRenderer.invoke('stop'),
  nextPort: (): Promise<void> => ipcRenderer.invoke('next-port'),
  copy: (text: string): Promise<void> => ipcRenderer.invoke('copy', text),
  openBrowser: (): Promise<void> => ipcRenderer.invoke('open-browser'),
  playHere: (): Promise<void> => ipcRenderer.invoke('play-here'),
  onState: (listener: (state: ControlState) => void): void => {
    ipcRenderer.on('state', (_event, state: ControlState) => listener(state));
  },
};

export type DesktopApi = typeof api;

contextBridge.exposeInMainWorld('rampart', api);
