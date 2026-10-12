"use client";

import { useFrame } from "@react-three/fiber";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Prop } from "@/lib/types";
import { useGame } from "@/lib/store";
import { local } from "./state";
import { asphalt, concrete, grass, plaster, sand, tiles, zinc } from "./textures";

/** Modular Lagos kit: every prop kind is assembled from shared primitives. */

const box = new THREE.BoxGeometry(1, 1, 1);
const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
const cone = new THREE.ConeGeometry(0.5, 1, 4);
const sphere = new THREE.IcosahedronGeometry(0.5, 1);
const roofGeo = (() => {
  const g = new THREE.CylinderGeometry(0.0, 0.72, 1, 4, 1);
  g.rotateY(Math.PI / 4);
  return g;
})();

type MatOpts = { emissive?: boolean; transparent?: number; map?: THREE.Texture; rough?: number; tile?: number };
const matCache = new Map<string, THREE.MeshStandardMaterial>();
export function mat(color: string, opts: MatOpts = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${opts.emissive ? 1 : 0}|${opts.transparent ?? 1}|${opts.map?.uuid ?? ""}|${opts.rough ?? 0.85}|${opts.tile ?? 0}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.rough ?? 0.85,
      metalness: 0.03,
      transparent: opts.transparent !== undefined && opts.transparent < 1,
      opacity: opts.transparent ?? 1,
      ...(opts.map ? { map: opts.map } : {}),
      ...(opts.emissive ? { emissive: new THREE.Color(color), emissiveIntensity: 0.6 } : {}),
    });
    // Batched static meshes get world-space UVs: ``tile`` = metres per texture repeat.
    if (opts.tile) m.userData.tile = opts.tile;
    matCache.set(key, m);
  }
  return m;
}
const wallMat = (c: string) => mat(c, { map: plaster(), tile: 2.5 });

/** Box-projected UVs in world space so textures keep real-world scale on any size of prop. */
function worldUV(g: THREE.BufferGeometry, tile: number): void {
  const p = g.attributes.position, n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const [u, v] = ay >= ax && ay >= az ? [x, z] : ax >= az ? [z, y] : [x, y];
    uv[i * 2] = u / tile;
    uv[i * 2 + 1] = v / tile;
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

const texCache = new Map<string, THREE.CanvasTexture>();
function textTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
  const key = `${text}|${bg}|${fg}`;
  let t = texCache.get(key);
  if (t) return t;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = fg;
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 500, 116);
  ctx.fillStyle = fg;
  ctx.font = "900 54px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text.slice(0, 26), 256, 66, 480);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}
const labelMats = new Map<string, THREE.MeshBasicMaterial>();
function labelMat(text: string, bg: string, fg: string) {
  const k = `${text}|${bg}|${fg}`;
  let m = labelMats.get(k);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ map: textTexture(text, bg, fg), side: THREE.DoubleSide, toneMapped: false });
    labelMats.set(k, m);
  }
  return m;
}
const plane = new THREE.PlaneGeometry(1, 1);

type V3 = [number, number, number];
function B({ p, s, c, geo = box, shadow = true, r }: { p: V3; s: V3; c: string | THREE.Material; geo?: THREE.BufferGeometry; shadow?: boolean; r?: V3 }) {
  return <mesh geometry={geo} material={typeof c === "string" ? mat(c) : c} position={p} scale={s} rotation={r} castShadow={shadow} receiveShadow />;
}
function Label({ text, y, w, z = 0, bg = "#f7c500", fg = "#1d1a16", ry = 0 }: { text: string; y: number; w: number; z?: number; bg?: string; fg?: string; ry?: number }) {
  return <mesh geometry={plane} material={labelMat(text, bg, fg)} position={[0, y, z]} rotation={[0, ry, 0]} scale={[w, w / 4, 1]} />;
}

const WINDOW = "#2b4a63";
const BARS = "#2a2a2a";

function Windows({ w, d, h, floors }: { w: number; d: number; h: number; floors: number }) {
  const fh = h / floors;
  const out = [];
  const n = Math.max(1, Math.floor(w / 2.6));
  for (let f = 0; f < floors; f++) {
    const y = f * fh + fh * 0.55;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (w / n) * (i + 0.5);
      if (f === 0 && Math.abs(x) < 0.9) continue; // door
      for (const side of [1, -1]) {
        out.push(<B key={`${f}${i}${side}`} p={[x, y, (side * d) / 2 + side * 0.03]} s={[1.1, fh * 0.38, 0.05]} c={WINDOW} shadow={false} />);
        out.push(<B key={`b${f}${i}${side}`} p={[x, y, (side * d) / 2 + side * 0.06]} s={[1.15, 0.05, 0.03]} c={BARS} shadow={false} />);
        out.push(<B key={`f${f}${i}${side}`} p={[x, y - fh * 0.21, (side * d) / 2 + side * 0.08]} s={[1.3, 0.08, 0.12]} c="#e8e2d6" shadow={false} />);
      }
    }
  }
  return <>{out}</>;
}

/**
 * House wall: plaster in the house colour, a darker painted band at the foot
 * (rain splash), and on outside walls louvre windows with burglar-proof bars.
 */
