"use client";

import { useFrame } from "@react-three/fiber";
import { useRef, useState, useSyncExternalStore } from "react";
import * as THREE from "three";
import { useGame } from "@/lib/store";
import type { FurnitureSpec, Home } from "@/lib/types";
import { furn, furnitureVersion, subscribeFurniture, toWorld, worldRotY } from "./furniture";
import { mat } from "./props";
import { local } from "./state";

const box = new THREE.BoxGeometry(1, 1, 1);
const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
const ball = new THREE.IcosahedronGeometry(0.5, 1);
type V3 = [number, number, number];

function B({ p, s, c, geo = box, r }: { p: V3; s: V3; c: string | THREE.Material; geo?: THREE.BufferGeometry; r?: V3 }) {
  return <mesh geometry={geo} material={typeof c === "string" ? mat(c) : c} position={p} scale={s} rotation={r} castShadow receiveShadow />;
}

const WOOD = "#7a4e2d", DARK = "#3b2414", FABRIC = "#3f5d7a", WHITE = "#f4f1ea";

function Blades({ w, y, spin }: { w: number; y: number; spin: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => { if (ref.current) ref.current.rotation.y += dt * spin; });
  return (
    <group ref={ref} position={[0, y, 0]}>
      {[0, 1, 2].map((i) => <B key={i} p={[0, 0, 0]} s={[w, 0.02, 0.14]} c="#efefef" r={[0, (i * Math.PI) / 3, 0]} />)}
      <B p={[0, 0, 0]} s={[0.18, 0.08, 0.18]} c="#d6d6d6" geo={cyl} />
    </group>
  );
}

