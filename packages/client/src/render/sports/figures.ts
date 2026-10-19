import type { Graphics } from 'pixi.js';

/**
 * The Sports style's guns: pictogram sportsmen of ten ball sports (docs/SPORTS_STYLE.md §0),
 * one skeleton for all, each sport a table of joint angles for its poses — data, not ten
 * drawings. A figure is drawn in ink with its jersey white, so a stamp of it tinted by the
 * owner's colour wears their jersey and leaves the ink ink; its ball is a stamp of its own,
 * untinted, which a gun reloading simply does not place.
 *
 * Everything here is in tiles, at the origin of the figure's feet, facing right (+x); a stamp
 * is mirrored to face left. Angles are in degrees from straight down, forward positive: 0
 * hangs, 90 points ahead, 180 straight up, -90 behind.
 */

export const SPORTS = [
  'soccer',
  'basketball',
  'tennis',
  'baseball',
  'football',
  'golf',
  'volleyball',
  'badminton',
  'hockey',
  'handball',
] as const;
export type Sport = (typeof SPORTS)[number];

export type Pose = 'ready' | 'release' | 'follow' | 'bench';

export const INK = 0x1c1d22;
const WOOD = 0xb07a44;
const WOOD_DARK = 0x6e4524;

const THIGH = 0.35;
const SHIN = 0.34;
const TORSO = 0.52;
const UPPER_ARM = 0.27;
const FOREARM = 0.25;
const NECK = 0.05;
const HEAD = 0.17;
const SHOULDERS = 0.17;
const HIPS = 0.125;
/** The bench's seat, its top this high off the ground. */
const SEAT = 0.34;

/** A joint, or `free`: a point of its own, from the feet. */
type Joint = 'handF' | 'handB' | 'footF' | 'gear' | 'free';

/**
 * Where the ball is: a joint, nudged — or, `free`, a point in the air or on the ground apart
 * from the figure, which reads better than a ball in hand (the user's, 2026-10-19); `ground`
 * rests it on the ground. `turn` is the ball's own angle there, in radians: the shuttlecock
 * falling cork first, the football tilted in the hand.
 */
interface Anchor {
  at: Joint;
  dx: number;
  dy: number;
  ground?: boolean;
  turn?: number;
}

type GearKind = 'racket' | 'shuttleRacket' | 'club' | 'stick' | 'bat';

interface PoseData {
  lean: number;
  /** Upper and lower segment of each limb, the one behind the body and the one before it. */
  armB: readonly [number, number];
  armF: readonly [number, number];
  legB: readonly [number, number];
  legF: readonly [number, number];
  /** Off the ground, in tiles: a jump. */
  lift?: number;
  ball: Anchor;
  /** Held equipment's angle, in the front hand. */
  gear?: number;
}

/**
 * A sport's poses. **Ready is the moment before the strike**, not a rest: the ball apart from
 * the figure wherever it can be — tossed above the server, on the ground before the kicker,
 * cocked behind the thrower's head — so the sport reads at a small tile. The release meets the
 * ball where ready shows it, so the shot leaves from that very spot.
 */
interface SportData {
  gear?: GearKind;
  ready: PoseData;
  release: PoseData;
  follow: PoseData;
}

const at = (joint: Joint, dx = 0, dy = 0, ground = false, turn = 0): Anchor => ({
  at: joint,
  dx,
  dy,
  ground,
  turn,
});

