import type { FurnitureSpec, GameMap, Home, PlacedItem, Rect } from "@/lib/types";

/**
 * Furniture inside houses. Mirrors backend/app/houses.py: local frame per house
 * (origin at the centre, front door on +z), quarter-turn rotations, and the
 * same placement rules so decorate mode can show problems before saving.
 */
const WALL_T = 0.3;
const CLEAR = 0.15;

export interface WorldBox { x0: number; z0: number; x1: number; z1: number; h: number; item: string; home: string; id: number; cx: number; cz: number; ry: number }

/** Live furniture of every house (from the server) + derived world boxes. */
export const furn = {
  homes: {} as Record<string, PlacedItem[]>,
  boxes: [] as WorldBox[], // every item (solid or not) in world space
  version: 0,
  catalog: {} as Record<string, FurnitureSpec>,
  map: null as GameMap | null,
};

const DIR_ANGLE: Record<Home["dir"], number> = { s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 };

export function toWorld(h: Home, lx: number, lz: number): [number, number] {
  const [cx, cz] = h.center;
  switch (h.dir) {
    case "n": return [cx - lx, cz - lz];
    case "e": return [cx + lz, cz - lx];
    case "w": return [cx - lz, cz + lx];
    default: return [cx + lx, cz + lz];
  }
}

export function toLocal(h: Home, x: number, z: number): [number, number] {
  const dx = x - h.center[0], dz = z - h.center[1];
  switch (h.dir) {
    case "n": return [-dx, -dz];
    case "e": return [-dz, dx];
    case "w": return [dz, -dx];
    default: return [dx, dz];
  }
}

export const worldRotY = (h: Home, rot: number) => DIR_ANGLE[h.dir] + rot * (Math.PI / 2);
export const footprint = (s: FurnitureSpec, rot: number): [number, number] => (rot % 2 ? [s.d, s.w] : [s.w, s.d]);

const listeners = new Set<() => void>();
/** For useSyncExternalStore: re-render when any house's furniture changes. */
export function subscribeFurniture(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const furnitureVersion = () => furn.version;

function rebuild(): void {
  const out: WorldBox[] = [];
  const homes = furn.map?.homes ?? [];
  for (const [hid, items] of Object.entries(furn.homes)) {
    const h = homes.find((x) => x.id === hid);
    if (!h) continue;
    for (const it of items) {
      const s = furn.catalog[it.item];
      if (!s) continue;
      let [fw, fd] = footprint(s, it.rot);
      if (h.dir === "e" || h.dir === "w") [fw, fd] = [fd, fw];
      const [cx, cz] = toWorld(h, it.lx, it.lz);
      out.push({ x0: cx - fw / 2, z0: cz - fd / 2, x1: cx + fw / 2, z1: cz + fd / 2, h: s.h, item: it.item, home: hid, id: it.id, cx, cz, ry: worldRotY(h, it.rot) });
    }
  }
  furn.boxes = out;
  furn.version++;
  listeners.forEach((fn) => fn());
}

export function setCatalog(list: FurnitureSpec[], map: GameMap | null): void {
  furn.catalog = Object.fromEntries(list.map((f) => [f.id, f]));
  furn.map = map;
  rebuild();
}
export function setAllFurniture(homes: Record<string, PlacedItem[]>): void { furn.homes = { ...homes }; rebuild(); }
export function setHomeFurniture(home: string, items: PlacedItem[]): void { furn.homes = { ...furn.homes, [home]: items }; rebuild(); }

/** Solid furniture boxes as colliders [x0, z0, x1, z1, h] (for movement + pathfinding). */
let solidCache: { v: number; mapId: string; list: [number, number, number, number, number][] } = { v: -1, mapId: "", list: [] };
export function solidColliders(): [number, number, number, number, number][] {
  if (furn.map?.kind !== "hub") return [];
  if (solidCache.v !== furn.version || solidCache.mapId !== furn.map.id) {
    solidCache = { v: furn.version, mapId: furn.map.id, list: furn.boxes.filter((b) => furn.catalog[b.item]?.solid).map((b) => [b.x0, b.z0, b.x1, b.z1, b.h]) };
  }
  return solidCache.list;
}

// ---------------------------------------------------------------- placement rules (same as the server)
const overlap = (a: Rect, b: Rect, pad = 0) => a[0] < b[2] + pad && b[0] < a[2] + pad && a[1] < b[3] + pad && b[1] < a[3] + pad;

export function itemRect(s: FurnitureSpec, it: { lx: number; lz: number; rot: number }): Rect {
  const [fw, fd] = footprint(s, it.rot);
  return [it.lx - fw / 2, it.lz - fd / 2, it.lx + fw / 2, it.lz + fd / 2];
}

/** First problem with this layout (null = fine), plus which item causes it. */
export function checkLayout(h: Home, placed: PlacedItem[]): { msg: string; id: number } | null {
  const hw = h.lw / 2 - WALL_T / 2 - CLEAR, hd = h.ld / 2 - WALL_T / 2 - CLEAR, eps = 1e-6;
  const solids: [string, Rect][] = [];
  for (const p of placed) {
    const s = furn.catalog[p.item];
    if (!s) return { msg: "Unknown item", id: p.id };
    const r = itemRect(s, p);
    if (r[0] < -hw - eps || r[2] > hw + eps || r[1] < -hd - eps || r[3] > hd + eps) return { msg: `${s.name} doesn't fit there — keep it inside the walls`, id: p.id };
    if (!s.solid) continue;
    if (h.walls.some((w) => overlap(r, w))) return { msg: `${s.name} is inside a wall`, id: p.id };
    if (h.doorways.some((d) => overlap(r, d))) return { msg: `${s.name} is blocking a doorway`, id: p.id };
    const hit = solids.find(([, o]) => overlap(r, o, -0.02));
    if (hit) return { msg: `${s.name} is on top of the ${hit[0].toLowerCase()}`, id: p.id };
    solids.push([s.name, r]);
  }
  return null;
}

export const ITEM_ICON: Record<string, string> = {
  bed: "🛏️", bed_king: "🛏️", wardrobe: "🚪", bookshelf: "📚", sofa: "🛋️", armchair: "🪑", tv: "📺", center_table: "🟫",
  dining: "🍽️", fridge: "🧊", cooker: "🍳", plant: "🪴", rug: "🧶", ceiling_fan: "🌀", standing_fan: "🌬️",
};
