import { BotTable } from './botTable.js';
import { BOT_PROTOCOL_VERSION, type FromWorker, type ToWorker } from './protocol.js';

/**
 * The bots' worker (PLAN §11 item 3): a thin entry around `BotTable`, which holds all of
 * it. Typed with a scope of its own, since the client's types are the page's.
 */

interface WorkerScope {
  onmessage: ((event: { data: ToWorker }) => void) | null;
  postMessage(message: FromWorker): void;
}

const scope = globalThis as unknown as WorkerScope;
const table = new BotTable();

scope.onmessage = ({ data }) => {
  let answer: FromWorker | null;
  try {
    answer = table.handle(data);
  } catch (error) {
    answer = {
      type: 'failed',
      version: BOT_PROTOCOL_VERSION,
      match: data.match,
      tick: data.type === 'turn' ? data.tick : -1,
      message: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error),
    };
  }
  if (answer !== null) scope.postMessage(answer);
};
