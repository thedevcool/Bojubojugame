"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { net } from "@/lib/net";
import { useGame } from "@/lib/store";

const MapPreview = dynamic(() => import("@/game/Previews").then((m) => m.MapPreview), { ssr: false });

const STEPS = ["Arena", "Hide time", "Search time", "Safe house", "Players"] as const;
const SOON = [
  { name: "Tafawa Balewa Square-style", emoji: "🏟️" },
  { name: "Bar Beach-style", emoji: "🏖️" },
  { name: "Balogun Market-style", emoji: "🛍️" },
];
const NPC_FACES = ["🧑🏾", "👩🏾", "👨🏿", "👩🏿", "🧔🏾"];

/** Animated stopwatch: the ring sweeps once per chosen duration so the length "feels" real. */
function Stopwatch({ seconds, icon }: { seconds: number; icon: string }) {
  const R = 52, C = 2 * Math.PI * R;
  return (
    <div className="relative mx-auto grid h-36 w-36 place-items-center">
      <svg viewBox="0 0 120 120" className="absolute inset-0 -rotate-90">
        <circle cx="60" cy="60" r={R} fill="none" stroke="rgba(160,196,255,.18)" strokeWidth="9" />
        <circle key={seconds} cx="60" cy="60" r={R} fill="none" stroke="var(--accent)" strokeWidth="9" strokeLinecap="round"
          strokeDasharray={C} style={{ animation: `sweep ${Math.min(seconds, 8)}s linear infinite` }} />
      </svg>
      <style>{`@keyframes sweep { from { stroke-dashoffset: ${C}; } to { stroke-dashoffset: 0; } }`}</style>
      <div key={`t${seconds}`} className="anim-pop text-center">
        <div className="text-3xl">{icon}</div>
        <div className="text-2xl font-black tabular-nums">{seconds >= 60 ? `${Math.round((seconds / 60) * 10) / 10} min` : `${seconds}s`}</div>
      </div>
    </div>
  );
}

