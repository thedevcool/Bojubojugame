"use client";

import { useEffect, useState } from "react";
import * as THREE from "three";
import { getAdsConfig, getAdsOnMap, getVatarConfig, API_URL, type LiveAd } from "@/lib/api";
import { adsState } from "@/lib/ads";
import { useGame, type AdSpot } from "@/lib/store";
import type { GameMap } from "@/lib/types";
import { local } from "./state";

/**
 * Paid wall posters (real naira via Paystack — the only real money in the game).
 * Tap a kiosk, shop, billboard or arena wall -> "📢 Place ad here" -> the ad sheet.
 * Same face rules as the server (backend/app/ads.py find_face): never on people's houses.
 */
const AD_KINDS = new Set(["wall", "fence", "kiosk", "shop", "stall", "billboard", "venue", "flat", "tower", "container", "house", "duplex"]);

const box = new THREE.Box3();
const p = new THREE.Vector3();

/** The ad-able wall face the ray hits first (or null). `before` = distance of anything else in the way. */
export function adFaceAt(ray: THREE.Ray, map: GameMap, before: number, sx: number, sy: number): AdSpot | null {
  if (!adsState.enabled || local.insideHome) return null;
  let best: AdSpot | null = null, bestD = before;
  for (const prop of map.props) {
    const c = prop.collider;
    if (!c) continue;
    if (Math.max(Math.abs((c[0] + c[2]) / 2 - local.x), Math.abs((c[1] + c[3]) / 2 - local.z)) > 60) continue;
    box.min.set(c[0], 0, c[1]);
    box.max.set(c[2], c[4], c[3]);
    if (!ray.intersectBox(box, p)) continue;
    const d = ray.origin.distanceTo(p);
    if (d >= bestD) continue;
    const e = 1e-3;
    let spot: Omit<AdSpot, "map" | "at" | "sx" | "sy"> | null = null;
    if (Math.abs(p.x - c[0]) < e) spot = { x: c[0], y: p.y, z: p.z, nx: -1, nz: 0, lo: c[1], hi: c[3], top: c[4] };
    else if (Math.abs(p.x - c[2]) < e) spot = { x: c[2], y: p.y, z: p.z, nx: 1, nz: 0, lo: c[1], hi: c[3], top: c[4] };
    else if (Math.abs(p.z - c[1]) < e) spot = { x: p.x, y: p.y, z: c[1], nx: 0, nz: -1, lo: c[0], hi: c[2], top: c[4] };
    else if (Math.abs(p.z - c[3]) < e) spot = { x: p.x, y: p.y, z: c[3], nx: 0, nz: 1, lo: c[0], hi: c[2], top: c[4] };
    bestD = d; // anything nearer (a house wall, a car...) blocks the walls behind it
    if (!AD_KINDS.has(prop.kind) || prop.win || prop.inner || prop.label) { best = null; continue; }
    // the top of a wall, or a wall too small for even the smallest poster: not an ad spot
    best = spot && spot.hi - spot.lo >= 1.1 && spot.top >= 1.05 ? { ...spot, map: map.id, at: Date.now(), sx, sy } : null;
  }
  if (best && Math.hypot(best.x - local.x, best.z - local.z) > 16) return null;
  return best;
}

const rotY = (nx: number, nz: number) => (nx > 0 ? Math.PI / 2 : nx < 0 ? -Math.PI / 2 : nz < 0 ? Math.PI : 0);

function Poster({ ad }: { ad: LiveAd }) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let t: THREE.Texture | null = null, gone = false;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(API_URL + ad.image, (x) => {
      x.colorSpace = THREE.SRGBColorSpace;
      x.anisotropy = 4;
      if (gone) x.dispose();
      else { t = x; setTex(x); }
    });
    return () => { gone = true; t?.dispose(); };
  }, [ad.image]);
  if (!tex) return null;
  return (
    <group position={[ad.x + ad.nx * 0.03, ad.y, ad.z + ad.nz * 0.03]} rotation={[0, rotY(ad.nx, ad.nz), 0]}>
      <mesh position={[0, 0, -0.005]}>
        <planeGeometry args={[ad.w + 0.12, ad.h + 0.12]} />
        <meshStandardMaterial color="#1b1f2a" roughness={0.6} />
      </mesh>
      <mesh>
        <planeGeometry args={[ad.w, ad.h]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Live posters for this map (refreshed every minute and after you buy one). */
export function AdsLayer({ map }: { map: GameMap }) {
  const version = useGame((s) => s.adsVersion);
  const [ads, setAds] = useState<LiveAd[]>([]);
  useEffect(() => {
    let alive = true;
    // LagosLife players pay through LagosLife, everyone else through Paystack
    (useGame.getState().mini ? getVatarConfig() : getAdsConfig()).then((c) => { adsState.enabled = c.enabled; }).catch(() => {});
    const load = () => getAdsOnMap(map.id).then((r) => { if (alive) setAds(r.live); }).catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [map.id, version]);
  return <>{ads.map((a) => <Poster key={a.id} ad={a} />)}</>;
}
