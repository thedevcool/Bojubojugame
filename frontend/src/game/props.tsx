"use client";

import { memo, useMemo } from "react";
import * as THREE from "three";
import type { Prop } from "@/lib/types";

/** Modular Lagos kit: every prop kind is assembled from shared primitives. */

const box = new THREE.BoxGeometry(1, 1, 1);
const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
const cone = new THREE.ConeGeometry(0.5, 1, 4);
const sphere = new THREE.IcosahedronGeometry(0.5, 1);
const roof = (() => {
  const g = new THREE.CylinderGeometry(0.0, 0.72, 1, 4, 1);
  g.rotateY(Math.PI / 4);
  return g;
})();

const matCache = new Map<string, THREE.MeshStandardMaterial>();
export function mat(color: string, opts: { emissive?: boolean; transparent?: number } = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${opts.emissive ? 1 : 0}|${opts.transparent ?? 1}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.85,
      metalness: 0.05,
      flatShading: true,
      emissive: opts.emissive ? new THREE.Color(color) : undefined,
      emissiveIntensity: opts.emissive ? 0.35 : 0,
      transparent: opts.transparent !== undefined && opts.transparent < 1,
      opacity: opts.transparent ?? 1,
    });
    matCache.set(key, m);
  }
  return m;
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
  ctx.fillStyle = fg;
  ctx.font = "bold 56px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text.slice(0, 22), 256, 68, 490);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}

type V3 = [number, number, number];
function B({ p, s, c, geo = box, shadow = true }: { p: V3; s: V3; c: string | THREE.Material; geo?: THREE.BufferGeometry; shadow?: boolean }) {
  return <mesh geometry={geo} material={typeof c === "string" ? mat(c) : c} position={p} scale={s} castShadow={shadow} receiveShadow />;
}

function Label({ text, y, w, z = 0, bg = "#f7c500", fg = "#1d1a16" }: { text: string; y: number; w: number; z?: number; bg?: string; fg?: string }) {
  const tex = useMemo(() => textTexture(text, bg, fg), [text, bg, fg]);
  return (
    <mesh position={[0, y, z]}>
      <planeGeometry args={[w, w / 4]} />
      <meshBasicMaterial map={tex} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  );
}

const WINDOW = "#2b4a63";

function Building({ p, floors }: { p: Prop; floors: number }) {
  const color = p.color ?? "#e7d1a1";
  const fh = p.h / floors;
  const rows = [];
  for (let f = 0; f < floors; f++) {
    const y = f * fh + fh * 0.55;
    rows.push(<B key={`f${f}`} p={[0, y, p.d / 2 + 0.02]} s={[p.w * 0.8, fh * 0.32, 0.05]} c={WINDOW} shadow={false} />);
    rows.push(<B key={`b${f}`} p={[0, y, -p.d / 2 - 0.02]} s={[p.w * 0.8, fh * 0.32, 0.05]} c={WINDOW} shadow={false} />);
  }
  return (
    <>
      <B p={[0, p.h / 2, 0]} s={[p.w, p.h, p.d]} c={color} />
      {rows}
      <B p={[0, 0.9, p.d / 2 + 0.03]} s={[1.1, 1.8, 0.06]} c="#6b4226" shadow={false} />
      {p.kind === "house" ? (
        <mesh geometry={roof} material={mat("#7a3b2a")} position={[0, p.h + 0.9, 0]} scale={[p.w * 1.05, 1.8, p.d * 1.05]} castShadow />
      ) : (
        <B p={[0, p.h + 0.25, 0]} s={[p.w + 0.3, 0.5, p.d + 0.3]} c="#8a8f96" />
      )}
      {p.kind === "duplex" && <B p={[0, p.h * 0.5, p.d / 2 + 0.6]} s={[p.w * 0.6, 0.2, 1.2]} c="#cfd6dd" />}
      {p.text && <group position={[0, 0, p.d / 2 + 0.06]}><Label text={p.text} y={p.h * 0.85} w={Math.min(p.w * 0.9, 6)} /></group>}
    </>
  );
}

