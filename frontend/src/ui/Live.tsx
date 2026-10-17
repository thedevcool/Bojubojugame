"use client";

import { useEffect, useRef, useState } from "react";
import { sound } from "@/game/sound";
import { getLiveGames, loadAccount, type LiveGame } from "@/lib/api";
import { net } from "@/lib/net";
import { ensureMap } from "@/lib/maps";
import { useGame } from "@/lib/store";
import { draw, type Dot } from "./MapView";
import { fmtTime, useSecondsLeft } from "./hooks";

const PHASE: Record<string, string> = {
  lobby: "Waiting for players", travel: "On the way", gather: "Gathering", dice: "Rolling dice", reveal: "Dice don talk",
  hide: "Hiding 🙈", seek: "Seeking 👀", result: "Round result",
};

/** Polls the server's list of public games every few seconds. */
export function useLiveGames(): LiveGame[] | null {
  const [games, setGames] = useState<LiveGame[] | null>(null);
  useEffect(() => {
    const acc = loadAccount();
    if (!acc) return;
    let alive = true;
    const load = () => getLiveGames(acc).then((r) => alive && setGames(r.games)).catch(() => alive && setGames([]));
    load();
    const id = setInterval(load, 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return games;
}

export function joinGame(code: string): void {
  net.send({ t: "g_join", code });
  useGame.getState().openApp("boju");
  sound.play("pop");
}

export function watchGame(code: string): void {
  net.send({ t: "watch", code });
  useGame.getState().set({ watching: code, wsnap: null, phoneOpen: false, phoneApp: null });
  sound.play("pop");
}

function GameRow({ g, action }: { g: LiveGame; action: "join" | "watch" }) {
  return (
    <div className="ios-row">
      <span className={`ios-glyph ${action === "join" ? "bg-[#30d158]" : "bg-[#ff375f]"}`}>{action === "join" ? "👥" : "📺"}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold">@{g.creator}&apos;s game</div>
        <div className="truncate text-[11px] opacity-60">
          {g.arena_name} · {g.humans} player{g.humans === 1 ? "" : "s"}{g.bots ? ` + ${g.bots} NPC` : ""} · {action === "join" ? `${g.max - g.humans - g.bots} spots left` : `${PHASE[g.phase] ?? g.phase}${g.round ? ` · round ${g.round}` : ""}`}
        </div>
      </div>
      {action === "join" ? (
        <button className="btn btn-primary px-3 py-1 text-sm" onClick={() => joinGame(g.code)}>Join</button>
      ) : (
        <button className="btn btn-ghost px-3 py-1 text-sm" onClick={() => watchGame(g.code)}>Watch</button>
      )}
    </div>
  );
}

/** Lobbies you can join and games you can watch. */
export function LiveGamesList({ only }: { only?: "join" | "watch" }) {
  const games = useLiveGames();
  const myGroup = useGame((s) => s.group?.code);
  if (games === null) return <div className="ios-group"><div className="ios-row text-sm opacity-60">Looking for games…</div></div>;
  const open = games.filter((g) => g.joinable && g.code !== myGroup);
  const live = games.filter((g) => !g.joinable && g.phase !== "lobby" && g.code !== myGroup);
  return (
    <>
      {only !== "watch" && (
        <>
          <div className="ios-section-title">Waiting for players</div>
          <div className="ios-group">
            {open.length ? open.map((g) => <GameRow key={g.code} g={g} action="join" />) : (
              <div className="ios-row text-[13px] opacity-60">Nobody is waiting right now — create a game and real players can join you.</div>
            )}
          </div>
        </>
      )}
      {only !== "join" && (
        <>
          <div className="ios-section-title">Playing now</div>
          <div className="ios-group">
            {live.length ? live.map((g) => <GameRow key={g.code} g={g} action="watch" />) : (
              <div className="ios-row text-[13px] opacity-60">No games in progress. Check back soon!</div>
            )}
          </div>
        </>
      )}
    </>
  );
}

/** Full-screen spectator map of someone else's game (you stay where you are). */
export function WatchView() {
  const watching = useGame((s) => s.watching);
  const snap = useGame((s) => s.wsnap);
  const maps = useGame((s) => s.content?.maps);
  const set = useGame((s) => s.set);
  const ref = useRef<HTMLCanvasElement>(null);
  const left = useSecondsLeft(snap?.phase_end);
  const map = snap && maps ? maps[snap.arena] : null;
  useEffect(() => { if (snap?.arena) void ensureMap(snap.arena); }, [snap?.arena]); // its streets, for the map
  useEffect(() => {
    const c = ref.current, ctx = c?.getContext("2d");
    if (!c || !ctx || !map || !snap) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const [x0, z0, x1, z1] = map.bounds;
    const s = Math.min(w / (x1 - x0), h / (z1 - z0)) * 0.95;
    const colors: Record<string, string> = { seeker: "#ff3b30", hiding: "#2f7cf6", safe: "#30d158", found: "#8e8e93", idle: "#8e8e93" };
    const people: Dot[] = snap.players.map(([, nick, x, z, role, bot]) => ({ x, z, color: colors[role] ?? "#f7c500", label: `${role === "seeker" ? "🙈 " : ""}${nick}${bot ? " 🤖" : ""}` }));
    draw(ctx, map, { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, s }, w, h, null, null, people, true);
  }, [snap, map]);
  if (!watching) return null;
  const stop = () => { net.send({ t: "watch", code: null }); set({ watching: null, wsnap: null }); };
  return (
    <div className="anim-fade pointer-events-auto absolute inset-0 z-[53] flex flex-col bg-[#0a1324]">
      <div className="flex items-center gap-3 px-3 pb-2 pt-[max(env(safe-area-inset-top),10px)]">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#ff375f] text-lg">📺</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-black">Watching game {watching}</div>
          <div className="truncate text-[11px] opacity-70">{snap ? `${map?.name ?? ""} · ${PHASE[snap.phase] ?? snap.phase}${["hide", "seek", "gather", "dice"].includes(snap.phase) ? ` · ${fmtTime(left)}` : ""}` : "Connecting…"}</div>
        </div>
        <button className="btn btn-ghost px-3 py-1.5 text-sm" onClick={stop}>Close</button>
      </div>
      <canvas ref={ref} className="min-h-0 w-full flex-1" />
      <div className="panel m-2 p-3 text-xs">
        {snap ? (
          <div className="flex items-center justify-between">
            <span>🙈 Boju <span className="opacity-60">red</span> · 🥷 hiders <span className="opacity-60">blue, shown only when Boju can see them</span></span>
            <span className="font-bold">Found {snap.found} · Hiding {snap.hiding}</span>
          </div>
        ) : "Loading the map…"}
      </div>
    </div>
  );
}
