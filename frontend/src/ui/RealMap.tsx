"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MLMap, Marker, StyleSpecification } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { API_URL } from "@/lib/api";
import { useGame } from "@/lib/store";

/**
 * Real-world maps (MapLibre GL + free OpenFreeMap tiles, © OpenStreetMap).
 * If the tiles can't load (bad network), we fall back to a plain style so the
 * route and the moving vehicle still show.
 */
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const FALLBACK: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#dfe9f5" } }],
};

let stylePromise: Promise<string | StyleSpecification> | null = null;
function pickStyle(): Promise<string | StyleSpecification> {
  stylePromise ??= (async () => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4500);
      const r = await fetch(STYLE_URL, { signal: ctrl.signal });
      clearTimeout(t);
      return r.ok ? STYLE_URL : FALLBACK;
    } catch {
      stylePromise = null; // try again next time
      return FALLBACK;
    }
  })();
  return stylePromise;
}

async function createMap(el: HTMLDivElement, center: [number, number], zoom: number): Promise<{ map: MLMap; ml: typeof import("maplibre-gl") }> {
  const ml = await import("maplibre-gl");
  const style = await pickStyle();
  const map = new ml.Map({
    container: el,
    style,
    center,
    zoom,
    attributionControl: { compact: true, customAttribution: "© OpenStreetMap contributors · OpenFreeMap" },
    dragRotate: false,
    pitchWithRotate: false,
  });
  await new Promise<void>((res) => (map.loaded() ? res() : map.once("load", () => res())));
  map.resize();
  return { map, ml };
}

function pinEl(html: string, cls: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = cls;
  el.innerHTML = html;
  return el;
}

// ------------------------------------------------------------------ ride
interface Route { from: { name: string; lng: number; lat: number }; to: { name: string; lng: number; lat: number }; coords: [number, number][]; source: string }

const MODE_ICON: Record<string, string> = { danfo: "🚌", keke: "🛺", bus: "🚍", car: "🚗", flight: "✈️" };
const MODE_NAME: Record<string, string> = { danfo: "Danfo", keke: "Keke", bus: "Bus", car: "Shared car", flight: "Flight" };