/** One furniture item in its own frame: footprint w × d centred on the origin, front facing +z. */
export function FurnitureMesh({ s, ceiling = 3.2 }: { s: FurnitureSpec; ceiling?: number }) {
  const { w, d, h } = s;
  switch (s.id) {
    case "bed":
    case "bed_king": {
      const duvet = s.id === "bed_king" ? "#7b2d43" : "#2f6db5";
      return (
        <>
          <B p={[0, 0.17, 0]} s={[w, 0.26, d]} c={s.id === "bed_king" ? DARK : WOOD} />
          <B p={[0, h - 0.12, 0.02]} s={[w * 0.96, 0.2, d * 0.95]} c={WHITE} />
          <B p={[0, h - 0.0, d * 0.14]} s={[w * 0.97, 0.06, d * 0.66]} c={duvet} />
          <B p={[0, h + 0.02, d * 0.46]} s={[w * 0.97, 0.05, 0.12]} c={duvet} />
          {[-w * 0.24, w * 0.24].map((x) => <B key={x} p={[x, h + 0.06, -d * 0.36]} s={[w * 0.4, 0.13, 0.36]} c="#ffffff" />)}
          <B p={[0, 0.6, -d / 2 + 0.05]} s={[w + 0.06, 1.0, 0.1]} c={s.id === "bed_king" ? "#2a1a10" : DARK} />
        </>
      );
    }
    case "wardrobe":
      return (
        <>
          <B p={[0, h / 2, 0]} s={[w, h, d]} c={WOOD} />
          <B p={[0, h / 2, d / 2 + 0.005]} s={[0.025, h * 0.92, 0.01]} c={DARK} />
          {[-0.08, 0.08].map((x) => <B key={x} p={[x, h * 0.52, d / 2 + 0.03]} s={[0.03, 0.22, 0.03]} c="#c9a227" />)}
          <B p={[0, h + 0.03, 0]} s={[w + 0.06, 0.06, d + 0.06]} c={DARK} />
        </>
      );
    case "bookshelf":
      return (
        <>
          <B p={[-w / 2 + 0.03, h / 2, 0]} s={[0.05, h, d]} c={WOOD} />
          <B p={[w / 2 - 0.03, h / 2, 0]} s={[0.05, h, d]} c={WOOD} />
          <B p={[0, h / 2, -d / 2 + 0.02]} s={[w, h, 0.03]} c={DARK} />
          {[0.05, 0.5, 0.95, 1.4, h - 0.03].map((y) => <B key={y} p={[0, y, 0]} s={[w, 0.04, d]} c={WOOD} />)}
          {[0.07, 0.52, 0.97].map((y, row) =>
            [-0.32, -0.18, -0.05, 0.12, 0.27].map((x, i) => (
              <B key={`${row}${i}`} p={[x, y + 0.17, 0.02]} s={[0.1, 0.3 - ((i + row) % 3) * 0.04, d * 0.75]} c={["#b23a48", "#2f6db5", "#e0a72e", "#3a8f5c", "#6b3fa0"][(i + row) % 5]} />
            )),
          )}
        </>
      );
    case "sofa":
    case "armchair": {
      const seats = s.id === "sofa" ? 3 : 1;
      const arm = 0.18;
      const inner = w - arm * 2;
      return (
        <>
          <B p={[0, 0.2, 0]} s={[w, 0.28, d]} c={FABRIC} />
          {Array.from({ length: seats }, (_, i) => (
            <B key={i} p={[-inner / 2 + (inner / seats) * (i + 0.5), 0.4, 0.06]} s={[inner / seats - 0.04, 0.14, d - 0.3]} c="#4a6d8f" />
          ))}
          <B p={[0, 0.6, -d / 2 + 0.13]} s={[w, 0.62, 0.26]} c={FABRIC} />
          {[-1, 1].map((sx) => <B key={sx} p={[sx * (w / 2 - arm / 2), 0.42, 0]} s={[arm, 0.42, d]} c={FABRIC} />)}
          {seats === 3 && [-0.6, 0.6].map((x) => <B key={x} p={[x, 0.62, -d / 2 + 0.32]} s={[0.36, 0.3, 0.12]} c="#e0a72e" r={[-0.2, 0, 0]} />)}
        </>
      );
    }
    case "tv":
      return (
        <>
          <B p={[0, 0.25, 0]} s={[w, 0.5, d]} c={DARK} />
          <B p={[0, 0.25, d / 2 + 0.005]} s={[w * 0.9, 0.36, 0.01]} c="#2a1a10" />
          <B p={[0, 0.53, -0.05]} s={[0.25, 0.04, 0.18]} c="#111111" />
          <B p={[0, 0.92, -0.05]} s={[w * 0.92, 0.6, 0.05]} c="#0d0d0d" />
          <mesh geometry={box} material={mat("#3a6ea5", { emissive: true })} position={[0, 0.92, -0.02]} scale={[w * 0.86, 0.53, 0.01]} />
        </>
      );
    case "center_table":
      return (
        <>
          <B p={[0, h, 0]} s={[w, 0.04, d]} c={mat("#bfe3ff", { transparent: 0.55, rough: 0.1 })} />
          <B p={[0, h * 0.35, 0]} s={[w * 0.85, 0.03, d * 0.85]} c={WOOD} />
          {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => <B key={`${sx}${sz}`} p={[sx * (w / 2 - 0.05), h / 2, sz * (d / 2 - 0.05)]} s={[0.04, h, 0.04]} c={DARK} />)}
          <B p={[0.15, h + 0.05, 0]} s={[0.12, 0.06, 0.12]} c="#d94f3d" geo={cyl} />
        </>
      );
    case "dining":
      return (
        <>
          <B p={[0, 0.76, 0]} s={[1.1, 0.05, 0.8]} c={WOOD} />
          {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => <B key={`${sx}${sz}`} p={[sx * 0.48, 0.38, sz * 0.33]} s={[0.06, 0.76, 0.06]} c={DARK} />)}
          {[[0, -0.62, 0], [0, 0.62, Math.PI], [-0.7, 0, Math.PI / 2], [0.7, 0, -Math.PI / 2]].map(([x, z, ry]) => (
            <group key={`${x}${z}`} position={[x, 0, z]} rotation={[0, ry, 0]}>
              <B p={[0, 0.45, 0]} s={[0.42, 0.05, 0.42]} c={WOOD} />
              <B p={[0, 0.72, -0.19]} s={[0.42, 0.5, 0.04]} c={WOOD} />
              {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => <B key={`${sx}${sz}`} p={[sx * 0.18, 0.22, sz * 0.18]} s={[0.04, 0.45, 0.04]} c={DARK} />)}
            </group>
          ))}
        </>
      );
    case "fridge":
      return (
        <>
          <B p={[0, h / 2, 0]} s={[w, h, d]} c={mat("#e8ecef", { rough: 0.35 })} />
          <B p={[0, h * 0.62, d / 2 + 0.005]} s={[w * 0.98, 0.015, 0.01]} c="#9aa3ad" />
          <B p={[w / 2 - 0.08, h * 0.8, d / 2 + 0.03]} s={[0.03, 0.3, 0.03]} c="#9aa3ad" />
          <B p={[w / 2 - 0.08, h * 0.4, d / 2 + 0.03]} s={[0.03, 0.4, 0.03]} c="#9aa3ad" />
        </>
      );
    case "cooker":
      return (
        <>
          <B p={[0, h / 2, 0]} s={[w, h, d]} c={mat("#d9dcdf", { rough: 0.4 })} />
          <B p={[0, h + 0.01, 0]} s={[w * 0.96, 0.02, d * 0.96]} c="#1d1d1d" />
          {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => <B key={`${sx}${sz}`} p={[sx * w * 0.22, h + 0.03, sz * d * 0.22]} s={[0.14, 0.02, 0.14]} c="#3a3a3a" geo={cyl} />)}
          <B p={[0, h * 0.45, d / 2 + 0.005]} s={[w * 0.8, h * 0.5, 0.01]} c="#2b2b2b" />
          <B p={[0, h * 0.74, d / 2 + 0.03]} s={[w * 0.6, 0.03, 0.03]} c="#9aa3ad" />
        </>
      );
    case "plant":
      return (
        <>
          <B p={[0, 0.18, 0]} s={[w * 0.75, 0.36, d * 0.75]} c="#b5651d" geo={cyl} />
          <mesh geometry={ball} material={mat("#2f7d32")} position={[0, 0.7, 0]} scale={[w * 1.1, 0.8, d * 1.1]} castShadow />
          <mesh geometry={ball} material={mat("#3a9d3f")} position={[0.08, 1.0, -0.04]} scale={[w * 0.8, 0.5, d * 0.8]} castShadow />
        </>
      );
    case "rug":
      return (
        <>
          <B p={[0, 0.065, 0]} s={[w, 0.012, d]} c="#8e2b2b" />
          <B p={[0, 0.072, 0]} s={[w * 0.82, 0.006, d * 0.74]} c="#d9a441" />
          <B p={[0, 0.076, 0]} s={[w * 0.62, 0.006, d * 0.5]} c="#1f3d6b" />
        </>
      );
    case "ceiling_fan":
      return (
        <group>
          <B p={[0, ceiling - 0.2, 0]} s={[0.04, 0.4, 0.04]} c="#dddddd" geo={cyl} />
          <Blades w={w} y={ceiling - 0.42} spin={9} />
        </group>
      );
    case "standing_fan":
      return (
        <>
          <B p={[0, 0.03, 0]} s={[w, 0.05, d]} c="#e5e5e5" geo={cyl} />
          <B p={[0, 0.6, 0]} s={[0.04, 1.15, 0.04]} c="#cfcfcf" geo={cyl} />
          <B p={[0, h - 0.12, -0.05]} s={[0.36, 0.36, 0.1]} c={mat("#f2f2f2", { transparent: 0.5 })} geo={cyl} r={[Math.PI / 2, 0, 0]} />
          <group rotation={[Math.PI / 2, 0, 0]} position={[0, h - 0.12, 0]}><Blades w={0.3} y={0} spin={14} /></group>
        </>
      );
    default:
      return <B p={[0, h / 2, 0]} s={[w, h, d]} c="#aaaaaa" />;
  }
}

