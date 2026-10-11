"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { FurnitureSpec, GameMap, Rect } from "@/lib/types";
import { FurnitureMesh } from "./FurnitureMeshes";
import Avatar, { type Motion } from "./Avatar";
import { MapProps, Vehicle } from "./props";
import { grass } from "./textures";

/** Small, cheap canvases for menus: low DPR, no shadows, rendered only while open. */
const GL = { antialias: true, powerPreference: "low-power" as const };

function Turntable({ children, speed = 0.5 }: { children: React.ReactNode; speed?: number }) {
  const g = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (g.current) g.current.rotation.y += dt * speed;
  });
  return <group ref={g}>{children}</group>;
}

/** Live 3D preview of the player's avatar while they pick skin/shirt/trousers. */
export function AvatarPreview({ av, className }: { av: number[]; className?: string }) {
  const motion = useRef<Motion>({ speed: 0, crouch: false });
  return (
    <div className={className}>
      <Canvas dpr={[1, 1.5]} gl={GL} camera={{ fov: 30, position: [0, 1.35, 4.6] }} onCreated={({ camera }) => camera.lookAt(0, 1.05, 0)}>
        <hemisphereLight args={["#eaf2ff", "#3a4a6a", 1.2]} />
        <directionalLight position={[2, 4, 3]} intensity={2} />
        <Turntable speed={0.6}>
          <Avatar av={av} motion={motion} />
        </Turntable>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
          <circleGeometry args={[0.9, 40]} />
          <meshBasicMaterial color="#2f7cf6" transparent opacity={0.35} />
        </mesh>
      </Canvas>
    </div>
  );
}

function OrbitRig({ map, focus }: { map: GameMap; focus: Rect | null }) {
  const { camera } = useThree();
  const target = useMemo(() => new THREE.Vector3(), []);
  const want = useMemo(() => new THREE.Vector3(), []);
  const look = useMemo(() => new THREE.Vector3(), []);
  const angle = useRef(0.6);
  const size = Math.max(map.bounds[2] - map.bounds[0], map.bounds[3] - map.bounds[1]);
  useFrame((_, dt) => {
    angle.current += dt * (focus ? 0.25 : 0.18);
    const fx = focus ? (focus[0] + focus[2]) / 2 : (map.bounds[0] + map.bounds[2]) / 2;
    const fz = focus ? (focus[1] + focus[3]) / 2 : (map.bounds[1] + map.bounds[3]) / 2;
    const r = focus ? 16 : size * 0.85;
    const h = focus ? 11 : size * 0.6;
    want.set(fx + Math.sin(angle.current) * r, h, fz + Math.cos(angle.current) * r);
    const k = 1 - Math.exp(-dt * 2.2); // smooth, iOS-like ease towards the new shot
    camera.position.lerp(want, k);
    target.lerp(look.set(fx, 0, fz), k);
    camera.lookAt(target);
  });
  return null;
}

function FocusMarker({ rect }: { rect: Rect }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const s = 1 + Math.sin(clock.elapsedTime * 3) * 0.06;
    ref.current.scale.set(s, 1, s);
    (ref.current.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.sin(clock.elapsedTime * 3) * 0.15;
  });
  const w = rect[2] - rect[0], d = rect[3] - rect[1];
  return (
    <group position={[(rect[0] + rect[2]) / 2, 0, (rect[1] + rect[3]) / 2]}>
      <mesh ref={ref} position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w, d]} />
        <meshBasicMaterial color="#39d353" transparent opacity={0.4} depthWrite={false} />
      </mesh>
      <mesh position={[0, 5.5, 0]}>
        <coneGeometry args={[0.7, 1.4, 4]} />
        <meshBasicMaterial color="#39d353" />
      </mesh>
    </group>
  );
}

/** Slowly orbiting 3D preview of an arena; flies to ``focus`` (e.g. the chosen safe house). */
export function MapPreview({ map, focus, className }: { map: GameMap; focus?: Rect | null; className?: string }) {
  const b = map.bounds;
  const groundTex = useMemo(() => grass(Math.round((b[2] - b[0]) / 6)), [b]);
  return (
    <div className={className}>
      <Canvas dpr={[1, 1.5]} gl={GL} camera={{ fov: 45, near: 0.5, far: 400, position: [60, 50, 60] }}>
        <color attach="background" args={["#bfe3f5"]} />
        <fog attach="fog" args={["#bfe3f5", 90, 220]} />
        <hemisphereLight args={["#eaf6ff", "#6b5a3a", 1.1]} />
        <directionalLight position={[40, 60, 25]} intensity={2} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(b[0] + b[2]) / 2, 0, (b[1] + b[3]) / 2]}>
          <planeGeometry args={[b[2] - b[0] + 30, b[3] - b[1] + 30]} />
          <meshStandardMaterial map={groundTex} color="#d8f0c8" roughness={1} />
        </mesh>
        <MapProps props={map.props} lowDetail />
        {focus && <FocusMarker rect={focus} />}
        <OrbitRig map={map} focus={focus ?? null} />
      </Canvas>
    </div>
  );
}

/** Turning 3D preview of a piece of furniture in the shop. */
export function FurniturePreview({ spec, className }: { spec: FurnitureSpec; className?: string }) {
  const size = Math.max(spec.w, spec.d, spec.h * 1.2, 0.8);
  return (
    <div className={className}>
      <Canvas dpr={[1, 1.5]} gl={GL} camera={{ fov: 30, position: [0, size * 1.5, size * 3] }} onCreated={({ camera }) => camera.lookAt(0, spec.h * 0.4, 0)}>
        <hemisphereLight args={["#fff6e8", "#4a3a2a", 1.3]} />
        <directionalLight position={[2, 4, 3]} intensity={2.2} />
        <Turntable speed={0.7}>
          <FurnitureMesh s={spec} ceiling={Math.max(1.4, spec.h + 1)} />
        </Turntable>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
          <circleGeometry args={[size * 0.9, 40]} />
          <meshBasicMaterial color="#c9b48f" />
        </mesh>
      </Canvas>
    </div>
  );
}

/** Turning 3D preview of a car at Tokunbo Autos. */
export function CarPreview({ color, className }: { color: string; className?: string }) {
  return (
    <div className={className}>
      <Canvas dpr={[1, 1.5]} gl={GL} camera={{ fov: 30, position: [0, 3.2, 9] }} onCreated={({ camera }) => camera.lookAt(0, 0.6, 0)}>
        <hemisphereLight args={["#eef4ff", "#4a4a4a", 1.3]} />
        <directionalLight position={[3, 5, 4]} intensity={2.3} />
        <Turntable speed={0.6}>
          <Vehicle kind="car" w={1.9} d={4.1} h={1.5} color={color} />
        </Turntable>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[3, 40]} />
          <meshBasicMaterial color="#b9c3cc" />
        </mesh>
      </Canvas>
    </div>
  );
}