function haversine(a: [number, number], b: [number, number]): number {
  const R = 6371, toR = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toR, dLng = (b[0] - a[0]) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toR) * Math.cos(b[1] * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Full-screen ride: the vehicle travels the real route from your home area to the venue. */
export function RideMap() {
  const ride = useGame((s) => s.ride);
  const homeArea = useGame((s) => s.homeArea);
  const maps = useGame((s) => s.content?.maps);
  const set = useGame((s) => s.set);
  const box = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState<{ km: number; from: string; to: string } | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!ride || !box.current) return;
    let alive = true, raf = 0;
    let map: MLMap | null = null;
    const start = Date.now();
    const total = Math.max(1, ride.until - start);
    (async () => {
      const q = new URLSearchParams({ home: homeArea ?? "Yaba", arena: ride.arena, mode: ride.mode });
      let route: Route;
      try {
        route = (await (await fetch(`${API_URL}/api/route?${q}`)).json()) as Route;
      } catch {
        return;
      }
      if (!alive || !box.current || !route.coords?.length) return;
      const { map: m, ml } = await createMap(box.current, route.coords[0], 11);
      if (!alive) { m.remove(); return; }
      map = m;
      const coords = route.coords;
      const cum = [0];
      for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
      const km = cum[cum.length - 1];
      setInfo({ km, from: route.from.name, to: maps?.[ride.arena]?.venue?.name ?? route.to.name });
      m.addSource("route", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } } });
      m.addSource("done", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [coords[0]] } } });
      m.addLayer({ id: "route-casing", type: "line", source: "route", paint: { "line-color": "#ffffff", "line-width": 9 }, layout: { "line-cap": "round", "line-join": "round" } });
      m.addLayer({ id: "route", type: "line", source: "route", paint: { "line-color": "#9cc3ff", "line-width": 5, ...(ride.mode === "flight" ? { "line-dasharray": [1.5, 1.5] } : {}) }, layout: { "line-cap": "round", "line-join": "round" } });
      m.addLayer({ id: "done", type: "line", source: "done", paint: { "line-color": "#2f7cf6", "line-width": 6 }, layout: { "line-cap": "round", "line-join": "round" } });
      new ml.Marker({ element: pinEl("🏠", "grid h-8 w-8 place-items-center rounded-full bg-white text-lg shadow-lg") }).setLngLat(coords[0]).addTo(m);
      new ml.Marker({ element: pinEl("🌳", "grid h-9 w-9 place-items-center rounded-full bg-[#22b573] text-lg shadow-lg ring-4 ring-white") }).setLngLat(coords[coords.length - 1]).addTo(m);
      const vehicle: Marker = new ml.Marker({ element: pinEl(MODE_ICON[ride.mode] ?? "🚌", "grid h-11 w-11 place-items-center rounded-full bg-[#2f7cf6] text-2xl shadow-xl ring-4 ring-white") })
        .setLngLat(coords[0]).addTo(m);
      const bounds = coords.reduce((b, c) => b.extend(c), new ml.LngLatBounds(coords[0], coords[0]));
      const follow = km < 60 && ride.mode !== "flight";
      m.fitBounds(bounds, { padding: 60, duration: 0 });
      const tick = () => {
        if (!alive) return;
        const t = Math.min(1, (Date.now() - start) / total);
        const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; // ease in-out, like a real ride
        const target = e * km;
        let i = 1;
        while (i < cum.length - 1 && cum[i] < target) i++;
        const seg = cum[i] - cum[i - 1] || 1;
        const k = Math.max(0, Math.min(1, (target - cum[i - 1]) / seg));
        const p: [number, number] = [coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * k, coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * k];
        vehicle.setLngLat(p);
        (m.getSource("done") as unknown as { setData: (d: unknown) => void }).setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [...coords.slice(0, i), p] } });
        if (follow && t > 0.12) m.jumpTo({ center: p, zoom: Math.min(14, m.getZoom() + 0.02) });
        setProgress(t);
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    })();
    return () => { alive = false; cancelAnimationFrame(raf); map?.remove(); };
  }, [ride, homeArea, maps]);

  useEffect(() => {
    if (!ride) return;
    const id = setTimeout(() => set({ ride: null }), Math.max(0, ride.until - Date.now()) + 900);
    return () => clearTimeout(id);
  }, [ride, set]);

  if (!ride) return null;
  const left = Math.max(0, Math.ceil((1 - progress) * ride.seconds));
  return (
    <div className="anim-fade absolute inset-0 z-[55] bg-[#dfe9f5]">
      {/* maplibre's CSS forces position:relative on the container, so size it explicitly */}
      <div className="absolute inset-0"><div ref={box} style={{ width: "100%", height: "100%" }} /></div>
      <div className="panel anim-banner absolute left-3 right-3 top-3 mx-auto max-w-md p-3">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[var(--accent)] text-2xl">{MODE_ICON[ride.mode] ?? "🚌"}</span>
          <div className="min-w-0 flex-1">
            <div className="text-xs opacity-75">{MODE_NAME[ride.mode] ?? "Ride"} · {info ? `${Math.round(info.km)} km` : "finding route…"}</div>
            <div className="truncate font-bold">{info ? `${info.from} → ${info.to}` : "Oya, we dey go!"}</div>
          </div>
          <span className="text-sm font-black tabular-nums">{progress >= 1 ? "✓" : `${left}s`}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/15">
          <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="mt-1 text-[11px] opacity-70">{progress >= 1 ? "We don reach! Enter the arena 🙌🏾" : ride.mode === "flight" ? "Fasten your seatbelt — Abuja here we come!" : "Conductor: “Enter with your change o!”"}</div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ city picker
/** Nigeria map with a pin per playable city. */
export function CityMap({ selected, onSelect, className }: { selected: string; onSelect: (id: string) => void; className?: string }) {
  const cities = useGame((s) => s.content?.config.cities);
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const pins = useRef<Record<string, HTMLDivElement>>({});
  const [ready, setReady] = useState(false);
  const pick = useRef(onSelect);
  pick.current = onSelect;

  useEffect(() => {
    if (!box.current || !cities) return;
    let alive = true;
    (async () => {
      const { map, ml } = await createMap(box.current!, [5.6, 7.6], 4.9);
      if (!alive) { map.remove(); return; }
      mapRef.current = map;
      for (const c of cities) {
        const el = pinEl(`📍 ${c.name}`, "cursor-pointer whitespace-nowrap rounded-full bg-[#0a1324]/85 px-2.5 py-1 text-xs font-bold text-white shadow-lg transition-transform duration-300");
        el.onclick = () => pick.current(c.id);
        pins.current[c.id] = el;
        new ml.Marker({ element: el }).setLngLat([c.lng, c.lat]).addTo(map);
      }
      setReady(true);
    })();
    return () => { alive = false; mapRef.current?.remove(); mapRef.current = null; pins.current = {}; };
  }, [cities]);

  useEffect(() => {
    const c = cities?.find((x) => x.id === selected);
    for (const [id, el] of Object.entries(pins.current)) {
      el.style.transform = id === selected ? "scale(1.25)" : "scale(1)";
      el.style.background = id === selected ? "#2f7cf6" : "rgba(10,19,36,.85)";
    }
    if (c && mapRef.current) mapRef.current.flyTo({ center: [c.lng, c.lat], zoom: 6.2, duration: 1400, essential: true });
  }, [selected, cities, ready]);

  return <div ref={box} className={className} />;
}
