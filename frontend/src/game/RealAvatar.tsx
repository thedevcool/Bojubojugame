"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { BOTTOMS, SKIN, TOPS } from "./palette";

/**
 * Realistic characters (built by tools/characters/build_characters.py from MakeHuman's CC0 human): one skinned mesh,
 * one material, three 1K maps. Skin tone, top and bottom colours come from the look picker through the mesh's tint
 * mask (vertex colour: R skin, G top, B bottom), so one file serves every look.
 */
export const CHARACTER_URL = { male: "/characters/male.glb", female: "/characters/female.glb" } as const;

const tintCache = new Map<string, THREE.MeshStandardMaterial>();

function tinted(src: THREE.MeshStandardMaterial, skin: string, top: string, bottom: string): THREE.MeshStandardMaterial {
  const key = `${src.uuid}|${skin}|${top}|${bottom}`;
  const hit = tintCache.get(key);
  if (hit) return hit;
  const m = src.clone();
  m.vertexColors = false; // the colour attribute is the tint mask, read below
  const u = {
    uSkin: { value: new THREE.Color(skin).multiplyScalar(1.25) },
    uTop: { value: new THREE.Color(top).multiplyScalar(1.25) },
    uBottom: { value: new THREE.Color(bottom).multiplyScalar(1.25) },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 color;\nvarying vec3 vTint;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvTint = color.rgb;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uSkin;\nuniform vec3 uTop;\nuniform vec3 uBottom;\nvarying vec3 vTint;")
      // seams average the tints (never fade to white); hair, shoes and eyes keep their own colour
      .replace("#include <map_fragment>", `#include <map_fragment>
        float tSum = vTint.r + vTint.g + vTint.b;
        vec3 tCol = (vTint.r * uSkin + vTint.g * uTop + vTint.b * uBottom + max(0.0, 1.0 - tSum) * vec3(1.0)) / max(tSum, 1.0);
        diffuseColor.rgb *= tCol;`);
  };
  m.customProgramCacheKey = () => "boju-real-tint";
  tintCache.set(key, m);
  return m;
}

/** Relaxed standing pose: arms down from the modelling pose, a little breathing. */
const ARMS: [string, number][] = [["upperarm01L", 1], ["upperarm01R", -1]];
const Z = new THREE.Vector3(0, 0, 1);
const X = new THREE.Vector3(1, 0, 0);

export default function RealAvatar({ av, breathe = true }: { av: number[]; breathe?: boolean }) {
  const [s, t, b, gender = 0] = av;
  const female = gender === 1;
  const gltf = useGLTF(female ? CHARACTER_URL.female : CHARACTER_URL.male);
  const scene = useMemo(() => clone(gltf.scene), [gltf.scene]);
  const spine = useRef<THREE.Bone | null>(null);

  useEffect(() => {
    scene.updateMatrixWorld(true);
    const bones = new Map<string, THREE.Bone>();
    scene.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones.set(o.name.replace(/[.\s]/g, ""), o as THREE.Bone);
      const mesh = o as THREE.SkinnedMesh;
      if (mesh.isSkinnedMesh) {
        if (/lod1/i.test(mesh.name)) mesh.visible = false; // the far version, for later
        mesh.material = tinted(mesh.material as THREE.MeshStandardMaterial, SKIN[s % 8], TOPS[t % 8], BOTTOMS[b % 8]);
        mesh.frustumCulled = false;
      }
    });
    for (const [name, side] of ARMS) {
      const bone = bones.get(name);
      if (!bone || !bone.parent) continue;
      const rest = bone.getWorldQuaternion(new THREE.Quaternion());
      const parent = bone.parent.getWorldQuaternion(new THREE.Quaternion());
      // down to the side first, then a touch forward (the same order as the builder's preview pose)
      const turn = new THREE.Quaternion().setFromAxisAngle(X, (8 * Math.PI) / 180)
        .multiply(new THREE.Quaternion().setFromAxisAngle(Z, (-45 * side * Math.PI) / 180));
      bone.quaternion.copy(parent.invert().multiply(turn).multiply(rest));
    }
    spine.current = bones.get("spine03") ?? null;
  }, [scene, s, t, b]);

  const rest = useRef<THREE.Quaternion | null>(null);
  useFrame(() => {
    const sp = spine.current;
    if (!breathe || !sp) return;
    rest.current ??= sp.quaternion.clone();
    const k = Math.sin(performance.now() / 1000 * 1.7) * 0.012;
    sp.quaternion.copy(rest.current).multiply(new THREE.Quaternion().setFromAxisAngle(X, k));
  });

  return <primitive object={scene} />;
}
