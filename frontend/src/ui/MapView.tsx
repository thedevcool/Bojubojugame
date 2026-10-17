"use client";

import { GAME_ONLY } from "@/lib/scope";
import { useEffect, useRef, useState } from "react";
import { walkTo } from "@/game/nav";
import { local, remotes, sample } from "@/game/state";
import { sound } from "@/game/sound";
import { naira } from "@/lib/api";
import { net } from "@/lib/net";
import { useGame } from "@/lib/store";
import type { GameMap, Prop } from "@/lib/types";
import { useMap, useRole, useTicker } from "./hooks";
import { HUB_LNGLAT } from "@/lib/geo";

import { NaijaMap } from "./RealMap";

interface View { cx: number; cz: number; s: number } // world centre + pixels per metre

const ZONE_COLOR: Record<string, string> = { bus_stop: "#f7c500", food: "#ff7a1a", phone_shop: "#b48cff", furniture_shop: "#c98a4b", car_shop: "#e04f5f" };
const ZONE_ICON: Record<string, string> = { bus_stop: "🚏", food: "🍽️", phone_shop: "📱", furniture_shop: "🛋️", car_shop: "🚗" };

/** Draws a district like a printed street map (roads, plots, houses, shops, people, your pin). */
export interface Dot { x: number; z: number; color: string; label?: string }

