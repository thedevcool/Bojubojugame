import type { GameMap } from "@/lib/types";
import { furn } from "./furniture";

/** Where (and how) an avatar sits or lies: a bed, sofa, chair, bus-stop bench, or the floor. */
export interface Seat { x: number; z: number; y: number; ry: number | null; lie?: boolean }

const REACH = 1.1;

/** Nearest seat (or bed when ``sleep``) within reach of (x, z). */
export function findSeat(map: GameMap, x: number, z: number, sleep = false): Seat {
  for (const p of map.props) {
    if (p.kind === "bus_shelter" && !sleep && Math.abs(x - p.x) <= p.w / 2 && Math.abs(z - p.z) <= p.d / 2) return { x, z, y: 0.45, ry: null };
  }
  let best: Seat | null = null, bestD = REACH;
  const here = homeAt(x, z);
  for (const b of furn.boxes) {
    if (b.home !== here) continue; // no sitting on furniture through a wall
    const s = furn.catalog[b.item];
    if (!s || (sleep ? !s.bed : s.seat === null)) continue;
    const cx = Math.min(Math.max(x, b.x0), b.x1), cz = Math.min(Math.max(z, b.z0), b.z1);
    const d = Math.hypot(x - cx, z - cz);
    if (d >= bestD || d < 1e-3) continue;
    bestD = d;
    if (sleep) {
      // lie down along the bed: head at the headboard (the item's back), feet to the front
      best = { x: b.cx, z: b.cz, y: s.h, ry: b.ry, lie: true };
    } else {
      const nx = (x - cx) / d, nz = (z - cz) / d;
      best = { x: cx - nx * 0.28, z: cz - nz * 0.28, y: s.seat ?? 0.45, ry: Math.atan2(nx, nz) };
    }
  }
  return best ?? { x, z, y: 0, ry: null };
}

/** Is there a bed right here (for the sleep button)? */
export function bedNear(x: number, z: number): boolean {
  const here = homeAt(x, z);
  return furn.boxes.some((b) => b.home === here && furn.catalog[b.item]?.bed && Math.hypot(x - Math.min(Math.max(x, b.x0), b.x1), z - Math.min(Math.max(z, b.z0), b.z1)) < REACH);
}

function homeAt(x: number, z: number): string | null {
  return furn.map?.homes?.find((h) => h.rect[0] <= x && x <= h.rect[2] && h.rect[1] <= z && z <= h.rect[3])?.id ?? null;
}