const SOCCER: PoseData = {
  lean: 8,
  armB: [48, 34],
  armF: [-42, -22],
  legB: [8, 0],
  legF: [-34, -82],
  ball: at('free', 0.46, 0, true),
};
const DRIBBLE: PoseData = {
  lean: 14,
  armB: [-24, 10],
  armF: [52, 30],
  legB: [22, -18],
  legF: [30, -10],
  ball: at('free', 0.5, -0.38),
};
const TOSS: PoseData = {
  lean: -6,
  armB: [156, 158],
  armF: [-100, 165],
  legB: [-16, -10],
  legF: [12, 6],
  gear: -165,
  ball: at('free', 0.3, -2.0),
};
const BATTER: PoseData = {
  lean: 8,
  armB: [-20, 170],
  armF: [-30, 165],
  legB: [-18, -10],
  legF: [20, 8],
  gear: -140,
  ball: at('free', 0.72, -0.95),
};
const COCKED: PoseData = {
  lean: -10,
  armB: [118, 108],
  armF: [-74, -168],
  legB: [-22, -12],
  legF: [18, 6],
  ball: at('handF', -0.06, -0.05, false, -0.5),
};
const ADDRESS: PoseData = {
  lean: 24,
  armB: [8, 4],
  armF: [12, 8],
  legB: [-8, -3],
  legF: [8, 3],
  gear: 14,
  ball: at('free', 0.68, 0, true),
};
const SPIKE: PoseData = {
  lean: 6,
  armB: [-95, -160],
  armF: [105, 110],
  legB: [5, -85],
  legF: [25, -75],
  lift: 0.32,
  ball: at('free', 0.55, -1.8),
};
const SMASH: PoseData = {
  lean: -6,
  armB: [132, 128],
  armF: [-112, -160],
  legB: [-14, -8],
  legF: [12, 6],
  gear: -120,
  // Falling cork first towards the player, as a shuttle comes over the net.
  ball: at('free', 0.46, -1.78, false, 2.5),
};
const SLAPSHOT: PoseData = {
  lean: 26,
  armB: [-40, -70],
  armF: [-54, -96],
  legB: [-24, -44],
  legF: [32, -12],
  gear: -150,
  ball: at('free', 0.52, 0, true),
};
const JUMP_THROW: PoseData = {
  lean: -6,
  armB: [104, 120],
  armF: [-108, -148],
  legB: [-10, -30],
  legF: [80, 8],
  lift: 0.2,
  ball: at('handF', -0.03, -0.1),
};

const DATA: Record<Sport, SportData> = {
  soccer: {
    ready: SOCCER,
    release: {
      lean: -6,
      armB: [-55, -30],
      armF: [60, 40],
      legB: [-8, -4],
      legF: [52, 34],
      ball: SOCCER.ball,
    },
    follow: {
      lean: -18,
      armB: [-75, -55],
      armF: [80, 60],
      legB: [-4, -4],
      legF: [100, 82],
      ball: at('footF'),
    },
  },
  basketball: {
    ready: DRIBBLE,
    release: {
      lean: 0,
      armB: [160, 172],
      armF: [168, 176],
      legB: [-6, -12],
      legF: [10, 0],
      lift: 0.18,
      ball: at('handF', 0.03, -0.17),
    },
    follow: {
      lean: 2,
      armB: [140, 150],
      armF: [150, 112],
      legB: [2, -16],
      legF: [12, -4],
      lift: 0.08,
      ball: at('handF'),
    },
  },
  tennis: {
    gear: 'racket',
    ready: TOSS,
    release: {
      lean: 6,
      armB: [55, 20],
      armF: [160, 150],
      legB: [-16, -12],
      legF: [6, 0],
      lift: 0.05,
      gear: 175,
      ball: TOSS.ball,
    },
    follow: {
      lean: 22,
      armB: [18, 0],
      armF: [62, 22],
      legB: [-32, -52],
      legF: [30, 10],
      gear: 28,
      ball: at('gear'),
    },
  },
  baseball: {
    gear: 'bat',
    ready: BATTER,
    release: {
      lean: 12,
      armB: [50, 76],
      armF: [55, 80],
      legB: [-25, -20],
      legF: [25, 5],
      gear: 95,
      ball: BATTER.ball,
    },
    follow: {
      lean: 0,
      armB: [90, 150],
      armF: [100, 160],
      legB: [-28, -40],
      legF: [24, 6],
      gear: -120,
      ball: at('gear'),
    },
  },
  football: {
    ready: COCKED,
    release: {
      lean: 10,
      armB: [22, 0],
      armF: [132, 120],
      legB: [-30, -32],
      legF: [26, 6],
      ball: at('handF', 0.08, -0.04, false, -0.3),
    },
    follow: {
      lean: 24,
      armB: [-20, -10],
      armF: [70, 40],
      legB: [-32, -56],
      legF: [28, 6],
      ball: at('handF'),
    },
  },
  golf: {
    gear: 'club',
    ready: ADDRESS,
    release: {
      lean: 24,
      armB: [16, 12],
      armF: [20, 16],
      legB: [-8, -3],
      legF: [8, 3],
      gear: 22,
      ball: ADDRESS.ball,
    },
    follow: {
      lean: 20,
      armB: [36, 32],
      armF: [40, 36],
      legB: [-8, -3],
      legF: [8, 3],
      gear: 48,
      ball: at('gear'),
    },
  },
  volleyball: {
    ready: SPIKE,
    release: {
      lean: 10,
      armB: [150, 122],
      armF: [60, 20],
      legB: [5, -80],
      legF: [25, -70],
      lift: 0.32,
      ball: SPIKE.ball,
    },
    follow: {
      lean: 16,
      armB: [110, 80],
      armF: [30, 0],
      legB: [10, -60],
      legF: [26, -50],
      lift: 0.2,
      ball: at('handF'),
    },
  },
  badminton: {
    gear: 'shuttleRacket',
    ready: SMASH,
    release: {
      lean: 4,
      armB: [40, 20],
      armF: [166, 150],
      legB: [10, -40],
      legF: [-6, -42],
      lift: 0.1,
      gear: 128,
      ball: SMASH.ball,
    },
    follow: {
      lean: 20,
      armB: [10, -6],
      armF: [72, 32],
      legB: [-26, -30],
      legF: [26, 8],
      gear: 40,
      ball: at('gear'),
    },
  },
  hockey: {
    gear: 'stick',
    ready: SLAPSHOT,
    release: {
      lean: 26,
      armB: [32, 20],
      armF: [22, 10],
      legB: [-30, -50],
      legF: [34, -8],
      gear: 22,
      ball: SLAPSHOT.ball,
    },
    follow: {
      lean: 14,
      armB: [100, 110],
      armF: [112, 122],
      legB: [-30, -50],
      legF: [30, -6],
      gear: 122,
      ball: at('gear'),
    },
  },
  handball: {
    ready: JUMP_THROW,
    release: {
      lean: 8,
      armB: [62, 40],
      armF: [160, 138],
      legB: [-10, -22],
      legF: [70, 0],
      lift: 0.2,
      ball: at('handF', 0.05, -0.06),
    },
    follow: {
      lean: 16,
      armB: [10, -6],
      armF: [80, 50],
      legB: [-14, -24],
      legF: [30, 2],
      lift: 0.05,
      ball: at('handF'),
    },
  },
};

