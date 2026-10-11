"use client";

import { Html, Sky } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, N8AO, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { net } from "@/lib/net";
import { useGame } from "@/lib/store";
import type { GameMap, Home, RosterEntry } from "@/lib/types";
import Ambient from "./Ambient";
import Avatar, { type Motion } from "./Avatar";
import { setCatalog, toWorld, worldRotY, furn, checkLayout } from "./furniture";
import { FurnitureLayer, FurnitureMesh } from "./FurnitureMeshes";
import { navState, stopWalking, walkTo } from "./nav";
import { inRect, resolveCollision } from "./physics";
import { findSeat, type Seat } from "./seats";
import { MapProps, Vehicle } from "./props";
import { sound } from "./sound";
import { cam, fx, input, local, remotes, sample, sceneRefs } from "./state";
import { grass, laterite } from "./textures";

const SEND_HZ = 12;
const SUN = new THREE.Vector3(40, 60, 25);
const HEAD_Y = 1.5;

/**
 * Fraction (0..1) of the head→camera segment that is free of solid props, so
 * the third-person camera never ends up inside a wall.
 */
function cameraClearance(map: GameMap, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  let best = 1;
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const minX = Math.min(ax, bx) - 0.3, maxX = Math.max(ax, bx) + 0.3;
  const minZ = Math.min(az, bz) - 0.3, maxZ = Math.max(az, bz) + 0.3;
  for (const p of map.props) {
    const c = p.collider;
    if (!c || c[2] < minX || c[0] > maxX || c[3] < minZ || c[1] > maxZ) continue;
    let t0 = 0, t1 = 1, hit = true;
    const pad = 0.2;
    const slabs: [number, number, number, number][] = [
      [ax, dx, c[0] - pad, c[2] + pad], [ay, dy, -1, c[4] + pad], [az, dz, c[1] - pad, c[3] + pad],
    ];
    for (const [o, d, lo, hi] of slabs) {
      if (Math.abs(d) < 1e-6) { if (o < lo || o > hi) { hit = false; break; } continue; }
      let ta = (lo - o) / d, tb = (hi - o) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) { hit = false; break; }
    }
    if (hit && t0 < best) best = t0;
  }
  return Math.max(0.12, best - 0.04);
}

