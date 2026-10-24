import type { Clan, HairColours, Hairstyle } from './figures.js';

/**
 * The Anime style's portraits (ARCHIVE 14w): your clan's hero, hair in your
 * colour, in the expression your seat's situation calls for — inline SVG for the HTML banner —
 * and the cut-ins on the board, two heroes' faces split on a diagonal, made images.
 */

/**
 * Determined before a fight, shouting as a shot strikes home, shocked at a breach, relaxed
 * once a round is held, in tears at a life spent.
 */
export type Expression = 'determined' | 'shout' | 'shocked' | 'relaxed' | 'tears';

/** A hero to draw: their clan, hairstyle and hair colours. */
export interface Hero {
  clan: Clan;
  style: Hairstyle;
  hair: HairColours;
}

const INK = '#2b1d2e';
const SKIN = '#ffe2cc';
const SKIN_SHADE = '#f3b89c';

const OUTFIT: Record<Clan, { cloth: string; trim: string }> = {
  karate: { cloth: '#f7f5ef', trim: '#1c1a20' },
  mage: { cloth: '#2c3358', trim: '#f0c445' },
  maid: { cloth: '#24232e', trim: '#ffffff' },
  genius: { cloth: '#3f3a52', trim: '#2f5d50' },
  soldier: { cloth: '#66733f', trim: '#3a3226' },
  sword: { cloth: '#b9c7d6', trim: '#2c3150' },
  mecha: { cloth: '#8b93a3', trim: '#5ff3e6' },
  idol: { cloth: '#fdfbff', trim: '#f0c445' },
};

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

const W = 360;
const H = 200;
const CX = 250;
const CY = 100;
const R = 62;

/** Clip paths need ids unique on the page, where several portraits may stand at once. */
let clipIds = 0;

/**
 * A hero's portrait in a slanted panel, its background the expression's: `call`, where given,
 * lettered across its foot.
 */
export function portraitSvg(
  clan: Clan,
  style: Hairstyle,
  hairColours: HairColours,
  expression: Expression,
  call = '',
): string {
  const id = `anime-clip-${++clipIds}`;
  const lettered =
    call === ''
      ? ''
      : `<text x="22" y="${H - 18}" font-family="'Arial Black', Impact, sans-serif" font-size="32" font-style="italic"
      fill="#fff" stroke="${INK}" stroke-width="7" paint-order="stroke" transform="rotate(-6 22 ${H - 18})">${call}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs><clipPath id="${id}"><polygon points="30,0 ${W},0 ${W - 30},${H} 0,${H}"/></clipPath></defs>
  <g clip-path="url(#${id})">
    ${background(expression)}
    ${heroSvg({ clan, style, hair: hairColours }, expression)}
    ${lettered}
  </g>
  <polygon points="30,0 ${W},0 ${W - 30},${H} 0,${H}" fill="none" stroke="#fff" stroke-width="8"/>
  <polygon points="30,0 ${W},0 ${W - 30},${H} 0,${H}" fill="none" stroke="${INK}" stroke-width="3"/>
</svg>`;
}

/**
 * A cut-in on the board: the attacker shouting on the left over focus lines, the one hit
 * shocked on the right in the gloom, facing each other across a white slash. Without an
 * attacker, the one hit alone.
 */
