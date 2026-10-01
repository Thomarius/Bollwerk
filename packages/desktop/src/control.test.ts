import type { RunningServer, StartResult } from '@rampart/server';
import { describe, expect, it } from 'vitest';

import { ServerControl, nextPort, type ControlState } from './control.js';

/** A start that binds every port but the ones it is told are taken. */
function fakeStart(taken: Set<number>, stopped: number[]) {
  return (port: number): Promise<StartResult> => {
    if (taken.has(port)) {
      return Promise.resolve({ ok: false, reason: 'port_in_use', port, host: '0.0.0.0' });
    }
    const server: RunningServer = {
      port,
      host: '0.0.0.0',
      urls: [`http://localhost:${port}`],
      stop: () => {
        stopped.push(port);
        return Promise.resolve();
      },
    };
    return Promise.resolve({ ok: true, server });
  };
}

describe('the server as the window shows it', () => {
  it('runs, stops and runs again, saying so at each step', async () => {
    const seen: ControlState['status'][] = [];
    const stopped: number[] = [];
    const control = new ServerControl(fakeStart(new Set(), stopped), 8080);
    control.onChange((s) => seen.push(s.status));
    await control.startOn();
    expect(control.state).toEqual({
      status: 'running',
      port: 8080,
      urls: ['http://localhost:8080'],
    });
    await control.stop();
    expect(stopped).toEqual([8080]);
    await control.startOn();
    expect(seen).toEqual(['starting', 'running', 'stopping', 'stopped', 'starting', 'running']);
  });

  it('says a port is taken, and starts on the next one offered', async () => {
    const control = new ServerControl(fakeStart(new Set([8080]), []), 8080);
    await control.startOn();
    expect(control.state).toEqual({ status: 'failed', port: 8080, reason: 'port_in_use' });
    await control.startOn(nextPort(8080));
    expect(control.state.status).toBe('running');
    expect(control.state.port).toBe(8081);
  });

  it('ignores a start while running and a stop while stopped', async () => {
    const stopped: number[] = [];
    const control = new ServerControl(fakeStart(new Set(), stopped), 8080);
    await control.stop();
    await control.startOn();
    await control.startOn(9000);
    expect(control.state.port).toBe(8080);
    expect(stopped).toEqual([]);
  });

  it('wraps the next port inside the range a user may bind', () => {
    expect(nextPort(8080)).toBe(8081);
    expect(nextPort(65535)).toBe(1024);
  });
});