function LocalPlayer({ map }: { map: GameMap }) {
  const group = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const motion = useRef<Motion>({ speed: 0, crouch: false, sit: false, seatY: 0 });
  const last = useRef({ sent: 0, x: NaN, z: NaN, c: false, s: false });
  const seat = useRef<Seat | null>(null);
  const stuck = useRef({ t: 0, d: Infinity });
  const avatarGroup = useRef<THREE.Group>(null);
  const carGroup = useRef<THREE.Group>(null);
  const carColor = useGame((s) => s.content?.config.cars.find((c) => c.id === s.life.carId)?.color);
  const cfg = useGame((s) => s.content?.config.movement);
  const me = useGame((s) => s.me);
  const av = useGame((s) => (s.me ? Object.values(s.roster).find((r) => r.id === s.me?.id)?.av : undefined));
  const { camera } = useThree();
  const want = useMemo(() => new THREE.Vector3(), []);
  const camState = useRef({ dist: cam.dist, pitch: cam.pitch, clear: 1, lift: 0, home: null as string | null });
  navState.map = map;

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
    let mag = Math.min(1, Math.hypot(ix, iy));
    const manual = mag > 0.08;
    if (manual && local.path.length) stopWalking(); // the stick/keys always win over tap-to-move
    let ang = -Math.atan2(ix, iy) + cam.yaw + Math.PI;
    let autoRun = false;
    if (!manual && local.path.length && !local.frozen) {
      // tap-to-move: follow the planned waypoints
      let [tx, tz] = local.path[0];
      while (local.path.length > 1 && Math.hypot(tx - local.x, tz - local.z) < 0.35) { local.path.shift(); [tx, tz] = local.path[0]; }
      const d = Math.hypot(tx - local.x, tz - local.z);
      if (local.path.length === 1 && d < 0.2) stopWalking();
      else {
        ang = Math.atan2(tx - local.x, tz - local.z);
        mag = Math.min(1, d / 0.6 + 0.35);
        let left = d;
        for (let i = 1; i < local.path.length; i++) left += Math.hypot(local.path[i][0] - local.path[i - 1][0], local.path[i][1] - local.path[i - 1][1]);
        autoRun = left > 14;
        // give up if we stop making progress (someone standing in the way, etc.)
        const s = stuck.current;
        if (left < s.d - 0.3) { s.d = left; s.t = 0; } else if ((s.t += dt) > 1.6) { stopWalking(); s.d = Infinity; s.t = 0; }
      }
    }
    if (!local.path.length) stuck.current.d = Infinity;
    const moving = mag > 0.08 && !local.frozen && (manual || local.path.length > 0);
    if (moving && (local.sit || local.lie)) { local.sit = local.lie = false; useGame.getState().set({ sitting: false, sleeping: false }); }
    if (manual) local.seatTarget = null;
    // arrived at furniture you tapped: sit on it, or ask "sleep or sit?" for a bed
    const tgt = local.seatTarget;
    if (tgt && !local.path.length) {
      local.seatTarget = null;
      if (Math.hypot(tgt.x - local.x, tgt.z - local.z) < 2.2) {
        if (tgt.bed) useGame.getState().set({ seatAsk: true });
        else { local.sit = true; useGame.getState().set({ sitting: true }); }
      }
    }
    local.crouch = !local.sit && !local.lie && (input.crouchToggle || k.has("KeyC") || k.has("ControlLeft"));
    const wantRun = (input.runHeld || input.joyRun || autoRun || k.has("ShiftLeft") || k.has("ShiftRight")) && !local.crouch;
    local.run = wantRun && moving && local.stamina > 0;
    if (local.run) local.stamina = Math.max(0, local.stamina - dt);
    else local.stamina = Math.min(cfg.stamina_max_s, local.stamina + cfg.stamina_regen_per_s * dt);
    local.moving = moving;
    let speed = 0;
    const st0g = useGame.getState();
    const myCar = local.drive ? st0g.content?.config.cars.find((c) => c.id === st0g.life.carId) : undefined;
    if (local.drive && !myCar) local.drive = false;
    if (moving) {
      speed = myCar ? myCar.speed * 0.97 * mag : (local.crouch ? cfg.crouch_speed : local.run ? cfg.run_speed : cfg.walk_speed) * mag;
      const vx = Math.sin(ang) * speed, vz = Math.cos(ang) * speed;
      const [nx, nz] = resolveCollision(map, local.x + vx * dt, local.z + vz * dt, cfg.player_radius);
      const locked = map.kind === "hub" && (lockedHomeAt(map, nx, nz) || (myCar && map.homes?.find((h) => inRect(h.rect, nx, nz))?.id));
      if (locked && !(map.homes?.find((h) => h.id === locked && inRect(h.rect, local.x, local.z)))) {
        // someone's house: knock first (the server would refuse the step anyway)
        if (local.path.length) stopWalking();
      } else {
        local.x = nx;
        local.z = nz;
      }
      local.ry = Math.atan2(vx, vz);
    }
    // sitting: snap to the nearest bed/bench, or sit on the floor
    const resting = local.sit || local.lie;
    if (resting && (!seat.current || !!seat.current.lie !== local.lie)) {
      seat.current = findSeat(map, local.x, local.z, local.lie);
      if (local.lie && !seat.current.lie) { local.lie = false; local.sit = true; useGame.getState().set({ sleeping: false, sitting: true }); }
      if (seat.current.ry !== null) local.ry = seat.current.ry;
    } else if (!resting) seat.current = null;
    if (local.lie) local.stamina = Math.min(cfg.stamina_max_s, local.stamina + dt * 2); // a nap restores your breath
    motion.current.speed = myCar ? 0 : speed;
    motion.current.crouch = local.crouch;
    if (avatarGroup.current) avatarGroup.current.visible = !myCar;
    if (carGroup.current) carGroup.current.visible = !!myCar;
    motion.current.sit = local.sit;
    motion.current.lie = local.lie;
    motion.current.seatY = seat.current?.y ?? 0;
    sound.footsteps(myCar ? 0 : speed, local.crouch);
    local.insideHome = map.homes?.find((h) => inRect(h.rect, local.x, local.z))?.id ?? null;
    if (local.insideHome !== camState.current.home) {
      camState.current.home = local.insideHome;
      sound.play("door");
    }
    // ---- render
    const st0 = seat.current;
    if (st0) {
      // ease onto the seat instead of teleporting
      const gp = group.current.position;
      gp.x += (st0.x - gp.x) * (1 - Math.exp(-dt * 8));
      gp.z += (st0.z - gp.z) * (1 - Math.exp(-dt * 8));
      gp.y = 0;
    } else group.current.position.set(local.x, 0, local.z);
    let d = (local.ry - group.current.rotation.y) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    group.current.rotation.y += d * (1 - Math.exp(-dt * 14));
    if (ring.current) ring.current.visible = cam.aerial.on;
    // ---- camera
    const c = camState.current;
    const onboarding = useGame.getState().onboard === "welcome";
    const decor = useGame.getState().decor;
    const decorHome = decor ? map.homes?.find((h) => h.id === decor.home) : undefined;
    if (decorHome) {
      // decorate mode: look straight down into your house like a floor plan
      const [hx, hz] = decorHome.center;
      // fit the whole floor plan on screen (portrait phones are narrow), front door at the bottom
      const pc = camera as THREE.PerspectiveCamera;
      const tv = Math.tan(THREE.MathUtils.degToRad(pc.fov / 2));
      const height = Math.max((decorHome.lw / 2 + 0.8) / (tv * pc.aspect), (decorHome.ld / 2 + 2.2) / tv);
      const [fx0, fz0] = toWorld(decorHome, 0, 0.02);
      want.set(fx0, height, fz0);
      camera.position.lerp(want, 1 - Math.exp(-dt * 6));
      camera.up.set(hx - fx0, 0, hz - fz0).normalize();
      camera.lookAt(hx, 0, hz);
    } else if (cam.aerial.on) {
      camera.up.set(0, 1, 0);
      // map-app feel: targets move with your fingers, the camera glides after them, flicks keep coasting
      const a = cam.aerial;
      if (!a.drag) {
        a.tx += a.vx * dt;
        a.tz += a.vz * dt;
        const f = Math.exp(-dt * 3.2);
        a.vx *= f;
        a.vz *= f;
      }
      const [bx0, bz0, bx1, bz1] = map.bounds;
      a.tx = Math.min(bx1, Math.max(bx0, a.tx));
      a.tz = Math.min(bz1, Math.max(bz0, a.tz));
      a.th = Math.min(120, Math.max(16, a.th));
      a.x = THREE.MathUtils.damp(a.x, a.tx, a.drag ? 22 : 12, dt);
      a.z = THREE.MathUtils.damp(a.z, a.tz, a.drag ? 22 : 12, dt);
      a.h = THREE.MathUtils.damp(a.h, a.th, 10, dt);
      want.set(a.x, a.h, a.z + a.h * 0.35);
      camera.position.lerp(want, 1 - Math.exp(-dt * 9));
      camera.lookAt(a.x, 0, a.z);
    } else {
      camera.up.set(0, 1, 0);
      const inside = !!local.insideHome;
      if (onboarding) cam.yaw += dt * 0.22; // slow welcome orbit
      // indoors you can still look all around the room, just from a closer, higher camera
      const wantDist = onboarding ? 9 : inside ? Math.min(cam.dist, 3.8) : local.drive ? cam.dist + 4 : cam.dist;
      const wantPitch = onboarding ? 0.45 : inside ? Math.min(1.3, Math.max(0.55, cam.pitch + 0.3)) : local.drive ? Math.max(cam.pitch, 0.5) : cam.pitch;
      c.dist = THREE.MathUtils.lerp(c.dist, wantDist, 1 - Math.exp(-dt * 5));
      c.pitch = THREE.MathUtils.lerp(c.pitch, wantPitch, 1 - Math.exp(-dt * 5));
      const ox = Math.sin(cam.yaw) * c.dist * Math.cos(c.pitch), oy = Math.sin(c.pitch) * c.dist, oz = Math.cos(cam.yaw) * c.dist * Math.cos(c.pitch);
      let clear = 1;
      let lift = 0;
      if (inside) {
        // indoors: keep the camera inside the room (a cut-away view from above), never out past the walls
        const hr = map.homes?.find((h) => h.id === local.insideHome)?.rect;
        if (hr) {
          let t = 1;
          const lim = (o: number, d: number, lo: number, hi: number) => (d > 0 ? (hi - o) / d : d < 0 ? (lo - o) / d : 1);
          if (ox) t = Math.min(t, lim(local.x, ox, hr[0] + 0.3, hr[2] - 0.3));
          if (oz) t = Math.min(t, lim(local.z, oz, hr[1] + 0.3, hr[3] - 0.3));
          clear = Math.max(0.05, Math.min(1, t));
          lift = (1 - clear) * c.dist * 0.6; // squeezed by a wall: rise up instead
        }
      } else clear = cameraClearance(map, local.x, HEAD_Y, local.z, local.x + ox, HEAD_Y - 0.1 + oy, local.z + oz);
      // pull in fast when blocked, ease back out slowly (no popping)
      c.clear = clear < c.clear ? clear : THREE.MathUtils.lerp(c.clear, clear, 1 - Math.exp(-dt * 3));
      c.lift = THREE.MathUtils.lerp(c.lift, lift, 1 - Math.exp(-dt * 6));
      want.set(local.x + ox * c.clear, HEAD_Y - 0.1 + (inside ? oy + c.lift : oy * c.clear), local.z + oz * c.clear);
      camera.position.lerp(want, 1 - Math.exp(-dt * 14));
      if (fx.shake > 0.001) {
        camera.position.x += (Math.random() - 0.5) * fx.shake * 0.4;
        camera.position.y += (Math.random() - 0.5) * fx.shake * 0.4;
        fx.shake *= Math.exp(-dt * 6);
      }
      camera.lookAt(local.x, 1.3, local.z);
    }
    // ---- heartbeat: a hider hears Boju getting close
    const st = useGame.getState();
    const g = st.group, r = g?.round, meId = st.me?.id;
    if (g?.phase === "seek" && r && meId && r.seeker !== meId && r.state[meId] === "hiding") {
      const seeker = Object.values(st.roster).find((x) => x.id === r.seeker);
      const sp = seeker ? sample(seeker.n) : null;
      if (sp) sound.heartbeat(Math.max(0, 1 - Math.hypot(sp.x - local.x, sp.z - local.z) / 14));
    }
    // ---- network (12 Hz, only when something changed)
    const now = state.clock.elapsedTime;
    const l = last.current;
    if (now - l.sent >= 1 / SEND_HZ && (l.x !== local.x || l.z !== local.z || l.c !== local.crouch || l.s !== (local.sit || local.lie) || now - l.sent > 1)) {
      l.sent = now;
      l.x = local.x;
      l.z = local.z;
      l.c = local.crouch;
      l.s = local.sit || local.lie;
      net.send({ t: "mv", x: +local.x.toFixed(2), z: +local.z.toFixed(2), ry: +local.ry.toFixed(2), c: local.crouch, r: local.run, st: local.sit, ly: local.lie, dr: local.drive, s: ++local.seq });
    }
  });

  return (
    <group ref={group}>
      <group ref={avatarGroup}><Avatar av={av ?? [0, 0, 0]} me={!!me} motion={motion} /></group>
      <group ref={carGroup} visible={false}>{carColor && <Vehicle kind="car" w={1.9} d={4.1} h={1.5} color={carColor} />}</group>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]} visible={false}>
        <ringGeometry args={[1.2, 1.8, 32]} />
        <meshBasicMaterial color="#2f7cf6" transparent opacity={0.85} depthWrite={false} />
      </mesh>
    </group>
  );
}

