import type { BotTransport } from './workerDriver.js';

/**
 * The page's one bots' worker, made when the first local match wants it and kept for the
 * next — a rematch, a tournament's next match — which saves loading it again. A worker that
 * failed is ended and forgotten, so the next match makes a fresh one.
 */
let shared: BotTransport | null = null;

/** The worker, or null where there can be none: the bots then think on the page's thread. */
export function botWorker(): BotTransport | null {
  if (shared !== null) return shared;
  if (typeof Worker !== 'function') return null;
  let worker: Worker;
  try {
    // Written out whole, so Vite sees the worker and bundles it as one of its own.
    worker = new Worker(new URL('./botWorker.ts', import.meta.url), { type: 'module' });
  } catch (error) {
    console.warn('Bots on the page’s thread: no worker could be made.', error);
    return null;
  }
  let onMessage: Parameters<BotTransport['listen']>[0] = () => undefined;
  let onError: Parameters<BotTransport['listen']>[1] = () => undefined;
  worker.addEventListener('message', (event) => onMessage(event.data));
  worker.addEventListener('messageerror', () =>
    onError('a message from the worker could not be read'),
  );
  worker.addEventListener('error', (event) => {
    // A module that will not load says so here too; the event's default is a console line.
    onError(`the worker failed: ${event.message || 'it could not be loaded'}`);
  });
  const transport: BotTransport = {
    post: (message) => worker.postMessage(message),
    listen: (message, error) => {
      onMessage = message;
      onError = error;
    },
    terminate: () => {
      worker.terminate();
      if (shared === transport) shared = null;
    },
  };
  shared = transport;
  return transport;
}
