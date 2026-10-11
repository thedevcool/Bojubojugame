"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CITIES, HUB_LNGLAT, ISLANDS, LAGOONS, LAKE_CHAD, NIGERIA, OCEAN, RIVERS, ROADS, metresToLngLat, type LngLat } from "@/lib/geo";
import { useGame } from "@/lib/store";
import type { GameMap } from "@/lib/types";

/**
 * Boju Boju's own map (pure SVG, no third-party tiles): Nigeria, rivers, roads,
 * cities and every place in the game. Zoom into Lagos and our hub district's
 * real street plan appears.
 */
const LAT0 = 8;
const K = 100; // map units per degree
const COS = Math.cos((LAT0 * Math.PI) / 180);
export const project = ([lng, lat]: LngLat): [number, number] => [lng * COS * K, -lat * K];
const pathOf = (pts: LngLat[], close = true) => pts.map((p, i) => `${i ? "L" : "M"}${project(p)[0].toFixed(3)},${project(p)[1].toFixed(3)}`).join("") + (close ? "Z" : "");

export interface Place { id: string; label: string; lng: number; lat: number; icon: string; kind: "venue" | "area" | "hub" | "city" }
interface View { cx: number; cy: number; s: number }

const MIN_S = 0.2, MAX_S = 4000;

function fitView(bounds: [LngLat, LngLat], w: number, h: number, pad = 40): View {
  const [a, b] = [project(bounds[0]), project(bounds[1])];
  const dx = Math.abs(a[0] - b[0]) || 0.01, dy = Math.abs(a[1] - b[1]) || 0.01;
  const s = Math.min((w - pad * 2) / dx, (h - pad * 2) / dy);
  return { cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, s: Math.max(MIN_S, Math.min(MAX_S, s)) };
}

/** Our hub (and arena venues) drawn at their spot on the map, from the real game maps. */
function GameDistrict({ map, anchor }: { map: GameMap; anchor: LngLat }) {
  const rect = (x0: number, z0: number, x1: number, z1: number) => pathOf([metresToLngLat(anchor, x0, z0), metresToLngLat(anchor, x1, z0), metresToLngLat(anchor, x1, z1), metresToLngLat(anchor, x0, z1)]);
  const [bx0, bz0, bx1, bz1] = map.bounds;
  return (
    <g>
      <path d={rect(bx0, bz0, bx1, bz1)} fill={map.kind === "hub" ? "#efe4cc" : "#d4e8bd"} stroke="#c9b48f" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {map.props.filter((p) => p.kind === "lawn" || p.kind === "field").map((p, i) => <path key={`l${i}`} d={rect(p.x - p.w / 2, p.z - p.d / 2, p.x + p.w / 2, p.z + p.d / 2)} fill="#bcdba0" />)}
      {map.props.filter((p) => p.kind === "road").map((p, i) => <path key={`r${i}`} d={rect(p.x - p.w / 2, p.z - p.d / 2, p.x + p.w / 2, p.z + p.d / 2)} fill="#a3acb7" />)}
      {map.props.filter((p) => p.collider && !["tree", "palm", "lamp", "pole", "wall"].includes(p.kind)).map((p, i) => {
        const c = p.collider!;
        return <path key={`b${i}`} d={rect(c[0], c[1], c[2], c[3])} fill="#d6c7ad" />;
      })}
      {(map.homes ?? []).map((h) => <path key={h.id} d={rect(h.rect[0], h.rect[1], h.rect[2], h.rect[3])} fill="#f5e6c8" stroke="#8b6b4a" strokeWidth={0.8} vectorEffect="non-scaling-stroke" />)}
      {map.zones.map((z) => <path key={z.id} d={rect(z.rect[0], z.rect[1], z.rect[2], z.rect[3])} fill={z.kind === "bus_stop" ? "#f7c500" : z.kind === "food" ? "#ff9a4a" : "#9db8ff"} opacity={0.9} />)}
    </g>
  );
}

