"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { API_URL, serverFlags, setFlag } from "@/lib/api";
import { net } from "@/lib/net";
import { useGame } from "@/lib/store";

const AvatarPreview = dynamic(() => import("@/game/Previews").then((m) => m.AvatarPreview), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-3xl bg-white/5" />,
});

/** Baba Boju: an elder in a face cap and his favourite ankara. */
const BABA = [3, 2, 0, 0, 3];
const CITIES = {
  lagos: { name: "Lagos", lat: 6.5244, lng: 3.3792, km: 70, arena: "arena_park", safe: "gatehouse" },
  ibadan: { name: "Ibadan", lat: 7.3775, lng: 3.947, km: 45, arena: "arena_ibadan", safe: "hunter_hut" },
} as const;
type City = keyof typeof CITIES;
/** ?realchars=1: preview the realistic characters (not shown to players yet) */
const realPreview = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("realchars");

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/**
 * The storefront: everyone comes in here. Baba Boju welcomes you, asks where you live (Lagos or Ibadan — from your
 * location if you allow it, else you choose), then: play with online players (Match me / Join a group) when
 * anyone else is on, or play with NPCs when nobody is.
 */
export default function Storefront() {
  const front = useGame((s) => s.front);
  const group = useGame((s) => s.group);
  const me = useGame((s) => s.me?.id);
  const name = useGame((s) => s.mini?.name || s.life.username || s.me?.nick || "my friend");
  const set = useGame((s) => s.set);
  const [shown, setShown] = useState(0);
  const [city, setCity] = useState<City | null>(null);
  const [locating, setLocating] = useState(false);
  const [locNote, setLocNote] = useState("");
  const [online, setOnline] = useState<{ online: number; waiting: number } | null>(null);
  const [pickOnline, setPickOnline] = useState(false);

  const speech = `Welcome ${name}, na you we dey wait for! You remember that time we dey play Boju Boju? You miss am, abi? Make we play, see who go beat who. But first, you go train with others — maybe when you don better, you fit come face me.`;

  useEffect(() => { // Baba talks, a few letters at a time
    if (!front) return;
    setShown(0);
    const id = setInterval(() => setShown((n) => (n >= speech.length ? n : n + 2)), 28);
    return () => clearInterval(id);
  }, [front, speech]);
  useEffect(() => { // who's on right now (decides which buttons you get)
    if (!front || !me) return;
    let live = true;
    const poll = () => fetch(`${API_URL}/api/online?pid=${encodeURIComponent(me)}`).then((r) => r.json()).then((d) => live && setOnline(d)).catch(() => {});
    poll();
    const id = setInterval(poll, 8000);
    return () => { live = false; clearInterval(id); };
  }, [front, me]);
  useEffect(() => { if (group && group.phase !== "over") set({ front: false }); }, [group, set]);

  if (!front || (group && group.phase !== "over")) return null;
  // where you live: chosen here, or already saved on your account (it loads a moment after you arrive)
  const saved = serverFlags.city === "lagos" || serverFlags.city === "ibadan" ? (serverFlags.city as City) : null;
  const home = city ?? saved;
  const talking = shown < speech.length;

  const choose = (c: City) => { setCity(c); setFlag("city", c); };
  const locate = () => {
    if (!navigator.geolocation) { setLocNote("Your phone no gree share location — choose your city."); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const hit = (Object.keys(CITIES) as City[]).find((c) => km(here, CITIES[c]) <= CITIES[c].km);
        if (hit) choose(hit);
        else setLocNote("You no dey Lagos or Ibadan for now — choose the one wey you like.");
      },
      () => { setLocating(false); setLocNote("No wahala — just choose your city."); },
      { timeout: 10000, maximumAge: 600000 },
    );
  };
  const close = () => set({ front: false });
  const playNpcs = () => {
    const c = CITIES[home ?? "lagos"];
    net.send({ t: "g_create", arena: c.arena, hide: 30, search: 180, safe: c.safe, bots: 3, public: true });
    close();
    useGame.getState().openApp("boju");
  };
  const matchMe = () => { net.send({ t: "g_match" }); close(); useGame.getState().openApp("boju"); };
  const joinGroup = () => { close(); useGame.getState().openApp("boju"); };
  const others = online?.online ?? 0;

  return (
    <div className="storefront pointer-events-auto absolute inset-0 z-[58] flex flex-col" data-testid="storefront">
      <div className="bg-grid" aria-hidden />
      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-end px-4 pb-[max(env(safe-area-inset-bottom),14px)] pt-[max(env(safe-area-inset-top),10px)]">
        <div className="sf-stall" aria-hidden><span>BOJU BOJU</span></div>
        {/* ?realchars=1: preview of the realistic characters beside Baba */}
        <AvatarPreview av={BABA} className={realPreview ? "sf-baba sf-baba-wide" : "sf-baba"} real={realPreview ? [0, 0, 0] : undefined} />
        <div className="panel anim-rise sf-speech w-full max-w-md p-4" onClick={() => setShown(speech.length)}>
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--accent)]">Baba Boju</div>
          <p className="mt-1 text-[14.5px] leading-snug">{speech.slice(0, shown)}{talking && <span className="sf-caret">▍</span>}</p>
        </div>
        {!talking && (
          <div className="anim-rise mt-3 w-full max-w-md space-y-2">
            {!home ? (
              <>
                <div className="text-center text-sm font-semibold">Where you dey? You go always start from your city.</div>
                <button className="btn btn-primary w-full py-3" disabled={locating} onClick={locate}>{locating ? "Finding you…" : "📍 Use my location"}</button>
                {locNote && <div className="text-center text-xs opacity-80">{locNote}</div>}
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn btn-ghost py-2.5" onClick={() => choose("lagos")}>🌆 Lagos</button>
                  <button className="btn btn-ghost py-2.5" onClick={() => choose("ibadan")}>🌳 Ibadan</button>
                </div>
              </>
            ) : others > 0 ? (
              pickOnline ? (
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn btn-primary py-3" onClick={matchMe}>⚡ Match me</button>
                  <button className="btn btn-ghost py-3" onClick={joinGroup}>🔑 Join a group</button>
                </div>
              ) : (
                <button className="btn btn-primary w-full py-3.5 text-lg" onClick={() => setPickOnline(true)}>
                  🎮 Play with online players <span className="ml-1 rounded-full bg-white/20 px-2 text-xs">{others} on</span>
                </button>
              )
            ) : (
              <button className="btn btn-primary w-full py-3.5 text-lg" onClick={playNpcs}>🤖 Play with NPCs</button>
            )}
            {home && (
              <div className="flex items-center justify-between px-1 text-xs opacity-75">
                <button onClick={() => { setCity(null); delete serverFlags.city; setLocNote(""); }}>📍 {CITIES[home].name} · change</button>
                <button onClick={close}>Walk around first →</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
