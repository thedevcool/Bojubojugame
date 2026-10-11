/**
 * Street "physics" for moving things the server doesn't simulate: ambient traffic, the crowd,
 * other players and your own car. Cars are capsules (a line along the car, with a radius),
 * people are circles. Nothing passes through anything: traffic waits, your car stops.
 */
import { useGame } from "@/lib/store";
import { local, remotes, sample } from "./state";

export interface Body { x: number; z: number; dx: number; dz: number; half: number; r: number }
export interface Pt { x: number; z: number }

/** Live traffic and crowd positions (written every frame by Ambient). */
export const traffic = { cars: [] as Body[], peds: [] as Pt[] };

export const PERSON_R = 0.35;
export const MY_CAR = { half: 1.6, r: 0.95 };

/** Distance from a point to a capsule's surface (negative = inside). */
export function capsuleDist(b: Body, x: number, z: number): number {
  const px = x - b.x, pz = z - b.z;
  const t = Math.max(-b.half, Math.min(b.half, px * b.dx + pz * b.dz));
  return Math.hypot(px - b.dx * t, pz - b.dz * t) - b.r;
}

/** Gap between two capsules (approximated with five points along the first one). */
export function capsuleGap(a: Body, b: Body): number {
  let m = Infinity;
  for (const k of [-1, -0.5, 0, 0.5, 1]) m = Math.min(m, capsuleDist(b, a.x + a.dx * a.half * k, a.z + a.dz * a.half * k) - a.r);
  return m;
}

export const bodyFrom = (x: number, z: number, ry: number, half: number, r: number): Body => ({ x, z, dx: Math.sin(ry), dz: Math.cos(ry), half, r });

/** Other players right now: people on foot, and drivers as cars. */
export function otherPlayers(): { people: Pt[]; cars: Body[] } {
  const me = useGame.getState().me?.n;
  const people: Pt[] = [], cars: Body[] = [];
  for (const n of remotes.keys()) {
    if (n === me) continue;
    const s = sample(n);
    if (!s || (s.f & 8)) continue; // hidden / spectating
    if (s.f & 64) cars.push(bodyFrom(s.x, s.z, s.ry, MY_CAR.half, MY_CAR.r));
    else people.push({ x: s.x, z: s.z });
  }
  return { people, cars };
}

/**
 * How much room the local player would have at (x, z) facing ry: negative means they'd overlap
 * a car (or, when driving, a person). Used to stop you walking or driving through traffic.
 */
export function roomAt(x: number, z: number, ry: number, driving: boolean, others = otherPlayers()): number {
  let m = Infinity;
  const cars = [...traffic.cars, ...others.cars];
  if (driving) {
    const me = bodyFrom(x, z, ry, MY_CAR.half, MY_CAR.r);
    for (const c of cars) m = Math.min(m, capsuleGap(me, c));
    for (const p of [...traffic.peds, ...others.people]) m = Math.min(m, capsuleDist(me, p.x, p.z) - PERSON_R);
  } else {
    for (const c of cars) m = Math.min(m, capsuleDist(c, x, z) - PERSON_R);
  }
  return m;
}

/** Where the local player is, as something traffic must not hit. */
export function localBody(): { person: Pt | null; car: Body | null } {
  if (local.drive) return { person: null, car: bodyFrom(local.x, local.z, local.ry, MY_CAR.half, MY_CAR.r) };
  return { person: { x: local.x, z: local.z }, car: null };
}