/** Each sport's ball: its size, in tiles, half across and half high. */
export const BALL_SIZE: Record<Sport, { rx: number; ry: number }> = {
  soccer: { rx: 0.19, ry: 0.19 },
  basketball: { rx: 0.2, ry: 0.2 },
  tennis: { rx: 0.13, ry: 0.13 },
  baseball: { rx: 0.13, ry: 0.13 },
  football: { rx: 0.22, ry: 0.13 },
  golf: { rx: 0.1, ry: 0.1 },
  volleyball: { rx: 0.19, ry: 0.19 },
  badminton: { rx: 0.22, ry: 0.13 },
  hockey: { rx: 0.16, ry: 0.07 },
  handball: { rx: 0.16, ry: 0.16 },
};

interface Point {
  x: number;
  y: number;
}

interface Skeleton {
  hip: Point;
  shoulder: Point;
  head: Point;
  elbowB: Point;
  handB: Point;
  elbowF: Point;
  handF: Point;
  kneeB: Point;
  footB: Point;
  kneeF: Point;
  footF: Point;
}

function towards(from: Point, angle: number, length: number): Point {
  const a = (angle * Math.PI) / 180;
  return { x: from.x + Math.sin(a) * length, y: from.y + Math.cos(a) * length };
}

const SITTING: PoseData = {
  lean: 6,
  armB: [22, 80],
  armF: [28, 84],
  legB: [86, 4],
  legF: [92, -2],
  ball: at('free'),
};

/** The joints of a pose, the hip placed so the lower foot stands on the ground. */
function skeleton(pose: PoseData, seated: boolean): Skeleton {
  const legDrop = (leg: readonly [number, number]): number =>
    towards(towards({ x: 0, y: 0 }, leg[0], THIGH), leg[1], SHIN).y;
  const hipY = seated
    ? -SEAT - 0.04
    : -Math.max(legDrop(pose.legB), legDrop(pose.legF)) - (pose.lift ?? 0);
  const hip = { x: 0, y: hipY };
  const l = (pose.lean * Math.PI) / 180;
  const up = { x: Math.sin(l), y: -Math.cos(l) };
  const shoulder = { x: hip.x + up.x * TORSO, y: hip.y + up.y * TORSO };
  const head = {
    x: shoulder.x + up.x * (NECK + HEAD),
    y: shoulder.y + up.y * (NECK + HEAD),
  };
  const elbowB = towards(shoulder, pose.armB[0], UPPER_ARM);
  const elbowF = towards(shoulder, pose.armF[0], UPPER_ARM);
  const kneeB = towards(hip, pose.legB[0], THIGH);
  const kneeF = towards(hip, pose.legF[0], THIGH);
  return {
    hip,
    shoulder,
    head,
    elbowB,
    handB: towards(elbowB, pose.armB[1], FOREARM),
    elbowF,
    handF: towards(elbowF, pose.armF[1], FOREARM),
    kneeB,
    footB: towards(kneeB, pose.legB[1], SHIN),
    kneeF,
    footF: towards(kneeF, pose.legF[1], SHIN),
  };
}

