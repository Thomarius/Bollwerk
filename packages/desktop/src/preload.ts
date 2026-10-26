import { contextBridge, ipcRenderer } from 'electron';

import type { ControlState } from './control.js';
import type { FirewallStatus } from './firewall.js';

/**
 * What the window may ask of the main process, and nothing more: the window's own page is
 * sandboxed and never touches Node. See `main.ts` for each.
 */
const api = {
  start: (): Promise<void> => ipcRenderer.invoke('start'),
  stop: (): Promise<void> => ipcRenderer.invoke('stop'),
  nextPort: (): Promise<void> => ipcRenderer.invoke('next-port'),
  copy: (text: string): Promise<void> => ipcRenderer.invoke('copy', text),
  setUpnp: (on: boolean): Promise<void> => ipcRenderer.invoke('set-upnp', on),
  setTunnel: (on: boolean): Promise<void> => ipcRenderer.invoke('set-tunnel', on),
  openBrowser: (): Promise<void> => ipcRenderer.invoke('open-browser'),
  playHere: (): Promise<void> => ipcRenderer.invoke('play-here'),
  onState: (listener: (state: ControlState) => void): void => {
    ipcRenderer.on('state', (_event, state: ControlState) => listener(state));
  },
  onFirewall: (listener: (status: FirewallStatus) => void): void => {
    ipcRenderer.on('firewall', (_event, status: FirewallStatus) => listener(status));
  },
};

export type DesktopApi = typeof api;

contextBridge.exposeInMainWorld('bollwerk', api);
