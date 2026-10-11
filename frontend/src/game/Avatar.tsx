"use client";

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { BOTTOMS, SKIN } from "./palette";
import { mat } from "./props";
import { ankara } from "./textures";

export interface Motion { speed: number; crouch: boolean }

const box = new THREE.BoxGeometry(1, 1, 1);
const cap = new THREE.CapsuleGeometry(0.5, 1, 3, 8);
const ball = new THREE.SphereGeometry(0.5, 14, 10);
const hairCap = new THREE.SphereGeometry(0.52, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);

const shirtCache = new Map<number, THREE.MeshStandardMaterial>();
function shirt(i: number): THREE.MeshStandardMaterial {
  let m = shirtCache.get(i % 8);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map: ankara(i), roughness: 0.9 });
    shirtCache.set(i % 8, m);
  }
  return m;
}

/**
 * A stylised-realistic person: capsule limbs that swing from hips/shoulders,
 * ankara shirt, hair, eyes, shoes. ``motion`` is read every frame (no re-render).
 */
export default function Avatar({ av, label, me, motion, tag }: { av: number[]; label?: string; me?: boolean; motion: { current: Motion }; tag?: string }) {
  const [s, t, b] = av;
  const skin = mat(SKIN[s % 8]);
  const pants = mat(BOTTOMS[b % 8]);
  const top = shirt(t);
  const legL = useRef<THREE.Group>(null), legR = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null), armR = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const phase = useRef(0);

  useFrame((_, dt) => {
    const m = motion.current;
    const moving = m.speed > 0.2;
    phase.current += dt * (moving ? 4 + m.speed * 1.6 : 0);
    const amp = moving ? Math.min(0.9, 0.25 + m.speed * 0.12) : 0;
    const sw = Math.sin(phase.current) * amp;
    if (legL.current) legL.current.rotation.x = m.crouch ? -1.1 + sw * 0.3 : sw;
    if (legR.current) legR.current.rotation.x = m.crouch ? -1.1 - sw * 0.3 : -sw;
    if (armL.current) armL.current.rotation.x = -sw * 0.8;
    if (armR.current) armR.current.rotation.x = sw * 0.8;
    if (body.current) {
      body.current.position.y = m.crouch ? -0.45 : moving ? Math.abs(Math.cos(phase.current)) * 0.05 : Math.sin(phase.current * 0.3) * 0.01;
      body.current.rotation.x = m.crouch ? 0.35 : moving ? 0.06 * Math.min(1, m.speed / 3) : 0;
    }
  });

  return (
    <group ref={body}>
      {/* legs: pivot at hip */}
      {[[-0.12, legL], [0.12, legR]].map(([x, ref]) => (
        <group key={x as number} ref={ref as React.RefObject<THREE.Group>} position={[x as number, 0.92, 0]}>
          <mesh geometry={cap} material={pants} position={[0, -0.42, 0]} scale={[0.17, 0.5, 0.17]} castShadow />
          <mesh geometry={box} material={mat("#2b2118")} position={[0, -0.86, 0.05]} scale={[0.15, 0.1, 0.3]} castShadow />
        </group>
      ))}
      {/* torso + hips */}
      <mesh geometry={box} material={pants} position={[0, 0.95, 0]} scale={[0.38, 0.16, 0.22]} castShadow />
      <mesh geometry={cap} material={top} position={[0, 1.25, 0]} scale={[0.42, 0.3, 0.26]} castShadow />
      {/* arms: pivot at shoulder */}
      {[[-0.27, armL], [0.27, armR]].map(([x, ref]) => (
        <group key={x as number} ref={ref as React.RefObject<THREE.Group>} position={[x as number, 1.47, 0]}>
          <mesh geometry={cap} material={top} position={[0, -0.13, 0]} scale={[0.13, 0.15, 0.13]} castShadow />
          <mesh geometry={cap} material={skin} position={[0, -0.38, 0]} scale={[0.1, 0.25, 0.1]} castShadow />
          <mesh geometry={ball} material={skin} position={[0, -0.6, 0]} scale={0.11} />
        </group>
      ))}
      {/* neck + head */}
      <mesh geometry={cap} material={skin} position={[0, 1.6, 0]} scale={[0.1, 0.08, 0.1]} />
      <group position={[0, 1.78, 0]}>
        <mesh geometry={ball} material={skin} scale={[0.27, 0.32, 0.29]} castShadow />
        <mesh geometry={hairCap} material={mat("#15100c")} position={[0, 0.03, -0.01]} scale={[0.29, 0.31, 0.31]} />
        <mesh geometry={ball} material={mat("#ffffff")} position={[-0.065, 0.03, 0.125]} scale={[0.055, 0.04, 0.03]} />
        <mesh geometry={ball} material={mat("#ffffff")} position={[0.065, 0.03, 0.125]} scale={[0.055, 0.04, 0.03]} />
        <mesh geometry={ball} material={mat("#120d0a")} position={[-0.065, 0.03, 0.14]} scale={0.022} />
        <mesh geometry={ball} material={mat("#120d0a")} position={[0.065, 0.03, 0.14]} scale={0.022} />
        <mesh geometry={ball} material={skin} position={[0, -0.03, 0.15]} scale={[0.05, 0.06, 0.05]} />
        <mesh geometry={box} material={mat("#5a2a22")} position={[0, -0.1, 0.135]} scale={[0.08, 0.015, 0.02]} />
        <mesh geometry={ball} material={skin} position={[-0.14, 0, 0]} scale={[0.04, 0.07, 0.05]} />
        <mesh geometry={ball} material={skin} position={[0.14, 0, 0]} scale={[0.04, 0.07, 0.05]} />
      </group>
      {me && <mesh geometry={box} material={mat("#f7c500", { emissive: true })} position={[0, 2.25, 0]} scale={0.12} rotation={[0.6, 0.6, 0]} />}
      {label && (
        <Html position={[0, 2.3, 0]} center distanceFactor={10} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
          <div className="whitespace-nowrap rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold text-white">
            {label}{tag && <span className="ml-1 rounded bg-[var(--danfo)] px-1 text-[9px] text-black">{tag}</span>}
          </div>
        </Html>
      )}
    </group>
  );
}
