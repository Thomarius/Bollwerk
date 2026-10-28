/**
 * The menus' icons (PLAN §11 item 4, MS1): line drawings on a 24-unit grid in the text's
 * colour, so they follow a button's state and a look's accent with no colour of their own.
 * Beside a button's words, never in place of them.
 */
const stroke = (path: string): string =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

export const ICONS = {
  play: stroke('<path d="M7 4v16l13-8z" fill="currentColor"/>'),
  pause: stroke('<path d="M8 5v14M16 5v14"/>'),
  trophy: stroke(
    '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>',
  ),
  resume: stroke('<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>'),
  help: stroke(
    '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"/>',
  ),
  gear: stroke(
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  ),
  join: stroke('<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>'),
  back: stroke('<path d="M19 12H5M12 19l-7-7 7-7"/>'),
  sound: stroke(
    '<path d="M11 5 6 9H2v6h4l5 4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  ),
  mute: stroke(
    '<path d="M11 5 6 9H2v6h4l5 4z" fill="currentColor"/><path d="m22 9-6 6M16 9l6 6"/>',
  ),
  expand: stroke('<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>'),
  shrink: stroke('<path d="M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5"/>'),
  gallery: stroke(
    '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  ),
  dice: stroke(
    '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.3" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>',
  ),
  crown: stroke('<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" fill="currentColor"/>'),
  eye: stroke(
    '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  ),
} as const;

export type IconName = keyof typeof ICONS;

/**
 * Each award's icon on its card in the summary (`awards.ts` names them), so a card reads at a
 * glance (2026-10-28); an award without one shows none.
 */
export const AWARD_ICONS: Readonly<Record<string, string>> = {
  wrecker: stroke(
    '<path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3"/>',
  ),
  landlord: stroke('<path d="M5 21V4M5 4h12l-2.5 4L17 12H5M3 21h8"/>'),
  collector: stroke('<path d="M4 21V9h3V6h2v3h6V6h2v3h3v12zM10 21v-4h4v4"/>'),
  'iron-wall': stroke('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>'),
  comeback: stroke('<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>'),
  'front-runner': stroke('<path d="M5 6l6 6-6 6M13 6l6 6-6 6"/>'),
  'photo-finish': stroke(
    '<rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13.5" r="3.5"/><path d="M8 7l2-3h4l2 3"/>',
  ),
  'last-stand': stroke(
    '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  ),
  phoenix: stroke(
    '<path d="M12 21c-4 0-6-3-6-6 0-4 4-6 4-10 3 2 4 4 4 6 1-1 2-2 2-4 2 2 2 5 2 8 0 3-2 6-6 6z"/>',
  ),
  'late-bloomer': stroke(
    '<path d="M12 21V11M12 11c0-4 3-7 7-7 0 4-3 7-7 7zM12 14c0-3-2.5-5-6-5 0 3 2.5 5 6 5z"/>',
  ),
  artillerist: stroke('<circle cx="8" cy="16" r="4"/><path d="M10.5 13 20 6l1.5 2.5-9 7.5"/>'),
  steady: stroke('<path d="M3 12h4l2-4 3 8 2-4h7"/>'),
  nemesis: stroke('<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>'),
  mason: stroke('<path d="M3 6h18v12H3zM3 12h18M9 6v6M15 12v6"/>'),
};

/** A button's inside: its icon, then its words in a span of their own, so they can change alone. */
export function withIcon(name: IconName, words: string): string {
  return `${ICONS[name]}<span>${words}</span>`;
}
