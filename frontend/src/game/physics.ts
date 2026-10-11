import type { GameMap, Rect } from "@/lib/types";

/** Client-side mirror of backend/app/engine/geometry.py for smooth prediction. */
export function resolveCollision(map: GameMap, x: number, z: number, r: number): [number, number] {
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const p of map.props) {
      const c = p.collider;
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