function HouseWall({ p }: { p: Prop }) {
  const along = p.w >= p.d; // wall runs along x
  const len = along ? p.w : p.d, thick = along ? p.d : p.w;
  const color = p.color ?? "#e7d1a1";
  const n = p.win ? Math.floor(len / 2.4) : 0;
  const ry = along ? 0 : Math.PI / 2;
  const items = [];
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + (len / n) * (i + 0.5);
    for (const side of [1, -1]) {
      const z = side * (thick / 2 + 0.01);
      items.push(
        <group key={`${i}${side}`} position={[x, 0, z]}>
          <B p={[0, 1.55, 0]} s={[1.12, 1.12, 0.03]} c="#f7f4ee" shadow={false} />
          <B p={[0, 1.55, side * 0.01]} s={[1.0, 1.0, 0.02]} c={mat("#3d5d73", { rough: 0.2 })} shadow={false} />
          {[0.3, 0.55, 0.8, 1.05, 1.3].map((k) => <B key={k} p={[0, 1.05 + k * 0.8, side * 0.025]} s={[0.98, 0.025, 0.012]} c="#86a3b5" shadow={false} />)}
          {side === 1 && [-0.4, -0.2, 0, 0.2, 0.4].map((bx) => <B key={bx} p={[bx, 1.55, 0.05]} s={[0.025, 1.08, 0.025]} c="#22262a" shadow={false} />)}
          {side === 1 && <B p={[0, 0.98, 0.06]} s={[1.25, 0.06, 0.1]} c="#e8e2d6" shadow={false} />}
        </group>,
      );
    }
  }
  return (
    <group rotation={[0, ry, 0]}>
      <B p={[0, p.h / 2, 0]} s={[len, p.h, thick]} c={wallMat(color)} />
      {p.win && <B p={[0, 0.22, 0]} s={[len + 0.01, 0.44, thick + 0.02]} c={wallMat("#8a6f55")} shadow={false} />}
      {p.inner && <B p={[0, 0.06, 0]} s={[len + 0.01, 0.12, thick + 0.02]} c="#6b5a48" shadow={false} />}
      {items}
    </group>
  );
}

function Building({ p, floors }: { p: Prop; floors: number }) {
  const color = p.color ?? "#e7d1a1";
  return (
    <>
      <B p={[0, p.h / 2, 0]} s={[p.w, p.h, p.d]} c={wallMat(color)} />
      <B p={[0, 0.25, 0]} s={[p.w + 0.1, 0.5, p.d + 0.1]} c="#8f8a80" shadow={false} />
      <Windows w={p.w} d={p.d} h={p.h} floors={floors} />
      <B p={[0, 1.05, p.d / 2 + 0.04]} s={[1.1, 2.1, 0.08]} c="#5b3a22" shadow={false} />
      {p.kind === "house" ? (
        <mesh geometry={roofGeo} material={mat("#9aa0a6", { map: zinc(), tile: 2 })} position={[0, p.h + 0.9, 0]} scale={[p.w * 1.08, 1.8, p.d * 1.08]} castShadow />
      ) : (
        <>
          <B p={[0, p.h + 0.3, 0]} s={[p.w + 0.3, 0.6, p.d + 0.3]} c={wallMat("#d8d2c6")} />
          <mesh geometry={cyl} material={mat("#1d1a16")} position={[p.w / 2 - 1.2, p.h + 1.3, -p.d / 4]} scale={[1.3, 1.5, 1.3]} castShadow />
        </>
      )}
      {p.kind === "duplex" && <B p={[0, p.h * 0.5, p.d / 2 + 0.6]} s={[p.w * 0.6, 0.2, 1.2]} c="#cfd6dd" />}
      {p.text && <group position={[0, 0, p.d / 2 + 0.12]}><Label text={p.text} y={p.h * 0.85} w={Math.min(p.w * 0.9, 6)} /></group>}
    </>
  );
}

function Vehicle({ kind, w, d, h, color }: { kind: string; w: number; d: number; h: number; color?: string }) {
  const along = d >= w;
  const L = Math.max(w, d), W = Math.min(w, d);
  const body = kind === "danfo" ? "#f2b705" : kind === "keke" ? "#f2b705" : (color ?? "#8a8f96");
  const glossy = mat(body, { rough: 0.35 });
  const inner = (
    <>
      <B p={[0, h * 0.42, 0]} s={[W, h * 0.55, L]} c={glossy} />
      {kind === "danfo" && (
        <>
          <B p={[0, h * 0.35, 0]} s={[W + 0.02, 0.14, L * 0.98]} c="#1d1a16" shadow={false} />
          <B p={[0, h * 0.55, 0]} s={[W + 0.02, 0.1, L * 0.98]} c="#1d1a16" shadow={false} />
          <B p={[0, h * 0.85, -L * 0.04]} s={[W * 0.98, h * 0.32, L * 0.88]} c={glossy} />
          <B p={[0, h * 0.86, -L * 0.04]} s={[W + 0.02, h * 0.2, L * 0.76]} c={WINDOW} shadow={false} />
          <B p={[0, h * 1.05, -L * 0.1]} s={[W * 0.8, 0.12, L * 0.5]} c="#3a3a3a" />
        </>
      )}
      {kind === "car" && (
        <>
          <B p={[0, h * 0.85, -L * 0.05]} s={[W * 0.88, h * 0.32, L * 0.52]} c={glossy} />
          <B p={[0, h * 0.86, -L * 0.05]} s={[W * 0.9, h * 0.24, L * 0.5]} c={WINDOW} shadow={false} />
        </>
      )}
      {kind === "keke" && (
        <>
          <B p={[0, h * 0.95, -0.1]} s={[W * 1.05, 0.08, L * 0.85]} c="#1d1a16" />
          <B p={[0, h * 0.7, L * 0.4]} s={[W * 0.8, h * 0.4, 0.05]} c={WINDOW} shadow={false} />
        </>
      )}
      <B p={[-W * 0.3, h * 0.4, L / 2 + 0.01]} s={[0.25, 0.12, 0.03]} c={mat("#fff6c8", { emissive: true })} shadow={false} />
      <B p={[W * 0.3, h * 0.4, L / 2 + 0.01]} s={[0.25, 0.12, 0.03]} c={mat("#fff6c8", { emissive: true })} shadow={false} />
      <B p={[-W * 0.3, h * 0.4, -L / 2 - 0.01]} s={[0.22, 0.1, 0.03]} c="#b3261e" shadow={false} />
      <B p={[W * 0.3, h * 0.4, -L / 2 - 0.01]} s={[0.22, 0.1, 0.03]} c="#b3261e" shadow={false} />
      {(kind === "keke" ? [[0, 1], [-1, -1], [1, -1]] : [[-1, 1], [1, 1], [-1, -1], [1, -1]]).map(([sx, sz]) => (
        <mesh key={`${sx}${sz}`} geometry={cyl} material={mat("#151515")} position={[sx * W * 0.5, 0.32, sz * L * 0.32]} rotation={[0, 0, Math.PI / 2]} scale={[0.64, 0.26, 0.64]} castShadow />
      ))}
    </>
  );
  return along ? inner : <group rotation={[0, Math.PI / 2, 0]}>{inner}</group>;
}

