import { Graphics, type Container, type Renderer } from 'pixi.js';

/**
 * The frame-time readout behind `&perf=1` (PLAN 11.22): where a frame's milliseconds go,
 * split into the sim, the HUD, each layer's drawing and Pixi's render, and how much
 * geometry Pixi had to cut into triangles again. A dev tool, so its texts are English only.
 *
 * Headless Chrome cannot time anything (CLAUDE.md), so the figures are taken on a real
 * machine: the readout measures a fixed window — from `SETTLE_MS` after the match's first
 * frame, for `WINDOW_MS` — so the same link gives comparable figures before and after a
 * change, and Copy puts them on the clipboard to be sent.
 */

/** Skipped at the start: a snapshot's first frames draw the whole board. */
const SETTLE_MS = 3000;
/** The measured window, long enough to take in more than one phase of a watched match. */
const WINDOW_MS = 30000;
/** How often the live figures are written into the page, which is itself work. */
const SHOW_EVERY_MS = 500;
/** The live figures are over the last this long. */
const LIVE_MS = 2000;

/** The sections of a frame, in the order shown. `effects` includes `flow`. */
export const SECTIONS = ['sim', 'hud', 'effects', 'flow', 'overlay', 'render'] as const;
export type Section = (typeof SECTIONS)[number];

export interface Spread {
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

/** Mean, percentiles and worst of some samples; zeros for none. */
export function spread(samples: readonly number[]): Spread {
  if (samples.length === 0) return { mean: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number;
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    mean: sum / sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted[sorted.length - 1] as number,
  };
}

/**
 * Frames that stutter: longer than twice the typical frame, which on any refresh rate is a
 * frame the screen showed twice, and the plain thresholds a player feels at 60 Hz.
 */
export function stutters(intervals: readonly number[]): {
  doubled: number;
  over33: number;
  over50: number;
} {
  const typical = spread(intervals).p50;
  let doubled = 0;
  let over33 = 0;
  let over50 = 0;
  for (const ms of intervals) {
    if (ms > typical * 2) doubled++;
    if (ms > 33.4) over33++;
    if (ms > 50) over50++;
  }
  return { doubled, over33, over50 };
}

/** One frame as measured. */
interface Sample {
  at: number;
  interval: number;
  sections: Record<Section, number>;
  /** Vertices Pixi triangulated again this frame, from `Graphics` changed since the last. */
  rebuilt: number;
  /** `Graphics` changed since the last frame. */
  dirty: number;
}

function emptySections(): Record<Section, number> {
  return { sim: 0, hud: 0, effects: 0, flow: 0, overlay: 0, render: 0 };
}

const fixed = (n: number, digits = 1): string => n.toFixed(digits);

export class PerfMeter {
  enabled = false;

  private started = new Map<Section, number>();
  private current = emptySections();
  private live: Sample[] = [];
  private window: Sample[] = [];
  private firstFrame: number | null = null;
  private done = false;
  private shownAt = 0;
  private node: HTMLElement | null = null;
  private body: HTMLElement | null = null;
  private context: () => Record<string, string> = () => ({});
  private stage: Container | null = null;
  private renderer: Renderer | null = null;
  private pending: { contexts: Graphics[]; dirty: number } = { contexts: [], dirty: 0 };
  /** Vertices rebuilt over the window, by `Graphics`: which drawing to make cheaper. */
  private byGraphics = new Map<string, { vertices: number; frames: number; max: number }>();

  begin(section: Section): void {
    if (this.enabled) this.started.set(section, performance.now());
  }

  end(section: Section): void {
    if (!this.enabled) return;
    const from = this.started.get(section);
    if (from !== undefined) this.current[section] += performance.now() - from;
  }