export function cutInSvg(attacker: Hero | null, victim: Hero): string {
  const id = `anime-cut-${++clipIds}`;
  const top = W * 0.58;
  const foot = W * 0.42;
  const right = `<g transform="translate(${2 * CX + 20} 0) scale(-1 1)">${heroSvg(victim, 'shocked', false)}</g>`;
  const body =
    attacker === null
      ? `${background('shocked')}<g transform="translate(-70 0)">${heroSvg(victim, 'shocked')}</g>`
      : `<g clip-path="url(#${id}-l)">${background('shout')}<g transform="translate(-150 0)">${heroSvg(attacker, 'shout')}</g></g>
    <g clip-path="url(#${id}-r)">${background('shocked')}${right}</g>
    <line x1="${top}" y1="-4" x2="${foot}" y2="${H + 4}" stroke="${INK}" stroke-width="12"/>
    <line x1="${top}" y1="-4" x2="${foot}" y2="${H + 4}" stroke="#fff" stroke-width="7"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <clipPath id="${id}-l"><polygon points="0,0 ${top},0 ${foot},${H} 0,${H}"/></clipPath>
    <clipPath id="${id}-r"><polygon points="${top},0 ${W},0 ${W},${H} ${foot},${H}"/></clipPath>
    <clipPath id="${id}"><rect width="${W}" height="${H}"/></clipPath>
  </defs>
  <g clip-path="url(#${id})">${body}</g>
  <rect x="3" y="3" width="${W - 6}" height="${H - 6}" fill="none" stroke="#fff" stroke-width="6"/>
  <rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" fill="none" stroke="${INK}" stroke-width="3"/>
</svg>`;
}

/** The hero alone, head and shoulders, the head at (CX, CY), facing right. */
function heroSvg(hero: Hero, expression: Expression, lettered = true): string {
  const { clan, style } = hero;
  const hair = {
    base: hex(hero.hair.base),
    light: hex(hero.hair.light),
    dark: hex(hero.hair.dark),
  };
  const o = OUTFIT[clan];
  return `${clan === 'karate' ? `<path d="M ${CX - 60} ${CY - 14} L ${CX - 110} ${CY + 20} M ${CX - 60} ${CY - 14} L ${CX - 104} ${CY - 30}" stroke="#1c1a20" stroke-width="8" stroke-linecap="round"/>` : ''}
    ${hairBack(style, hair)}
    <path d="M ${CX - 95} ${H} Q ${CX - 80} ${CY + 70} ${CX} ${CY + 66} Q ${CX + 80} ${CY + 70} ${CX + 95} ${H} Z" fill="${o.cloth}" stroke="${INK}" stroke-width="3"/>
    ${collar(clan, o)}
    <rect x="${CX - 14}" y="${CY + 40}" width="28" height="30" fill="${SKIN_SHADE}"/>
    <ellipse cx="${CX - 52}" cy="${CY + 8}" rx="10" ry="14" fill="${SKIN}" stroke="${INK}" stroke-width="3"/>
    <circle cx="${CX}" cy="${CY}" r="${R}" fill="${SKIN}" stroke="${INK}" stroke-width="3"/>
    ${face(expression, clan)}
    ${hairFront(style, hair)}
    ${headwear(clan)}
    ${effects(expression, lettered)}
    ${hand(expression)}`;
}

function background(expression: Expression): string {
  if (expression === 'determined' || expression === 'shout') {
    // Focus lines on a burning ground: the cut-in before a fight.
    const lines: string[] = [];
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const b = a + 0.05;
      const r = 400;
      lines.push(
        `<polygon points="${CX + Math.cos(a) * 90},${CY + Math.sin(a) * 90} ${CX + Math.cos(a) * r},${CY + Math.sin(a) * r} ${CX + Math.cos(b) * r},${CY + Math.sin(b) * r}" fill="#fff" opacity="0.55"/>`,
      );
    }
    return `<linearGradient id="bgd" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ffb02a"/><stop offset="0.5" stop-color="#e8402a"/><stop offset="1" stop-color="#7a1030"/></linearGradient>
      <rect width="${W}" height="${H}" fill="url(#bgd)"/>${lines.join('')}`;
  }
  if (expression === 'shocked' || expression === 'tears') {
    // The blue shade and the gloom lines: something has gone very wrong.
    const lines: string[] = [];
    for (let i = 0; i < 9; i++) {
      const x = CX - 44 + i * 11;
      lines.push(
        `<line x1="${x}" y1="${CY - 58}" x2="${x}" y2="${CY - 10 - (i % 3) * 8}" stroke="#3a3a8a" stroke-width="3" opacity="0.8"/>`,
      );
    }
    return `<rect width="${W}" height="${H}" fill="#2a2c5a"/>
      <g opacity="0.25">${Array.from({ length: 12 }, (_, i) => `<line x1="${i * 34}" y1="0" x2="${i * 34 - 40}" y2="${H}" stroke="#9aa8ff" stroke-width="2"/>`).join('')}</g>
      <g id="gloom">${lines.join('')}</g>`;
  }
  // Relaxed: a summer sky, sparkles.
  const sparkles = [
    [70, 40, 10],
    [120, 80, 6],
    [320, 40, 9],
    [300, 150, 7],
    [90, 140, 5],
  ]
    .map(([x, y, r]) => sparkle(x!, y!, r!, '#fff'))
    .join('');
  return `<linearGradient id="bgr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4aa8ff"/><stop offset="1" stop-color="#bfe6ff"/></linearGradient>
    <rect width="${W}" height="${H}" fill="url(#bgr)"/>
    <ellipse cx="80" cy="170" rx="90" ry="30" fill="#fff" opacity="0.9"/><ellipse cx="130" cy="160" rx="50" ry="34" fill="#fff" opacity="0.9"/>
    ${sparkles}`;
}

