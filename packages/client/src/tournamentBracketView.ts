import { HOST_TEAM, type Progress, type Save } from '@bollwerk/tournament';

import { escape } from './html.js';
import { formatNumber, ordinal, t } from './i18n.js';
import { bracketLayout, type BracketNode } from './tournamentBracket.js';
import { stageName } from './tournamentText.js';

/**
 * The knockout's tree in a window of its own over the tournament screen (the test session's
 * request, 2026-10-08): drawn as an SVG from `bracketLayout`, fitted to the window, a match's
 * teams and places shown for the box the mouse is on and pinned by a click. Mouse only: Close
 * is a button.
 */

/** Wide enough for the longest stage heading, "Winners' bracket, round 1". */
const COLUMN = 200;
const ROW = 30;
const BOX_W = 150;
const BOX_H = 20;
const PAD = 40;
/** Up to this many rows the boxes are tall enough to letter with their winner. */
const LETTERED_ROWS = 24;

function teamName(save: Save, id: number): string {
  return save.teams[id]?.name ?? '?';
}

/** A match's details for its tooltip: where, and its teams — placed, as they stand, or to come. */
function details(save: Save, n: BracketNode): string {
  const head = `<b>${escape(stageName(save, n.step))}</b>`;
  if (n.teams === null) return `${head}<p>${escape(t('bracket.later'))}</p>`;
  const tag = (id: number): string =>
    id === HOST_TEAM
      ? ` <em class="you">${escape(t('tournament.yourTeamTag'))}</em>`
      : save.teams[id]?.archnemesis === true
        ? ` <em class="arch">${escape(t('tournament.archTag'))}</em>`
        : '';
  if (n.order === null) {
    const list = n.teams.map((id) => `<li>${escape(teamName(save, id))}${tag(id)}</li>`).join('');
    return `${head}<p>${escape(t('bracket.toPlay'))}</p><ul>${list}</ul>`;
  }
  const list = n.order
    .map((id, place) => {
      const score = n.scores?.[place];
      return (
        `<li><span class="place">${escape(ordinal(place + 1))}</span> ${escape(teamName(save, id))}${tag(id)}` +
        (score === undefined ? '' : ` <span class="score">${escape(formatNumber(score))}</span>`) +
        `</li>`
      );
    })
    .join('');
  const how = n.scores === null ? t('bracket.rolled') : t('bracket.played');
  return `${head}<p>${escape(how)}</p><ol>${list}</ol>`;
}

export function bracketSvg(save: Save, progress: Progress): string {
  const layout = bracketLayout(save, progress);
  const width = layout.columns * COLUMN + PAD * 2;
  const height = layout.rows * ROW + PAD * 2;
  const cx = (n: BracketNode): number => PAD + n.x * COLUMN;
  const cy = (n: BracketNode): number => PAD + n.y * ROW + ROW / 2;
  const byKey = new Map(layout.nodes.map((n) => [n.key, n]));
  const lettered = layout.rows <= LETTERED_ROWS;
  const lines = layout.edges
    .map((e) => {
      const a = byKey.get(e.from);
      const b = byKey.get(e.to);
      if (a === undefined || b === undefined) return '';
      const x1 = cx(a) + BOX_W;
      const y1 = cy(a);
      const x2 = cx(b);
      const y2 = cy(b);
      const mid = (x1 + x2) / 2;
      return `<path class="edge${e.host ? ' host' : ''}" d="M${x1} ${y1} H${mid} V${y2} H${x2}"/>`;
    })
    .join('');
  const boxes = layout.nodes
    .map((n) => {
      const classes = ['match', n.state, n.host ? 'host' : '', n.arch ? 'arch' : '']
        .filter((c) => c !== '')
        .join(' ');
      const winner = n.order?.[0];
      const label =
        lettered && winner !== undefined
          ? `<text x="${cx(n) + 8}" y="${cy(n) + 4}">${escape(teamName(save, winner).slice(0, 18))}</text>`
          : '';
      const dot = n.arch
        ? `<circle class="arch-dot" cx="${cx(n) + BOX_W - 8}" cy="${cy(n)}" r="4"/>`
        : '';
      return (
        `<g class="${classes}" data-key="${n.key}">` +
        `<rect x="${cx(n)}" y="${cy(n) - BOX_H / 2}" width="${BOX_W}" height="${BOX_H}" rx="4"/>` +
        `${label}${dot}</g>`
      );
    })
    .join('');
  // Each column named as its stage is, the winners' over the top and the losers' over its band.
  const heads = new Map<string, { x: number; y: number; text: string }>();
  for (const n of layout.nodes) {
    const key = `${n.section}:${n.x}`;
    if (heads.has(key)) continue;
    const y = n.section === 'losers' ? PAD + (layout.losersTop ?? 0) * ROW - 8 : PAD - 14;
    heads.set(key, { x: cx(n), y, text: stageName(save, n.step) });
  }
  const headings = [...heads.values()]
    .map((h) => `<text class="heading" x="${h.x}" y="${h.y}">${escape(h.text)}</text>`)
    .join('');
  return (
    // At its own size, never shrunk to fit: a knockout of 64 matches a round scrolls instead.
    `<svg class="bracket-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `${headings}${lines}${boxes}</svg>`
  );
}

/** Opens the bracket over whatever is on screen; `click` sounds as the menu's buttons do. */
export function openBracket(save: Save, progress: Progress, click: () => void): void {
  const layout = bracketLayout(save, progress);
  const byKey = new Map(layout.nodes.map((n) => [n.key, n]));
  const overlay = document.createElement('div');
  overlay.className = 'bracket-overlay';
  overlay.innerHTML =
    `<div class="panel"><h2>${escape(t('bracket.title'))}</h2>` +
    `<p class="note">${escape(t('bracket.hint'))}</p>` +
    `<div class="bracket-scroll">${bracketSvg(save, progress)}</div>` +
    `<div class="bracket-tip" hidden></div>` +
    `<button class="close">${escape(t('howTo.close'))}</button></div>`;
  document.body.append(overlay);
  const tip = overlay.querySelector<HTMLElement>('.bracket-tip')!;
  let pinned: string | null = null;
  const show = (key: string | null, event: MouseEvent): void => {
    const n = key === null ? undefined : byKey.get(key);
    if (n === undefined) {
      tip.hidden = true;
      return;
    }
    tip.innerHTML = details(save, n);
    tip.hidden = false;
    const panel = overlay.querySelector<HTMLElement>('.panel')!.getBoundingClientRect();
    tip.style.left = `${Math.min(event.clientX - panel.left + 14, panel.width - 260)}px`;
    tip.style.top = `${event.clientY - panel.top + 14}px`;
  };
  const keyAt = (event: MouseEvent): string | null =>
    (event.target as Element).closest('g.match')?.getAttribute('data-key') ?? null;
  overlay.addEventListener('mousemove', (event) => {
    if (pinned === null) show(keyAt(event), event);
  });
  overlay.addEventListener('click', (event) => {
    if ((event.target as Element).closest('.close') !== null) {
      click();
      overlay.remove();
      return;
    }
    const key = keyAt(event);
    if (key === null) return;
    click();
    // A click pins a match's details, and a second click on it lets them go.
    pinned = pinned === key ? null : key;
    show(key, event);
    for (const g of overlay.querySelectorAll('g.match.pinned')) g.classList.remove('pinned');
    if (pinned !== null)
      overlay.querySelector(`g.match[data-key="${pinned}"]`)?.classList.add('pinned');
  });
}