function RemotePlayer({ r, map }: { r: RosterEntry; map: GameMap }) {
  const group = useRef<THREE.Group>(null);
  const motion = useRef<Motion>({ speed: 0, crouch: false, sit: false, seatY: 0 });
  const seat = useRef<Seat | null>(null);
  const prev = useRef({ x: 0, z: 0 });
  const emote = useGame((s) => s.emotes.find((e) => e.n === r.n && e.until > Date.now()));
  // the name tag is DOM (not hidden with the 3D group), so mirror visibility in React state
  const [shown, setShown] = useState(false);
  const avatarRef = useRef<THREE.Group>(null);
  const carRef = useRef<THREE.Group>(null);
  const carColor = useGame((s) => (r.car ? s.content?.config.cars.find((c) => c.id === r.car)?.color : undefined));
  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const snap = sample(r.n);
    const vis = !!snap && (snap.f & 8) === 0; // out of range or disconnected: no ghost bodies/tags
    if (vis !== shown) setShown(vis);
    if (!snap || !vis) { g.visible = false; return; }
    g.visible = true;
    const sp = dt > 0 ? Math.hypot(snap.x - prev.current.x, snap.z - prev.current.z) / dt : 0;
    prev.current = { x: snap.x, z: snap.z };
    motion.current.speed = THREE.MathUtils.lerp(motion.current.speed, Math.min(sp, 7), 0.25);
    motion.current.crouch = (snap.f & 1) === 1;
    const driving = (snap.f & 64) === 64 && !!carColor;
    if (avatarRef.current) avatarRef.current.visible = !driving;
    if (carRef.current) carRef.current.visible = driving;
    const lying = (snap.f & 32) === 32;
    const sitting = (snap.f & 16) === 16 && !lying;
    if ((sitting || lying) && (!seat.current || !!seat.current.lie !== lying)) seat.current = findSeat(map, snap.x, snap.z, lying);
    if (!sitting && !lying) seat.current = null;
    motion.current.sit = sitting;
    motion.current.lie = lying && !!seat.current?.lie;
    motion.current.seatY = seat.current?.y ?? 0;
    const s = seat.current;
    g.position.set(s ? s.x : snap.x, 0, s ? s.z : snap.z);
    g.rotation.y = s?.ry ?? snap.ry;
  });
  return (
    <group ref={group} visible={false}>
      <group ref={avatarRef}><Avatar av={r.av} motion={motion} label={shown ? (emote ? `${r.nick}: ${emote.text}` : r.nick) : undefined} tag={r.bot ? "NPC" : undefined} /></group>
      <group ref={carRef} visible={false}>{carColor && <Vehicle kind="car" w={1.9} d={4.1} h={1.5} color={carColor} />}</group>
    </group>
  );
}

