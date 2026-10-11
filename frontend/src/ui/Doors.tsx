"use client";

import { useEffect, useState } from "react";
import { local } from "@/game/state";
import { net } from "@/lib/net";
import { useGame } from "@/lib/store";
import { useMap, useTicker } from "./hooks";

/** Standing at someone's door: knock (they must be online and let you in). */
export function DoorPanel() {
  useTicker(250);
  const map = useMap();
  const owners = useGame((s) => s.doorOwners);
  const open = useGame((s) => s.openDoors);
  const me = useGame((s) => s.me?.id);
  const roster = useGame((s) => s.roster);
  const [knocked, setKnocked] = useState<string | null>(null);
  if (map?.kind !== "hub" || !map.homes) return null;
  const home = map.homes.find((h) => Math.hypot(h.door[0] - local.x, h.door[1] - local.z) < 3.2 && !(local.insideHome === h.id));
  const owner = home ? owners[home.id] : undefined;
  if (!home || !owner || owner === me) return null;
  const nick = Object.values(roster).find((r) => r.id === owner)?.nick;
  const isOpen = open.includes(home.id);
  return (
    <div className="pointer-events-auto absolute bottom-28 left-1/2 z-20 w-72 -translate-x-1/2"><div className="panel anim-rise p-3">
      <div className="font-bold">🚪 {home.name}</div>
      <div className="mb-2 text-xs opacity-75">{nick ? `@${nick}'s house` : "Someone lives here"} · {isOpen ? "you've been let in — walk inside" : "knock and wait for them to open"}</div>
      {!isOpen && (
        <button className="btn btn-primary w-full" disabled={knocked === home.id} onClick={() => {
          net.send({ t: "knock", home: home.id });
          setKnocked(home.id);
          setTimeout(() => setKnocked(null), 8000);
        }}>{knocked === home.id ? "Knocking… ✊🏾" : "✊🏾 Knock"}</button>
      )}
    </div></div>
  );
}

/** Someone is at your door: let them in or not. */
export function KnockPrompt() {
  const k = useGame((s) => s.knock);
  const set = useGame((s) => s.set);
  useEffect(() => {
    if (!k) return;
    const t = setTimeout(() => set({ knock: null }), 30000);
    return () => clearTimeout(t);
  }, [k, set]);
  if (!k) return null;
  const answer = (ok: boolean) => { net.send({ t: "knock_answer", to: k.from, ok }); set({ knock: null }); };
  return (
    <div className="pointer-events-auto absolute left-1/2 top-[7.5rem] z-[61] w-[min(24rem,94vw)] -translate-x-1/2">
      <div className="panel anim-banner flex items-center gap-3 p-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--clay)] text-xl">🚪</span>
        <div className="min-w-0 flex-1 text-sm"><b>@{k.nick}</b> is knocking at your door</div>
        <button className="btn btn-primary px-3 py-1.5 text-sm" onClick={() => answer(true)}>Let in</button>
        <button className="btn btn-ghost px-2 py-1.5 text-sm" onClick={() => answer(false)}>Not now</button>
      </div>
    </div>
  );
}