export function draw(ctx: CanvasRenderingContext2D, map: GameMap, v: View, w: number, h: number, myHome: string | null, pin: { x: number; z: number } | null, people?: Dot[], labels = false) {
  const X = (x: number) => (x - v.cx) * v.s + w / 2, Z = (z: number) => (z - v.cz) * v.s + h / 2;
  const R = (x0: number, z0: number, x1: number, z1: number) => ctx.fillRect(X(x0), Z(z0), (x1 - x0) * v.s, (z1 - z0) * v.s);
  // a ground piece (grown by ``pad``), turned when it follows a real street at an angle
  const RP = (p: Prop, pad = 0) => {
    if (!p.ry) { R(p.x - p.w / 2 - pad, p.z - p.d / 2 - pad, p.x + p.w / 2 + pad, p.z + p.d / 2 + pad); return; }
    ctx.save(); ctx.translate(X(p.x), Z(p.z)); ctx.rotate(-p.ry);
    ctx.fillRect((-p.w / 2 - pad) * v.s, (-p.d / 2 - pad) * v.s, (p.w + 2 * pad) * v.s, (p.d + 2 * pad) * v.s);
    ctx.restore();
  };
  ctx.fillStyle = map.kind === "hub" || map.town || map.id === "arena_akobo" ? "#e9dcc4" : "#cfe3b8"; // towns on paper, parks green
  ctx.fillRect(0, 0, w, h);
  for (const p of map.props) {
    const x0 = p.x - p.w / 2, z0 = p.z - p.d / 2, x1 = p.x + p.w / 2, z1 = p.z + p.d / 2;
    if (p.kind === "lawn" || p.kind === "field") { ctx.fillStyle = "#b9d99a"; R(x0, z0, x1, z1); }
    else if (p.kind === "lot") { ctx.fillStyle = "#d9d3c7"; R(x0, z0, x1, z1); }
  }
  for (const p of map.props) {
    if (p.kind !== "sidewalk") continue;
    ctx.fillStyle = "#f6f1e7";
    R(p.x - p.w / 2, p.z - p.d / 2, p.x + p.w / 2, p.z + p.d / 2);
  }
  for (const p of map.props) {
    if (p.kind !== "laterite") continue; // untarred red-earth streets (Ibadan)
    ctx.fillStyle = "#c98a63";
    RP(p);
  }
  for (const p of map.props) {
    if (p.kind !== "road" && p.kind !== "flyover") continue;
    ctx.fillStyle = "#ffffff";
    RP(p, 0.4);
  }
  for (const p of map.props) { // all the kerbs first, then the tarmac, so turned streets join cleanly
    if (p.kind !== "road" && p.kind !== "flyover") continue;
    ctx.fillStyle = "#8d969f";
    RP(p);
    if (labels && v.s > 2 && Math.min(p.w, p.d) > 4 && !p.ry) {
      // a dashed centre line, like a real street map
      ctx.strokeStyle = "rgba(255,255,255,.75)"; ctx.lineWidth = 1; ctx.setLineDash([5, 5]); ctx.beginPath();
      if (p.w > p.d) { ctx.moveTo(X(p.x - p.w / 2), Z(p.z)); ctx.lineTo(X(p.x + p.w / 2), Z(p.z)); }
      else { ctx.moveTo(X(p.x), Z(p.z - p.d / 2)); ctx.lineTo(X(p.x), Z(p.z + p.d / 2)); }
      ctx.stroke(); ctx.setLineDash([]);
    }
  }
  // buildings, walls, cars, hedges (anything solid): a soft shadow, then the roof
  for (const p of map.props) {
    const c = p.collider;
    if (!c || ["tree", "palm", "lamp", "pole"].includes(p.kind)) continue;
    if (labels && (c[2] - c[0]) * v.s > 4 && (c[3] - c[1]) * v.s > 4) { ctx.fillStyle = "rgba(60,45,30,.18)"; ctx.fillRect(X(c[0]) + 2, Z(c[1]) + 2, (c[2] - c[0]) * v.s, (c[3] - c[1]) * v.s); }
    ctx.fillStyle = p.kind === "hedge" || p.kind === "bush" ? "#5f9a4c"
      : p.kind === "wall" && !p.win && !p.inner ? "#a8977c"
      : p.kind === "car" || p.kind === "danfo" || p.kind === "keke" ? "#7a828c"
      : p.color && labels ? p.color : "#cdbfa8";
    R(c[0], c[1], c[2], c[3]);
  }
  for (const p of map.props) {
    if (p.kind !== "tree" && p.kind !== "palm") continue;
    ctx.fillStyle = "#7fb26a";
    ctx.beginPath(); ctx.arc(X(p.x), Z(p.z), Math.max(2, 1.4 * v.s), 0, Math.PI * 2); ctx.fill();
  }
  for (const hm of map.homes ?? []) {
    const r = hm.rect;
    ctx.fillStyle = hm.id === myHome ? "#39d353" : "#f3e2c2";
    ctx.strokeStyle = "#8b6b4a";
    ctx.lineWidth = 1;
    R(r[0], r[1], r[2], r[3]);
    ctx.strokeRect(X(r[0]), Z(r[1]), (r[2] - r[0]) * v.s, (r[3] - r[1]) * v.s);
  }
  for (const z of map.zones) {
    ctx.fillStyle = ZONE_COLOR[z.kind] ?? "#2f7cf6";
    ctx.globalAlpha = 0.85;
    R(z.rect[0], z.rect[1], z.rect[2], z.rect[3]);
    ctx.globalAlpha = 1;
  }
  if (labels) drawLabels(ctx, map, X, Z, v.s, w, h, myHome);
  if (people) {
    // spectator map: only the players we were given, no "you"
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    for (const d of people) {
      ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(X(d.x), Z(d.z), 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = d.color; ctx.beginPath(); ctx.arc(X(d.x), Z(d.z), 5.2, 0, Math.PI * 2); ctx.fill();
      if (d.label) {
        ctx.fillStyle = "rgba(10,19,36,.75)";
        const tw = ctx.measureText(d.label).width + 8;
        ctx.fillRect(X(d.x) - tw / 2, Z(d.z) - 22, tw, 14);
        ctx.fillStyle = "#ffffff"; ctx.fillText(d.label, X(d.x), Z(d.z) - 11);
      }
    }
    return;
  }
  ctx.fillStyle = "#2f7cf6";
  for (const n of remotes.keys()) {
    const s = sample(n);
    if (s) { ctx.beginPath(); ctx.arc(X(s.x), Z(s.z), 2.5, 0, Math.PI * 2); ctx.fill(); }
  }
  if (pin) {
    ctx.fillStyle = "#ff3b30";
    ctx.beginPath(); ctx.arc(X(pin.x), Z(pin.z) - 9, 6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(X(pin.x) - 4, Z(pin.z) - 7); ctx.lineTo(X(pin.x), Z(pin.z)); ctx.lineTo(X(pin.x) + 4, Z(pin.z) - 7); ctx.fill();
  }
  // you: a blue dot with a heading wedge
  const px = X(local.x), pz = Z(local.z);
  ctx.fillStyle = "rgba(47,124,246,.22)";
  ctx.beginPath(); ctx.moveTo(px, pz); ctx.arc(px, pz, 16, Math.PI / 2 - local.ry - 0.5, Math.PI / 2 - local.ry + 0.5); ctx.fill();
  ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(px, pz, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#2f7cf6"; ctx.beginPath(); ctx.arc(px, pz, 4.2, 0, Math.PI * 2); ctx.fill();
}

/** Place names, always on (not only when you tap): districts large and faint, places as pills, never overlapping. */
function drawLabels(ctx: CanvasRenderingContext2D, map: GameMap, X: (x: number) => number, Z: (z: number) => number, s: number, w: number, h: number, myHome: string | null) {
  const used: [number, number, number, number][] = [];
  const free = (x0: number, y0: number, x1: number, y1: number) => x1 > 0 && y1 > 0 && x0 < w && y0 < h && !used.some((u) => x0 < u[2] && x1 > u[0] && y0 < u[3] && y1 > u[1]);
  const pill = (text: string, x: number, y: number, bg: string, fg = "#ffffff") => {
    ctx.font = "700 11px system-ui, sans-serif";
    const tw = ctx.measureText(text).width + 12, th = 18;
    const x0 = x - tw / 2, y0 = y - th / 2;
    if (!free(x0, y0, x0 + tw, y0 + th)) return;
    used.push([x0 - 2, y0 - 2, x0 + tw + 2, y0 + th + 2]);
    ctx.fillStyle = "rgba(0,0,0,.18)"; ctx.beginPath(); ctx.roundRect(x0 + 1, y0 + 2, tw, th, 9); ctx.fill();
    ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(x0, y0, tw, th, 9); ctx.fill();
    ctx.fillStyle = fg; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, x, y + 0.5);
  };
  // the places you go to first (they win any overlap)
  for (const hm of map.homes ?? []) if (hm.id === myHome) pill("🏠 My house", X(hm.door[0]), Z(hm.door[1]) - 12, "#2fa84f");
  for (const sh of map.safe_houses) pill(`🟢 ${sh.name}`, X((sh.rect[0] + sh.rect[2]) / 2), Z((sh.rect[1] + sh.rect[3]) / 2), "#1f8a4c");
  for (const z of map.zones) pill(`${ZONE_ICON[z.kind] ?? "📍"} ${z.name}`, X((z.rect[0] + z.rect[2]) / 2), Z((z.rect[1] + z.rect[3]) / 2), "rgba(20,28,48,.88)");
  // named buildings and signs on the map (shops, churches, stalls)
  // (internal ids like "adeniji_7" aren't names: skip them)
  if (s > 2.4) for (const p of map.props) if (p.label && p.collider && !/^[a-z]+(_[a-z]+)*_?\d+$/i.test(p.label)) pill(p.label, X(p.x), Z(p.z), "rgba(255,255,255,.92)", "#2a2f3a");
  // districts: big, faint, uppercase — the way a printed map names neighbourhoods
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const sec of map.sections) {
    const cx = X((sec.rect[0] + sec.rect[2]) / 2), cy = Z((sec.rect[1] + sec.rect[3]) / 2);
    const size = Math.max(11, Math.min(20, ((sec.rect[2] - sec.rect[0]) * s) / 12));
    ctx.font = `800 ${size}px system-ui, sans-serif`;
    const text = sec.name.toUpperCase();
    const tw = ctx.measureText(text).width;
    if (!free(cx - tw / 2, cy - size / 2, cx + tw / 2, cy + size / 2)) continue;
    used.push([cx - tw / 2, cy - size / 2, cx + tw / 2, cy + size / 2]);
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.strokeText(text, cx, cy);
    ctx.fillStyle = "rgba(70,60,90,.72)"; ctx.fillText(text, cx, cy);
  }
}

/** Small round map on the HUD; tap to open the full map. */
export function MiniMapWidget() {
  const ref = useRef<HTMLCanvasElement>(null);
  const map = useMap();
  const set = useGame((s) => s.set);
  const myHome = useGame((s) => s.home?.id ?? null);
  const pin = useGame((s) => s.pin);
  const { inGame, isSeeker } = useRole();
  const inGroup = useGame((s) => !!s.group); // the Coach bar is taller during a game
  const touring = useGame((s) => (s.gameGuide === "on" ? "guide" : s.onboard === "welcome" ? null : s.onboard)); // the tour / guide card sits at the top
  useEffect(() => {
    if (!map) return;
    const id = setInterval(() => {
      const c = ref.current, ctx = c?.getContext("2d");
      if (!c || !ctx) return;
      const here = pin?.kind === "here" && pin.map === map.id ? pin : null;
      draw(ctx, map, { cx: local.x, cz: local.z, s: 2.2 }, c.width, c.height, myHome, here);
    }, 200);
    return () => clearInterval(id);
  }, [map, myHome, pin]);
  if (!map || (inGame && isSeeker)) return null;
  return (
    <button aria-label="Open map" onClick={() => { set({ mapOpen: true }); sound.play("pop"); }}
      className={`pointer-events-auto absolute left-2 ${touring ? "top-[13.8rem]" : inGroup ? "top-[10.6rem]" : "top-[7.4rem]"} ${touring === "roles" ? "hidden" : ""} z-10 h-[76px] w-[76px] overflow-hidden rounded-full border-[3px] border-white/85 shadow-lg active:scale-95`}
      style={{ transition: "transform .2s var(--ease-spring)" }}>
      <canvas ref={ref} width={168} height={168} className="h-full w-full" />
      <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-1.5 text-[9px] font-bold text-white">MAP</span>
    </button>
  );
}

/** Full-screen map: this area (pan, pinch, tap to pin) and Naija (real map, travel). */
export function MapScreen() {
  const open = useGame((s) => s.mapOpen);
  const map = useMap();
  const [tab, setTab] = useState<"here" | "naija">("here");
  const set = useGame((s) => s.set);
  const mini = useGame((s) => !!s.mini) || GAME_ONLY; // just the game: the map is this area, no trips round Naija
  if (!open || !map) return null;
  return (
    <div className="anim-fade pointer-events-auto absolute inset-0 z-[52] flex flex-col bg-[#0a1324]">
      <div className="flex items-center gap-2 px-3 pb-2 pt-[max(env(safe-area-inset-top),10px)]">
        {mini ? (
          <div className="flex-1 truncate font-bold">📍 {map.kind === "hub" ? "Lagos hub" : map.name}</div>
        ) : (
          <div className="segmented flex-1">
            <button data-on={tab === "here"} onClick={() => setTab("here")}>📍 {map.kind === "hub" ? "Lagos hub" : map.name}</button>
            <button data-on={tab === "naija"} onClick={() => setTab("naija")}>🇳🇬 Naija</button>
          </div>
        )}
        <button className="btn btn-ghost px-3 py-1.5" onClick={() => set({ mapOpen: false })}>✕</button>
      </div>
      <div className="relative min-h-0 flex-1">
        {tab === "here" || mini ? <AreaMap map={map} /> : <TravelMap />}
        {/* places built from OpenStreetMap credit it (ODbL) */}
        {map.town && (tab === "here" || mini) && <div className="pointer-events-none absolute bottom-1 right-2 text-[10px] text-black/60">Map data © OpenStreetMap contributors</div>}
      </div>
    </div>
  );
}

function AreaMap({ map }: { map: GameMap }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ cx: local.x, cz: local.z, s: 3 });
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: number; d: number } | null>(null);
  const pin = useGame((s) => (s.pin?.kind === "here" && s.pin.map === map.id ? s.pin : null));
  const myHome = useGame((s) => s.home?.id ?? null);
  const hasCar = useGame((s) => !!s.life.carId);
  const set = useGame((s) => s.set);
  useTicker(250);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const c = ref.current, ctx = c?.getContext("2d");
      if (c && ctx) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = c.clientWidth, h = c.clientHeight;
        if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        draw(ctx, map, view.current, w, h, myHome, pin, undefined, true);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [map, myHome, pin]);

  const toWorld = (cx: number, cy: number) => {
    const c = ref.current!.getBoundingClientRect(), v = view.current;
    return [v.cx + (cx - c.left - c.width / 2) / v.s, v.cz + (cy - c.top - c.height / 2) / v.s] as const;
  };
  const down = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const ps = [...ptrs.current.values()];
    gesture.current = { moved: 0, d: ps.length === 2 ? Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) : 0 };
  };
  const move = (e: React.PointerEvent) => {
    const prev = ptrs.current.get(e.pointerId);
    if (!prev || !gesture.current) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const ps = [...ptrs.current.values()];
    const v = view.current;
    if (ps.length >= 2) {
      const d = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
      if (gesture.current.d) v.s = Math.min(14, Math.max(1.2, v.s * (d / gesture.current.d)));
      gesture.current.d = d;
      gesture.current.moved += 20;
    } else {
      v.cx -= (e.clientX - prev.x) / v.s;
      v.cz -= (e.clientY - prev.y) / v.s;
      gesture.current.moved += Math.hypot(e.clientX - prev.x, e.clientY - prev.y);
    }
  };
  const up = (e: React.PointerEvent) => {
    ptrs.current.delete(e.pointerId);
    const g = gesture.current;
    if (g && g.moved < 8 && ptrs.current.size === 0) {
      const [x, z] = toWorld(e.clientX, e.clientY);
      const zone = map.zones.find((zn) => x >= zn.rect[0] - 2 && x <= zn.rect[2] + 2 && z >= zn.rect[1] - 2 && z <= zn.rect[3] + 2);
      const home = map.homes?.find((hm) => x >= hm.rect[0] && x <= hm.rect[2] && z >= hm.rect[1] && z <= hm.rect[3]);
      const label = zone ? `${ZONE_ICON[zone.kind] ?? "📍"} ${zone.name}` : home ? `🏠 ${home.name}` : "📍 Pinned spot";
      const at = zone ? [(zone.rect[0] + zone.rect[2]) / 2, (zone.rect[1] + zone.rect[3]) / 2] : home ? home.door : [x, z];
      set({ pin: { kind: "here", map: map.id, x: at[0], z: at[1], label } });
      sound.play("pop");
    }
    if (ptrs.current.size === 0) gesture.current = null;
  };
  const wheel = (e: React.WheelEvent) => { view.current.s = Math.min(14, Math.max(1.2, view.current.s * Math.exp(-e.deltaY / 400))); };
  const go = (drive: boolean) => {
    if (!pin) return;
    const st = useGame.getState();
    if (drive) { local.drive = true; st.set({ driving: true }); }
    if (!walkTo(pin.x, pin.z)) st.toast("Can't find a way there", "error");
    st.set({ mapOpen: false, guide: { x: pin.x, z: pin.z, label: pin.label } });
  };
  const places = [
    ...map.zones.map((z) => ({ label: `${ZONE_ICON[z.kind] ?? "📍"} ${z.name}`, x: (z.rect[0] + z.rect[2]) / 2, z: (z.rect[1] + z.rect[3]) / 2 })),
    ...(myHome && map.homes ? map.homes.filter((h) => h.id === myHome).map((h) => ({ label: "🏠 My house", x: h.door[0], z: h.door[1] })) : []),
  ];
  return (
    <div className="absolute inset-0 flex flex-col">
      <canvas ref={ref} className="min-h-0 w-full flex-1 touch-none" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel} />
      <div className="absolute right-3 top-3 flex flex-col gap-2">
        <button className="btn btn-ghost h-10 w-10 bg-black/40 p-0 text-lg" onClick={() => { view.current.s = Math.min(14, view.current.s * 1.4); }}>＋</button>
        <button className="btn btn-ghost h-10 w-10 bg-black/40 p-0 text-lg" onClick={() => { view.current.s = Math.max(1.2, view.current.s / 1.4); }}>－</button>
        <button className="btn btn-ghost h-10 w-10 bg-black/40 p-0 text-lg" onClick={() => Object.assign(view.current, { cx: local.x, cz: local.z })}>◎</button>
      </div>
      <div className="panel anim-sheet m-2 space-y-2 p-3">
        {pin ? (
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 truncate text-sm font-bold">{pin.label}</div>
            <button className="btn btn-primary px-3 py-1.5 text-sm" onClick={() => go(false)}>🚶🏾 Walk</button>
            {hasCar && <button className="btn btn-ghost px-3 py-1.5 text-sm" onClick={() => go(true)}>🚗 Drive</button>}
            <button className="btn btn-ghost px-2 py-1.5 text-sm" onClick={() => set({ pin: null })}>✕</button>
          </div>
        ) : (
          <div className="text-xs opacity-75">Tap anywhere to drop a pin. Drag to move, pinch to zoom.</div>
        )}
        <div className="touch-scroll-x flex gap-1.5 overflow-x-auto pb-0.5">
          {places.map((p) => (
            <button key={p.label} className="shrink-0 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold"
              onClick={() => { set({ pin: { kind: "here", map: map.id, x: p.x, z: p.z, label: p.label } }); Object.assign(view.current, { cx: p.x, cz: p.z }); }}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Real map of Nigeria: pin a city venue (or home), then board at the bus stop or drive there. */
function TravelMap() {
  const cfg = useGame((s) => s.content?.config);
  const maps = useGame((s) => s.content?.maps);
  const mapId = useGame((s) => s.mapId);
  const pin = useGame((s) => (s.pin?.kind === "trip" ? s.pin : null));
  const hasCar = useGame((s) => !!s.life.carId);
  const set = useGame((s) => s.set);
  if (!cfg || !maps) return null;
  const here = mapId === "hub_plaza" ? "hub" : mapId;
  const dests = [
    { to: "hub", label: "🏠 Home · Lagos hub", lat: HUB_LNGLAT[1], lng: HUB_LNGLAT[0] },
    ...cfg.cities.flatMap((c) => c.arenas.map((a) => ({ to: a, label: `🌳 ${maps[a]?.venue?.name ?? maps[a]?.name ?? a}`, lat: maps[a]?.venue?.lat ?? c.lat, lng: maps[a]?.venue?.lng ?? c.lng }))),
  ].filter((d) => d.to !== here);
  const fares = (to: string) => (cfg.cities.find((c) => c.arenas.includes(to === "hub" ? (mapId ?? "") : to))?.fares ?? cfg.fares);
  const board = () => {
    if (!pin) return;
    const st = useGame.getState();
    const stop = maps[mapId ?? ""]?.zones.find((z) => z.kind === "bus_stop");
    if (stop) {
      const x = (stop.rect[0] + stop.rect[2]) / 2, z = (stop.rect[1] + stop.rect[3]) / 2;
      walkTo(x, z);
      st.set({ guide: { x, z, label: "🚏 Board here" }, mapOpen: false });
      st.toast(`Waka go the bus stop — board for ${pin.label.replace(/^\S+\s/, "")}`, "good");
    }
  };
  const drive = () => {
    if (!pin) return;
    net.send({ t: "trip", to: pin.to, mode: "own_car", key: crypto.randomUUID() });
    set({ mapOpen: false });
  };
  return (
    <div className="absolute inset-0 flex flex-col">
      <NaijaMap dests={dests} selected={pin?.to ?? null} onSelect={(to) => { const d = dests.find((x) => x.to === to); if (d) set({ pin: { kind: "trip", to, label: d.label } }); }} className="min-h-0 w-full flex-1" />
      <div className="panel anim-sheet m-2 space-y-2 p-3">
        {pin ? (
          <>
            <div className="text-sm font-black">{pin.label}</div>
            <div className="text-xs opacity-75">By bus from the 🚏 bus stop: {fares(pin.to).map((f) => `${f.name} ${naira(f.price)}`).join(" · ")}</div>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn btn-primary text-sm" onClick={board}>🚏 Go to the bus stop</button>
              <button className="btn btn-ghost text-sm" disabled={!hasCar} onClick={drive}>{hasCar ? "🚗 Drive there" : "🚗 Buy a car first"}</button>
            </div>
          </>
        ) : (
          <div className="text-xs opacity-75">Tap a city pin to plan a trip. You can explore any city venue, even without a game.</div>
        )}
        <div className="touch-scroll-x flex gap-1.5 overflow-x-auto pb-0.5">
          {dests.map((d) => (
            <button key={d.to} className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${pin?.to === d.to ? "bg-[var(--accent)]" : "bg-white/10"}`}
              onClick={() => set({ pin: { kind: "trip", to: d.to, label: d.label } })}>{d.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
