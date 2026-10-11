"use client";

import { Html, Sky } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, N8AO, Vignette } from "@react-three/postprocessing";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { net } from "@/lib/net";
import { useGame } from "@/lib/store";
import type { GameMap, RosterEntry } from "@/lib/types";
import Ambient from "./Ambient";
import Avatar, { type Motion } from "./Avatar";
import { inRect, resolveCollision } from "./physics";
import { MapProps } from "./props";
import { sound } from "./sound";
import { cam, fx, input, local, sample } from "./state";
import { grass, laterite } from "./textures";

const SEND_HZ = 12;
const SUN = new THREE.Vector3(40, 60, 25);
const HEAD_Y = 1.5;

/**
 * Fraction (0..1) of the head→camera segment that is free of solid props, so
 * the third-person camera never ends up inside a wall.
 */
function cameraClearance(map: GameMap, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  let best = 1;
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const minX = Math.min(ax, bx) - 0.3, maxX = Math.max(ax, bx) + 0.3;
  const minZ = Math.min(az, bz) - 0.3, maxZ = Math.max(az, bz) + 0.3;
  for (const p of map.props) {
    const c = p.collider;
    if (!c || c[2] < minX || c[0] > maxX || c[3] < minZ || c[1] > maxZ) continue;
    let t0 = 0, t1 = 1, hit = true;
    const pad = 0.2;
    const slabs: [number, number, number, number][] = [
      [ax, dx, c[0] - pad, c[2] + pad], [ay, dy, -1, c[4] + pad], [az, dz, c[1] - pad, c[3] + pad],
    ];
    for (const [o, d, lo, hi] of slabs) {
      if (Math.abs(d) < 1e-6) { if (o < lo || o > hi) { hit = false; break; } continue; }
      let ta = (lo - o) / d, tb = (hi - o) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) { hit = false; break; }
    }
    if (hit && t0 < best) best = t0;
  }
  return Math.max(0.12, best - 0.04);
}

