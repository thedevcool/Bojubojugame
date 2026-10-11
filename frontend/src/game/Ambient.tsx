"use client";

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useGame } from "@/lib/store";
import type { GameMap } from "@/lib/types";
import { BOTTOMS, SKIN, TOPS } from "./palette";
import { Vehicle } from "./props";
import { local, serverNow } from "./state";

/**
 * Ambient street life for the hub: pedestrians, vendors and traffic.
 * Positions are a pure function of server time, so every player sees the
 * same crowd without any network traffic. Pedestrians are GPU-instanced:
 * the whole crowd is ~6 draw calls.
 */

const GREETINGS = ["E kaaro o!", "How far?", "Wetin dey happen?", "No wahala!", "Boju Boju later?", "Ẹ n lẹ o!", "Na wa o, this sun!", "My guy!", "Ah, you don show!"];
const VIEW = 65;

interface Walker { path: [number, number][]; lens: number[]; total: number; speed: number; offset: number; lateral: number; say: string; colors: [number, number, number]; vendor?: { x: number; z: number; ry: number } }

function build(map: GameMap, density: number): Walker[] {
  const out: Walker[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const path of map.npc_paths ?? []) {
    const lens: number[] = [];
    let total = 0;
    for (let i = 0; i + 1 < path.pts.length; i++) {
      const l = Math.hypot(path.pts[i + 1][0] - path.pts[i][0], path.pts[i + 1][1] - path.pts[i][1]);
      lens.push(l);
      total += l;
    }
    const n = Math.max(1, Math.round(path.n * density));
    for (let k = 0; k < n; k++) {
      out.push({
        path: path.pts, lens, total,
        speed: 1.1 + rnd() * 0.6, offset: rnd() * total * 2, lateral: (rnd() - 0.5) * 1.2,
        say: GREETINGS[Math.floor(rnd() * GREETINGS.length)],
        colors: [Math.floor(rnd() * 8), Math.floor(rnd() * 8), Math.floor(rnd() * 8)],
      });
    }
  }
  for (const v of map.vendors ?? []) {
    out.push({ path: [], lens: [], total: 0, speed: 0, offset: 0, lateral: 0, say: v.say, colors: [Math.floor(rnd() * 8), Math.floor(rnd() * 8), Math.floor(rnd() * 8)], vendor: v });
  }
  return out;
}

function pose(w: Walker, t: number): { x: number; z: number; ry: number; moving: boolean } {
  if (w.vendor) return { x: w.vendor.x, z: w.vendor.z, ry: w.vendor.ry, moving: false };
  let s = (t * w.speed + w.offset) % (w.total * 2);
  const back = s > w.total;
  if (back) s = w.total * 2 - s;
  let i = 0;
  while (i < w.lens.length - 1 && s > w.lens[i]) { s -= w.lens[i]; i++; }
  const [ax, az] = w.path[i], [bx, bz] = w.path[i + 1];
  const k = w.lens[i] ? s / w.lens[i] : 0;
  const dx = (bx - ax) / (w.lens[i] || 1), dz = (bz - az) / (w.lens[i] || 1);
  const dir = back ? -1 : 1;
  return { x: ax + (bx - ax) * k - dz * w.lateral, z: az + (bz - az) * k + dx * w.lateral, ry: Math.atan2(dx * dir, dz * dir), moving: true };
}