function Tree({ p, palm }: { p: Prop; palm?: boolean }) {
  const trunk = p.kind === "big_tree" ? 1.6 : palm ? 0.4 : 0.6;
  if (palm) {
    return (
      <>
        <mesh geometry={cyl} material={mat("#8b6b47")} position={[0, p.h / 2, 0]} scale={[trunk, p.h, trunk]} castShadow />
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <mesh key={i} geometry={box} material={mat("#3f8f3a")} position={[Math.cos(i * 0.9) * 1.3, p.h - 0.3, Math.sin(i * 0.9) * 1.3]} rotation={[0, -i * 0.9, 0.5]} scale={[2.8, 0.06, 0.7]} castShadow />
        ))}
      </>
    );
  }
  const crown = p.kind === "big_tree" ? 9 : 4.2;
  return (
    <>
      <mesh geometry={cyl} material={mat("#6e4f33")} position={[0, p.h * 0.3, 0]} scale={[trunk, p.h * 0.6, trunk]} castShadow />
      <mesh geometry={sphere} material={mat("#3c7d33")} position={[0, p.h * 0.72, 0]} scale={[crown, crown * 0.7, crown]} castShadow />
      <mesh geometry={sphere} material={mat("#4a8f3c")} position={[crown * 0.2, p.h * 0.82, crown * 0.15]} scale={[crown * 0.7, crown * 0.5, crown * 0.7]} castShadow />
    </>
  );
}

function Road({ p }: { p: Prop }) {
  const alongX = (p.dir ?? (p.w >= p.d ? "x" : "z")) === "x";
  const L = alongX ? p.w : p.d, W = alongX ? p.d : p.w;
  const dashes = [];
  for (let s = -L / 2 + 2; s < L / 2 - 2; s += 6) dashes.push(s);
  const rot: V3 = alongX ? [0, 0, 0] : [0, Math.PI / 2, 0];
  return (
    <group rotation={rot}>
      <B p={[0, 0.01, 0]} s={[L, 0.02, W]} c={mat("#ffffff", { map: asphalt(), tile: 7 })} shadow={false} />
      {W >= 9 ? (
        <>
          <B p={[0, 0.025, -0.12]} s={[L, 0.01, 0.12]} c="#e2b007" shadow={false} />
          <B p={[0, 0.025, 0.12]} s={[L, 0.01, 0.12]} c="#e2b007" shadow={false} />
        </>
      ) : (
        dashes.map((s) => <B key={s} p={[s, 0.025, 0]} s={[2.4, 0.01, 0.14]} c="#eeeeee" shadow={false} />)
      )}
      <B p={[0, 0.025, W / 2 - 0.35]} s={[L, 0.01, 0.12]} c="#eeeeee" shadow={false} />
      <B p={[0, 0.025, -W / 2 + 0.35]} s={[L, 0.01, 0.12]} c="#eeeeee" shadow={false} />
      {/* open gutters along the edges */}
      <B p={[0, 0.005, W / 2 + 0.2]} s={[L, 0.02, 0.4]} c="#2a2722" shadow={false} />
      <B p={[0, 0.005, -W / 2 - 0.2]} s={[L, 0.02, 0.4]} c="#2a2722" shadow={false} />
    </group>
  );
}

function Zebra({ p }: { p: Prop }) {
  const alongZ = p.dir === "z";
  const stripes = [];
  const span = alongZ ? p.d : p.w;
  for (let s = -span / 2 + 0.4; s < span / 2; s += 0.9) stripes.push(s);
  return (
    <>
      {stripes.map((s) => (
        <B key={s} p={[alongZ ? 0 : s, 0.03, alongZ ? s : 0]} s={alongZ ? [p.w, 0.01, 0.45] : [0.45, 0.01, p.d]} c="#f2f2f2" shadow={false} />
      ))}
    </>
  );
}

