/**
 * Windows fading in as they arrive (PLAN §11 item 4, MS3). Every window outside a match is
 * written into the page's `#app` as one `.menu` element, and some are written again at every
 * change — the lobby at each choice — so a window is new only when its kind is: the classes
 * of the element, `menu home` for the menu, `menu lobby` for a table. A redrawn lobby keeps
 * its kind and does not flicker; the menu after the lobby fades in.
 */

/** The kind of window an element is, or null for anything that is not one (a match). */
export function windowKind(element: Element | null): string | null {
  const classes = element === null ? [] : [...element.classList];
  if (!classes.includes('menu')) return null;
  return classes.filter((c) => c !== 'entering').join(' ');
}

/** Marks each window of a new kind written into `root`, which the stylesheet fades in. */
export function watchWindows(root: HTMLElement): void {
  let shown: string | null = null;
  new MutationObserver(() => {
    const element = root.firstElementChild;
    const kind = windowKind(element);
    if (kind !== null && kind !== shown) element?.classList.add('entering');
    shown = kind;
  }).observe(root, { childList: true });
}
