"use client";

import { Html } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { net } from "@/lib/net";
import { useGame } from "@/lib/store";
import type { GameMap, RosterEntry } from "@/lib/types";
import { BOTTOMS, SKIN, TOPS } from "./palette";
import { resolveCollision } from "./physics";
import { mat, MapProps } from "./props";
import { cam, input, local, sample } from "./state";

const box = new THREE.BoxGeometry(1, 1, 1);
const head = new THREE.IcosahedronGeometry(0.5, 1);

function Avatar({ av, label, me }: { av: number[]; label?: string; me?: boolean }) {
  const [s, t, b] = av;
  return (
    <group>
      <mesh geometry={box} material={mat(BOTTOMS[b % 8])} position={[-0.13, 0.42, 0]} scale={[0.2, 0.84, 0.24]} castShadow />
      <mesh geometry={box} material={mat(BOTTOMS[b % 8])} position={[0.13, 0.42, 0]} scale={[0.2, 0.84, 0.24]} castShadow />
      <mesh geometry={box} material={mat(TOPS[t % 8])} position={[0, 1.1, 0]} scale={[0.56, 0.6, 0.3]} castShadow />
      <mesh geometry={box} material={mat(SKIN[s % 8])} position={[-0.36, 1.08, 0]} scale={[0.14, 0.55, 0.16]} castShadow />
      <mesh geometry={box} material={mat(SKIN[s % 8])} position={[0.36, 1.08, 0]} scale={[0.14, 0.55, 0.16]} castShadow />
      <mesh geometry={head} material={mat(SKIN[s % 8])} position={[0, 1.58, 0]} scale={0.36} castShadow />
      <mesh geometry={box} material={mat("#1d1a16")} position={[0, 1.6, 0.17]} scale={[0.2, 0.05, 0.04]} />
      {me && <mesh geometry={box} material={mat("#f7c500", { emissive: true })} position={[0, 2.05, 0]} scale={[0.14, 0.14, 0.14]} rotation={[0.6, 0.6, 0]} />}
      {label && (
        <Html position={[0, 2.15, 0]} center distanceFactor={10} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
          <div className="whitespace-nowrap rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold text-white">{label}</div>
        </Html>
      )}
    </group>
  );
}

const SEND_HZ = 12;

function LocalPlayer({ map }: { map: GameMap }) {
  const group = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const last = useRef({ sent: 0, x: NaN, z: NaN, c: false });
  const cfg = useGame((s) => s.content?.config.movement);
  const me = useGame((s) => s.me);
  const av = useGame((s) => (s.me ? Object.values(s.roster).find((r) => r.id === s.me?.id)?.av : undefined));
  const { camera } = useThree();
  const tmp = useMemo(() => new THREE.Vector3(), []);

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
    if (moving) {
      const speed = local.crouch ? cfg.crouch_speed : local.run ? cfg.run_speed : cfg.walk_speed;
      const ang = -Math.atan2(ix, iy) + cam.yaw + Math.PI;
      const vx = Math.sin(ang) * speed * mag, vz = Math.cos(ang) * speed * mag;
      const [nx, nz] = resolveCollision(map, local.x + vx * dt, local.z + vz * dt, cfg.player_radius);
      local.x = nx;
      local.z = nz;
      local.ry = Math.atan2(vx, vz);
    }
    // ---- render
    group.current.position.set(local.x, 0, local.z);
    group.current.rotation.y = local.ry;
    if (inner.current) {
      inner.current.scale.y = local.crouch ? 0.55 : 1;
      inner.current.position.y = moving ? Math.abs(Math.sin(state.clock.elapsedTime * (local.run ? 14 : 9))) * 0.06 : 0;
    }
    // ---- camera (third person)
    const dist = cam.dist;
    tmp.set(local.x + Math.sin(cam.yaw) * dist * Math.cos(cam.pitch), 1.4 + Math.sin(cam.pitch) * dist, local.z + Math.cos(cam.yaw) * dist * Math.cos(cam.pitch));
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
      <group ref={inner}>
        <Avatar av={av ?? [0, 0, 0]} me={!!me} />
      </group>
    </group>
  );
}

function RemotePlayer({ r }: { r: RosterEntry }) {
  const group = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const emote = useGame((s) => s.emotes.find((e) => e.n === r.n && e.until > Date.now()));
  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const snap = sample(r.n);
    if (!snap) { g.visible = false; return; }
    g.visible = true;
    const moved = Math.hypot(g.position.x - snap.x, g.position.z - snap.z) > 0.01;
    g.position.set(snap.x, 0, snap.z);
    g.rotation.y = snap.ry;
    if (inner.current) {
      inner.current.scale.y = snap.f & 1 ? 0.55 : 1;
      inner.current.position.y = moved ? Math.abs(Math.sin(state.clock.elapsedTime * 9)) * 0.06 : 0;
    }
  });
  return (
    <group ref={group} visible={false}>
      <group ref={inner}>
        <Avatar av={r.av} label={emote ? `${r.nick}: ${emote.text}` : r.nick} />
      </group>
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
        <mesh key={i} position={[(m.rect[0] + m.rect[2]) / 2, 0.06, (m.rect[1] + m.rect[3]) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[m.rect[2] - m.rect[0], m.rect[3] - m.rect[1]]} />
          <meshBasicMaterial color={m.color} transparent opacity={0.35} />
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

function World({ map }: { map: GameMap }) {
  const quality = useGame((s) => s.quality);
  const b = map.bounds;
  const cx = (b[0] + b[2]) / 2, cz = (b[1] + b[3]) / 2;
  const w = b[2] - b[0] + 40, d = b[3] - b[1] + 40;
  const shadows = quality === "high";
  const fogFar = quality === "low" ? 55 : quality === "medium" ? 80 : 120;
  return (
    <>
      <color attach="background" args={["#bfe3f5"]} />
      <fog attach="fog" args={["#bfe3f5", fogFar * 0.4, fogFar]} />
      <hemisphereLight args={["#fff6e0", "#5b4a33", 0.9]} />
      <directionalLight
        position={[30, 50, 20]}
        intensity={1.6}
        castShadow={shadows}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0, cz]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color={map.ground} roughness={1} />
      </mesh>
      <MapProps props={map.props} lowDetail={quality === "low"} />
      <Markers map={map} />
      <LocalPlayer map={map} />
      <Remotes />
    </>
  );
}

export default function Scene({ map }: { map: GameMap }) {
  const quality = useGame((s) => s.quality);
  const dpr: [number, number] = quality === "low" ? [0.6, 1] : quality === "medium" ? [1, 1.5] : [1, 2];
  return (
    <Canvas
      shadows={quality === "high"}
      dpr={dpr}
      camera={{ fov: 60, near: 0.1, far: 200, position: [0, 5, 10] }}
      gl={{ antialias: quality !== "low", powerPreference: "high-performance", preserveDrawingBuffer: true }}
    >
      <World key={map.id} map={map} />
    </Canvas>
  );
}