/** How long each kind of equipment is, from the hand to its far end. */
const GEAR_LENGTH: Record<GearKind, number> = {
  racket: 0.42,
  shuttleRacket: 0.46,
  club: 0.6,
  stick: 0.56,
  bat: 0.58,
};

/** The far end of the equipment: the racket's face, the club's head, the stick's blade. */
function gearTip(kind: GearKind, angle: number, joints: Skeleton): Point {
  const hand = joints.handF;
  if (kind === 'racket' || kind === 'shuttleRacket') {
    return towards(hand, angle, GEAR_LENGTH[kind] * 0.7);
  }
  if (kind === 'stick') {
    // The blade runs on ahead of the shaft's end, along the ice.
    return towards(towards(hand, angle, GEAR_LENGTH.stick), angle + 65, 0.1);
  }
  return towards(hand, angle, GEAR_LENGTH[kind]);
}

/**
 * Where the ball is in this pose, in tiles from the feet, facing right: where it is drawn while
 * held, and in the release pose where a shot leaves from — the ball flies from the ball.
 */
export function ballPoint(sport: Sport, pose: Pose): Point & { turn: number } {
  const data = DATA[sport];
  if (pose === 'bench') {
    // Laid on the bench beside the figure.
    const size = BALL_SIZE[sport];
    return { x: -0.4, y: -SEAT - 0.02 - size.ry, turn: 0 };
  }
  const p = data[pose];
  let base: Point = { x: 0, y: 0 };
  if (p.ball.at === 'gear') {
    const joints = skeleton(p, false);
    base = data.gear === undefined ? joints.handF : gearTip(data.gear, p.gear ?? 0, joints);
  } else if (p.ball.at !== 'free') {
    base = skeleton(p, false)[p.ball.at];
  }
  const x = base.x + p.ball.dx;
  const y = p.ball.ground === true ? -BALL_SIZE[sport].ry : base.y + p.ball.dy;
  return { x, y, turn: p.ball.turn ?? 0 };
}

/** Whether the ready pose holds its ball in a hand, so it moves with the figure's breathing. */
export function heldWhenReady(sport: Sport): boolean {
  return DATA[sport].ready.ball.at !== 'free';
}

function limb(g: Graphics, t: number, a: Point, b: Point, c: Point, width: number): void {
  g.moveTo(a.x * t, a.y * t)
    .lineTo(b.x * t, b.y * t)
    .lineTo(c.x * t, c.y * t);
  g.stroke({ width, color: INK, cap: 'round', join: 'round' });
}

/** Lines no thinner than this many pixels, whatever the tile. */
function limbWidth(t: number): number {
  return Math.max(1.7, t * 0.12);
}

/**
 * The figure of `sport` in `pose`, its equipment in hand, the ball left out: ink, and a white
 * jersey for the stamp's tint. Sat on the bench (`bench`), it holds nothing.
 */