function PropMesh({ p }: { p: Prop }) {
  const c = p.color;
  switch (p.kind) {
    case "house": case "flat": case "duplex":
      return <Building p={p} floors={p.kind === "flat" ? 3 : p.kind === "duplex" ? 2 : 1} />;
    case "shop": {
      const ry = p.face === "w" ? -Math.PI / 2 : p.face === "e" ? Math.PI / 2 : p.face === "n" ? Math.PI : 0;
      const [w, d] = p.face === "w" || p.face === "e" ? [p.d, p.w] : [p.w, p.d];
      return (
        <group rotation={[0, ry, 0]}>
          <B p={[0, p.h / 2, 0]} s={[w, p.h, d]} c={wallMat("#e9e2d0")} />
          <B p={[0, 1.15, d / 2 + 0.03]} s={[w * 0.8, 2.3, 0.05]} c="#3b3b3b" shadow={false} />
          <B p={[0, p.h + 0.15, d / 2 + 0.5]} s={[w + 0.4, 0.1, 1.2]} c={mat("#9aa0a6", { map: zinc(), tile: 2 })} />
          {p.text && <Label text={p.text} y={p.h - 0.45} w={w * 0.95} z={d / 2 + 0.06} bg={c ?? "#3d7fd9"} fg="#ffffff" />}
        </group>
      );
    }
    case "venue":
      return (
        <>
          <B p={[0, p.h / 2, 0]} s={[p.w, p.h, p.d]} c={wallMat(c ?? "#6b3fa0")} />
          <group position={[0, 0, -p.d / 2 - 0.06]} rotation={[0, Math.PI, 0]}><Label text={p.text ?? "EVENTS"} y={p.h * 0.7} w={p.w * 0.8} bg="#1d1a16" fg="#f7c500" /></group>
        </>
      );
    case "wall":
      if (p.win || p.inner) return <HouseWall p={p} />;
      return (
        <>
          <B p={[0, p.h / 2, 0]} s={[p.w, p.h, p.d]} c={wallMat(c ?? "#c9b48a")} />
          <B p={[0, p.h + 0.06, 0]} s={[p.w + 0.05, 0.12, p.d + 0.12]} c="#8f8a80" shadow={false} />
          {p.ad && (
            <group rotation={[0, p.w >= p.d ? 0 : Math.PI / 2, 0]}>
              <Label text={p.ad} y={p.h * 0.55} w={Math.min(Math.max(p.w, p.d) * 0.4, 9)} z={Math.min(p.w, p.d) / 2 + 0.03} bg="#2f6db5" fg="#ffffff" />
            </group>
          )}
        </>
      );
    case "fence":
      return <B p={[0, p.h / 2, 0]} s={[p.w, p.h, p.d]} c={wallMat(c ?? "#9aa0a6")} />;
    case "gate":
      return <B p={[0, p.h / 2, 0]} s={[p.w, p.h, p.d]} c={mat("#3a3f45", { rough: 0.5 })} />;
    case "gate_post":
      return <B p={[0, p.h / 2, 0]} s={[p.w, p.h, p.d]} c={wallMat("#d8d2c6")} />;
    case "floor":
      return <B p={[0, 0.03, 0]} s={[p.w, 0.05, p.d]} c={mat("#ffffff", { map: tiles(), tile: 1.6 })} shadow={false} />;
    case "road":
      return <Road p={p} />;
    case "zebra":
      return <Zebra p={p} />;
    case "sidewalk":
      return (
        <>
          <B p={[0, 0.06, 0]} s={[p.w, 0.12, p.d]} c={mat("#ffffff", { map: concrete(), tile: 1.5 })} shadow={false} />
        </>
      );
    case "lawn":
      return <B p={[0, 0.012, 0]} s={[p.w, 0.02, p.d]} c={mat("#ffffff", { map: grass(), tile: 6 })} shadow={false} />;
    case "lot":
      return <B p={[0, 0.012, 0]} s={[p.w, 0.02, p.d]} c={mat("#b8a68a", { map: sand(), tile: 6 })} shadow={false} />;
    case "field":
      return (
        <>
          <B p={[0, 0.012, 0]} s={[p.w, 0.02, p.d]} c={mat("#ffffff", { map: sand(), tile: 8 })} shadow={false} />
          <B p={[0, 0.025, 0]} s={[0.15, 0.01, p.d - 1]} c="#f2f2f2" shadow={false} />
          <B p={[0, 0.025, p.d / 2 - 0.5]} s={[p.w - 1, 0.01, 0.15]} c="#f2f2f2" shadow={false} />
          <B p={[0, 0.025, -p.d / 2 + 0.5]} s={[p.w - 1, 0.01, 0.15]} c="#f2f2f2" shadow={false} />
        </>
      );
    case "goal":
      return (
        <>
          <B p={[0, p.h, 0]} s={[0.12, 0.12, p.d]} c="#f2f2f2" />
          <B p={[0, p.h / 2, -p.d / 2]} s={[0.12, p.h, 0.12]} c="#f2f2f2" />
          <B p={[0, p.h / 2, p.d / 2]} s={[0.12, p.h, 0.12]} c="#f2f2f2" />
        </>
      );
    case "danfo": case "keke": case "car":
      return <Vehicle kind={p.kind} w={p.w} d={p.d} h={p.h} color={p.color} />;
    case "tree": case "big_tree":
      return <Tree p={p} />;
    case "palm":
      return <Tree p={p} palm />;
    case "hedge":
      return <B p={[0, p.h / 2, 0]} s={[p.w, p.h, p.d]} c={mat("#2f6e2c", { map: grass(), tile: 2 })} />;
    case "bench":
      return (
        <>
          <B p={[0, 0.45, 0]} s={[p.w, 0.08, p.d]} c="#8b5a2b" />
          <B p={[-p.w / 2 + 0.15, 0.22, 0]} s={[0.1, 0.45, p.d]} c="#3a3a3a" />
          <B p={[p.w / 2 - 0.15, 0.22, 0]} s={[0.1, 0.45, p.d]} c="#3a3a3a" />
        </>
      );
    case "tyres":
      return [0, 1, 2].map((i) => <mesh key={i} geometry={cyl} material={mat("#151515")} position={[0, 0.15 + i * 0.3, 0]} scale={[p.w, 0.28, p.d]} castShadow />);
    case "tank":
      // the black plastic water tank on a steel stand that every Lagos compound has
      return (
        <>
          {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => <B key={`${sx}${sz}`} p={[sx * p.w * 0.38, 0.75, sz * p.d * 0.38]} s={[0.08, 1.5, 0.08]} c="#5b5f63" />)}
          <B p={[0, 1.52, 0]} s={[p.w * 0.95, 0.06, p.d * 0.95]} c="#5b5f63" />
          <mesh geometry={cyl} material={mat("#1d1a16", { rough: 0.6 })} position={[0, 1.55 + (p.h - 1.55) / 2, 0]} scale={[p.w, p.h - 1.55, p.d]} castShadow />
          <mesh geometry={cyl} material={mat("#2a2622")} position={[0, p.h + 0.04, 0]} scale={[p.w * 0.35, 0.08, p.d * 0.35]} />
        </>
      );
    case "generator":
      return (
        <>
          <B p={[0, p.h / 2, 0]} s={[p.w, p.h, p.d]} c={mat("#d94f3d", { rough: 0.5 })} />
          <B p={[0, p.h + 0.05, 0]} s={[p.w * 0.9, 0.1, p.d * 0.9]} c="#1d1a16" />
          <B p={[p.w / 2 + 0.05, p.h * 0.7, 0]} s={[0.1, 0.1, 0.1]} c="#444" />
        </>
      );
    case "container":
      return <B p={[0, p.h / 2, 0]} s={[p.w, p.h, p.d]} c={mat(c ?? "#2f6db5", { rough: 0.6 })} />;
    case "kiosk":
      return (
        <>
          <B p={[0, p.h / 2, 0]} s={[p.w, p.h, p.d]} c={mat(c ?? "#3d7fd9", { rough: 0.6 })} />
          <B p={[0, p.h * 0.55, p.d / 2 + 0.02]} s={[p.w * 0.8, p.h * 0.35, 0.05]} c="#f2e6c9" shadow={false} />
          <B p={[0, p.h + 0.1, 0.3]} s={[p.w + 0.4, 0.1, p.d + 0.8]} c={mat("#9aa0a6", { map: zinc(), tile: 2 })} />
          {p.text && <Label text={p.text} y={p.h - 0.35} w={p.w * 0.95} z={p.d / 2 + 0.06} />}
        </>
      );
    case "stall": case "grill":
      return (
        <>
          <B p={[0, 0.5, 0]} s={[p.w, 1, p.d]} c="#8b5a2b" />
          {p.kind === "stall" && (
            <>
              <mesh geometry={cone} material={mat(c ?? "#d94f3d")} position={[0, p.h, 0]} scale={[p.w * 1.6, 0.8, p.d * 1.6]} rotation={[0, Math.PI / 4, 0]} castShadow />
              <B p={[-p.w / 2 + 0.1, p.h / 2, p.d / 2 - 0.1]} s={[0.08, p.h, 0.08]} c="#5b3a22" />
              <B p={[p.w / 2 - 0.1, p.h / 2, p.d / 2 - 0.1]} s={[0.08, p.h, 0.08]} c="#5b3a22" />
              {p.text && <Label text={p.text} y={p.h - 0.6} w={p.w} z={p.d / 2 + 0.05} />}
            </>
          )}
          {p.kind === "grill" && <B p={[0, 1.05, 0]} s={[p.w, 0.1, p.d]} c={mat("#ff7a1a", { emissive: true })} shadow={false} />}
        </>
      );
    case "bus_shelter":
      return (
        <>
          {[-1, 1].map((sx) => <B key={sx} p={[sx * (p.w / 2 - 0.1), p.h / 2, -p.d / 2 + 0.1]} s={[0.12, p.h, 0.12]} c="#3a3f45" />)}
          <B p={[0, p.h, 0]} s={[p.w, 0.12, p.d]} c="#f2b705" />
          <B p={[0, 0.5, -p.d / 2 + 0.2]} s={[p.w * 0.8, 0.1, 0.5]} c="#8b5a2b" />
          {p.text && <Label text={p.text} y={p.h + 0.45} w={3.2} bg="#1d1a16" fg="#f7c500" />}
        </>
      );
    case "sign":
      return p.text ? (
        <>
          <B p={[-p.w * 0.35, p.h / 2, 0]} s={[0.12, p.h, 0.12]} c="#3a3f45" />
          <B p={[p.w * 0.35, p.h / 2, 0]} s={[0.12, p.h, 0.12]} c="#3a3f45" />
          <group rotation={[0, p.w >= p.d ? 0 : Math.PI / 2, 0]}>
            <Label text={p.text} y={p.h - 0.4} w={Math.max(p.w, p.d)} z={0.08} bg="#d94f3d" fg="#fff8e7" />
          </group>
        </>
      ) : <B p={[0, p.h / 2, 0]} s={[0.12, p.h, 0.12]} c="#3a3f45" />;
    case "billboard":
      return (
        <>
          <B p={[0, p.h / 2, 0]} s={[0.3, p.h, 0.3]} c="#3a3f45" />
          <B p={[0, p.h - 1.2, 0]} s={[p.w, 2.4, 0.2]} c="#2a2a2a" />
          {p.text && <Label text={p.text} y={p.h - 1.2} w={p.w * 0.97} z={0.12} bg="#f7c500" fg="#1d1a16" />}
          {p.text && <Label text={p.text} y={p.h - 1.2} w={p.w * 0.97} z={-0.12} bg="#f7c500" fg="#1d1a16" ry={Math.PI} />}
        </>
      );
    case "lamp":
      return (
        <>
          <B p={[0, p.h / 2, 0]} s={[0.12, p.h, 0.12]} c="#3a3f45" />
          <B p={[0, p.h, 0.6]} s={[0.1, 0.1, 1.2]} c="#3a3f45" />
          <B p={[0, p.h - 0.08, 1.15]} s={[0.4, 0.1, 0.25]} c={mat("#fff3b0", { emissive: true })} shadow={false} />
        </>
      );
    case "pole":
      return (
        <>
          <mesh geometry={cyl} material={mat("#7a6a55")} position={[0, p.h / 2, 0]} scale={[0.24, p.h, 0.24]} castShadow />
          <B p={[0, p.h - 0.4, 0]} s={[1.4, 0.1, 0.1]} c="#5b4a35" />
          <mesh geometry={cyl} material={mat("#5b6670")} position={[0.4, p.h - 1.4, 0]} scale={[0.5, 0.8, 0.5]} />
        </>
      );
    // ---- home interiors
    case "bed":
      return (
        <>
          <B p={[0, 0.25, 0]} s={[p.w, 0.3, p.d]} c="#6b4226" />
          <B p={[0, 0.48, 0]} s={[p.w * 0.95, 0.18, p.d * 0.95]} c="#f2efe6" />
          <B p={[0, 0.58, p.d * 0.2]} s={[p.w * 0.93, 0.06, p.d * 0.55]} c="#ffffff" shadow={false} />
          <B p={[0, 0.6, p.d * 0.2]} s={[p.w * 0.94, 0.04, p.d * 0.55]} c="#2f6db5" shadow={false} />
          <B p={[0, 0.65, -p.d * 0.38]} s={[p.w * 0.7, 0.14, 0.35]} c="#ffffff" shadow={false} />
        </>
      );
    case "wardrobe":
      return (
        <>
          <B p={[0, p.h / 2, 0]} s={[p.w, p.h, p.d]} c="#7a4e2d" />
          <B p={[0, p.h / 2, p.d / 2 + 0.01]} s={[0.03, p.h * 0.9, 0.02]} c="#3b2414" shadow={false} />
        </>
      );
    case "tv":
      return (
        <>
          <B p={[0, 0.3, 0]} s={[p.w, 0.6, p.d]} c="#4a3423" />
          <B p={[0, 0.95, 0]} s={[0.06, 0.65, p.d * 0.95]} c="#111111" />
          <B p={[-0.035, 0.95, 0]} s={[0.01, 0.58, p.d * 0.88]} c={mat("#3a6ea5", { emissive: true })} shadow={false} />
        </>
      );
    case "table":
      return (
        <>
          <B p={[0, p.h, 0]} s={[p.w, 0.06, p.d]} c="#8b5a2b" />
          {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => <B key={`${sx}${sz}`} p={[sx * (p.w / 2 - 0.06), p.h / 2, sz * (p.d / 2 - 0.06)]} s={[0.06, p.h, 0.06]} c="#5b3a22" />)}
          <B p={[0, p.h + 0.12, 0]} s={[0.2, 0.2, 0.2]} c="#d94f3d" />
        </>
      );
    case "rug":
      return <B p={[0, 0.06, 0]} s={[p.w, 0.01, p.d]} c="#9b2d2d" shadow={false} />;
    case "fan":
      return (
        <group position={[0, p.y ?? 2.8, 0]}>
          <B p={[0, 0.2, 0]} s={[0.05, 0.4, 0.05]} c="#dddddd" shadow={false} />
          <B p={[0, 0, 0]} s={[p.w, 0.02, 0.15]} c="#eeeeee" shadow={false} />
          <B p={[0, 0, 0]} s={[0.15, 0.02, p.w]} c="#eeeeee" shadow={false} />
        </group>
      );
    case "porch":
      return (
        <>
          <B p={[0, 0.07, 0]} s={[p.w, 0.14, p.d]} c={mat("#ffffff", { map: concrete(), tile: 1.2 })} />
          <B p={[0, 0.14, 0]} s={[p.w * 0.6, 0.02, p.d * 0.7]} c="#7d2f2a" shadow={false} />
        </>
      );
    case "pillar":
      return (
        <>
          <mesh geometry={cyl} material={wallMat("#f4efe4")} position={[0, p.h / 2, 0]} scale={[0.26, p.h, 0.26]} castShadow />
          <B p={[0, 0.08, 0]} s={[0.36, 0.16, 0.36]} c={wallMat("#d8cfbd")} />
        </>
      );
    case "canopy":
      return (
        <>
          <B p={[0, p.h + 0.08, 0]} s={[p.w, 0.12, p.d]} c={wallMat("#f4efe4")} />
          <B p={[0, p.h + 0.2, 0]} s={[p.w + 0.1, 0.1, p.d + 0.1]} c={mat("#7a3b2a", { map: zinc(), tile: 1.5 })} />
        </>
      );
    case "door_leaf": {
      // one leaf of the panelled double front door, swung open into the parlour
      const along = p.w >= p.d;
      const len = along ? p.w : p.d;
      return (
        <group rotation={[0, along ? 0 : Math.PI / 2, 0]}>
          <B p={[0, 1.05, 0]} s={[len, 2.1, 0.055]} c="#6e3f22" />
          {[0.55, 1.45].map((y) => (
            <group key={y}>
              <B p={[0, y, 0.03]} s={[len * 0.7, 0.62, 0.012]} c="#8a5531" shadow={false} />
              <B p={[0, y, -0.03]} s={[len * 0.7, 0.62, 0.012]} c="#8a5531" shadow={false} />
            </group>
          ))}
          <B p={[len * 0.38, 1.0, 0.045]} s={[0.035, 0.14, 0.03]} c={mat("#d4af37", { rough: 0.3 })} shadow={false} />
          <B p={[len * 0.38, 1.0, -0.045]} s={[0.035, 0.14, 0.03]} c={mat("#d4af37", { rough: 0.3 })} shadow={false} />
        </group>
      );
    }
    case "door_frame": {
      // wall above the door + white architrave + a stone threshold
      const along = p.w >= p.d;
      const len = along ? p.w : p.d;
      const lintel = Math.max(0.2, p.h - 2.25);
      return (
        <group rotation={[0, along ? 0 : Math.PI / 2, 0]}>
          <B p={[0, 2.25 + lintel / 2, 0]} s={[len + 0.02, lintel, 0.3]} c={wallMat(c ?? "#e7d1a1")} />
          <B p={[0, 2.31, 0]} s={[len + 0.3, 0.12, 0.36]} c="#f4f1ea" />
          {[-1, 1].map((sx) => <B key={sx} p={[sx * (len / 2 + 0.06), 1.13, 0]} s={[0.12, 2.26, 0.36]} c="#f4f1ea" />)}
          <B p={[0, 0.025, 0]} s={[len, 0.05, 0.42]} c={mat("#8f8a80", { rough: 0.6 })} shadow={false} />
        </group>
      );
    }
    case "ac":
      return (
        <>
          <B p={[0, p.h, 0]} s={[p.w, 0.55, p.d]} c={mat("#e9ecee", { rough: 0.5 })} />
          <mesh geometry={cyl} material={mat("#4b4f54")} position={[0, p.h, 0]} scale={[Math.min(p.w, p.d) * 0.8, 0.36, Math.min(p.w, p.d) * 0.8]} rotation={[p.w > p.d ? Math.PI / 2 : 0, 0, p.w > p.d ? 0 : Math.PI / 2]} />
        </>
      );
    case "fountain":
      return (
        <>
          <mesh geometry={cyl} material={wallMat("#e6dfd2")} position={[0, p.h / 2, 0]} scale={[p.w, p.h, p.d]} castShadow receiveShadow />
          <mesh geometry={cyl} material={mat("#4aa3df", { rough: 0.15 })} position={[0, p.h + 0.01, 0]} scale={[p.w * 0.88, 0.04, p.d * 0.88]} />
          <mesh geometry={cyl} material={wallMat("#e6dfd2")} position={[0, p.h + 0.9, 0]} scale={[1.2, 1.8, 1.2]} castShadow />
          <mesh geometry={cyl} material={wallMat("#e6dfd2")} position={[0, p.h + 1.85, 0]} scale={[3, 0.2, 3]} castShadow />
          <mesh geometry={sphere} material={mat("#bfe3ff", { transparent: 0.65, rough: 0.1 })} position={[0, p.h + 2.4, 0]} scale={[1.2, 1.6, 1.2]} />
        </>
      );
    case "rock":
      return (
        <>
          <mesh geometry={sphere} material={mat("#8a8378", { rough: 1 })} position={[0, p.h * 0.45, 0]} scale={[p.w, p.h, p.d]} castShadow receiveShadow />
          <mesh geometry={sphere} material={mat("#9b9387", { rough: 1 })} position={[p.w * 0.25, p.h * 0.75, -p.d * 0.1]} scale={[p.w * 0.55, p.h * 0.55, p.d * 0.55]} castShadow />
        </>
      );
    case "tower":
      return (
        <>
          <B p={[0, p.h / 2, 0]} s={[p.w, p.h, p.d]} c={wallMat("#d9cdb8")} />
          <Windows w={p.w} d={p.d} h={p.h} floors={Math.round(p.h / 3)} />
          <B p={[0, p.h + 0.6, 0]} s={[p.w * 0.7, 1.2, p.d * 0.7]} c={wallMat("#b9a58a")} />
          {p.text && <group position={[0, 0, p.d / 2 + 0.12]}><Label text={p.text} y={3.2} w={p.w * 0.9} bg="#2f6db5" fg="#ffffff" /></group>}
        </>
      );
    default:
      return <B p={[0, p.h / 2, 0]} s={[p.w, p.h, p.d]} c={c ?? "#aaaaaa"} />;
  }
}