function LocalPlayer({ map }: { map: GameMap }) {
  const group = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const motion = useRef<Motion>({ speed: 0, crouch: false });
  const last = useRef({ sent: 0, x: NaN, z: NaN, c: false });
  const cfg = useGame((s) => s.content?.config.movement);
  const me = useGame((s) => s.me);
  const av = useGame((s) => (s.me ? Object.values(s.roster).find((r) => r.id === s.me?.id)?.av : undefined));
  const { camera } = useThree();
  const want = useMemo(() => new THREE.Vector3(), []);
  const camState = useRef({ dist: cam.dist, pitch: cam.pitch, clear: 1, home: null as string | null });

  useFrame((state, rawDt) => {
    if (!cfg || !group.current) return;
    const dt = Math.min(rawDt, 0.1);
    // ---- input
    let ix = input.joyX, iy = input.joyY;
    const k = input.keys;
    if (k.has("KeyW") || k.has("ArrowUp")) iy += 1;
    if (k.has("KeyS") || k.has("ArrowDown")) iy -= 1;
    if (k.has("KeyA") || k.has("ArrowLeft")) ix -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) ix += 1;
    const mag = Math.min(1, Math.hypot(ix, iy));
    const moving = mag > 0.08 && !local.frozen;
    local.crouch = input.crouchToggle || k.has("KeyC") || k.has("ControlLeft");
    const wantRun = (input.runHeld || input.joyRun || k.has("ShiftLeft") || k.has("ShiftRight")) && !local.crouch;
    local.run = wantRun && moving && local.stamina > 0;
    if (local.run) local.stamina = Math.max(0, local.stamina - dt);
    else local.stamina = Math.min(cfg.stamina_max_s, local.stamina + cfg.stamina_regen_per_s * dt);
    local.moving = moving;
    let speed = 0;
    if (moving) {
      speed = (local.crouch ? cfg.crouch_speed : local.run ? cfg.run_speed : cfg.walk_speed) * mag;
      const ang = -Math.atan2(ix, iy) + cam.yaw + Math.PI;
      const vx = Math.sin(ang) * speed, vz = Math.cos(ang) * speed;
      const [nx, nz] = resolveCollision(map, local.x + vx * dt, local.z + vz * dt, cfg.player_radius);
      local.x = nx;
      local.z = nz;
      local.ry = Math.atan2(vx, vz);
    }
    motion.current.speed = speed;
    motion.current.crouch = local.crouch;
    sound.footsteps(speed, local.crouch);
    local.insideHome = map.homes?.find((h) => inRect(h.rect, local.x, local.z))?.id ?? null;
    if (local.insideHome !== camState.current.home) {
      camState.current.home = local.insideHome;
      sound.play("door");
    }
    // ---- render
    group.current.position.set(local.x, 0, local.z);
    let d = (local.ry - group.current.rotation.y) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    group.current.rotation.y += d * (1 - Math.exp(-dt * 14));
    if (ring.current) ring.current.visible = cam.aerial.on;
    // ---- camera
    const c = camState.current;
    if (cam.aerial.on) {
      want.set(cam.aerial.x, cam.aerial.h, cam.aerial.z + cam.aerial.h * 0.35);
      camera.position.lerp(want, 1 - Math.exp(-dt * 6));
      camera.lookAt(cam.aerial.x, 0, cam.aerial.z);
    } else {
      const inside = !!local.insideHome;
      c.dist = THREE.MathUtils.lerp(c.dist, inside && cam.dist < 12 ? 3.4 : cam.dist, 1 - Math.exp(-dt * 5));
      c.pitch = THREE.MathUtils.lerp(c.pitch, inside ? 1.05 : cam.pitch, 1 - Math.exp(-dt * 5));
      const ox = Math.sin(cam.yaw) * c.dist * Math.cos(c.pitch), oy = Math.sin(c.pitch) * c.dist, oz = Math.cos(cam.yaw) * c.dist * Math.cos(c.pitch);
      const clear = inside ? 1 : cameraClearance(map, local.x, HEAD_Y, local.z, local.x + ox, HEAD_Y - 0.1 + oy, local.z + oz);
      // pull in fast when blocked, ease back out slowly (no popping)
      c.clear = clear < c.clear ? clear : THREE.MathUtils.lerp(c.clear, clear, 1 - Math.exp(-dt * 3));
      want.set(local.x + ox * c.clear, HEAD_Y - 0.1 + oy * c.clear, local.z + oz * c.clear);
      camera.position.lerp(want, 1 - Math.exp(-dt * 14));
      if (fx.shake > 0.001) {
        camera.position.x += (Math.random() - 0.5) * fx.shake * 0.4;
        camera.position.y += (Math.random() - 0.5) * fx.shake * 0.4;
        fx.shake *= Math.exp(-dt * 6);
      }
      camera.lookAt(local.x, 1.3, local.z);
    }
    // ---- heartbeat: a hider hears Boju getting close
    const st = useGame.getState();
    const g = st.group, r = g?.round, meId = st.me?.id;
    if (g?.phase === "seek" && r && meId && r.seeker !== meId && r.state[meId] === "hiding") {
      const seeker = Object.values(st.roster).find((x) => x.id === r.seeker);
      const sp = seeker ? sample(seeker.n) : null;
      if (sp) sound.heartbeat(Math.max(0, 1 - Math.hypot(sp.x - local.x, sp.z - local.z) / 14));
    }
    // ---- network (12 Hz, only when something changed)
    const now = state.clock.elapsedTime;
    const l = last.current;
    if (now - l.sent >= 1 / SEND_HZ && (l.x !== local.x || l.z !== local.z || l.c !== local.crouch || now - l.sent > 1)) {
      l.sent = now;
      l.x = local.x;
      l.z = local.z;
      l.c = local.crouch;
      net.send({ t: "mv", x: +local.x.toFixed(2), z: +local.z.toFixed(2), ry: +local.ry.toFixed(2), c: local.crouch, r: local.run, s: ++local.seq });
    }
  });

  return (
    <group ref={group}>
      <Avatar av={av ?? [0, 0, 0]} me={!!me} motion={motion} />
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]} visible={false}>
        <ringGeometry args={[1.2, 1.8, 32]} />
        <meshBasicMaterial color="#2f7cf6" transparent opacity={0.85} depthWrite={false} />
      </mesh>
    </group>
  );
}