export function drawFigure(g: Graphics, t: number, sport: Sport, pose: Pose): void {
  const data = DATA[sport];
  const seated = pose === 'bench';
  const p = seated ? SITTING : data[pose];
  const j = skeleton(p, seated);
  const w = limbWidth(t);
  const gear = seated ? undefined : data.gear;
  limb(g, t, j.shoulder, j.elbowB, j.handB, w);
  limb(g, t, j.hip, j.kneeB, j.footB, w);
  // The jersey: a tapered block from hips to shoulders, outlined so a jersey the colour of the
  // turf still has its edge.
  const l = (p.lean * Math.PI) / 180;
  const n = { x: Math.cos(l), y: Math.sin(l) };
  const top = { x: j.shoulder.x - (n.y * w) / t / 2, y: j.shoulder.y + (n.x * w) / t / 2 };
  g.poly([
    (j.hip.x - n.x * HIPS) * t,
    (j.hip.y - n.y * HIPS) * t,
    (j.hip.x + n.x * HIPS) * t,
    (j.hip.y + n.y * HIPS) * t,
    (top.x + n.x * SHOULDERS) * t,
    (top.y + n.y * SHOULDERS) * t,
    (top.x - n.x * SHOULDERS) * t,
    (top.y - n.y * SHOULDERS) * t,
  ]);
  g.fill({ color: 0xffffff });
  g.stroke({ width: Math.max(1, t * 0.05), color: INK, join: 'round' });
  limb(g, t, j.hip, j.kneeF, j.footF, w);
  g.circle(j.head.x * t, j.head.y * t, HEAD * t);
  g.fill({ color: INK });
  if (gear !== undefined) drawGear(g, t, gear, p.gear ?? 0, j);
  limb(g, t, j.shoulder, j.elbowF, j.handF, w);
}

function drawGear(g: Graphics, t: number, kind: GearKind, angle: number, j: Skeleton): void {
  const hand = j.handF;
  const thin = Math.max(1.2, t * 0.065);
  const a = (angle * Math.PI) / 180;
  const along = { x: Math.sin(a), y: Math.cos(a) };
  if (kind === 'bat') {
    // Tapered: thin at the hands, thick at the barrel.
    const end = towards(hand, angle, GEAR_LENGTH.bat);
    const n = { x: Math.cos(a) * t, y: -Math.sin(a) * t };
    const thinEnd = 0.025;
    const thick = 0.06;
    g.poly([
      hand.x * t + n.x * thinEnd,
      hand.y * t + n.y * thinEnd,
      end.x * t + n.x * thick,
      end.y * t + n.y * thick,
      end.x * t - n.x * thick,
      end.y * t - n.y * thick,
      hand.x * t - n.x * thinEnd,
      hand.y * t - n.y * thinEnd,
    ]);
    g.fill({ color: INK });
    g.circle(end.x * t, end.y * t, thick * t);
    g.fill({ color: INK });
    return;
  }
  if (kind === 'racket' || kind === 'shuttleRacket') {
    const handle = GEAR_LENGTH[kind] * (kind === 'racket' ? 0.42 : 0.55);
    const neck = towards(hand, angle, handle);
    g.moveTo(hand.x * t, hand.y * t).lineTo(neck.x * t, neck.y * t);
    g.stroke({ width: thin, color: INK, cap: 'round' });
    const face = towards(hand, angle, GEAR_LENGTH[kind] * 0.7);
    const rx = (kind === 'racket' ? 0.1 : 0.075) * t;
    const ry = (kind === 'racket' ? 0.135 : 0.1) * t;
    // The head's long axis along the handle.
    g.poly(turnedEllipse(face.x * t, face.y * t, ry, rx, Math.atan2(along.y, along.x)));
    g.fill({ color: 0xffffff, alpha: 0.85 });
    g.stroke({ width: thin, color: INK });
    return;
  }
  const end = towards(hand, angle, GEAR_LENGTH[kind]);
  g.moveTo(hand.x * t, hand.y * t).lineTo(end.x * t, end.y * t);
  g.stroke({ width: thin, color: INK, cap: 'round' });
  if (kind === 'club') {
    const toe = towards(end, Math.abs(angle) < 50 ? 90 : angle + 80, 0.12);
    g.moveTo(end.x * t, end.y * t).lineTo(toe.x * t, toe.y * t);
    g.stroke({ width: thin * 1.6, color: INK, cap: 'round' });
  } else if (kind === 'stick') {
    const blade = towards(end, angle + 65, 0.17);
    g.moveTo(end.x * t, end.y * t).lineTo(blade.x * t, blade.y * t);
    g.stroke({ width: thin * 1.7, color: INK, cap: 'round' });
  }
}

/** An ellipse turned by `angle`, as a polygon: Pixi's own are drawn upright. */
function turnedEllipse(cx: number, cy: number, rx: number, ry: number, angle: number): number[] {
  const points: number[] = [];
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  for (let i = 0; i < 20; i++) {
    const a = (i * Math.PI * 2) / 20;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    points.push(cx + x * c - y * s, cy + x * s + y * c);
  }
  return points;
}