const DECORATIVE = new Set(["bench", "tyres", "grill", "fan", "rug", "table"]);

/**
 * Mounts the props a few at a time, then merges every static mesh into one mesh per
 * material (hundreds of props -> a few dozen draw calls on mobile).
 * The merge is done in small slices across frames, never one long block: on a low-end phone a
 * single block froze the page for seconds (and, inside LagosLife, their page with it).
 * Shapes stay indexed (no toNonIndexed), which halves the work and the memory.
 */
const SLICE_MS = 30; // under the 50 ms "long task" line, so taps still get through
const MOUNT_CHUNK = 40; // props mounted per step: mounting all of them at once was a ~2 s freeze
function StaticBatch({ items, city }: { items: React.ReactNode[]; city?: boolean }) {
  const src = useRef<THREE.Group>(null);
  const [shown, setShown] = useState(MOUNT_CHUNK);
  const [merged, setMerged] = useState<THREE.Mesh[] | null>(null);
  const all = shown >= items.length;
  const built = useRef(false);
  const doneBuilding = () => {
    if (built.current) return;
    built.current = true;
    if (city) useGame.getState().set({ building: false });
  };
  // the city is "building" from mount until it's merged (the Scene pauses drawing meanwhile)
  useLayoutEffect(() => {
    if (city) useGame.getState().set({ building: true });
    return doneBuilding;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // mount the props a few at a time
  useEffect(() => {
    if (all) return;
    const t = window.setTimeout(() => setShown((n) => n + MOUNT_CHUNK), 0);
    return () => window.clearTimeout(t);
  }, [shown, all]);
  useLayoutEffect(() => {
    const root = src.current;
    if (!all || !root) return;
    let cancelled = false, timer = 0;
    const out: THREE.Mesh[] = [];
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !Array.isArray(m.material)) meshes.push(m);
    });
    const groups = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; shadow: boolean }>();
    const tmp = new THREE.Matrix4();
    let i = 0, k = 0;
    let entries: [THREE.Material, { geos: THREE.BufferGeometry[]; shadow: boolean }][] = [];
    const prepare = (m: THREE.Mesh) => {
      const g = m.geometry.clone();
      if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]); // merge needs all-or-none indexed
      g.applyMatrix4(tmp.multiplyMatrices(inv, m.matrixWorld));
      const tile = (m.material as THREE.Material).userData.tile as number | undefined;
      if (tile) worldUV(g, tile);
      for (const key of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(key)) g.deleteAttribute(key);
      const e = groups.get(m.material as THREE.Material) ?? { geos: [], shadow: false };
      e.geos.push(g);
      e.shadow ||= m.castShadow;
      groups.set(m.material as THREE.Material, e);
    };
    const step = () => {
      if (cancelled) return;
      const t0 = performance.now();
      while (i < meshes.length && performance.now() - t0 < SLICE_MS) prepare(meshes[i++]);
      if (i < meshes.length) { timer = window.setTimeout(step, 0); return; }
      if (!entries.length) entries = [...groups];
      while (k < entries.length && performance.now() - t0 < SLICE_MS) {
        const [material, { geos, shadow }] = entries[k++];
        const g = mergeGeometries(geos, false);
        geos.forEach((x) => x.dispose());
        if (!g) continue;
        g.computeBoundingSphere();
        const mesh = new THREE.Mesh(g, material);
        mesh.castShadow = shadow;
        mesh.receiveShadow = true;
        out.push(mesh);
      }
      if (k < entries.length) { timer = window.setTimeout(step, 0); return; }
      doneBuilding();
      setMerged(out);
    };
    timer = window.setTimeout(step, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      out.forEach((m) => m.geometry.dispose());
    };
  }, [all]); // eslint-disable-line react-hooks/exhaustive-deps
  if (merged) return <>{merged.map((m) => <primitive key={m.uuid} object={m} />)}</>;
  return <group ref={src} visible={false}>{items.slice(0, shown)}</group>;
}

