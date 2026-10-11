/** High-frequency mutable state lives here, outside React, and is read in useFrame. */

export interface Snap { t: number; x: number; z: number; ry: number; f: number }

export const local = {
  x: 0, z: 0, ry: 0,
  crouch: false,
  run: false,
  moving: false,
  stamina: 5,
  seq: 0,
  frozen: false,
  insideHome: null as string | null,
  sit: false,
  lie: false,
  drive: false,
  /** car speed along its heading (m/s, negative = reversing) */
  carV: 0,
  seatY: 0,
  /** furniture you tapped: when you arrive, sit (or ask sleep/sit for a bed) */
  seatTarget: null as { x: number; z: number; bed: boolean } | null,
  /** tap-to-move: remaining waypoints */
  path: [] as [number, number][],
};

export const input = {
  joyX: 0, joyY: 0, // -1..1 (joyY up = forward)
  keys: new Set<string>(),
  joyRun: false,
  runHeld: false,
  crouchToggle: false,
  /** on-screen driving pedals and steering (held) */
  pedal: { gas: false, brake: false, left: false, right: false },
  /** when the player last dragged to look around (the driving camera waits a moment after) */
  lookedAt: 0,
  /** pending screen tap (tap-to-move), consumed by the scene */
  tap: null as { x: number; y: number; walk: boolean } | null,
};

export const cam = {
  yaw: Math.PI,
  pitch: 0.35,
  dist: 6,
  /** Aerial "scan the map" mode: drag pans x/z, wheel/pinch changes height. */
  aerial: { on: false, x: 0, z: 0, h: 55, tx: 0, tz: 0, th: 55, vx: 0, vz: 0, drag: false },
};

/** The live camera + canvas, for DOM overlays that turn a screen point into a ground point (decorate mode). */
export const sceneRefs = { camera: null as unknown as import("three").Camera | null, canvas: null as HTMLCanvasElement | null };

/** Short-lived screen effects (camera shake on a tag, etc.). */
export const fx = { shake: 0 };

/** Remote players: net id -> snapshot buffer (server time, ms). */
export const remotes = new Map<number, Snap[]>();
export const clock = { offset: 0 }; // serverTime - Date.now()

export function serverNow(): number {
  return Date.now() + clock.offset;
}

export function pushSnapshot(ts: number, players: number[][]): void {
  const seen = new Set<number>();
  for (const [n, x, z, ry, f] of players) {
    seen.add(n);
    let buf = remotes.get(n);
    if (!buf) { buf = []; remotes.set(n, buf); }
    buf.push({ t: ts, x: x / 100, z: z / 100, ry: ry / 100, f });
    if (buf.length > 20) buf.shift();
  }
  for (const n of [...remotes.keys()]) if (!seen.has(n)) remotes.delete(n);
}

/** Interpolated pose ~120 ms in the past. */
export function sample(n: number, delayMs = 120): Snap | null {
  const buf = remotes.get(n);
  if (!buf || buf.length === 0) return null;
  const t = serverNow() - delayMs;
  if (t <= buf[0].t) return buf[0];
  for (let i = buf.length - 1; i > 0; i--) {
    const a = buf[i - 1], b = buf[i];
    if (a.t <= t && t <= b.t) {
      const k = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
      let dr = b.ry - a.ry;
      if (dr > Math.PI) dr -= Math.PI * 2;
      if (dr < -Math.PI) dr += Math.PI * 2;
      return { t, x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, ry: a.ry + dr * k, f: b.f };
    }
  }
  return buf[buf.length - 1];
}
