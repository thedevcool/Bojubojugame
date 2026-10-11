"use client";

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { BOTTOMS, SKIN } from "./palette";
import { mat } from "./props";
import { ankara } from "./textures";

export interface Motion { speed: number; crouch: boolean; sit?: boolean; seatY?: number }

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

// Skeleton proportions (metres)
const THIGH = 0.46;
const SHIN = 0.44;
const FOOT_H = 0.06;
const STAND_HIP = THIGH + SHIN + FOOT_H;
const UPPER_ARM = 0.28;
const FOREARM = 0.27;

/** Pelvis height that keeps the feet on the ground for a given hip/knee angle. */
const hipHeight = (hip: number, knee: number) => THIGH * Math.cos(hip) + SHIN * Math.cos(knee - hip) + FOOT_H;

type Limb = { upper: React.RefObject<THREE.Group | null>; lower: React.RefObject<THREE.Group | null> };

/**
 * Stylised-realistic person with two-bone legs and arms.
 * Walk/run uses a proper gait (knee lifts on the swing leg); "bend down" is a
 * real squat: thighs forward, knees bent, back leaning, head up, feet planted.
 */
export default function Avatar({ av, label, me, motion, tag }: { av: number[]; label?: string; me?: boolean; motion: { current: Motion }; tag?: string }) {
  const [s, t, b] = av;
  const skin = mat(SKIN[s % 8]);
  const pants = mat(BOTTOMS[b % 8]);
  const top = shirt(t);
  const shoe = mat("#241a12");
  const pelvis = useRef<THREE.Group>(null);
  const spine = useRef<THREE.Group>(null);
  const neck = useRef<THREE.Group>(null);
  const legs: Limb[] = [{ upper: useRef(null), lower: useRef(null) }, { upper: useRef(null), lower: useRef(null) }];
  const arms: Limb[] = [{ upper: useRef(null), lower: useRef(null) }, { upper: useRef(null), lower: useRef(null) }];
  const st = useRef({ phase: 0, bend: 0, speed: 0, sit: 0 });

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const m = motion.current;
    const k = st.current;
    k.bend = THREE.MathUtils.damp(k.bend, m.crouch ? 1 : 0, 10, dt); // smooth into/out of the squat
    k.speed = THREE.MathUtils.damp(k.speed, m.speed, 8, dt);
    k.sit = THREE.MathUtils.damp(k.sit, m.sit ? 1 : 0, 7, dt);
    const seatY = m.seatY ?? 0;
    const chair = seatY > 0.2; // on a bed/bench: legs hang down; on the floor: legs out in front
    const L = THREE.MathUtils.lerp;
    const moving = k.speed > 0.2;
    const running = k.speed > 4;
    k.phase += dt * (moving ? 3.2 + k.speed * 1.5 : 0);
    const amp = moving ? Math.min(running ? 0.75 : 0.5, 0.18 + k.speed * 0.11) : 0;
    const sinP = Math.sin(k.phase);

    // Squat pose blended with gait
    const squatHip = -1.25, squatKnee = 2.15;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const swing = sinP * side;
      const gaitHip = -swing * amp;
      const gaitKnee = Math.max(0, -Math.sin(k.phase + (i ? Math.PI : 0) - 0.6)) * (running ? 1.3 : 0.8) * Math.min(1, k.speed / 2);
      const hip = THREE.MathUtils.lerp(gaitHip, squatHip + gaitHip * 0.25, k.bend);
      const knee = THREE.MathUtils.lerp(gaitKnee, squatKnee, k.bend);
      legs[i].upper.current?.rotation.set(L(hip, chair ? -1.5 : -2.1, k.sit), 0, L(0, chair ? side * -0.04 : side * -0.1, k.sit));
      legs[i].lower.current?.rotation.set(L(knee, chair ? 1.45 : 1.5, k.sit), 0, 0);
      // arms swing opposite to legs; bent forward when squatting
      const armSwing = swing * amp * 0.9;
      const shoulder = THREE.MathUtils.lerp(armSwing, -0.75, k.bend);
      const elbow = THREE.MathUtils.lerp(-0.25 - (running ? 0.9 : 0.2), -0.9, k.bend);
      arms[i].upper.current?.rotation.set(L(shoulder, chair ? -0.45 : -1.0, k.sit), 0, side * L(0.06, chair ? 0.04 : -0.12, k.sit));
      arms[i].lower.current?.rotation.set(L(elbow, chair ? -0.75 : -0.7, k.sit), 0, 0);
    }
    const lean = THREE.MathUtils.lerp(moving ? (running ? 0.18 : 0.06) : 0, 0.55, k.bend);
    const hipY = THREE.MathUtils.lerp(STAND_HIP, hipHeight(-squatHip, squatKnee), k.bend);
    const bob = moving ? Math.abs(Math.cos(k.phase)) * (running ? 0.07 : 0.035) : Math.sin(k.phase * 0.3 + performance.now() / 900) * 0.006;
    const sitY = chair ? seatY + 0.07 : 0.13;
    if (pelvis.current) pelvis.current.position.set(0, L(hipY + bob * (1 - k.bend), sitY, k.sit), L(L(0, -0.12, k.bend), 0, k.sit));
    const bodyLean = L(lean, chair ? 0.04 : 0.18, k.sit); // on the floor: knees up, arms round them
    if (spine.current) spine.current.rotation.x = bodyLean;
    if (neck.current) neck.current.rotation.x = -bodyLean * 0.7; // keep looking ahead
  });

  return (
    <group>
      <group ref={pelvis} position={[0, STAND_HIP, 0]}>
        {/* hips */}
        <mesh geometry={box} material={pants} position={[0, 0.03, 0]} scale={[0.38, 0.17, 0.23]} castShadow />
        {/* legs: hip -> knee -> foot */}
        {[-0.12, 0.12].map((x, i) => (
          <group key={x} ref={legs[i].upper} position={[x, 0, 0]}>
            <mesh geometry={cap} material={pants} position={[0, -THIGH / 2, 0]} scale={[0.19, THIGH / 2 - 0.02, 0.19]} castShadow />
            <group ref={legs[i].lower} position={[0, -THIGH, 0]}>
              <mesh geometry={cap} material={pants} position={[0, -SHIN / 2, 0]} scale={[0.16, SHIN / 2 - 0.02, 0.16]} castShadow />
              <mesh geometry={box} material={shoe} position={[0, -SHIN - 0.01, 0.06]} scale={[0.15, 0.09, 0.3]} castShadow />
            </group>
          </group>
        ))}
        {/* torso pivots at the waist so the back can bend */}
        <group ref={spine} position={[0, 0.08, 0]}>
          <mesh geometry={cap} material={top} position={[0, 0.3, 0]} scale={[0.42, 0.28, 0.26]} castShadow />
          {[-0.27, 0.27].map((x, i) => (
            <group key={x} ref={arms[i].upper} position={[x, 0.52, 0]}>
              <mesh geometry={cap} material={top} position={[0, -UPPER_ARM / 2, 0]} scale={[0.13, UPPER_ARM / 2, 0.13]} castShadow />
              <group ref={arms[i].lower} position={[0, -UPPER_ARM, 0]}>
                <mesh geometry={cap} material={skin} position={[0, -FOREARM / 2, 0]} scale={[0.1, FOREARM / 2, 0.1]} castShadow />
                <mesh geometry={ball} material={skin} position={[0, -FOREARM - 0.04, 0]} scale={0.11} />
              </group>
            </group>
          ))}
          <group ref={neck} position={[0, 0.6, 0]}>
            <mesh geometry={cap} material={skin} position={[0, 0.04, 0]} scale={[0.1, 0.06, 0.1]} />
            <group position={[0, 0.22, 0]}>
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
          </group>
        </group>
      </group>
      {me && <mesh geometry={box} material={mat("#2f7cf6", { emissive: true })} position={[0, 2.25, 0]} scale={0.12} rotation={[0.6, 0.6, 0]} />}
      {label && (
        <Html position={[0, 2.3, 0]} center distanceFactor={10} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
          <div className="whitespace-nowrap rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur">
            {label}{tag && <span className="ml-1 rounded-full bg-[var(--accent)] px-1.5 text-[9px] text-white">{tag}</span>}
          </div>
        </Html>
      )}
    </group>
  );
}