// Body parts: [name, geometry, pivot(y), offset(y), scale, colour index source]
const box = new THREE.BoxGeometry(1, 1, 1);
const head = new THREE.SphereGeometry(0.5, 10, 8);
const hair = new THREE.SphereGeometry(0.52, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
const tmpM = new THREE.Matrix4(), rootM = new THREE.Matrix4(), partM = new THREE.Matrix4(), scaleM = new THREE.Matrix4();
const q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

function Crowd({ walkers }: { walkers: Walker[] }) {
  const n = walkers.length;
  const legs = useRef<THREE.InstancedMesh>(null), arms = useRef<THREE.InstancedMesh>(null);
  const torso = useRef<THREE.InstancedMesh>(null), heads = useRef<THREE.InstancedMesh>(null), hairs = useRef<THREE.InstancedMesh>(null);
  const [bubble, setBubble] = useState<{ x: number; z: number; text: string } | null>(null);
  const lastBubble = useRef(0);

  const setColors = (mesh: THREE.InstancedMesh | null, pick: (w: Walker) => string, per = 1) => {
    if (!mesh || mesh.instanceColor) return;
    const c = new THREE.Color();
    walkers.forEach((w, i) => { for (let k = 0; k < per; k++) mesh.setColorAt(i * per + k, c.set(pick(w))); });
    const colors = mesh.instanceColor as THREE.InstancedBufferAttribute | null;
    if (colors) colors.needsUpdate = true;
  };

  useFrame((state) => {
    const t = serverNow() / 1000;
    setColors(legs.current, (w) => BOTTOMS[w.colors[2]], 2);
    setColors(arms.current, (w) => TOPS[w.colors[1]], 2);
    setColors(torso.current, (w) => TOPS[w.colors[1]]);
    setColors(heads.current, (w) => SKIN[w.colors[0]]);
    setColors(hairs.current, () => "#15100c");
    let near: { d: number; x: number; z: number; text: string } | null = null;
    walkers.forEach((w, i) => {
      const p = pose(w, t);
      const far = Math.hypot(p.x - local.x, p.z - local.z) > VIEW;
      if (far) {
        for (const [m, per] of [[legs, 2], [arms, 2], [torso, 1], [heads, 1], [hairs, 1]] as const)
          for (let k = 0; k < per; k++) m.current?.setMatrixAt(i * per + k, HIDDEN);
        return;
      }
      const d = Math.hypot(p.x - local.x, p.z - local.z);
      if (d < 2.6 && (!near || d < near.d)) near = { d, x: p.x, z: p.z, text: w.say };
      const facePlayer = w.vendor && d < 4 ? Math.atan2(local.x - p.x, local.z - p.z) : p.ry;
      const sw = p.moving ? Math.sin(t * w.speed * 5.5 + i) * 0.55 : 0;
      const bob = p.moving ? Math.abs(Math.cos(t * w.speed * 5.5 + i)) * 0.04 : Math.sin(state.clock.elapsedTime * 1.5 + i) * 0.01;
      rootM.compose(v.set(p.x, bob, p.z), q.setFromEuler(e.set(0, facePlayer, 0)), sc.set(1, 1, 1));
      const part = (mesh: THREE.InstancedMesh | null, idx: number, px: number, py: number, rx: number, oy: number, s: [number, number, number]) => {
        if (!mesh) return;
        partM.compose(v.set(px, py, 0), q.setFromEuler(e.set(rx, 0, 0)), sc.set(1, 1, 1));
        tmpM.makeTranslation(0, oy, 0).premultiply(partM).multiply(scaleM.makeScale(...s));
        mesh.setMatrixAt(idx, tmpM.premultiply(rootM));
      };
      part(legs.current, i * 2, -0.12, 0.92, sw, -0.46, [0.17, 0.92, 0.2]);
      part(legs.current, i * 2 + 1, 0.12, 0.92, -sw, -0.46, [0.17, 0.92, 0.2]);
      part(arms.current, i * 2, -0.29, 1.47, -sw * 0.8, -0.32, [0.12, 0.64, 0.13]);
      part(arms.current, i * 2 + 1, 0.29, 1.47, sw * 0.8, -0.32, [0.12, 0.64, 0.13]);
      part(torso.current, i, 0, 1.22, 0, 0, [0.44, 0.62, 0.26]);
      part(heads.current, i, 0, 1.78, 0, 0, [0.27, 0.32, 0.29]);
      part(hairs.current, i, 0, 1.81, 0, 0, [0.29, 0.31, 0.31]);
    });
    for (const m of [legs, arms, torso, heads, hairs]) if (m.current) m.current.instanceMatrix.needsUpdate = true;
    const now = state.clock.elapsedTime;
    if (now - lastBubble.current > 0.25) {
      lastBubble.current = now;
      const nb = near as { x: number; z: number; text: string } | null;
      if ((nb?.text ?? null) !== (bubble?.text ?? null) || (nb && bubble && Math.hypot(nb.x - bubble.x, nb.z - bubble.z) > 0.5)) setBubble(nb ? { x: nb.x, z: nb.z, text: nb.text } : null);
    }
  });

  const material = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.85 }), []);
  return (
    <>
      <instancedMesh ref={legs} args={[box, material, n * 2]} castShadow frustumCulled={false} />
      <instancedMesh ref={arms} args={[box, material, n * 2]} castShadow frustumCulled={false} />
      <instancedMesh ref={torso} args={[box, material, n]} castShadow frustumCulled={false} />
      <instancedMesh ref={heads} args={[head, material, n]} castShadow frustumCulled={false} />
      <instancedMesh ref={hairs} args={[hair, material, n]} frustumCulled={false} />
      {bubble && (
        <Html position={[bubble.x, 2.4, bubble.z]} center distanceFactor={9} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
          <div className="whitespace-nowrap rounded-xl bg-white px-2 py-1 text-xs font-bold text-black shadow">{bubble.text}</div>
        </Html>
      )}
    </>
  );
}