/** Roofs stay separate so the one over your head disappears when you go inside. */
function Roof({ p }: { p: Prop }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (ref.current) ref.current.visible = local.insideHome !== p.label;
  });
  const duplex = p.style === "duplex";
  return (
    <group ref={ref} position={[p.x, 0, p.z]}>
      {duplex ? (
        <>
          <B p={[0, p.h + 1.6, 0]} s={[p.w - 0.8, 3.2, p.d - 0.8]} c={wallMat("#f3efe6")} />
          <Windows w={p.w - 0.8} d={p.d - 0.8} h={3.2} floors={1} />
          <group position={[0, p.h, 0]}><B p={[0, 3.45, 0]} s={[p.w, 0.5, p.d]} c={wallMat(p.color ?? "#3c4a57")} /></group>
          <mesh geometry={cyl} material={mat("#1d1a16")} position={[p.w / 2 - 1.6, p.h + 4.3, -p.d / 4]} scale={[1.2, 1.3, 1.2]} castShadow />
        </>
      ) : (
        <>
          <mesh geometry={roofGeo} material={mat(p.color ?? "#9aa0a6", { map: zinc(2) })} position={[0, p.h + 0.85, 0]} scale={[p.w * 1.05, 1.7, p.d * 1.05]} castShadow />
          {/* fascia board + satellite dish */}
          <B p={[0, p.h + 0.05, 0]} s={[p.w + 0.1, 0.18, p.d + 0.1]} c={wallMat("#f4efe4")} />
          <group position={[p.w / 4, p.h + 1.0, -p.d / 4]} rotation={[0.5, 0.8, 0]}>
            <mesh geometry={sphere} material={mat("#e6e6e6", { rough: 0.4 })} scale={[0.9, 0.9, 0.25]} castShadow />
            <B p={[0, 0, 0.3]} s={[0.04, 0.04, 0.6]} c="#9a9a9a" shadow={false} />
          </group>
        </>
      )}
    </group>
  );
}

