"use client";

import { useEffect, useMemo, useState } from "react";
import { flightPath, HUB_LNGLAT, lineKm, routeBetween, type LngLat } from "@/lib/geo";
import { useGame } from "@/lib/store";
import WorldMap, { type Place } from "./WorldMap";

/** Rides, the city picker and the travel map all use our own map (src/ui/WorldMap.tsx). */

const MODE_ICON: Record<string, string> = { danfo: "🚌", keke: "🛺", bus: "🚍", car: "🚗", flight: "✈️", own_car: "🚘" };
const MODE_NAME: Record<string, string> = { danfo: "Danfo", keke: "Keke", bus: "Bus", car: "Shared car", flight: "Flight", own_car: "Your car" };

// ------------------------------------------------------------------ ride
/** Full-screen ride: your vehicle travels our roads from the Lagos hub to the venue (or back home). */
export function RideMap() {
  const ride = useGame((s) => s.ride);
  const maps = useGame((s) => s.content?.maps);
  const set = useGame((s) => s.set);
  const [progress, setProgress] = useState(0);

  const plan = useMemo(() => {
    if (!ride || !maps) return null;
    const venue = maps[ride.arena]?.venue;
    const there: LngLat = venue ? [venue.lng, venue.lat] : HUB_LNGLAT;
    const [a, b] = ride.dir === "home" ? [there, HUB_LNGLAT] : [HUB_LNGLAT, there];
    const pts = ride.mode === "flight" ? flightPath(a, b) : routeBetween(a, b);
    const lngs = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
    // short Lagos rides still show some of the city around them
    const pad = Math.max(0, 0.09 - (Math.max(...lngs) - Math.min(...lngs))) / 2;
    const fit: [LngLat, LngLat] = [[Math.min(...lngs) - pad, Math.min(...lats) - pad], [Math.max(...lngs) + pad, Math.max(...lats) + pad]];
    const venueName = venue?.name ?? maps[ride.arena]?.name ?? "the venue";
    return { pts, fit, km: lineKm(pts), from: ride.dir === "home" ? venueName : "Lagos hub", to: ride.dir === "home" ? "Lagos hub (home)" : venueName };
  }, [ride, maps]);

  useEffect(() => {
    if (!ride) return;
    const start = Date.now(), total = Math.max(1, ride.until - start);
    let raf = 0;
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / total);
      setProgress(t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2); // ease in-out like a real ride
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    setProgress(0);
    raf = requestAnimationFrame(tick);
    const done = setTimeout(() => {
      set({ ride: null });
    }, total + 900);
    return () => { cancelAnimationFrame(raf); clearTimeout(done); };
  }, [ride, set]);

  if (!ride || !plan) return null;
  const left = Math.max(0, Math.ceil((1 - progress) * ride.seconds));
  return (
    <div className="anim-fade absolute inset-0 z-[55]">
      <WorldMap route={plan.pts} progress={progress} vehicle={MODE_ICON[ride.mode] ?? "🚌"} fit={plan.fit} interactive={false} className="absolute inset-0" />
      <div className="panel anim-banner absolute left-3 right-3 top-3 mx-auto max-w-md p-3">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[var(--accent)] text-2xl">{MODE_ICON[ride.mode] ?? "🚌"}</span>
          <div className="min-w-0 flex-1">
            <div className="text-xs opacity-75">{MODE_NAME[ride.mode] ?? "Ride"} · {Math.max(1, Math.round(plan.km))} km</div>
            <div className="truncate font-bold">{plan.from} → {plan.to}</div>
          </div>
          <span className="text-sm font-black tabular-nums">{progress >= 1 ? "✓" : `${left}s`}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/15">
          <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="mt-1 text-[11px] opacity-70">{progress >= 1 ? (ride.dir === "home" ? "Home sweet home 🏠" : "We don reach! 🙌🏾") : ride.dir === "home" ? "Heading back home — good game! 🙌🏾" : ride.mode === "flight" ? "Fasten your seatbelt — Abuja here we come!" : ride.mode === "own_car" ? "Your own motor — no conductor wahala 😎" : "Conductor: “Enter with your change o!”"}</div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ city picker
/** Nigeria map with a pin per playable city. */
export function CityMap({ selected, onSelect, className }: { selected: string; onSelect: (id: string) => void; className?: string }) {
  const cities = useGame((s) => s.content?.config.cities);
  const places: Place[] = useMemo(() => (cities ?? []).map((c) => ({ id: c.id, label: c.name, lng: c.lng, lat: c.lat, icon: "📍", kind: "city" })), [cities]);
  const c = cities?.find((x) => x.id === selected);
  return (
    <WorldMap places={places} selected={selected} onSelect={onSelect} interactive={false} showDistricts={false}
      focus={c ? { at: [c.lng, c.lat], s: 0.9 } : null} className={className} />
  );
}

// ------------------------------------------------------------------ Naija travel map
/** Interactive map of Nigeria with a pin per destination (pan, pinch, tap a pin). */
export function NaijaMap({ dests, selected, onSelect, className }: {
  dests: { to: string; label: string; lat: number; lng: number }[]; selected: string | null; onSelect: (to: string) => void; className?: string;
}) {
  const [look, setLook] = useState<string | null>(null);
  const places: Place[] = useMemo(() => {
    const out: Place[] = dests.map((d) => ({ id: d.to, label: d.label.replace(/^\S+\s/, ""), lng: d.lng, lat: d.lat, icon: d.to === "hub" ? "🙈" : "🌳", kind: d.to === "hub" ? "hub" : "venue" }));
    // you can always find our Lagos hub on the map, even while you're in it
    if (!dests.some((d) => d.to === "hub")) out.push({ id: "here:hub", label: "You're here · Lagos hub", lng: HUB_LNGLAT[0], lat: HUB_LNGLAT[1], icon: "🙈", kind: "hub" });
    return out;
  }, [dests]);
  const focusId = look ?? selected;
  const f = places.find((x) => x.id === focusId);
  return (
    <WorldMap places={places} selected={selected ?? look} className={className}
      onSelect={(id) => { setLook(id); if (!id.startsWith("here:")) onSelect(id); }}
      focus={f ? { at: [f.lng, f.lat], s: f.kind === "hub" ? 2600 : 30 } : null} />
  );
}
