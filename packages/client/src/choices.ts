/**
 * Choices in sight (PLAN §11 item 4, MS2): a `<select>` of a few options shown as what it is —
 * a row of buttons (`data-ui="seg"`), a number stepped either way (`"step"`) or a switch
 * (`"switch"`, its first option off and its second on) — one click where a list took two.
 *
 * The select stays, hidden, and is still the choice: a click sets it and fires its `change`, so
 * everything that reads or listens to it is as it was, the room's messages and the tests among
 * it. A select set by a script (the pause menu as it opens) is shown afresh by `syncChoices`.
 * A step shows the option's `data-short` where it has one, as the bots' levels show their
 * number beside their pips rather than "Level 5".
 */

/** Builds the controls for every select under `root` that asks for one and has none yet. */
export function enhanceChoices(root: ParentNode): void {
  for (const select of root.querySelectorAll<HTMLSelectElement>('select[data-ui]')) {
    if (select.dataset.enhanced === '1') continue;
    select.dataset.enhanced = '1';
    const kind = select.dataset.ui as 'seg' | 'step' | 'switch';
    const control = document.createElement('span');
    control.className = `ui-choice ${kind}`;
    control.setAttribute('role', 'group');
    const label = select.getAttribute('aria-label');
    if (label !== null) control.setAttribute('aria-label', label);
    select.classList.add('replaced');
    select.after(control);
    build(select, control, kind);
    show(select, control, kind);
    select.addEventListener('change', () => show(select, control, kind));
  }
}

/** Shows every control under `root` as its select now stands. */
export function syncChoices(root: ParentNode): void {
  for (const select of root.querySelectorAll<HTMLSelectElement>('select[data-enhanced="1"]')) {
    const control = select.nextElementSibling;
    if (control instanceof HTMLElement && control.classList.contains('ui-choice')) {
      show(select, control, select.dataset.ui as 'seg' | 'step' | 'switch');
    }
  }
}

/** Chooses the option at `index`, as a person choosing in the list would. */
function pick(select: HTMLSelectElement, index: number): void {
  if (select.disabled || index < 0 || index >= select.options.length) return;
  if (index === select.selectedIndex) return;
  select.selectedIndex = index;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

const shortText = (option: HTMLOptionElement | undefined): string =>
  option === undefined ? '' : (option.dataset.short ?? option.text);

function button(text: string, onClick: () => void, aria?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  if (aria !== undefined) b.setAttribute('aria-label', aria);
  b.addEventListener('click', (event) => {
    // Not the label's own: a click inside a label would also go to the hidden select.
    event.preventDefault();
    onClick();
  });
  return b;
}

function build(
  select: HTMLSelectElement,
  control: HTMLElement,
  kind: 'seg' | 'step' | 'switch',
): void {
  if (kind === 'seg') {
    [...select.options].forEach((option, i) => {
      control.append(button(shortText(option), () => pick(select, i)));
    });
  } else if (kind === 'step') {
    const out = document.createElement('output');
    control.append(
      button('−', () => pick(select, select.selectedIndex - 1), '−'),
      out,
      button('+', () => pick(select, select.selectedIndex + 1), '+'),
    );
  } else {
    const toggle = button('', () => pick(select, select.selectedIndex === 1 ? 0 : 1));
    toggle.setAttribute('role', 'switch');
    control.append(toggle);
  }
}

function show(
  select: HTMLSelectElement,
  control: HTMLElement,
  kind: 'seg' | 'step' | 'switch',
): void {
  const at = select.selectedIndex;
  const buttons = [...control.querySelectorAll('button')];
  control.classList.toggle('disabled', select.disabled);
  if (kind === 'seg') {
    buttons.forEach((b, i) => {
      b.classList.toggle('on', i === at);
      b.setAttribute('aria-pressed', String(i === at));
      b.disabled = select.disabled;
    });
  } else if (kind === 'step') {
    const out = control.querySelector('output');
    if (out !== null) out.textContent = shortText(select.options[at]);
    const [less, more] = buttons;
    if (less !== undefined) less.disabled = select.disabled || at <= 0;
    if (more !== undefined) more.disabled = select.disabled || at >= select.options.length - 1;
  } else {
    const toggle = buttons[0];
    if (toggle === undefined) return;
    toggle.classList.toggle('on', at === 1);
    toggle.setAttribute('aria-checked', String(at === 1));
    toggle.setAttribute('aria-label', select.options[at]?.text ?? '');
    toggle.disabled = select.disabled;
  }
}