export default function WorldMap({
  places = [], selected = null, onSelect, route, progress = 0, vehicle, focus, fit, interactive = true, className, showDistricts = true,
}: {
  places?: Place[]; selected?: string | null; onSelect?: (id: string) => void;
  route?: LngLat[]; progress?: number; vehicle?: string; focus?: { at: LngLat; s: number } | null; fit?: [LngLat, LngLat];
  interactive?: boolean; className?: string; showDistricts?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 360, h: 480 });
  const [view, setView] = useState<View>(() => fitView(fit ?? [[2.6, 4.2], [14.7, 13.9]], 360, 480));
  const viewRef = useRef(view);
  viewRef.current = view;
  const anim = useRef(0);
  const maps = useGame((s) => s.content?.maps);

  // track size; refit when the box first gets real dimensions
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      setSize((old) => {
        if (old.w === 360 && old.h === 480) setView(fitView(fit ?? [[2.6, 4.2], [14.7, 13.9]], w, h));
        return { w, h };
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // smooth fly-to (iOS-style ease) when the focus changes
  const flyTo = (to: View, ms = 1100) => {
    cancelAnimationFrame(anim.current);
    const from = { ...viewRef.current }, t0 = performance.now();
    const ls0 = Math.log(from.s), ls1 = Math.log(to.s);
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      setView({ cx: from.cx + (to.cx - from.cx) * e, cy: from.cy + (to.cy - from.cy) * e, s: Math.exp(ls0 + (ls1 - ls0) * e) });
      if (t < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  };
  const focusKey = focus ? `${focus.at[0]},${focus.at[1]},${focus.s}` : "";
  useEffect(() => {
    if (!focus) return;
    const [cx, cy] = project(focus.at);
    flyTo({ cx, cy, s: focus.s });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);
  const fitKey = fit ? fit.flat().join() : "";
  useEffect(() => {
    if (fit && size.w !== 360) flyTo(fitView(fit, size.w, size.h, 50), 800);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, size.w, size.h]);

  // gestures: drag to pan, pinch / wheel to zoom
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef(0);
  const down = (e: React.PointerEvent) => {
    if (!interactive) return;
    cancelAnimationFrame(anim.current);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const ps = [...ptrs.current.values()];
    pinch.current = ps.length === 2 ? Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) : 0;
  };
  const move = (e: React.PointerEvent) => {
    const prev = ptrs.current.get(e.pointerId);
    if (!prev) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const ps = [...ptrs.current.values()];
    const v = viewRef.current;
    if (ps.length >= 2 && pinch.current) {
      const d = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
      setView({ ...v, s: Math.max(MIN_S, Math.min(MAX_S, v.s * (d / pinch.current))) });
      pinch.current = d;
    } else if (ps.length === 1) {
      setView({ ...v, cx: v.cx - (e.clientX - prev.x) / v.s, cy: v.cy - (e.clientY - prev.y) / v.s });
    }
  };
  const up = (e: React.PointerEvent) => { ptrs.current.delete(e.pointerId); pinch.current = 0; };
  const wheel = (e: React.WheelEvent) => {
    if (!interactive) return;
    const v = viewRef.current;
    setView({ ...v, s: Math.max(MIN_S, Math.min(MAX_S, v.s * Math.exp(-e.deltaY / 300))) });
  };

  const { w, h } = size;
  const { cx, cy, s } = view;
  const toScreen = (p: LngLat): [number, number] => { const [x, y] = project(p); return [(x - cx) * s + w / 2, (y - cy) * s + h / 2]; };
  const onScreen = ([x, y]: [number, number], m = 40) => x > -m && y > -m && x < w + m && y < h + m;

  const routePath = useMemo(() => (route && route.length > 1 ? pathOf(route, false) : ""), [route]);
  const routePoint = useMemo(() => {
    if (!route || route.length < 2) return null;
    const seg = route.slice(1).map((p, i) => Math.hypot(p[0] - route[i][0], p[1] - route[i][1]));
    const total = seg.reduce((a, b) => a + b, 0);
    let target = total * Math.max(0, Math.min(1, progress)), i = 0;
    while (i < seg.length - 1 && target > seg[i]) { target -= seg[i]; i++; }
    const k = seg[i] ? target / seg[i] : 0;
    const p: LngLat = [route[i][0] + (route[i + 1][0] - route[i][0]) * k, route[i][1] + (route[i + 1][1] - route[i][1]) * k];
    return { p, done: [...route.slice(0, i + 1), p] };
  }, [route, progress]);

  // labels shown depend on zoom (Nigeria → state of Lagos → our streets)
  const showLocal = s > 25, showDistrict = s > 160;
  const hub = maps?.hub_plaza;
  return (
    <div ref={box} className={`${/\b(absolute|fixed)\b/.test(className ?? "") ? "" : "relative"} overflow-hidden bg-[#9fd0ec] ${className ?? ""}`} style={{ touchAction: "none" }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel}>
      <svg width={w} height={h} className="absolute inset-0 select-none">
        <defs>
          <pattern id="wm-sea" width="14" height="14" patternUnits="userSpaceOnUse">
            <path d="M0 7 Q3.5 4 7 7 T14 7" fill="none" stroke="#ffffff" strokeOpacity="0.18" strokeWidth="1" />
          </pattern>
          <filter id="wm-shadow" x="-5%" y="-5%" width="110%" height="110%"><feDropShadow dx="0" dy="1.5" stdDeviation="2" floodOpacity="0.25" /></filter>
        </defs>
        <rect width={w} height={h} fill="#e6dcc6" />
        <g transform={`translate(${w / 2} ${h / 2}) scale(${s}) translate(${-cx} ${-cy})`}>
          <path d={pathOf(OCEAN)} fill="#8ec8ea" />
          <path d={pathOf(OCEAN)} fill="url(#wm-sea)" />
          <path d={pathOf(NIGERIA)} fill="#eef3df" stroke="#2f9e57" strokeWidth={2} strokeDasharray="6 3" vectorEffect="non-scaling-stroke" filter="url(#wm-shadow)" />
          <path d={pathOf(LAKE_CHAD)} fill="#8ec8ea" />
          {LAGOONS.map((l, i) => <path key={i} d={pathOf(l)} fill="#8ec8ea" />)}
          {ISLANDS.map((l) => <path key={l.name} d={pathOf(l.pts)} fill="#eef3df" stroke="#c9d6b4" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />)}
          {RIVERS.map((r) => <path key={r.name} d={pathOf(r.pts, false)} fill="none" stroke="#6fb3dd" strokeWidth={s > 5 ? 4 : 2.2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)}
          {ROADS.filter((r) => r.kind !== "major" || showLocal).map((r) => (
            <g key={r.name}>
              <path d={pathOf(r.pts, false)} fill="none" stroke="#ffffff" strokeWidth={r.kind === "expressway" ? (showLocal ? 7 : 4) : 5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              <path d={pathOf(r.pts, false)} fill="none" stroke={r.kind === "expressway" ? "#f4a52c" : r.kind === "bridge" ? "#c8ccd2" : "#ffd98a"} strokeWidth={r.kind === "expressway" ? (showLocal ? 4.5 : 2.4) : 3} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </g>
          ))}
          {showDistricts && showDistrict && hub && <GameDistrict map={hub} anchor={HUB_LNGLAT} />}
          {showDistricts && showDistrict && maps && Object.values(maps).filter((m) => m.kind === "arena" && m.venue).map((m) => <GameDistrict key={m.id} map={m} anchor={[m.venue!.lng, m.venue!.lat]} />)}
          {routePath && (
            <>
              <path d={routePath} fill="none" stroke="#ffffff" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              <path d={routePath} fill="none" stroke="#9cc3ff" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" strokeDasharray={vehicle === "✈️" ? "8 6" : undefined} />
              {routePoint && <path d={pathOf(routePoint.done, false)} fill="none" stroke="#2f7cf6" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
            </>
          )}
        </g>
        {/* screen-space labels */}
        <g fontFamily="system-ui, sans-serif" style={{ paintOrder: "stroke" }} stroke="#ffffff" strokeWidth={3} strokeLinejoin="round">
          {CITIES.filter((c) => c.big || s > 0.9).map((c) => {
            const pt = toScreen([c.lng, c.lat]);
            if (!onScreen(pt)) return null;
            return (
              <g key={c.name}>
                <circle cx={pt[0]} cy={pt[1]} r={c.big ? 3.5 : 2.5} fill="#5d6778" stroke="#ffffff" strokeWidth={1.5} />
                <text x={pt[0] + 6} y={pt[1] + 4} fontSize={c.big ? 12 : 10.5} fontWeight={c.big ? 800 : 600} fill="#3a4250">{c.name}</text>
              </g>
            );
          })}
          {showLocal && ROADS.filter((r) => r.kind !== "expressway" || s > 40).map((r) => {
            const mid = r.pts[Math.floor(r.pts.length / 2)];
            const pt = toScreen(mid);
            return onScreen(pt, 0) ? <text key={r.name} x={pt[0]} y={pt[1] - 6} fontSize={9.5} fontWeight={600} fill="#8a6a2a" textAnchor="middle">{r.name}</text> : null;
          })}
          {s < 2 && <text x={toScreen([8.4, 9.6])[0]} y={toScreen([8.4, 9.6])[1]} fontSize={18} fontWeight={900} fill="#2f9e57" fillOpacity={0.45} textAnchor="middle" letterSpacing={6}>NIGERIA</text>}
          {s > 3 && s < 60 && RIVERS.map((r) => { const pt = toScreen(r.pts[Math.floor(r.pts.length / 2)]); return onScreen(pt, 0) ? <text key={r.name} x={pt[0]} y={pt[1]} fontSize={10} fontStyle="italic" fill="#3d8cc0">{r.name}</text> : null; })}
          {showDistrict && hub?.sections.map((sec) => {
            const pt = toScreen(metresToLngLat(HUB_LNGLAT, (sec.rect[0] + sec.rect[2]) / 2, (sec.rect[1] + sec.rect[3]) / 2));
            return onScreen(pt, 0) ? <text key={sec.id} x={pt[0]} y={pt[1]} fontSize={11} fontWeight={800} fill="#5b4630" textAnchor="middle">{sec.name}</text> : null;
          })}
        </g>
      </svg>
      {/* tappable pins */}
      {places.map((p) => {
        const pt = toScreen([p.lng, p.lat]);
        if (!onScreen(pt)) return null;
        if (p.kind === "area" && !showLocal) return null;
        const on = p.id === selected;
        return (
          <button key={p.id} onPointerDown={(e) => e.stopPropagation()} onClick={() => onSelect?.(p.id)}
            className={`absolute -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold shadow-lg transition-transform duration-300 ${on ? "scale-110 bg-[#2f7cf6] text-white" : p.kind === "area" ? "bg-white/90 text-[#3a4250]" : "bg-[#0a1324]/85 text-white"}`}
            style={{ left: pt[0], top: pt[1] - 4, transitionTimingFunction: "var(--ease-spring)" }}>
            {p.icon} {p.label}
          </button>
        );
      })}
      {routePoint && vehicle && (() => {
        const pt = toScreen(routePoint.p);
        return <span className="pointer-events-none absolute grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[#2f7cf6] text-2xl shadow-xl ring-4 ring-white" style={{ left: pt[0], top: pt[1] }}>{vehicle}</span>;
      })()}
      {interactive && (
        <div className="absolute right-2 top-2 flex flex-col gap-1.5">
          <button className="grid h-9 w-9 place-items-center rounded-xl bg-white/90 text-lg font-bold text-[#0a1324] shadow" onPointerDown={(e) => e.stopPropagation()} onClick={() => flyTo({ ...view, s: Math.min(MAX_S, view.s * 2) }, 350)}>＋</button>
          <button className="grid h-9 w-9 place-items-center rounded-xl bg-white/90 text-lg font-bold text-[#0a1324] shadow" onPointerDown={(e) => e.stopPropagation()} onClick={() => flyTo({ ...view, s: Math.max(MIN_S, view.s / 2) }, 350)}>－</button>
        </div>
      )}
      <span className="pointer-events-none absolute bottom-1 left-1.5 rounded bg-white/70 px-1.5 text-[9px] font-semibold text-[#3a4250]">🙈 Boju Boju map</span>
    </div>
  );
}

/** Every place in the game, as pins: our hub, city venues, and the Lagos home areas. */
export function usePlaces(): Place[] {
  const cfg = useGame((s) => s.content?.config);
  const maps = useGame((s) => s.content?.maps);
  return useMemo(() => {
    if (!cfg || !maps) return [];
    const out: Place[] = [{ id: "hub", label: "Lagos hub", lng: HUB_LNGLAT[0], lat: HUB_LNGLAT[1], icon: "🙈", kind: "hub" }];
    for (const c of cfg.cities) for (const a of c.arenas) {
      const v = maps[a]?.venue;
      if (v) out.push({ id: a, label: v.name, lng: v.lng, lat: v.lat, icon: "🌳", kind: "venue" });
    }
    for (const [name, [lat, lng]] of Object.entries(cfg.home_coords)) out.push({ id: `area:${name}`, label: name, lng, lat, icon: "📍", kind: "area" });
    return out;
  }, [cfg, maps]);
}