/** Every house's furniture, drawn only for houses near you (interiors are hidden from far away). */
export function FurnitureLayer({ homes, skip }: { homes: Home[]; skip?: string | null }) {
  useSyncExternalStore(subscribeFurniture, furnitureVersion, furnitureVersion);
  const [near, setNear] = useState<string[]>([]);
  const acc = useRef(0);
  useFrame((_, dt) => {
    if ((acc.current += dt) < 0.4) return;
    acc.current = 0;
    const ids = homes.filter((h) => h.id === local.insideHome || Math.hypot(h.center[0] - local.x, h.center[1] - local.z) < 16).map((h) => h.id);
    if (ids.join() !== near.join()) setNear(ids);
  });
  const decorating = useGame((s) => s.decor?.home ?? null);
  return (
    <>
      {near.filter((id) => id !== skip && id !== decorating).map((id) => {
        const h = homes.find((x) => x.id === id)!;
        return (furn.homes[id] ?? []).map((it) => {
          const s = furn.catalog[it.item];
          if (!s) return null;
          const [x, z] = toWorld(h, it.lx, it.lz);
          return (
            <group key={it.id} position={[x, 0, z]} rotation={[0, worldRotY(h, it.rot), 0]}>
              <FurnitureMesh s={s} />
            </group>
          );
        });
      })}
    </>
  );
}