/** The bench a silenced gun sits on, untinted: a plank on two legs, its feet at the origin. */
export function drawBench(g: Graphics, t: number): void {
  const ink = Math.max(1, t * 0.05);
  const x0 = -0.62 * t;
  const x1 = 0.3 * t;
  for (const x of [x0 + 0.08 * t, x1 - 0.08 * t]) {
    g.rect(x - 0.035 * t, -SEAT * t, 0.07 * t, SEAT * t);
    g.fill({ color: WOOD_DARK });
  }
  g.roundRect(x0, -SEAT * t - 0.03 * t, x1 - x0, 0.08 * t, 0.03 * t);
  g.fill({ color: WOOD });
  g.stroke({ width: ink, color: INK });
}

/** The sport's ball, centred at the origin, in its own colours. */
export function drawBall(g: Graphics, t: number, sport: Sport): void {
  const { rx, ry } = BALL_SIZE[sport];
  const r = rx * t;
  const ink = Math.max(1, t * 0.045);
  switch (sport) {
    case 'soccer': {
      g.circle(0, 0, r);
      g.fill({ color: 0xffffff });
      g.stroke({ width: ink, color: INK });
      const k = r * 0.42;
      const pent: number[] = [];
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
        pent.push(Math.cos(a) * k, Math.sin(a) * k);
      }
      g.poly(pent);
      g.fill({ color: INK });
      for (let i = 0; i < 5; i++) {
        const a = Math.PI / 2 + (i * 2 * Math.PI) / 5;
        g.circle(Math.cos(a) * r * 0.86, Math.sin(a) * r * 0.86, r * 0.2);
        g.fill({ color: INK });
      }
      break;
    }
    case 'basketball': {
      g.circle(0, 0, r);
      g.fill({ color: 0xe8792a });
      g.moveTo(-r, 0).lineTo(r, 0);
      g.moveTo(0, -r).lineTo(0, r);
      g.moveTo(-r * 0.62, -r * 0.78).quadraticCurveTo(-r * 0.2, 0, -r * 0.62, r * 0.78);
      g.moveTo(r * 0.62, -r * 0.78).quadraticCurveTo(r * 0.2, 0, r * 0.62, r * 0.78);
      g.stroke({ width: ink * 0.8, color: INK });
      g.circle(0, 0, r);
      g.stroke({ width: ink, color: INK });
      break;
    }
    case 'tennis': {
      g.circle(0, 0, r);
      g.fill({ color: 0xd8ec3a });
      g.moveTo(-r * 0.8, -r * 0.5).quadraticCurveTo(0, 0, -r * 0.8, r * 0.5);
      g.moveTo(r * 0.8, -r * 0.5).quadraticCurveTo(0, 0, r * 0.8, r * 0.5);
      g.stroke({ width: ink * 0.8, color: 0xffffff });
      g.circle(0, 0, r);
      g.stroke({ width: ink, color: INK });
      break;
    }
    case 'baseball': {
      g.circle(0, 0, r);
      g.fill({ color: 0xffffff });
      g.moveTo(-r * 0.55, -r * 0.8).quadraticCurveTo(-r * 0.15, 0, -r * 0.55, r * 0.8);
      g.moveTo(r * 0.55, -r * 0.8).quadraticCurveTo(r * 0.15, 0, r * 0.55, r * 0.8);
      g.stroke({ width: ink, color: 0xd8282c });
      g.circle(0, 0, r);
      g.stroke({ width: ink, color: INK });
      break;
    }
    case 'football': {
      g.ellipse(0, 0, rx * t, ry * t);
      g.fill({ color: 0x8a4a22 });
      g.stroke({ width: ink, color: INK });
      g.moveTo(-rx * t * 0.35, -ry * t * 0.25).lineTo(rx * t * 0.35, -ry * t * 0.25);
      g.stroke({ width: ink * 0.9, color: 0xffffff });
      for (let i = -2; i <= 2; i++) {
        const x = i * rx * t * 0.14;
        g.moveTo(x, -ry * t * 0.45).lineTo(x, -ry * t * 0.05);
      }
      g.stroke({ width: ink * 0.7, color: 0xffffff });
      break;
    }
    case 'golf': {
      g.circle(0, 0, r);
      g.fill({ color: 0xffffff });
      g.stroke({ width: ink, color: INK });
      break;
    }
    case 'volleyball': {
      g.circle(0, 0, r);
      g.fill({ color: 0xffffff });
      g.moveTo(-r, -r * 0.1).quadraticCurveTo(0, r * 0.6, r * 0.75, -r * 0.65);
      g.lineTo(r * 0.2, -r * 0.98).quadraticCurveTo(-r * 0.3, 0, -r, -r * 0.1);
      g.fill({ color: 0x2a64c8 });
      g.moveTo(-r * 0.4, r * 0.92).quadraticCurveTo(r * 0.4, r * 0.3, r, r * 0.05);
      g.lineTo(r * 0.85, r * 0.55).quadraticCurveTo(r * 0.4, r * 0.85, -r * 0.4, r * 0.92);
      g.fill({ color: 0xf2c42a });
      g.circle(0, 0, r);
      g.stroke({ width: ink, color: INK });
      break;
    }
    case 'badminton': {
      // Cork ahead, the skirt of feathers behind: it flies cork first.
      const len = rx * t * 2;
      const back = -len * 0.5;
      g.poly([
        back + len * 0.62,
        -ry * t * 0.3,
        back,
        -ry * t,
        back,
        ry * t,
        back + len * 0.62,
        ry * t * 0.3,
      ]);
      g.fill({ color: 0xffffff });
      g.stroke({ width: ink * 0.8, color: INK, join: 'round' });
      g.moveTo(back + len * 0.62, 0).lineTo(back, 0);
      g.stroke({ width: ink * 0.6, color: INK });
      g.circle(back + len * 0.74, 0, ry * t * 0.42);
      g.fill({ color: 0xffffff });
      g.stroke({ width: ink * 0.8, color: INK });
      break;
    }
    case 'hockey': {
      const h = ry * t;
      g.rect(-rx * t, -h * 0.5, rx * t * 2, h);
      g.fill({ color: INK });
      g.ellipse(0, -h * 0.5, rx * t, h * 0.5);
      g.fill({ color: 0x44464e });
      g.stroke({ width: Math.max(1, ink * 0.7), color: INK });
      break;
    }
    case 'handball': {
      g.circle(0, 0, r);
      g.fill({ color: 0xffffff });
      g.moveTo(-r, 0).quadraticCurveTo(0, -r * 0.5, r, 0);
      g.lineTo(r * 0.6, r * 0.8).quadraticCurveTo(0, r * 0.3, -r * 0.6, r * 0.8);
      g.fill({ color: 0xd8282c });
      g.circle(0, 0, r);
      g.stroke({ width: ink, color: INK });
      break;
    }
  }
}