function sparkle(x: number, y: number, r: number, fill: string): string {
  const k = r * 0.28;
  return `<polygon points="${x},${y - r} ${x + k},${y - k} ${x + r},${y} ${x + k},${y + k} ${x},${y + r} ${x - k},${y + k} ${x - r},${y} ${x - k},${y - k}" fill="${fill}"/>`;
}

function collar(clan: Clan, o: { cloth: string; trim: string }): string {
  switch (clan) {
    case 'karate':
      return `<path d="M ${CX - 30} ${CY + 66} L ${CX + 20} ${H} M ${CX + 30} ${CY + 66} L ${CX} ${CY + 110}" stroke="${INK}" stroke-width="3" fill="none"/>`;
    case 'maid':
      return `<path d="M ${CX - 34} ${CY + 66} L ${CX + 34} ${CY + 66} L ${CX + 20} ${CY + 90} L ${CX - 20} ${CY + 90} Z" fill="#fff" stroke="${INK}" stroke-width="3"/>`;
    case 'genius':
      return `<path d="M ${CX - 22} ${CY + 66} L ${CX + 22} ${CY + 66} L ${CX} ${CY + 104} Z" fill="#fff" stroke="${INK}" stroke-width="2"/>
        <path d="M ${CX - 5} ${CY + 70} L ${CX + 5} ${CY + 70} L ${CX + 7} ${CY + 110} L ${CX} ${CY + 118} L ${CX - 7} ${CY + 110} Z" fill="${o.trim}"/>`;
    case 'idol':
      return `<path d="M ${CX - 20} ${CY + 80} L ${CX} ${CY + 70} L ${CX + 20} ${CY + 80} L ${CX} ${CY + 90} Z" fill="${o.trim}" stroke="${INK}" stroke-width="2"/>`;
    default:
      return '';
  }
}

const EYE_N = { x: CX - 6, y: CY + 10 };
const EYE_F = { x: CX + 36, y: CY + 10 };

