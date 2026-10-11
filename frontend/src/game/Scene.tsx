"use client";

import { Sky } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { net } from "@/lib/net";
import { useGame } from "@/lib/store";
import type { GameMap, RosterEntry } from "@/lib/types";
import Ambient from "./Ambient";
import Avatar, { type Motion } from "./Avatar";
import { inRect, resolveCollision } from "./physics";
import { MapProps } from "./props";
import { cam, input, local, sample } from "./state";
import { grass, laterite } from "./textures";

const SEND_HZ = 12;
const SUN = new THREE.Vector3(40, 60, 25);

function LocalPlayer({ map }: { map: GameMap }) {
  const group = useRef<THREE.Group>(null);
  const motion = useRef<Motion>({ speed: 0, crouch: false });
  const last = useRef({ sent: 0, x: NaN, z: NaN, c: false });
  const cfg = useGame((s) => s.content?.config.movement);
  const me = useGame((s) => s.me);
  const av = useGame((s) => (s.me ? Object.values(s.roster).find((r) => r.id === s.me?.id)?.av : undefined));
  const { camera } = useThree();
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const camState = useRef({ dist: cam.dist, pitch: cam.pitch });

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
    const wantRun = (input.runHeld || k.has("ShiftLeft") || k.has("ShiftRight")) && !local.crouch;
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
    local.insideHome = map.homes?.find((h) => inRect(h.rect, local.x, local.z))?.id ?? null;
    // ---- render
    group.current.position.set(local.x, 0, local.z);
    group.current.rotation.y = THREE.MathUtils.lerp(group.current.rotation.y, group.current.rotation.y + angleDelta(group.current.rotation.y, local.ry), 1 - Math.exp(-dt * 14));
    // ---- camera: third person outside, high and close inside a house
    const inside = !!local.insideHome;
    const c = camState.current;
    c.dist = THREE.MathUtils.lerp(c.dist, inside && cam.dist < 12 ? 3.4 : cam.dist, 1 - Math.exp(-dt * 5));
    c.pitch = THREE.MathUtils.lerp(c.pitch, inside ? 1.05 : cam.pitch, 1 - Math.exp(-dt * 5));
    tmp.set(local.x + Math.sin(cam.yaw) * c.dist * Math.cos(c.pitch), 1.4 + Math.sin(c.pitch) * c.dist, local.z + Math.cos(cam.yaw) * c.dist * Math.cos(c.pitch));
    camera.position.lerp(tmp, 1 - Math.exp(-dt * 12));
    camera.lookAt(local.x, 1.3, local.z);
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
    </group>
  );
}

function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
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

/** Sun whose shadow camera follows the player: crisp shadows with a small shadow map. */
function Sun({ shadows }: { shadows: boolean }) {
  const light = useRef<THREE.DirectionalLight>(null);
  useFrame(() => {
    const l = light.current;
    if (!l) return;
    l.position.set(local.x + SUN.x, SUN.y, local.z + SUN.z);
    l.target.position.set(local.x, 0, local.z);
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
  const b = map.bounds;
  const cx = (b[0] + b[2]) / 2, cz = (b[1] + b[3]) / 2;
  const w = b[2] - b[0] + 60, d = b[3] - b[1] + 60;
  const shadows = quality !== "low";
  const fogFar = quality === "low" ? 60 : quality === "medium" ? 90 : 140;
  const groundTex = useMemo(() => (map.kind === "hub" ? laterite(Math.round(w / 6)) : grass(Math.round(w / 6))), [map.kind, w]);
  return (
    <>
      <Sky sunPosition={[SUN.x, SUN.y, SUN.z]} turbidity={7} rayleigh={1.2} mieCoefficient={0.006} mieDirectionalG={0.85} />
      <fog attach="fog" args={["#cfdde6", fogFar * 0.35, fogFar]} />
      <hemisphereLight args={["#e9f3ff", "#7a5a3a", 1.0]} />
      <ambientLight intensity={0.15} />
      <Sun shadows={shadows} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0, cz]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial map={groundTex} color={map.kind === "hub" ? "#ffffff" : "#d8f0c8"} roughness={1} />
      </mesh>
      <MapProps props={map.props} lowDetail={quality === "low"} />
      <Markers map={map} />
      {map.kind === "hub" && <Ambient map={map} />}
      <LocalPlayer map={map} />
      <Remotes />
    </>
  );
}

// ?debug=1 exposes client-only camera/player state for screenshots and QA (the server still validates movement).
if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug")) {
  (window as unknown as { __boju: unknown }).__boju = { local, cam };
}

export default function Scene({ map }: { map: GameMap }) {
  const quality = useGame((s) => s.quality);
  const dpr: [number, number] = quality === "low" ? [0.6, 1] : quality === "medium" ? [1, 1.5] : [1, 2];
  return (
    <Canvas
      shadows={quality === "high" ? "soft" : quality === "medium"}
      dpr={dpr}
      camera={{ fov: 60, near: 0.1, far: 260, position: [0, 5, 10] }}
      gl={{ antialias: quality !== "low", powerPreference: "high-performance", preserveDrawingBuffer: true }}
    >
      <World key={map.id} map={map} />
    </Canvas>
  );
}
