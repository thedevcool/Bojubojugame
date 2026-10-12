import type { GameMap, Rect } from "@/lib/types";
import { solidColliders } from "./furniture";

/** Client-side mirror of backend/app/engine/geometry.py for smooth prediction. */
export function resolveCollision(map: GameMap, x: number, z: number, r: number): [number, number] {
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const c of [...map.props.map((p) => p.collider), ...solidColliders()]) {
      if (!c) continue;
      const cx = Math.min(Math.max(x, c[0]), c[2]);
      const cz = Math.min(Math.max(z, c[1]), c[3]);
      const dx = x - cx, dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        x = cx + (dx / d) * r;
        z = cz + (dz / d) * r;
      } else {
        // centre inside the box: push out along the shallowest axis
        const opts: [number, number, number][] = [
          [x - c[0], c[0] - r, z], [c[2] - x, c[2] + r, z],
          [z - c[1], x, c[1] - r], [c[3] - z, x, c[3] + r],
        ];
        opts.sort((a, b) => a[0] - b[0]);
        [, x, z] = opts[0];
      }
      moved = true;
    }
    if (!moved) break;
  }
  const b = map.bounds;
  x = Math.min(Math.max(x, b[0] + r + 0.02), b[2] - r - 0.02);
  z = Math.min(Math.max(z, b[1] + r + 0.02), b[3] - r - 0.02);
  return [x, z];
}

export const inRect = (r: Rect, x: number, z: number) => r[0] <= x && x <= r[2] && r[1] <= z && z <= r[3];

/**
 * How much room a car body has at (x, z) facing ry, against walls, stalls, parked cars and poles:
 * negative = it would overlap one. The car is a capsule (a line along it, with a radius).
 */
export function carRoom(map: GameMap, x: number, z: number, ry: number, half: number, r: number): number {
  const dx = Math.sin(ry), dz = Math.cos(ry);
  let m = Infinity;
  for (const c of [...map.props.map((p) => p.collider), ...solidColliders()]) {
    if (!c) continue;
    // quick reject: the box is further than the whole car
    if (c[0] - x > half + r || x - c[2] > half + r || c[1] - z > half + r || z - c[3] > half + r) continue;
    for (const k of [-1, -0.5, 0, 0.5, 1]) {
      const px = x + dx * half * k, pz = z + dz * half * k;
      const cx = Math.min(Math.max(px, c[0]), c[2]), cz = Math.min(Math.max(pz, c[1]), c[3]);
      m = Math.min(m, Math.hypot(px - cx, pz - cz) - r);
    }
  }
  return m;
}