function face(expression: Expression, clan: Clan): string {
  const parts: string[] = [];
  for (const e of [EYE_N, EYE_F]) {
    const rx = e === EYE_F ? 10 : 13;
    if (expression === 'tears') {
      // Squeezed shut, a stream of tears running from each.
      parts.push(
        `<path d="M ${e.x - rx} ${e.y - 2} Q ${e.x} ${e.y + 10} ${e.x + rx} ${e.y - 2}" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round"/>
        <path d="M ${e.x - 6} ${e.y + 4} L ${e.x - 8} ${CY + 64} L ${e.x + 6} ${CY + 64} L ${e.x + 4} ${e.y + 4} Z" fill="#9ad8ff" opacity="0.9" stroke="#4a9ad8" stroke-width="2"/>`,
      );
    } else if (expression === 'relaxed') {
      parts.push(
        `<path d="M ${e.x - rx} ${e.y + 4} Q ${e.x} ${e.y - 12} ${e.x + rx} ${e.y + 4}" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
      );
    } else if (expression === 'shocked') {
      parts.push(
        `<ellipse cx="${e.x}" cy="${e.y}" rx="${rx}" ry="17" fill="#fff" stroke="${INK}" stroke-width="3"/><circle cx="${e.x + 1}" cy="${e.y}" r="3" fill="${INK}"/>`,
      );
    } else {
      const inner = e === EYE_N ? 1 : -1;
      parts.push(`<ellipse cx="${e.x}" cy="${e.y}" rx="${rx}" ry="18" fill="${INK}"/>
        <ellipse cx="${e.x}" cy="${e.y + 5}" rx="${rx - 3}" ry="10" fill="#7a3a8a"/>
        <circle cx="${e.x - 4}" cy="${e.y - 7}" r="5" fill="#fff"/><circle cx="${e.x + 4}" cy="${e.y + 8}" r="2" fill="#fff"/>
        <path d="M ${e.x - rx * inner - 2} ${e.y - 28} L ${e.x + rx * inner} ${e.y - 20}" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`);
    }
  }
  if (clan === 'genius') {
    for (const e of [EYE_N, EYE_F]) {
      const w = e === EYE_F ? 14 : 18;
      const glare = expression === 'determined' || expression === 'shout';
      parts.push(
        `<rect x="${e.x - w}" y="${e.y - 16}" width="${w * 2}" height="32" rx="6" fill="${glare ? '#fff' : 'none'}" stroke="${INK}" stroke-width="3"/>`,
      );
    }
  }
  const m = { x: CX + 20, y: CY + 40 };
  if (expression === 'determined') {
    parts.push(
      `<path d="M ${m.x - 10} ${m.y} L ${m.x + 10} ${m.y - 2}" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
    );
  } else if (expression === 'shout') {
    parts.push(
      `<path d="M ${m.x - 16} ${m.y - 8} L ${m.x + 16} ${m.y - 10} L ${m.x + 10} ${m.y + 16} L ${m.x - 10} ${m.y + 16} Z" fill="#b83a4a" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M ${m.x - 13} ${m.y - 6} L ${m.x + 13} ${m.y - 8}" stroke="#fff" stroke-width="4"/>`,
    );
  } else if (expression === 'shocked' || expression === 'tears') {
    parts.push(
      `<ellipse cx="${m.x}" cy="${m.y + 4}" rx="8" ry="11" fill="#6a2a36" stroke="${INK}" stroke-width="3"/>`,
    );
  } else {
    parts.push(`<path d="M ${m.x - 12} ${m.y - 2} Q ${m.x} ${m.y + 14} ${m.x + 12} ${m.y - 2} Z" fill="#b83a4a" stroke="${INK}" stroke-width="3"/>
      <ellipse cx="${EYE_N.x - 12}" cy="${CY + 30}" rx="12" ry="6" fill="#ff8a9a" opacity="0.8"/>
      <ellipse cx="${EYE_F.x + 6}" cy="${CY + 30}" rx="8" ry="5" fill="#ff8a9a" opacity="0.8"/>`);
  }
  return parts.join('');
}

function hairBack(style: Hairstyle, hair: { base: string; dark: string }): string {
  const s = `fill="${hair.base}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"`;
  const cap = `<circle cx="${CX - 4}" cy="${CY - 4}" r="${R + 8}" ${s}/>`;
  switch (style) {
    case 'bun':
      return `<circle cx="${CX - 40}" cy="${CY - 62}" r="28" ${s}/>${cap}`;
    case 'twin':
      return `<path d="M ${CX - 60} ${CY - 30} Q ${CX - 120} ${CY + 20} ${CX - 100} ${CY + 110} Q ${CX - 80} ${CY + 40} ${CX - 50} ${CY + 10} Z" ${s}/>
        <path d="M ${CX + 60} ${CY - 30} Q ${CX + 120} ${CY + 20} ${CX + 100} ${CY + 110} Q ${CX + 80} ${CY + 40} ${CX + 50} ${CY + 10} Z" ${s}/>${cap}`;
    case 'long':
      return `<rect x="${CX - 74}" y="${CY - 40}" width="140" height="150" rx="40" ${s}/>${cap}`;
    case 'spiky': {
      const pts: string[] = [];
      for (let i = 0; i <= 18; i++) {
        const a = Math.PI * 0.7 + (i / 18) * Math.PI * 1.6;
        const r = i % 2 === 0 ? R + 4 : R + 34;
        pts.push(`${CX - 6 + Math.cos(a) * r},${CY - 6 + Math.sin(a) * r}`);
      }
      return `<polygon points="${pts.join(' ')}" ${s}/>${cap}`;
    }
    default:
      return cap;
  }
}

function hairFront(style: Hairstyle, hair: { base: string; light: string }): string {
  const s = `fill="${hair.base}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"`;
  const top = `M ${CX - 68} ${CY + 6} A ${R + 8} ${R + 8} 0 0 1 ${CX + 68} ${CY}`;
  const fringe =
    style === 'neat'
      ? `L ${CX + 50} ${CY - 18} L ${CX + 10} ${CY - 34} L ${CX - 30} ${CY - 10} L ${CX - 60} ${CY + 20} Z`
      : style === 'spiky'
        ? `L ${CX + 52} ${CY - 22} L ${CX + 40} ${CY - 2} L ${CX + 22} ${CY - 28} L ${CX + 6} ${CY - 4} L ${CX - 14} ${CY - 26} L ${CX - 32} ${CY - 2} L ${CX - 50} ${CY - 18} L ${CX - 62} ${CY + 24} Z`
        : `L ${CX + 56} ${CY - 12} L ${CX + 42} ${CY + 2} L ${CX + 30} ${CY - 18} L ${CX + 14} ${CY - 2} L ${CX} ${CY - 20} L ${CX - 16} ${CY - 4} L ${CX - 32} ${CY - 20} L ${CX - 64} ${CY + 30} Z`;
  const lock =
    style === 'twin' || style === 'bun'
      ? `<path d="M ${CX + 58} ${CY - 10} L ${CX + 72} ${CY + 46} L ${CX + 54} ${CY + 30} Z" ${s}/>`
      : '';
  const spikes =
    style === 'spiky'
      ? `<path d="M ${CX - 50} ${CY - 40} L ${CX - 36} ${CY - 100} L ${CX - 10} ${CY - 62} L ${CX + 14} ${CY - 108} L ${CX + 26} ${CY - 62} L ${CX + 60} ${CY - 88} L ${CX + 56} ${CY - 36} Z" ${s}/>`
      : '';
  return `${spikes}<path d="${top} ${fringe}" ${s}/>${lock}
    <path d="M ${CX - 40} ${CY - 44} Q ${CX - 4} ${CY - 60} ${CX + 26} ${CY - 54}" stroke="${hair.light}" stroke-width="7" fill="none" stroke-linecap="round"/>`;
}

function headwear(clan: Clan): string {
  switch (clan) {
    case 'karate':
      return `<path d="M ${CX - 66} ${CY - 12} L ${CX + 68} ${CY - 22}" stroke="#1c1a20" stroke-width="12" stroke-linecap="round"/>`;
    case 'maid':
      return `<path d="M ${CX - 44} ${CY - 66} Q ${CX} ${CY - 84} ${CX + 44} ${CY - 66} L ${CX + 40} ${CY - 54} Q ${CX} ${CY - 70} ${CX - 40} ${CY - 54} Z" fill="#fff" stroke="${INK}" stroke-width="3"/>`;
    case 'idol':
      return sparkle(CX + 48, CY - 54, 16, '#f0c445');
    case 'soldier':
      // The beret, worn back, the hair out from under it.
      return `<ellipse cx="${CX - 10}" cy="${CY - 62}" rx="58" ry="18" fill="#3f4a26" stroke="${INK}" stroke-width="3" transform="rotate(-8 ${CX - 10} ${CY - 62})"/>
        <circle cx="${CX + 30}" cy="${CY - 66}" r="6" fill="#f0c445" stroke="${INK}" stroke-width="2"/>`;
    case 'mage':
      return `<path d="M ${CX - 64} ${CY - 26} Q ${CX} ${CY - 44} ${CX + 66} ${CY - 30}" stroke="#f0c445" stroke-width="6" fill="none"/>
        <circle cx="${CX + 30}" cy="${CY - 38}" r="8" fill="#d94a3a" stroke="${INK}" stroke-width="2"/>`;
    case 'mecha':
      return `<path d="M ${CX - 56} ${CY + 14} Q ${CX - 56} ${CY + 50} ${CX + 8} ${CY + 52}" stroke="#4a505e" stroke-width="5" fill="none"/>
        <circle cx="${CX - 56}" cy="${CY + 10}" r="13" fill="#4a505e" stroke="${INK}" stroke-width="3"/>`;
    default:
      return '';
  }
}

function effects(expression: Expression, lettered: boolean): string {
  if (expression === 'determined') return sparkle(EYE_F.x + 18, EYE_F.y - 16, 16, '#fff');
  if (expression === 'shout') {
    // Anger's cross-shaped vein at the temple.
    const x = CX + 40;
    const y = CY - 30;
    return `<g stroke="#e8304a" stroke-width="4" fill="none" stroke-linecap="round">
      <path d="M ${x - 10} ${y - 3} Q ${x - 3} ${y - 3} ${x - 3} ${y - 10}"/><path d="M ${x + 3} ${y - 10} Q ${x + 3} ${y - 3} ${x + 10} ${y - 3}"/>
      <path d="M ${x - 10} ${y + 3} Q ${x - 3} ${y + 3} ${x - 3} ${y + 10}"/><path d="M ${x + 3} ${y + 10} Q ${x + 3} ${y + 3} ${x + 10} ${y + 3}"/></g>`;
  }
  if (expression === 'shocked') {
    // The "!?" lettered only where it is not mirrored: a cut-in's victim faces the other way.
    if (!lettered) {
      return `<path d="M ${CX - 76} ${CY - 40} Q ${CX - 90} ${CY - 10} ${CX - 76} ${CY - 4} Q ${CX - 62} ${CY - 10} ${CX - 76} ${CY - 40} Z" fill="#8fd0ff" stroke="${INK}" stroke-width="2"/>`;
    }
    return `<path d="M ${CX - 76} ${CY - 40} Q ${CX - 90} ${CY - 10} ${CX - 76} ${CY - 4} Q ${CX - 62} ${CY - 10} ${CX - 76} ${CY - 40} Z" fill="#8fd0ff" stroke="${INK}" stroke-width="2"/>
      <text x="${CX + 70}" y="${CY - 40}" font-family="'Arial Black', sans-serif" font-size="44" fill="#fff" stroke="${INK}" stroke-width="5" paint-order="stroke">!?</text>`;
  }
  return '';
}

function hand(expression: Expression): string {
  if (expression !== 'relaxed') return '';
  // The V-sign, beside the face.
  const x = CX + 84;
  const y = CY + 60;
  return `<g stroke="${INK}" stroke-width="3" fill="${SKIN}" stroke-linejoin="round">
    <rect x="${x - 6}" y="${y - 58}" width="11" height="40" rx="5" transform="rotate(-12 ${x} ${y - 18})"/>
    <rect x="${x + 8}" y="${y - 54}" width="11" height="38" rx="5" transform="rotate(12 ${x + 12} ${y - 16})"/>
    <rect x="${x - 12}" y="${y - 22}" width="34" height="30" rx="10"/>
  </g>`;
}
