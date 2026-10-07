/**
 * Dinic's maximum flow, used to answer one question: what is the cheapest set of
 * tiles that would seal a castle?
 *
 * Sealing is exactly a minimum vertex cut. The sea reaches a castle through some path
 * of non-wall tiles; to enclose it you must place walls that break every such path,
 * and you may only build on empty land of your own island. Give every buildable tile
 * capacity 1 and everything else that cannot be built on infinite capacity, and the
 * minimum cut between the map border and the castle is the smallest wall that works.
 *
 * Existing walls are simply absent from the graph, so their value is accounted for
 * without any special case: paths must already route around them, and the cut only
 * ever counts tiles that still need building.
 */

export const INFINITE_CAPACITY = 1 << 28;

/** A graph as it stood, edges and capacities, to come back to with `MaxFlow.reset`. */
export interface FlowMark {
  edges: number;
  head: Int32Array;
  capacity: Int32Array;
}

/**
 * The edges are typed arrays grown by doubling, and the scratch of a search is kept between
 * searches: a bot runs dozens of these a plan, and they were most of its time (2026-10-06).
 */
export class MaxFlow {
  private readonly head: Int32Array;
  private to = new Int32Array(64);
  private capacity = new Int32Array(64);
  private next = new Int32Array(64);
  private edges = 0;
  private readonly level: Int32Array;
  private readonly cursor: Int32Array;
  private readonly queue: Int32Array;
  private path = new Int32Array(64);

  constructor(private readonly nodes: number) {
    this.head = new Int32Array(nodes).fill(-1);
    this.level = new Int32Array(nodes);
    this.cursor = new Int32Array(nodes);
    this.queue = new Int32Array(nodes);
  }

  /** Adds a directed edge and its residual twin. */
  addEdge(from: number, to: number, capacity: number): void {
    if (this.edges + 2 > this.to.length) this.grow();
    const e = this.edges;
    this.to[e] = to;
    this.capacity[e] = capacity;
    this.next[e] = this.head[from] as number;
    this.head[from] = e;

    this.to[e + 1] = from;
    this.capacity[e + 1] = 0;
    this.next[e + 1] = this.head[to] as number;
    this.head[to] = e + 1;
    this.edges = e + 2;
  }

  private grow(): void {
    const size = this.to.length * 2;
    const widened = (old: Int32Array): Int32Array<ArrayBuffer> => {
      const array = new Int32Array(size);
      array.set(old);
      return array;
    };
    this.to = widened(this.to);
    this.capacity = widened(this.capacity);
    this.next = widened(this.next);
  }

  /** The graph as it stands, before any flow is pushed through it. */
  mark(): FlowMark {
    return {
      edges: this.edges,
      head: this.head.slice(),
      capacity: this.capacity.slice(0, this.edges),
    };
  }

  /**
   * Back to a mark: the edges added since gone, every capacity as it was. The edges are
   * walked in the same order as before, so a flow pushed again is the same flow.
   */
  reset(mark: FlowMark): void {
    this.edges = mark.edges;
    this.capacity.set(mark.capacity);
    this.head.set(mark.head);
  }

  maxFlow(source: number, sink: number, limit = INFINITE_CAPACITY): number {
    let total = 0;
    while (total < limit && this.buildLevels(source, sink)) {
      this.cursor.set(this.head);
      for (;;) {
        const pushed = this.augment(source, sink, limit - total);
        if (pushed === 0) break;
        total += pushed;
        if (total >= limit) break;
      }
    }
    return total;
  }

  private buildLevels(source: number, sink: number): boolean {
    const { level, queue, to, capacity, next } = this;
    level.fill(-1);
    let head = 0;
    let tail = 0;
    queue[tail++] = source;
    level[source] = 0;

    while (head < tail) {
      const u = queue[head++] as number;
      const depth = (level[u] as number) + 1;
      for (let e = this.head[u] as number; e !== -1; e = next[e] as number) {
        const v = to[e] as number;
        if ((capacity[e] as number) <= 0 || level[v] !== -1) continue;
        level[v] = depth;
        queue[tail++] = v;
      }
    }
    return level[sink] !== -1;
  }

  /** Iterative depth-first augmentation; recursion would blow the stack on a full grid. */
  private augment(source: number, sink: number, limit: number): number {
    const { level, cursor, to, capacity, next } = this;
    let depth = 0;
    let node = source;

    for (;;) {
      if (node === sink) {
        const path = this.path;
        let bottleneck = limit;
        for (let k = 0; k < depth; k++) {
          bottleneck = Math.min(bottleneck, capacity[path[k] as number] as number);
        }
        for (let k = 0; k < depth; k++) {
          const e = path[k] as number;
          capacity[e] = (capacity[e] as number) - bottleneck;
          capacity[e ^ 1] = (capacity[e ^ 1] as number) + bottleneck;
        }
        return bottleneck;
      }

      let advanced = false;
      const wanted = (level[node] as number) + 1;
      for (let e = cursor[node] as number; e !== -1; e = next[e] as number) {
        cursor[node] = e;
        const v = to[e] as number;
        if ((capacity[e] as number) > 0 && level[v] === wanted) {
          if (depth === this.path.length) {
            const longer = new Int32Array(depth * 2);
            longer.set(this.path);
            this.path = longer;
          }
          this.path[depth++] = e;
          node = v;
          advanced = true;
          break;
        }
      }
      if (advanced) continue;

      // Dead end: retire this node from the level graph and step back.
      cursor[node] = -1;
      level[node] = -1;
      if (depth === 0) return 0;
      const last = this.path[--depth] as number;
      node = to[last ^ 1] as number;
    }
  }

  /** Nodes still reachable from the source once the flow is maximal: the cut's near side. */
  reachable(source: number): Uint8Array {
    const { queue, to, capacity, next } = this;
    const seen = new Uint8Array(this.nodes);
    let head = 0;
    let tail = 0;
    queue[tail++] = source;
    seen[source] = 1;

    while (head < tail) {
      const u = queue[head++] as number;
      for (let e = this.head[u] as number; e !== -1; e = next[e] as number) {
        const v = to[e] as number;
        if ((capacity[e] as number) <= 0 || seen[v] === 1) continue;
        seen[v] = 1;
        queue[tail++] = v;
      }
    }
    return seen;
  }
}
