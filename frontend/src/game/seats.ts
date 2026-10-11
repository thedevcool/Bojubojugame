import type { GameMap } from "@/lib/types";

/** Where (and how high) an avatar sits: on a bed edge, a bus-stop bench, or the floor. */
export interface Seat { x: number; z: number; y: number; ry: number | null }

const SEATS: Record<string, number> = { bed: 0.55, bench: 0.45 };
const REACH = 1.1;

export function findSeat(map: GameMap, x: number, z: number): Seat {
  let best: Seat | null = null, bestD = REACH;
  for (const p of map.props) {
    if (p.kind === "bus_shelter") {
      if (Math.abs(x - p.x) <= p.w / 2 && Math.abs(z - p.z) <= p.d / 2) return { x, z, y: 0.45, ry: null };
      continue;
    }
    const seatY = SEATS[p.kind];
    const c = p.collider;
    if (seatY === undefined || !c) continue;
    const cx = Math.min(Math.max(x, c[0]), c[2]), cz = Math.min(Math.max(z, c[1]), c[3]);
    const d = Math.hypot(x - cx, z - cz);
    if (d >= bestD || d < 1e-3) continue;
    bestD = d;
    const nx = (x - cx) / d, nz = (z - cz) / d;
    // hips just inside the edge, facing away from the bed
    best = { x: cx - nx * 0.28, z: cz - nz * 0.28, y: seatY, ry: Math.atan2(nx, nz) };
  }
  return best ?? { x, z, y: 0, ry: null };
}
