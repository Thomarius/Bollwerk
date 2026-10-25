import { audio } from './app.js';
import { escape } from './html.js';
import { t } from './i18n.js';

/**
 * The loading screen before the first menu (ARCHIVE 14b): every sound and music
 * file fetched once, with a bar, before anything else opens — the user's choice of waiting for
 * all of it, so the game never waits on a file later. From the player's own disk it is a moment;
 * from a host the first time, as long as the host's upload takes; after that the browser has
 * them and the host only says they have not changed.
 */
export async function showLoading(): Promise<void> {
  const root = document.createElement('div');
  root.className = 'loading-screen';
  root.innerHTML =
    `<div class="panel" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">` +
    `<h1>Bollwerk</h1><p>${escape(t('loading.audio'))}</p>` +
    `<div class="bar"><div class="fill"></div></div></div>`;
  const panel = root.querySelector<HTMLElement>('.panel')!;
  const fill = root.querySelector<HTMLElement>('.fill')!;
  document.body.append(root);
  let shown = -1;
  try {
    await audio.load((done) => {
      const percent = Math.round(done * 100);
      if (percent <= shown) return;
      shown = percent;
      fill.style.width = `${percent}%`;
      panel.setAttribute('aria-valuenow', String(percent));
    });
  } finally {
    root.remove();
  }
}
