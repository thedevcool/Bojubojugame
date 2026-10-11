import type { GameMap } from "@/lib/types";
import { local } from "./state";

/**
 * Client-side grid navigation for tap-to-move (mirror of backend/app/engine/nav.py).
 * One walkable grid per map, built lazily and cached.
 */
const CELL = 0.5;
const RADIUS = 0.45;

interface Grid { x0: number; z0: number; w: number; h: number; walk: Uint8Array; boxes: number[][] }
const cache = new Map<string, Grid>();

/** Rasterise every solid box (grown by the player radius) into a walkable bitmap. */
function build(map: GameMap): Grid {
  const [bx0, bz0, bx1, bz1] = map.bounds;
  const w = Math.floor((bx1 - bx0) / CELL), h = Math.floor((bz1 - bz0) / CELL);
  const boxes = map.props.map((p) => p.collider).filter((c): c is [number, number, number, number, number] => !!c);
  const walk = new Uint8Array(w * h).fill(1);
  const r = RADIUS + 0.05;
  for (let i = 0; i < w; i++) { walk[i * h] = 0; walk[i * h + h - 1] = 0; }
  for (let j = 0; j < h; j++) { walk[j] = 0; walk[(w - 1) * h + j] = 0; }
  for (const c of boxes) {
    const i0 = Math.max(0, Math.floor((c[0] - r - bx0) / CELL)), i1 = Math.min(w - 1, Math.floor((c[2] + r - bx0) / CELL));
    const j0 = Math.max(0, Math.floor((c[1] - r - bz0) / CELL)), j1 = Math.min(h - 1, Math.floor((c[3] + r - bz0) / CELL));
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const x = bx0 + (i + 0.5) * CELL, z = bz0 + (j + 0.5) * CELL;
        const cx = Math.min(Math.max(x, c[0]), c[2]), cz = Math.min(Math.max(z, c[1]), c[3]);
        if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) walk[i * h + j] = 0;
      }
  }
  return { x0: bx0, z0: bz0, w, h, walk, boxes };
}

function grid(map: GameMap): Grid {
  let g = cache.get(map.id);
  if (!g) { g = build(map); cache.set(map.id, g); }
  return g;
}

const ok = (g: Grid, i: number, j: number) => i >= 0 && j >= 0 && i < g.w && j < g.h && g.walk[i * g.h + j] === 1;
const center = (g: Grid, i: number, j: number): [number, number] => [g.x0 + (i + 0.5) * CELL, g.z0 + (j + 0.5) * CELL];

function nearest(g: Grid, i: number, j: number): [number, number] | null {
  if (ok(g, i, j)) return [i, j];
  for (let r = 1; r < 12; r++)
    for (let di = -r; di <= r; di++)
      for (const [a, b] of [[i + di, j - r], [i + di, j + r], [i - r, j + di], [i + r, j + di]])
        if (ok(g, a, b)) return [a, b];
  return null;
}

function clear(g: Grid, ax: number, az: number, bx: number, bz: number): boolean {
  const pad = RADIUS + 0.05;
  for (const c of g.boxes) {
    let t0 = 0, t1 = 1, hit = true;
    for (const [o, d, lo, hi] of [[ax, bx - ax, c[0] - pad, c[2] + pad], [az, bz - az, c[1] - pad, c[3] + pad]] as const) {
      if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { hit = false; break; } continue; }
      let ta = (lo - o) / d, tb = (hi - o) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) { hit = false; break; }
    }
    if (hit) return false;
  }
  return true;
}

/** A* path from (sx,sz) to (tx,tz); returns smoothed waypoints (empty if unreachable). */
export function findPath(map: GameMap, sx: number, sz: number, tx: number, tz: number): [number, number][] {
  const g = grid(map);
  const s = nearest(g, Math.floor((sx - g.x0) / CELL), Math.floor((sz - g.z0) / CELL));
  const t = nearest(g, Math.floor((tx - g.x0) / CELL), Math.floor((tz - g.z0) / CELL));
  if (!s || !t) return [];
  if (clear(g, sx, sz, tx, tz) && ok(g, ...t)) return [[tx, tz]];
  const N = g.w * g.h, idx = (i: number, j: number) => i * g.h + j;
  const gScore = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const heap: [number, number][] = [];
  const push = (f: number, n: number) => {
    heap.push([f, n]);
    let k = heap.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
      }
    }
    return top;
  };
  const start = idx(...s), goal = idx(...t);
  gScore[start] = 0;
  push(0, start);
  let expanded = 0;
  while (heap.length && expanded < 60000) {
    const [, cur] = pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    expanded++;
    const ci = Math.floor(cur / g.h), cj = cur % g.h;
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (!ok(g, ni, nj) || (di && dj && !(ok(g, ci + di, cj) && ok(g, ci, cj + dj)))) continue;
        const n = idx(ni, nj), cost = gScore[cur] + (di && dj ? 1.4142 : 1);
        if (cost < gScore[n]) {
          gScore[n] = cost;
          came[n] = cur;
          push(cost + Math.hypot(t[0] - ni, t[1] - nj), n);
        }
      }
  }
  if (came[goal] === -1 && goal !== start) return [];
  const cells: number[] = [goal];
  while (cells[cells.length - 1] !== start) cells.push(came[cells[cells.length - 1]]);
  cells.reverse();
  const pts = cells.map((n) => center(g, Math.floor(n / g.h), n % g.h));
  if (ok(g, ...t)) pts[pts.length - 1] = [tx, tz];
  // string-pulling: skip waypoints we can walk straight past
  const out: [number, number][] = [];
  let ax = sx, az = sz, i = 0;
  while (i < pts.length) {
    let j = i;
    while (j + 1 < pts.length && clear(g, ax, az, pts[j + 1][0], pts[j + 1][1])) j++;
    out.push(pts[j]);
    [ax, az] = pts[j];
    i = j + 1;
  }
  return out;
}

/** The map the local player is on (set by the scene) so UI buttons can say "walk me there". */
export const navState = { map: null as GameMap | null, target: null as [number, number] | null };

/** Tap-to-move / "walk me there": plan a path and let LocalPlayer follow it. Returns false if unreachable. */
export function walkTo(x: number, z: number): boolean {
  const map = navState.map;
  if (!map) return false;
  const path = findPath(map, local.x, local.z, x, z);
  local.path = path;
  navState.target = path.length ? path[path.length - 1] : null;
  return path.length > 0;
}

export function stopWalking(): void {
  local.path = [];
  navState.target = null;
}