export default function CreateGame() {
  const cfg = useGame((s) => s.content?.config);
  const maps = useGame((s) => s.content?.maps);
  const arenas = Object.values(maps ?? {}).filter((m) => m.kind === "arena");
  const [step, setStep] = useState(0);
  const [arena, setArena] = useState(arenas[0]?.id ?? "");
  const [hide, setHide] = useState(cfg?.game.default_hide_time ?? 30);
  const [search, setSearch] = useState(cfg?.game.default_search_time ?? 180);
  const map = maps?.[arena];
  const [safe, setSafe] = useState(map?.safe_houses[0]?.id ?? "");
  const [bots, setBots] = useState(0);
  useEffect(() => { setSafe(map?.safe_houses[0]?.id ?? ""); }, [map]);
  if (!cfg || !map) return null;

  const safeRect = map.safe_houses.find((s) => s.id === safe)?.rect ?? null;
  const last = step === STEPS.length - 1;
  const create = () => net.send({ t: "g_create", arena, hide, search, safe, bots });

  return (
    <div>
      {/* progress */}
      <div className="mb-3 flex items-center gap-1.5">
        {STEPS.map((s, i) => (
          <button key={s} onClick={() => setStep(i)} aria-label={s}
            className="h-1.5 flex-1 rounded-full transition-all duration-500"
            style={{ background: i <= step ? "var(--accent)" : "rgba(160,196,255,.2)", transitionTimingFunction: "var(--ease-ios)" }} />
        ))}
      </div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--accent-2)]">Step {step + 1} of {STEPS.length}</div>

      <div key={step} className="anim-step min-h-[19rem]">
        {step === 0 && (
          <>
            <h3 className="mb-2 text-xl font-black">Where una wan play?</h3>
            <MapPreview map={map} className="mb-3 h-44 overflow-hidden rounded-2xl" />
            <div className="space-y-2">
              {arenas.map((a) => (
                <button key={a.id} data-on={a.id === arena} onClick={() => setArena(a.id)} className="choice flex w-full items-center gap-3 p-3 text-left">
                  <span className="text-2xl">🌳</span>
                  <span><span className="block font-bold">{a.name}</span><span className="text-xs opacity-70">{a.sections.length} sections · {a.safe_houses.length} safe houses</span></span>
                </button>
              ))}
              {SOON.map((s) => (
                <div key={s.name} className="choice flex items-center gap-3 p-3 opacity-45">
                  <span className="text-2xl grayscale">{s.emoji}</span>
                  <span className="font-semibold">{s.name}</span>
                  <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[10px]">Soon</span>
                </div>
              ))}
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <h3 className="mb-1 text-xl font-black">How long to hide?</h3>
            <p className="mb-3 text-sm opacity-75">Boju closes their eyes and counts while everyone runs.</p>
            <Stopwatch seconds={hide} icon="🙈" />
            <div className="segmented mt-4">
              {cfg.game.hide_time_options.map((o) => <button key={o} data-on={o === hide} onClick={() => setHide(o)}>{o}s</button>)}
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <h3 className="mb-1 text-xl font-black">How long to search?</h3>
            <p className="mb-3 text-sm opacity-75">Time Boju gets to find everybody.</p>
            <Stopwatch seconds={search} icon="👀" />
            <div className="segmented mt-4">
              {cfg.game.search_time_options.map((o) => <button key={o} data-on={o === search} onClick={() => setSearch(o)}>{Math.round((o / 60) * 10) / 10}m</button>)}
            </div>
          </>
        )}
        {step === 3 && (
          <>
            <h3 className="mb-1 text-xl font-black">Pick the safe house</h3>
            <p className="mb-2 text-sm opacity-75">Inside, nobody can catch you — but only 2 people, {cfg.game.safe_house_total_s}s max.</p>
            <MapPreview map={map} focus={safeRect} className="mb-3 h-44 overflow-hidden rounded-2xl" />
            <div className="grid grid-cols-1 gap-2">
              {map.safe_houses.map((s) => (
                <button key={s.id} data-on={s.id === safe} onClick={() => setSafe(s.id)} className="choice flex items-center gap-3 p-3 text-left">
                  <span className="text-xl">🏠</span><span className="font-bold">{s.name}</span>
                  {s.id === safe && <span className="anim-pop ml-auto text-[var(--leaf)]">✓</span>}
                </button>
              ))}
            </div>
          </>
        )}
        {step === 4 && (
          <>
            <h3 className="mb-1 text-xl font-black">Who dey play?</h3>
            <p className="mb-3 text-sm opacity-75">Invite friends after you create — or add NPC players to start now.</p>
            <div className="choice mb-3 flex items-center justify-between p-3" data-on={bots > 0}>
              <span className="font-bold">🤖 NPC players</span>
              <span className="flex items-center gap-3">
                <button className="btn btn-ghost h-9 w-9 p-0 text-lg" onClick={() => setBots(Math.max(0, bots - 1))}>−</button>
                <span key={bots} className="anim-pop w-4 text-center text-lg font-black">{bots}</span>
                <button className="btn btn-ghost h-9 w-9 p-0 text-lg" onClick={() => setBots(Math.min(cfg.game.max_players - 1, bots + 1))}>+</button>
              </span>
            </div>
            <div className="flex min-h-14 flex-wrap items-center justify-center gap-2">
              <span className="anim-pop grid h-12 w-12 place-items-center rounded-full bg-[var(--accent)] text-2xl" title="You">😎</span>
              {Array.from({ length: bots }, (_, i) => (
                <span key={i} className="anim-pop grid h-12 w-12 place-items-center rounded-full bg-white/10 text-2xl" style={{ animationDelay: `${i * 60}ms` }}>{NPC_FACES[i]}</span>
              ))}
              {bots === 0 && <span className="anim-fade text-sm opacity-70">+ friends via invite link</span>}
            </div>
            <div className="mt-4 rounded-2xl bg-white/5 p-3 text-xs opacity-85">
              {map.name} · hide {hide}s · search {Math.round((search / 60) * 10) / 10} min · safe: {map.safe_houses.find((s) => s.id === safe)?.name}
            </div>
          </>
        )}
      </div>

      <div className="mt-4 flex gap-2">
        {step > 0 && <button className="btn btn-ghost" onClick={() => setStep(step - 1)}>Back</button>}
        {last ? (
          <button className="btn btn-primary flex-1 text-lg" onClick={create}>{bots ? `Create & play with ${bots} NPC${bots > 1 ? "s" : ""}` : "Create group"}</button>
        ) : (
          <button className="btn btn-primary flex-1" onClick={() => setStep(step + 1)}>Next</button>
        )}
      </div>
    </div>
  );
}