  /** The page's readout, for the length of a match; `context` names what is measured. */
  attach(stage: Container, renderer: Renderer, context: () => Record<string, string>): void {
    if (!this.enabled) return;
    this.stage = stage;
    this.renderer = renderer;
    this.context = context;
    this.restart();
    const node = document.createElement('div');
    node.id = 'perf';
    node.style.cssText =
      'position:fixed;left:8px;bottom:8px;z-index:9999;padding:6px 8px;' +
      'background:rgba(0,0,0,0.75);color:#e8e8e8;font:11px/1.35 monospace;' +
      'border-radius:4px;white-space:pre;pointer-events:auto;';
    const body = document.createElement('div');
    const buttons = document.createElement('div');
    buttons.style.cssText = 'margin-top:4px;display:flex;gap:6px;';
    const copy = document.createElement('button');
    copy.textContent = 'Copy';
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(this.report()).then(
        () => (copy.textContent = 'Copied'),
        () => (copy.textContent = 'Copy failed'),
      );
    });
    const again = document.createElement('button');
    again.textContent = 'Measure again';
    again.addEventListener('click', () => {
      this.restart();
      copy.textContent = 'Copy';
    });
    buttons.append(copy, again);
    node.append(body, buttons);
    document.body.append(node);
    this.node = node;
    this.body = body;
  }

  detach(): void {
    this.node?.remove();
    this.node = null;
    this.body = null;
    this.stage = null;
    this.renderer = null;
  }

  private restart(): void {
    this.window = [];
    this.byGraphics.clear();
    this.firstFrame = null;
    this.done = false;
  }

  /**
   * Just before Pixi renders: which `Graphics` changed since the last frame, since Pixi
   * triangulates exactly those again inside `render`.
   */
  beforeRender(): void {
    if (!this.enabled || this.stage === null) return;
    const contexts: Graphics[] = [];
    let dirty = 0;
    const visit = (node: Container): void => {
      if (!node.visible) return;
      if (node instanceof Graphics && node.context.dirty) {
        dirty++;
        contexts.push(node);
      }
      for (const child of node.children) visit(child);
    };
    visit(this.stage);
    this.pending = { contexts, dirty };
  }

  /** Closes the frame begun at the last call, `interval` after the one before. */
  frameDone(now: number, interval: number): void {
    if (!this.enabled) return;
    let rebuilt = 0;
    const counting = this.firstFrame !== null && !this.done && now - this.firstFrame >= SETTLE_MS;
    const system = this.renderer?.graphicsContext;
    if (system !== undefined) {
      for (const g of this.pending.contexts) {
        const gpu = system.getGpuContext(g.context);
        if (!('geometryData' in gpu)) continue;
        const vertices = gpu.geometryData.vertices.length / 2;
        rebuilt += vertices;
        if (!counting) continue;
        const name = nameOf(g);
        const entry = this.byGraphics.get(name) ?? { vertices: 0, frames: 0, max: 0 };
        entry.vertices += vertices;
        entry.frames++;
        entry.max = Math.max(entry.max, vertices);
        this.byGraphics.set(name, entry);
      }
    }
    const sample: Sample = {
      at: now,
      interval,
      sections: this.current,
      rebuilt,
      dirty: this.pending.dirty,
    };
    this.current = emptySections();
    this.pending = { contexts: [], dirty: 0 };

    this.live.push(sample);
    while (this.live.length > 0 && (this.live[0] as Sample).at < now - LIVE_MS) this.live.shift();
    this.firstFrame ??= now;
    const since = now - this.firstFrame;
    if (!this.done && since >= SETTLE_MS) {
      if (since < SETTLE_MS + WINDOW_MS) this.window.push(sample);
      else this.done = true;
    }
    if (this.body !== null && now - this.shownAt >= SHOW_EVERY_MS) {
      this.shownAt = now;
      this.body.textContent = this.text(since);
    }
  }

  private text(since: number): string {
    const live = this.live;
    const intervals = live.map((s) => s.interval);
    const frames = spread(intervals);
    const lines = [
      `live ${LIVE_MS / 1000}s: ${fixed(1000 / Math.max(1, frames.mean), 0)} fps, ` +
        `frame ${fixed(frames.mean)} ms, worst ${fixed(frames.max)}`,
      'section    mean  worst',
      ...SECTIONS.map((name) => {
        const s = spread(live.map((x) => x.sections[name]));
        return `${name.padEnd(9)}${fixed(s.mean, 2).padStart(6)}${fixed(s.max, 1).padStart(7)}`;
      }),
      `rebuilt   ${fixed(spread(live.map((x) => x.rebuilt)).mean, 0)} vertices/frame ` +
        `in ${fixed(spread(live.map((x) => x.dirty)).mean, 0)} Graphics`,
    ];
    if (since < SETTLE_MS) lines.push('window: settling');
    else if (!this.done) {
      lines.push(`window: measuring, ${fixed((SETTLE_MS + WINDOW_MS - since) / 1000, 0)} s left`);
    } else lines.push('window: done, Copy sends the figures');
    return lines.join('\n');
  }

  /** The measured window, as text to paste into a message. */
  report(): string {
    const samples = this.window;
    const intervals = samples.map((s) => s.interval);
    const frames = spread(intervals);
    const bad = stutters(intervals);
    const heap = (performance as { memory?: { usedJSHeapSize: number } }).memory;
    const ms = (s: Spread): string =>
      `mean ${fixed(s.mean, 2)}  p50 ${fixed(s.p50, 2)}  p95 ${fixed(s.p95, 2)}  ` +
      `p99 ${fixed(s.p99, 2)}  max ${fixed(s.max, 1)}`;
    const context = {
      ...this.context(),
      window: `${fixed((samples.length > 0 ? (samples.at(-1) as Sample).at - (samples[0] as Sample).at : 0) / 1000)} s${this.done ? '' : ' (incomplete)'}`,
      screen: `${globalThis.innerWidth}x${globalThis.innerHeight} css px, ratio ${globalThis.devicePixelRatio}`,
      gpu: gpuName(this.renderer),
      ...(heap === undefined ? {} : { heap: `${fixed(heap.usedJSHeapSize / 2 ** 20, 0)} MB` }),
    };
    return [
      'Bollwerk perf',
      ...Object.entries(context).map(([k, v]) => `${k}: ${v}`),
      `frames: ${samples.length}, ${fixed(1000 / Math.max(1, frames.mean), 1)} fps`,
      `interval   ${ms(frames)}`,
      `stutter: ${bad.doubled} frames over twice the typical, ${bad.over33} over 33 ms, ${bad.over50} over 50 ms`,
      ...SECTIONS.map(
        (name) => `${name.padEnd(10)} ${ms(spread(samples.map((x) => x.sections[name])))}`,
      ),
      `rebuilt vertices/frame: ${ms(spread(samples.map((x) => x.rebuilt)))}`,
      `dirty Graphics/frame: mean ${fixed(spread(samples.map((x) => x.dirty)).mean)}`,
      'rebuilt most, vertices/frame over the window (frames rebuilt), worst frame:',
      ...[...this.byGraphics.entries()]
        .sort((a, b) => b[1].vertices - a[1].vertices)
        .slice(0, 10)
        .map(
          ([name, e]) =>
            `  ${name.padEnd(28)} ${fixed(e.vertices / Math.max(1, samples.length), 0).padStart(8)} (${e.frames}), worst ${e.max}`,
        ),
      // The stutter: what one frame rebuilt the most of, however rarely.
      'rebuilt most in one frame:',
      ...[...this.byGraphics.entries()]
        .sort((a, b) => b[1].max - a[1].max)
        .slice(0, 5)
        .map(([name, e]) => `  ${name.padEnd(28)} ${String(e.max).padStart(8)} (${e.frames})`),
    ].join('\n');
  }
}

/**
 * A `Graphics` by where it stands: its label if it has one, else its place under the
 * nearest labelled container — the scene names each theme's layers.
 */
function nameOf(g: Container): string {
  const path: string[] = [];
  let node: Container | null = g;
  // Pixi labels every `Graphics` 'Graphics', which says nothing.
  while (node !== null && (!node.label || node.label === 'Graphics')) {
    const parent: Container | null = node.parent;
    path.unshift(parent === null ? '?' : String(parent.children.indexOf(node)));
    node = parent;
  }
  return [node?.label ?? 'stage', ...path].join('/');
}

/** The graphics card's name, where the browser tells it. */
function gpuName(renderer: Renderer | null): string {
  const gl = (renderer as { gl?: WebGLRenderingContext } | null)?.gl;
  if (gl === undefined) return renderer === null ? 'unknown' : `renderer type ${renderer.type}`;
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return String(
    info === null ? gl.getParameter(gl.RENDERER) : gl.getParameter(info.UNMASKED_RENDERER_WEBGL),
  );
}

/** The one meter, so the themes can time their own layers without being handed it. */
export const perf = new PerfMeter();