/** Decorate mode: your draft layout, with the selected item lifted and tinted (red if it can't go there). */
function DecorDraft({ homes }: { homes: Home[] }) {
  const decor = useGame((s) => s.decor);
  if (!decor) return null;
  const h = homes.find((x) => x.id === decor.home);
  if (!h) return null;
  const placed = decor.items.filter((i) => i.placed);
  const problem = checkLayout(h, placed);
  return (
    <>
      {placed.map((it) => {
        const s = furn.catalog[it.item];
        if (!s) return null;
        const [x, z] = toWorld(h, it.lx, it.lz);
        const sel = decor.sel === it.id;
        const bad = problem?.id === it.id;
        return (
          <group key={it.id} position={[x, sel ? 0.12 : 0, z]} rotation={[0, worldRotY(h, it.rot), 0]}>
            <FurnitureMesh s={s} />
            {(sel || bad) && (
              <mesh position={[0, 0.03 - (sel ? 0.12 : 0) + 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[s.w, s.d]} />
                <meshBasicMaterial color={bad ? "#ff3b30" : "#2f7cf6"} transparent opacity={0.45} depthWrite={false} />
              </mesh>
            )}
          </group>
        );
      })}
    </>
  );
}

function DebugHook() {
  const { scene, camera, gl } = useThree();
  sceneRefs.camera = camera;
  sceneRefs.canvas = gl.domElement;
  const w = window as unknown as { __boju?: Record<string, unknown> };
  if (w.__boju) Object.assign(w.__boju, { scene, camera });
  return null;
}

function Remotes({ map }: { map: GameMap }) {
  const roster = useGame((s) => s.roster);
  const meId = useGame((s) => s.me?.id);
  return <>{Object.values(roster).filter((r) => r.id !== meId).map((r) => <RemotePlayer key={r.n} r={r} map={map} />)}</>;
}

/** id of a house at (x, z) that I may not enter (owned by someone else who hasn't let me in). */
function lockedHomeAt(map: GameMap, x: number, z: number): string | null {
  const h = map.homes?.find((x0) => inRect(x0.rect, x, z));
  if (!h) return null;
  const st = useGame.getState();
  const owner = st.doorOwners[h.id];
  return owner && owner !== st.me?.id && !st.openDoors.includes(h.id) ? h.id : null;
}

const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const topPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/** Tap-to-move: turns a screen tap into a ground point and plans a walk there. */
function TapMover() {
  const { camera, gl } = useThree();
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);
  const pv = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const t = input.tap;
    if (!t) return;
    input.tap = null;
    if (cam.aerial.on) return;
    const r = gl.domElement.getBoundingClientRect();
    // did you tap a real person? (bodies are ~1.8 m tall: test a few points up the body)
    const st = useGame.getState();
    let best: string | null = null, bestD = 46;
    for (const p of Object.values(st.roster)) {
      if (p.id === st.me?.id || p.bot) continue;
      const s = sample(p.n);
      if (!s || (s.f & 8)) continue;
      for (const y of [0.5, 1.1, 1.7]) {
        pv.set(s.x, y, s.z).project(camera);
        if (pv.z > 1) continue;
        const d = Math.hypot(((pv.x + 1) / 2) * r.width + r.left - t.x, ((1 - pv.y) / 2) * r.height + r.top - t.y);
        if (d < bestD) { bestD = d; best = p.id; }
      }
    }
    if (best) { st.set({ card: best }); sound.play("pop"); return; }
    if (local.frozen) return;
    ndc.set(((t.x - r.left) / r.width) * 2 - 1, -((t.y - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    {
      // tapped a bed / sofa / chair (inside a house)? test the ray against each one at its own height
      let f: (typeof furn.boxes)[number] | undefined;
      let fd = Infinity;
      for (const b of furn.boxes) {
        const s = furn.catalog[b.item];
        if (!s || !(s.bed || s.seat !== null) || Math.hypot(b.cx - local.x, b.cz - local.z) > 25) continue;
        topPlane.constant = -Math.min(s.h, 0.9) * 0.9;
        if (!ray.ray.intersectPlane(topPlane, hit)) continue;
        if (hit.x < b.x0 - 0.1 || hit.x > b.x1 + 0.1 || hit.z < b.z0 - 0.1 || hit.z > b.z1 + 0.1) continue;
        const d = ray.ray.origin.distanceTo(hit);
        if (d < fd) { fd = d; f = b; }
      }
      if (f) {
        const cx = Math.min(Math.max(local.x, f.x0), f.x1), cz = Math.min(Math.max(local.z, f.z0), f.z1);
        const d = Math.hypot(local.x - cx, local.z - cz);
        const bed = !!furn.catalog[f.item]?.bed;
        local.seatTarget = { x: cx, z: cz, bed };
        if (d > 0.9) walkTo(cx + ((local.x - cx) / (d || 1)) * 0.6, cz + ((local.z - cz) / (d || 1)) * 0.6);
        sound.play("pop");
        return;
      }
    }
    if (!t.walk) return;
    ndc.set(((t.x - r.left) / r.width) * 2 - 1, -((t.y - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(groundPlane, hit)) return;
    if (walkTo(hit.x, hit.z)) sound.play("pop");
  });
  return null;
}

/** Where you're walking to (tap-to-move) — a pulsing ring on the ground. */
function DestMarker() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const t = navState.target;
    m.visible = !!t && local.path.length > 0;
    if (t) {
      m.position.set(t[0], 0.06, t[1]);
      const s = 1 + Math.sin(clock.elapsedTime * 6) * 0.12;
      m.scale.set(s, s, s);
    }
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
      <ringGeometry args={[0.35, 0.55, 28]} />
      <meshBasicMaterial color="#2f7cf6" transparent opacity={0.9} depthWrite={false} />
    </mesh>
  );
}

/** Onboarding guide: a bobbing pin over the goal + an arrow at your feet pointing to it. */
function GuideMarker() {
  const guide = useGame((s) => s.guide);
  const pin = useRef<THREE.Group>(null);
  const arrow = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!guide) return;
    if (pin.current) pin.current.visible = Math.hypot(guide.x - local.x, guide.z - local.z) > 4;
    if (pin.current) {
      pin.current.position.set(guide.x, 3.2 + Math.sin(clock.elapsedTime * 3) * 0.25, guide.z);
      pin.current.rotation.y = clock.elapsedTime * 1.5;
    }
    if (arrow.current) {
      const d = Math.hypot(guide.x - local.x, guide.z - local.z);
      arrow.current.visible = d > 2.5;
      if (d < 1.8 && !useGame.getState().onboard) useGame.getState().set({ guide: null }); // arrived
      arrow.current.position.set(local.x, 0.08, local.z);
      arrow.current.rotation.y = Math.atan2(guide.x - local.x, guide.z - local.z);
    }
  });
  if (!guide) return null;
  return (
    <>
      <group ref={pin}>
        <mesh position={[0, 0, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.45, 1, 16]} />
          <meshBasicMaterial color="#2f7cf6" />
        </mesh>
        <Html position={[0, 1, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <div className="whitespace-nowrap rounded-full bg-[#2f7cf6] px-2.5 py-1 text-xs font-bold text-white shadow-lg">{guide.label}</div>
        </Html>
      </group>
      <group ref={arrow}>
        <mesh position={[0, 0, 1.5]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.35, 0.8, 3]} />
          <meshBasicMaterial color="#2f7cf6" transparent opacity={0.85} />
        </mesh>
      </group>
    </>
  );
}