function RemotePlayer({ r }: { r: RosterEntry }) {
  const group = useRef<THREE.Group>(null);
  const motion = useRef<Motion>({ speed: 0, crouch: false });
  const prev = useRef({ x: 0, z: 0 });
  const emote = useGame((s) => s.emotes.find((e) => e.n === r.n && e.until > Date.now()));
  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const snap = sample(r.n);
    if (!snap) { g.visible = false; return; }
    g.visible = true;
    const sp = dt > 0 ? Math.hypot(snap.x - prev.current.x, snap.z - prev.current.z) / dt : 0;
    prev.current = { x: snap.x, z: snap.z };
    motion.current.speed = THREE.MathUtils.lerp(motion.current.speed, Math.min(sp, 7), 0.25);
    motion.current.crouch = (snap.f & 1) === 1;
    g.position.set(snap.x, 0, snap.z);
    g.rotation.y = snap.ry;
  });
  return (
    <group ref={group} visible={false}>
      <Avatar av={r.av} motion={motion} label={emote ? `${r.nick}: ${emote.text}` : r.nick} tag={r.bot ? "NPC" : undefined} />
    </group>
  );
}

function Remotes() {
  const roster = useGame((s) => s.roster);
  const meId = useGame((s) => s.me?.id);
  return <>{Object.values(roster).filter((r) => r.id !== meId).map((r) => <RemotePlayer key={r.n} r={r} />)}</>;
}