function Wires({ props }: { props: Prop[] }) {
  const geo = useMemo(() => {
    const lines = new Map<string, Prop[]>();
    for (const p of props) if (p.kind === "pole" && p.line) lines.set(p.line, [...(lines.get(p.line) ?? []), p]);
    const pts: number[] = [];
    for (const poles of lines.values()) {
      for (let i = 0; i + 1 < poles.length; i++) {
        const a = poles[i], b = poles[i + 1];
        for (const off of [-0.55, 0.55]) {
          const along = Math.abs(b.x - a.x) > Math.abs(b.z - a.z);
          const ox = along ? 0 : off, oz = along ? off : 0;
          let prev: [number, number, number] | null = null;
          for (let k = 0; k <= 8; k++) {
            const t = k / 8;
            const pt: [number, number, number] = [a.x + (b.x - a.x) * t + ox, a.h - 0.35 - Math.sin(t * Math.PI) * 0.6, a.z + (b.z - a.z) * t + oz];
            if (prev) pts.push(...prev, ...pt);
            prev = pt;
          }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [props]);
  return <lineSegments geometry={geo}><lineBasicMaterial color="#1d1a16" /></lineSegments>;
}

/** ``city``: the main game world (its build shows "Building the city…" and pauses drawing). */
export const MapProps = memo(function MapProps({ props, lowDetail, city }: { props: Prop[]; lowDetail: boolean; city?: boolean }) {
  const statics = props.filter((p) => p.kind !== "roof" && !(lowDetail && DECORATIVE.has(p.kind)));
  return (
    <>
      <StaticBatch
        city={city}
        items={statics.map((p, i) => (
          <group key={i} position={[p.x, 0, p.z]}>
            <PropMesh p={p} />
          </group>
        ))}
      />
      {props.filter((p) => p.kind === "roof").map((p, i) => <Roof key={i} p={p} />)}
      <Wires props={props} />
    </>
  );
});

export { Vehicle };