/**
 * The ball's small motion while a figure stands ready, at `phase` 0..1 of its beat, from where
 * the ready pose shows it: the dribble, the toss hanging at its top, the shuttle drifting down.
 * In tiles, and a turn. A ball in hand moves with the figure instead (`heldWhenReady`).
 */
export function ballIdle(sport: Sport, phase: number): { dx: number; dy: number; turn: number } {
  const s = Math.sin(phase * Math.PI * 2);
  switch (sport) {
    case 'basketball': {
      // Dribbled: up to the hand and down to the ground, quickest at the floor.
      const ready = ballPoint('basketball', 'ready').y;
      const floor = -BALL_SIZE.basketball.ry;
      const hand = ready - 0.15;
      const up = Math.abs(Math.sin(phase * Math.PI));
      return { dx: 0, dy: floor - ready - (floor - hand) * up, turn: 0 };
    }
    case 'tennis':
    case 'volleyball':
      return { dx: 0, dy: s * 0.035, turn: phase * Math.PI * 2 };
    case 'badminton':
      return { dx: s * 0.02, dy: Math.cos(phase * Math.PI * 2) * 0.03, turn: s * 0.18 };
    default:
      return { dx: 0, dy: 0, turn: 0 };
  }
}

/**
 * How a ball is turned in flight, given its velocity on screen and its progress `p`: the
 * shuttlecock and the football along their flight, cork and nose first, upright either way;
 * the puck and the round balls spinning the way they fly.
 */
export function inFlight(
  sport: Sport,
  vx: number,
  vy: number,
  p: number,
): { rotation: number; scaleX: number; scaleY: number } {
  const dir = vx < 0 ? -1 : 1;
  switch (sport) {
    case 'badminton':
    case 'football':
      return { rotation: Math.atan2(vy, vx), scaleX: 1, scaleY: dir };
    case 'golf':
      return { rotation: 0, scaleX: dir, scaleY: 1 };
    default:
      return { rotation: dir * p * 9, scaleX: dir, scaleY: 1 };
  }
}