function Vehicle({ p }: { p: Prop }) {
  const along = p.d >= p.w; // long axis
  const L = Math.max(p.w, p.d), W = Math.min(p.w, p.d);
  const body = p.kind === "danfo" ? "#f7c500" : p.kind === "keke" ? "#2f9e57" : (p.color ?? "#8a8f96");
  const inner = (
    <>
      <B p={[0, p.h * 0.45, 0]} s={[W, p.h * 0.6, L]} c={body} />
      {p.kind === "danfo" && (
        <>
          <B p={[0, p.h * 0.4, 0]} s={[W + 0.02, 0.18, L * 0.98]} c="#1d1a16" shadow={false} />
          <B p={[0, p.h * 0.85, -L * 0.05]} s={[W * 0.98, p.h * 0.3, L * 0.85]} c={body} />
          <B p={[0, p.h * 0.85, -L * 0.05]} s={[W + 0.02, p.h * 0.18, L * 0.7]} c={WINDOW} shadow={false} />
        </>
      )}
      {p.kind === "car" && <B p={[0, p.h * 0.88, -L * 0.05]} s={[W * 0.9, p.h * 0.3, L * 0.55]} c={WINDOW} />}
      {p.kind === "keke" && <B p={[0, p.h * 0.95, 0]} s={[W * 1.05, 0.08, L * 0.9]} c="#1d1a16" />}
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`${sx}${sz}`} geometry={cyl} material={mat("#1d1a16")} position={[sx * W * 0.5, 0.3, sz * L * 0.32]} rotation={[0, 0, Math.PI / 2]} scale={[0.6, 0.25, 0.6]} />
        )),
      )}
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
        {[0, 1, 2, 3, 4].map((i) => (
          <mesh key={i} geometry={box} material={mat("#3f8f3a")} position={[Math.cos(i * 1.26) * 1.2, p.h - 0.2, Math.sin(i * 1.26) * 1.2]} rotation={[0, -i * 1.26, 0.45]} scale={[2.6, 0.08, 0.6]} castShadow />
        ))}
      </>
    );
  }
  const crown = p.kind === "big_tree" ? 9 : 4;
  return (
    <>
      <mesh geometry={cyl} material={mat("#6e4f33")} position={[0, p.h * 0.3, 0]} scale={[trunk, p.h * 0.6, trunk]} castShadow />
      <mesh geometry={sphere} material={mat("#3c7d33")} position={[0, p.h * 0.7, 0]} scale={[crown, crown * 0.75, crown]} castShadow />
    </>
  );
}

