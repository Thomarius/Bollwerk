// Frame times during the looks' wipes against the rest of play, in a watched eight-player bot
// match (ARCHIVE 13n, PLAN §11 item 3): each frame's interval, its work on the page's thread,
// the effects' and the render's share, whether two looks were on screen, and the banner's line.
//
// Measure in a visible window: headless Chrome never waits for the GPU, so wipes look free
// there. Playwright is not a dependency of the repository; run it beside an install of the
// version whose browser is cached (see tools/screenshots.sh):
//
//   npm run dev -w @bollwerk/client                  # in another terminal
//   mkdir -p /tmp/pw && cd /tmp/pw && npm init -y && npm i playwright@1.63.0
//   cp tools/wipes/measure.mjs /tmp/pw/ && cd /tmp/pw
//   SEEDED=1 HEADED=1 W=2560 H=1440 node measure.mjs new 'buildStyle=random&combatStyle=random&speed=2' 90
//
// SEEDED replaces Math.random with a fixed sequence, so two runs — the old code served from a
// worktree on another port (BASE=http://localhost:5174) and the new — see the same Random
// looks in the same order. Writes <label>.json with every frame.
/* global console, performance, PerformanceObserver, process, setInterval, window */
/* eslint-disable no-console -- a report printed to the terminal */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const [label, query, seconds] = process.argv.slice(2);
const url = `${process.env.BASE ?? 'http://localhost:5173'}/?autostart=1&players=8&seed=3&watch=1&level=5&perf=1&${query}`;

const browser = await chromium.launch({
  headless: !process.env.HEADED,
  args: ['--enable-gpu', '--use-angle=gl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({
  viewport: { width: Number(process.env.W ?? 1600), height: Number(process.env.H ?? 900) },
});
if (process.env.SEEDED) {
  // The same looks in the same order for both runs: Random draws from Math.random.
  await page.addInitScript(() => {
    let a = 0x9e3779b9;
    Math.random = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });
}
await page.addInitScript(() => {
  const frames = new Map();
  const rec = (ts) => {
    let f = frames.get(ts);
    if (!f) {
      f = { ts, work: 0, effects: 0, render: 0, prime: 0, showLooks: 0, wipe: 0, slots: 0 };
      frames.set(ts, f);
    }
    return f;
  };
  let currentTs = 0;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) =>
    raf((ts) => {
      currentTs = ts;
      const t0 = performance.now();
      try {
        cb(ts);
      } finally {
        rec(ts).work += performance.now() - t0;
      }
    });
  const longTasks = [];
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) longTasks.push({ start: e.startTime, dur: e.duration });
  }).observe({ type: 'longtask', buffered: true });
  let wrapped = false;
  const wrap = () => {
    const scene = globalThis.bollwerkScene;
    if (!scene || wrapped) return;
    wrapped = true;
    for (const name of ['drawEffects', 'render', 'prime', 'showLooks']) {
      const orig = scene[name].bind(scene);
      const key = name === 'drawEffects' ? 'effects' : name;
      scene[name] = (...a) => {
        const t0 = performance.now();
        try {
          return orig(...a);
        } finally {
          const f = rec(currentTs);
          f[key] += performance.now() - t0;
          if (name === 'render') {
            f.wipe = scene.shown.lineY !== null && scene.shown.from !== scene.shown.to ? 1 : 0;
            f.slots = scene.visible().length;
            f.lineY = scene.shown.lineY;
            f.styles = `${scene.styles.build}/${scene.styles.combat}`;
          }
        }
      };
    }
  };
  setInterval(wrap, 100);
  globalThis.__perfDump = () => ({ frames: [...frames.values()], longTasks });
});
await page.goto(url);
await page.waitForTimeout(Number(seconds) * 1000);
const data = await page.evaluate(() => globalThis.__perfDump());
writeFileSync(`${label}.json`, JSON.stringify(data));
await browser.close();

// Summary: wipe frames against the others, after a settling time.
const fr = data.frames.sort((a, b) => a.ts - b.ts);
const t0 = fr[0]?.ts ?? 0;
for (let i = 1; i < fr.length; i++) fr[i].interval = fr[i].ts - fr[i - 1].ts;
const used = fr.filter((f) => f.ts - t0 > 8000 && f.interval !== undefined && f.styles);
const stat = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
  const mean = s.reduce((a, b) => a + b, 0) / (s.length || 1);
  return `n=${s.length} mean ${mean.toFixed(1)} p50 ${at(0.5).toFixed(1)} p95 ${at(0.95).toFixed(1)} max ${(s.at(-1) ?? 0).toFixed(1)}`;
};
for (const [name, set] of [
  ['wipe', used.filter((f) => f.wipe)],
  ['rest', used.filter((f) => !f.wipe)],
]) {
  console.log(`${label} ${name}`);
  for (const k of ['interval', 'work', 'effects', 'render', 'prime']) {
    console.log(`  ${k.padEnd(9)} ${stat(set.map((f) => f[k]))}`);
  }
  const iv = set.map((f) => f.interval);
  console.log(
    `  >33ms ${iv.filter((x) => x > 33.5).length}  >50ms ${iv.filter((x) => x > 50).length}`,
  );
}
// Each wipe on its own: its frames and their worst.
const wipes = [];
let cur = null;
for (const f of used) {
  if (f.wipe) {
    if (!cur) wipes.push((cur = { start: f.ts - t0, frames: [] }));
    cur.frames.push(f);
  } else cur = null;
}
for (const w of wipes) {
  const iv = w.frames.map((f) => f.interval);
  const worst = w.frames.reduce((a, b) => (b.interval > a.interval ? b : a));
  console.log(
    `  wipe @${(w.start / 1000).toFixed(1)}s ${w.frames[0].styles} frames ${iv.length} mean ${(iv.reduce((a, b) => a + b, 0) / iv.length).toFixed(1)} max ${worst.interval.toFixed(1)} (work ${worst.work.toFixed(1)} eff ${worst.effects.toFixed(1)} render ${worst.render.toFixed(1)}) first ${iv
      .slice(0, 4)
      .map((x) => x.toFixed(0))
      .join(',')}`,
  );
}

// Late frames and dropped frames a second, in wipes and in the rest.
for (const [name, set] of [
  ['wipe', used.filter((f) => f.wipe)],
  ['rest', used.filter((f) => !f.wipe)],
]) {
  const late = set.filter((f) => f.interval > 20).length;
  const lost = set.reduce((a, f) => a + Math.max(0, Math.round(f.interval / 16.67) - 1), 0);
  const seconds = set.reduce((a, f) => a + f.interval, 0) / 1000;
  console.log(
    `${label} ${name}: late ${((100 * late) / set.length).toFixed(1)}%, dropped frames a second ${(lost / seconds).toFixed(1)}`,
  );
}