interface Car { kind: string; ax: number; az: number; dx: number; dz: number; len: number; speed: number; offset: number; color: string }
const CAR_COLORS = ["#8a8f96", "#a23b3b", "#22313f", "#f3efe6", "#2f6db5", "#1d1a16"];

function Traffic({ cars }: { cars: Car[] }) {
  const refs = useRef<(THREE.Group | null)[]>([]);
  useFrame(() => {
    const t = serverNow() / 1000;
    cars.forEach((c, i) => {
      const g = refs.current[i];
      if (!g) return;
      const s = (t * c.speed + c.offset) % c.len;
      g.position.set(c.ax + c.dx * s, 0, c.az + c.dz * s);
      g.rotation.y = Math.atan2(c.dx, c.dz);
      g.visible = Math.hypot(g.position.x - local.x, g.position.z - local.z) < VIEW + 20;
    });
  });
  return (
    <>
      {cars.map((c, i) => (
        <group key={i} ref={(el) => { refs.current[i] = el; }}>
          {c.kind === "danfo" ? <Vehicle kind="danfo" w={2.4} d={6} h={2.6} /> : c.kind === "keke" ? <Vehicle kind="keke" w={1.4} d={2.4} h={1.8} /> : <Vehicle kind="car" w={2} d={4.2} h={1.5} color={c.color} />}
        </group>
      ))}
    </>
  );
}

export default function Ambient({ map }: { map: GameMap }) {
  const quality = useGame((s) => s.quality);
  const density = quality === "low" ? 0.5 : quality === "medium" ? 1 : 1.6;
  const walkers = useMemo(() => build(map, density), [map, density]);
  const cars = useMemo(() => {
    const out: Car[] = [];
    const maxCars = quality === "low" ? 4 : quality === "medium" ? 7 : 12;
    (map.vehicles ?? []).forEach((v, vi) => {
      const [[ax, az], [bx, bz]] = v.pts;
      const len = Math.hypot(bx - ax, bz - az);
      for (let k = 0; k < v.n; k++)
        out.push({ kind: v.kind, ax, az, dx: (bx - ax) / len, dz: (bz - az) / len, len, speed: v.speed, offset: (len / v.n) * k + vi * 13, color: CAR_COLORS[(vi + k) % CAR_COLORS.length] });
    });
    return out.slice(0, maxCars);
  }, [map, quality]);
  if (!walkers.length && !cars.length) return null;
  return (
    <>
      {walkers.length > 0 && <Crowd key={walkers.length} walkers={walkers} />}
      <Traffic cars={cars} />
    </>
  );
}