function Markers({ map }: { map: GameMap }) {
  const safeId = useGame((s) => s.group?.settings.safe);
  const items: { rect: number[]; color: string }[] = [
    ...map.zones.map((z) => ({ rect: z.rect, color: z.kind === "bus_stop" ? "#f7c500" : "#ff7a1a" })),
    ...map.safe_houses.filter((s) => s.id === safeId).map((s) => ({ rect: s.rect, color: "#39d353" })),
  ];
  return (
    <>
      {items.map((m, i) => (
        <mesh key={i} position={[(m.rect[0] + m.rect[2]) / 2, 0.15, (m.rect[1] + m.rect[3]) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[m.rect[2] - m.rect[0], m.rect[3] - m.rect[1]]} />
          <meshBasicMaterial color={m.color} transparent opacity={0.3} depthWrite={false} />
        </mesh>
      ))}
      {map.found_area && (
        <mesh position={[map.found_area[0], 0.05, map.found_area[1]]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[12, 5]} />
          <meshBasicMaterial color="#d94f3d" transparent opacity={0.4} />
        </mesh>
      )}
    </>
  );
}

/** Section names + safe house + zones floating over the map while in aerial view. */
function AerialLabels({ map }: { map: GameMap }) {
  const on = useGame((s) => s.aerial);
  const safeId = useGame((s) => s.group?.settings.safe);
  if (!on) return null;
  const mid = (r: number[]): [number, number] => [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
  const tags: { key: string; at: [number, number]; text: string; cls: string }[] = [
    ...map.sections.map((s) => ({ key: `s${s.id}`, at: mid(s.rect), text: `📍 ${s.name}`, cls: "bg-black/60 text-white" })),
    ...map.safe_houses.filter((s) => s.id === safeId).map((s) => ({ key: `h${s.id}`, at: mid(s.rect), text: `🏠 ${s.name}`, cls: "bg-[var(--leaf)] text-white" })),
    ...map.zones.map((z) => ({ key: `z${z.id}`, at: mid(z.rect), text: z.kind === "bus_stop" ? `🚌 ${z.name}` : `🍽️ ${z.name}`, cls: "bg-[var(--accent)] text-white" })),
  ];
  return (
    <>
      {tags.map((t) => (
        <Html key={t.key} position={[t.at[0], 4, t.at[1]]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <div className={`anim-pop whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold shadow-lg ${t.cls}`}>{t.text}</div>
        </Html>
      ))}
    </>
  );
}

/** Sun whose shadow camera follows the player: crisp shadows with a small shadow map. */
function Sun({ shadows }: { shadows: boolean }) {
  const light = useRef<THREE.DirectionalLight>(null);
  useFrame(() => {
    const l = light.current;
    if (!l) return;
    const fx0 = cam.aerial.on ? cam.aerial.x : local.x, fz0 = cam.aerial.on ? cam.aerial.z : local.z;
    l.position.set(fx0 + SUN.x, SUN.y, fz0 + SUN.z);
    l.target.position.set(fx0, 0, fz0);
    l.target.updateMatrixWorld();
  });
  return (
    <directionalLight
      ref={light}
      color="#fff1d6"
      intensity={2.2}
      castShadow={shadows}
      shadow-mapSize={[1024, 1024]}
      shadow-bias={-0.0004}
      shadow-normalBias={0.03}
      shadow-camera-left={-28}
      shadow-camera-right={28}
      shadow-camera-top={28}
      shadow-camera-bottom={-28}
      shadow-camera-far={150}
    />
  );
}

function World({ map }: { map: GameMap }) {
  const quality = useGame((s) => s.quality);
  const aerial = useGame((s) => s.aerial);
  const b = map.bounds;
  const cx = (b[0] + b[2]) / 2, cz = (b[1] + b[3]) / 2;
  const w = b[2] - b[0] + 60, d = b[3] - b[1] + 60;
  const shadows = quality !== "low";
  const fogFar = quality === "low" ? 60 : quality === "medium" ? 90 : 140;
  const groundTex = useMemo(() => (map.kind === "hub" ? laterite(Math.round(w / 6)) : grass(Math.round(w / 6))), [map.kind, w]);
  const groundTint = map.kind === "hub" ? "#ffffff" : map.ground === "#79a85a" ? "#d8f0c8" : map.ground;
  return (
    <>
      <Sky sunPosition={[SUN.x, SUN.y, SUN.z]} turbidity={7} rayleigh={1.2} mieCoefficient={0.006} mieDirectionalG={0.85} />
      <fog attach="fog" args={["#cfdde6", aerial ? 120 : fogFar * 0.35, aerial ? 280 : fogFar]} />
      <hemisphereLight args={["#e9f3ff", "#7a5a3a", 1.0]} />
      <ambientLight intensity={0.15} />
      <Sun shadows={shadows} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0, cz]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial map={groundTex} color={groundTint} roughness={1} />
      </mesh>
      <MapProps props={map.props} lowDetail={quality === "low"} />
      <Markers map={map} />
      <AerialLabels map={map} />
      {map.kind === "hub" && <Ambient map={map} />}
      <LocalPlayer map={map} />
      <Remotes />
      {quality === "high" && (
        <EffectComposer multisampling={0}>
          <N8AO aoRadius={1.6} intensity={2.2} distanceFalloff={1} quality="performance" />
          <Vignette offset={0.25} darkness={0.45} />
        </EffectComposer>
      )}
    </>
  );
}

// ?debug=1 exposes client-only camera/player state for screenshots and QA (the server still validates movement).
if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug")) {
  (window as unknown as { __boju: unknown }).__boju = { local, cam, input, store: useGame };
}

export default function Scene({ map }: { map: GameMap }) {
  const quality = useGame((s) => s.quality);
  const dpr: [number, number] = quality === "low" ? [0.6, 1] : quality === "medium" ? [1, 1.5] : [1, 2];
  return (
    <Canvas
      shadows={quality === "high" ? "soft" : quality === "medium"}
      dpr={dpr}
      camera={{ fov: 60, near: 0.1, far: 320, position: [0, 5, 10] }}
      gl={{ antialias: quality !== "low", powerPreference: "high-performance", preserveDrawingBuffer: true }}
    >
      <World key={map.id} map={map} />
    </Canvas>
  );
}