/** The meeting circle everyone stands in before the dice (pulses, turns green when you're in). */
function GatherCircle() {
  const gather = useGame((s) => (s.group?.phase === "gather" ? s.group.gather : null));
  const inside = useGame((s) => !!s.me && !!s.group?.gather?.in.includes(s.me.id));
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ring.current) ring.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 3) * 0.03);
  });
  if (!gather) return null;
  const [x, z] = gather.center;
  return (
    <group position={[x, 0.07, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh ref={ring}>
        <ringGeometry args={[gather.r - 0.35, gather.r, 64]} />
        <meshBasicMaterial color={inside ? "#39d353" : "#ffffff"} transparent opacity={0.9} depthWrite={false} />
      </mesh>
      <mesh>
        <circleGeometry args={[gather.r - 0.35, 64]} />
        <meshBasicMaterial color={inside ? "#39d353" : "#2f7cf6"} transparent opacity={0.18} depthWrite={false} />
      </mesh>
    </group>
  );
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
        <mesh key={i} position={[(m.rect[0] + m.rect[2]) / 2, 0.15, (m.rect[1] + m.rect[3]) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[m.rect[2] - m.rect[0], m.rect[3] - m.rect[1]]} />
          <meshBasicMaterial color={m.color} transparent opacity={0.3} depthWrite={false} />
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

/** Section names + safe house + zones floating over the map while in aerial view. */
function AerialLabels({ map }: { map: GameMap }) {
  const on = useGame((s) => s.aerial);
  const safeId = useGame((s) => s.group?.settings.safe);
  if (!on) return null;
  const mid = (r: number[]): [number, number] => [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
  const tags: { key: string; at: [number, number]; text: string; cls: string }[] = [
    ...map.sections.map((s) => ({ key: `s${s.id}`, at: mid(s.rect), text: `📍 ${s.name}`, cls: "bg-black/60 text-white" })),
    ...map.safe_houses.filter((s) => s.id === safeId).map((s) => ({ key: `h${s.id}`, at: mid(s.rect), text: `🏠 ${s.name}`, cls: "bg-[var(--leaf)] text-white" })),
    ...map.zones.map((z) => ({ key: `z${z.id}`, at: mid(z.rect), text: z.kind === "bus_stop" ? `🚌 ${z.name}` : `🍽️ ${z.name}`, cls: "bg-[var(--accent)] text-white" })),
  ];
  return (
    <>
      {tags.map((t) => (
        <Html key={t.key} position={[t.at[0], 4, t.at[1]]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <div className={`anim-pop whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold shadow-lg ${t.cls}`}>{t.text}</div>
        </Html>
      ))}
    </>
  );
}

/** Sun whose shadow camera follows the player: crisp shadows with a small shadow map. */
function Sun({ shadows }: { shadows: boolean }) {
  const light = useRef<THREE.DirectionalLight>(null);
  useFrame(() => {
    const l = light.current;
    if (!l) return;
    const fx0 = cam.aerial.on ? cam.aerial.x : local.x, fz0 = cam.aerial.on ? cam.aerial.z : local.z;
    l.position.set(fx0 + SUN.x, SUN.y, fz0 + SUN.z);
    l.target.position.set(fx0, 0, fz0);
    l.target.updateMatrixWorld();
  });
  return (
    <directionalLight
      ref={light}
      color="#fff1d6"
      intensity={2.2}
      castShadow={shadows}
      shadow-mapSize={[1024, 1024]}
      shadow-bias={-0.0004}
      shadow-normalBias={0.03}
      shadow-camera-left={-28}
      shadow-camera-right={28}
      shadow-camera-top={28}
      shadow-camera-bottom={-28}
      shadow-camera-far={150}
    />
  );
}

function World({ map }: { map: GameMap }) {
  const quality = useGame((s) => s.quality);
  const catalog = useGame((s) => s.content?.config.furniture);
  useEffect(() => { setCatalog(catalog ?? [], map); }, [catalog, map]);
  const aerial = useGame((s) => s.aerial);
  const b = map.bounds;
  const cx = (b[0] + b[2]) / 2, cz = (b[1] + b[3]) / 2;
  const w = b[2] - b[0] + 60, d = b[3] - b[1] + 60;
  const shadows = quality !== "low";
  const fogFar = quality === "low" ? 60 : quality === "medium" ? 90 : 140;
  const groundTex = useMemo(() => (map.kind === "hub" ? laterite(Math.round(w / 6)) : grass(Math.round(w / 6))), [map.kind, w]);
  const groundTint = map.kind === "hub" ? "#ffffff" : map.ground === "#79a85a" ? "#d8f0c8" : map.ground;
  return (
    <>
      <Sky sunPosition={[SUN.x, SUN.y, SUN.z]} turbidity={7} rayleigh={1.2} mieCoefficient={0.006} mieDirectionalG={0.85} />
      <fog attach="fog" args={["#cfdde6", aerial ? 120 : fogFar * 0.35, aerial ? 280 : fogFar]} />
      <hemisphereLight args={["#e9f3ff", "#7a5a3a", 1.0]} />
      <ambientLight intensity={0.15} />
      <Sun shadows={shadows} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0, cz]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial map={groundTex} color={groundTint} roughness={1} />
      </mesh>
      <MapProps props={map.props} lowDetail={quality === "low"} />
      <Markers map={map} />
      <GatherCircle />
      <AerialLabels map={map} />
      {map.kind === "hub" && <Ambient map={map} />}
      {map.kind === "hub" && map.homes && <FurnitureLayer homes={map.homes} />}
      {map.kind === "hub" && map.homes && <DecorDraft homes={map.homes} />}
      <LocalPlayer map={map} />
      <Remotes map={map} />
      <TapMover />
      <DebugHook />
      <DestMarker />
      <GuideMarker />
      {quality === "high" && (
        <EffectComposer multisampling={0}>
          <N8AO aoRadius={1.6} intensity={2.2} distanceFalloff={1} quality="performance" />
          <Vignette offset={0.25} darkness={0.45} />
        </EffectComposer>
      )}
    </>
  );
}

// ?debug=1 exposes client-only camera/player state for screenshots and QA (the server still validates movement).
if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug")) {
  (window as unknown as { __boju: unknown }).__boju = { local, cam, input, store: useGame, walkTo, navState, remotes, sample, furn, toWorld };
}

export default function Scene({ map }: { map: GameMap }) {
  const quality = useGame((s) => s.quality);
  const dpr: [number, number] = quality === "low" ? [0.6, 1] : quality === "medium" ? [1, 1.5] : [1, 2];
  return (
    <Canvas
      shadows={quality === "high" ? "soft" : quality === "medium"}
      dpr={dpr}
      camera={{ fov: 60, near: 0.1, far: 320, position: [0, 5, 10] }}
      gl={{ antialias: quality !== "low", powerPreference: "high-performance", preserveDrawingBuffer: true }}
    >
      <World key={map.id} map={map} />
    </Canvas>
  );
}