function PropMesh({ p }: { p: Prop }) {
  const c = p.color;
  switch (p.kind) {
    case "house": case "flat": case "duplex":
      return <Building p={p} floors={p.kind === "flat" ? 3 : p.kind === "duplex" ? 2 : 1} />;
    case "venue":
      return (
        <>
          <B p={[0, p.h / 2, 0]} s={[p.w, p.h, p.d]} c={c ?? "#6b3fa0"} />
          <group position={[0, 0, -p.d / 2 - 0.06]} rotation={[0, Math.PI, 0]}><Label text={p.text ?? "EVENTS"} y={p.h * 0.7} w={p.w * 0.8} bg="#1d1a16" fg="#f7c500" /></group>
        </>
      );
    case "wall": case "fence": case "gate":
      return <B p={[0, p.h / 2, 0]} s={[p.w, p.h, p.d]} c={p.kind === "gate" ? "#3a3f45" : (c ?? (p.kind === "fence" ? "#9aa0a6" : "#c9b48a"))} />;
    case "floor":
      return <B p={[0, 0.03, 0]} s={[p.w, 0.05, p.d]} c={c ?? "#8c7a5b"} shadow={false} />;
    case "road":
      return (
        <>
          <B p={[0, 0.02, 0]} s={[p.w, 0.03, p.d]} c="#3b3b3d" shadow={false} />
          <B p={[0, 0.04, 0]} s={[p.w, 0.03, 0.15]} c="#f2f2f2" shadow={false} />
        </>
      );
    case "danfo": case "keke": case "car":
      return <Vehicle p={p} />;
    case "tree": case "big_tree":
      return <Tree p={p} />;
    case "palm":
      return <Tree p={p} palm />;
    case "hedge":
      return <B p={[0, p.h / 2, 0]} s={[p.w, p.h, p.d]} c="#2f6e2c" />;
    case "bench":
      return <B p={[0, p.h / 2, 0]} s={[p.w, p.h * 0.4, p.d]} c="#8b5a2b" />;
    case "tyres":
      return <mesh geometry={cyl} material={mat("#1d1a16")} position={[0, p.h / 2, 0]} scale={[p.w, p.h, p.d]} castShadow />;
    case "tank":
      return <mesh geometry={cyl} material={mat("#1d1a16")} position={[0, p.h / 2, 0]} scale={[p.w, p.h, p.d]} castShadow />;
    case "generator":
      return (
        <>
          <B p={[0, p.h / 2, 0]} s={[p.w, p.h, p.d]} c="#d94f3d" />
          <B p={[0, p.h + 0.05, 0]} s={[p.w * 0.9, 0.1, p.d * 0.9]} c="#1d1a16" />
        </>
      );
    case "container":
      return <B p={[0, p.h / 2, 0]} s={[p.w, p.h, p.d]} c={c ?? "#2f6db5"} />;
    case "kiosk":
      return (
        <>
          <B p={[0, p.h / 2, 0]} s={[p.w, p.h, p.d]} c={c ?? "#3d7fd9"} />
          <B p={[0, p.h * 0.55, p.d / 2 + 0.02]} s={[p.w * 0.8, p.h * 0.35, 0.05]} c="#f2e6c9" shadow={false} />
        </>
      );
    case "stall": case "grill":
      return (
        <>
          <B p={[0, 0.5, 0]} s={[p.w, 1, p.d]} c="#8b5a2b" />
          {p.kind === "stall" && (
            <>
              <mesh geometry={cone} material={mat(c ?? "#d94f3d")} position={[0, p.h, 0]} scale={[p.w * 1.6, 0.8, p.d * 1.6]} rotation={[0, Math.PI / 4, 0]} castShadow />
              {p.text && <Label text={p.text} y={p.h - 0.6} w={p.w} z={p.d / 2 + 0.05} />}
            </>
          )}
          {p.kind === "grill" && <B p={[0, 1.05, 0]} s={[p.w, 0.1, p.d]} c="#ff7a1a" shadow={false} />}
        </>
      );
    case "bus_shelter":
      return (
        <>
          <B p={[-p.w / 2 + 0.1, p.h / 2, -p.d / 2 + 0.1]} s={[0.12, p.h, 0.12]} c="#3a3f45" />
          <B p={[p.w / 2 - 0.1, p.h / 2, -p.d / 2 + 0.1]} s={[0.12, p.h, 0.12]} c="#3a3f45" />
          <B p={[0, p.h, 0]} s={[p.w, 0.12, p.d]} c="#f7c500" />
          <B p={[0, 0.5, -p.d / 2 + 0.2]} s={[p.w * 0.8, 0.1, 0.5]} c="#8b5a2b" />
          {p.text && <Label text={p.text} y={p.h + 0.45} w={3} bg="#1d1a16" fg="#f7c500" />}
        </>
      );
    case "sign":
      return p.text ? (
        <>
          <B p={[-p.w * 0.35, p.h / 2, 0]} s={[0.12, p.h, 0.12]} c="#3a3f45" />
          <B p={[p.w * 0.35, p.h / 2, 0]} s={[0.12, p.h, 0.12]} c="#3a3f45" />
          <Label text={p.text} y={p.h - 0.4} w={p.w} z={0.08} bg="#d94f3d" fg="#fff8e7" />
        </>
      ) : <B p={[0, p.h / 2, 0]} s={[0.12, p.h, 0.12]} c="#3a3f45" />;
    case "lamp":
      return (
        <>
          <B p={[0, p.h / 2, 0]} s={[0.12, p.h, 0.12]} c="#3a3f45" />
          <B p={[0, p.h, 0]} s={[0.4, 0.15, 0.4]} c="#fff3b0" />
        </>
      );
    default:
      return <B p={[0, p.h / 2, 0]} s={[p.w, p.h, p.d]} c={c ?? "#aaaaaa"} />;
  }
}

const DECORATIVE = new Set(["bench", "tyres", "lamp", "grill"]);

export const MapProps = memo(function MapProps({ props, lowDetail }: { props: Prop[]; lowDetail: boolean }) {
  return (
    <>
      {props.filter((p) => !(lowDetail && DECORATIVE.has(p.kind))).map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]}>
          <PropMesh p={p} />
        </group>
      ))}
    </>
  );
});
