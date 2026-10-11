"use client";

import { useEffect, useRef, useState } from "react";
import { sound } from "@/game/sound";
import { useGame } from "@/lib/store";
import { useMap, useSecondsLeft } from "./hooks";

/**
 * One clear voice for new players:
 * - "How to play": five quick cards, shown the first time you join a game (and any time from the menus).
 * - The Coach: the timer bar at the top says the ONE thing to do right now, for your role,
 *   with a guide arrow when you need to walk somewhere (more detail for your first games).
 * - A big flash at the two moments that matter: RUN & HIDE! / FIND THEM!
 */

const SEEN_KEY = "boju.howto";
const GAMES_KEY = "boju.games";
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};
export const gamesPlayed = () => Number(store.get(GAMES_KEY) ?? 0) || 0;

// ------------------------------------------------------------------ How to play
const CARDS = [
  { icon: "🎲", title: "The dice picks Boju", text: "Everyone picks a number. The dice chooses who is Boju — the seeker." },
  { icon: "🙈", title: "Boju closes their eyes", text: "Boju counts while everyone else runs and hides. You have about 30 seconds!" },
  { icon: "🏃🏾", title: "Hide well", text: "Get behind walls and inside buildings. Tap Bend to crouch behind hedges. Boju can't see through walls." },
  { icon: "👀", title: "Boju finds you by reaching you", text: "No buttons: if Boju walks up close to you, you're caught. Keep moving and stay out of sight." },
  { icon: "🟢", title: "The safe house", text: "Run into the green safe house to be safe — but only for 20 seconds in total. The compass shows the way." },
  { icon: "🏆", title: "Points and turns", text: "Staying hidden earns the most. Boju earns for every find. The first person caught is the next Boju. Most points wins!" },
];

export function HowToPlay() {
  const open = useGame((s) => s.howTo);
  const set = useGame((s) => s.set);
  const [i, setI] = useState(0);
  useEffect(() => { if (open) setI(0); }, [open]);
  if (!open) return null;
  const c = CARDS[i], last = i === CARDS.length - 1;
  const close = () => { store.set(SEEN_KEY, "1"); set({ howTo: false }); };
  return (
    <div className="pointer-events-auto absolute inset-0 z-[70] flex items-end justify-center bg-black/55 p-3 sm:items-center" data-testid="howto">
      <div className="panel anim-sheet w-full max-w-sm p-5 text-center">
        <div className="text-[11px] font-bold uppercase tracking-widest opacity-60">How to play Boju Boju</div>
        <div key={i} className="anim-pop mt-3 text-6xl leading-none">{c.icon}</div>
        <div className="mt-3 text-xl font-black">{c.title}</div>
        <p className="mt-1.5 min-h-[3.5rem] text-sm opacity-85">{c.text}</p>
        <div className="mt-3 flex justify-center gap-1.5">
          {CARDS.map((_, k) => <span key={k} className={`h-1.5 rounded-full transition-all ${k === i ? "w-5 bg-[var(--accent)]" : "w-1.5 bg-white/30"}`} />)}
        </div>
        <div className="mt-4 flex gap-2">
          {i > 0 ? <button className="btn btn-ghost flex-1" onClick={() => setI(i - 1)}>Back</button> : <button className="btn btn-ghost flex-1" onClick={close}>Skip</button>}
          <button className="btn btn-primary flex-[2]" onClick={() => (last ? close() : setI(i + 1))}>{last ? "Got it — let's play! 🙌🏾" : "Next"}</button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the Coach
interface Tip { key: string; icon: string; text: string; sub?: string; go?: { x: number; z: number; label: string } | null }

export function useTip(): Tip | null {
  const g = useGame((s) => s.group);
  const me = useGame((s) => s.me?.id);
  const map = useMap();
  const left = useSecondsLeft(g?.phase_end);
  if (!g || !me) return null;
  const meM = g.members.find((m) => m.id === me);
  if (!meM || meM.left) return null;
  const r = g.round;
  const nick = (id?: string | null) => g.members.find((m) => m.id === id)?.nick ?? "someone";
  const isBoju = r?.seeker === me;
  const safeName = map?.safe_houses.find((s) => s.id === g.settings.safe)?.name ?? "the safe house";
  switch (g.phase) {
    case "lobby": {
      const n = g.members.filter((m) => !m.left).length;
      return g.creator === me
        ? { key: "lobby-host", icon: "👥", text: n < 2 ? "Invite friends or add NPCs" : "Ready? Tap Start game", sub: n < 2 ? "You need at least 2 players. Your code is in 🙈 Boju Boju." : `${n} players in — tap 🙈 ${g.code} → Start game` }
        : { key: "lobby-guest", icon: "⏳", text: `Waiting for ${nick(g.creator)} to start`, sub: "The game takes everyone to the Motor Park" };
    }
    case "travel": {
      if (meM.boarded) return { key: "travel-on", icon: "🚌", text: "You're on the way to the arena", sub: "Get off and walk into the circle when you arrive" };
      const stop = map?.zones.find((z) => z.kind === "bus_stop");
      return {
        key: "travel", icon: "🚏", text: "Board a bus at the Motor Park", sub: "Stand at the bus stop and tap Board — before the timer runs out",
        go: stop && map?.kind === "hub" ? { x: (stop.rect[0] + stop.rect[2]) / 2, z: (stop.rect[1] + stop.rect[3]) / 2, label: "🚏 Board here" } : null,
      };
    }
    case "gather": {
      const inside = g.gather?.in.includes(me);
      return inside
        ? { key: "gather-in", icon: "⭕", text: "You're in! Waiting for the others", sub: "The dice roll as soon as everyone is in the circle" }
        : { key: "gather", icon: "⭕", text: "Walk into the circle", sub: "Everyone gathers before the dice roll", go: g.gather ? { x: g.gather.center[0], z: g.gather.center[1], label: "⭕ The circle" } : null };
    }
    case "dice":
      return meM.pick == null
        ? { key: "dice", icon: "🎲", text: "Pick a number", sub: "The dice choose who will be Boju (the seeker)" }
        : { key: "dice-wait", icon: "🎲", text: "Waiting for the others to pick", sub: "Fingers crossed it's not you 😅" };
    case "reveal":
      return { key: "reveal", icon: "🎲", text: "The dice are choosing Boju…" };
    case "hide":
      if (isBoju) return { key: "hide-boju", icon: "🙈", text: "You're Boju! Eyes closed…", sub: `Count while they hide — you start seeking in ${left}s` };
      if (!r || r.state[me] !== "hiding") return { key: "hide-out", icon: "🍿", text: "You're sitting this round out", sub: "Watch from the stands" };
      return { key: "hide", icon: "🏃🏾", text: "RUN & HIDE!", sub: `${nick(r.seeker)} opens their eyes soon. Get behind walls, Bend behind hedges, or reach 🟢 ${safeName}` };
    case "seek":
      if (isBoju) return { key: "seek-boju", icon: "👀", text: "FIND THEM!", sub: "Walk close to a hider to catch them — no button. Check behind walls and inside buildings." };
      if (!r || r.state[me] === "found") return { key: "seek-found", icon: "😅", text: "You've been found!", sub: r?.found[0] === me ? "You were caught first — you're the next Boju 🙈" : "Watch from the stands until the round ends" };
      if (r.state[me] !== "hiding") return { key: "seek-out", icon: "🍿", text: "Watch the round" };
      if (r.safe.includes(me)) return { key: "seek-safe", icon: "🟢", text: "You're safe in the safe house", sub: "Only for 20s in total — leave before it runs out" };
      return { key: "seek", icon: "🤫", text: "Boju is looking — stay hidden!", sub: `If ${nick(r.seeker)} comes close, move away and break their line of sight` };
    case "result":
      return { key: "result", icon: "📣", text: "Round over", sub: g.pending_seeker ? `Next Boju: ${nick(g.pending_seeker)}` : "The dice will pick the next Boju" };
    default:
      return null;
  }
}

/** Drops a guide arrow + pin where the Coach says to walk (cleared when that step is done). */
export function CoachGuide() {
  const tip = useTip();
  const set = useGame((s) => s.set);
  const guided = useRef<string | null>(null);
  const goKey = tip?.go ? `${tip.key}:${tip.go.x}:${tip.go.z}` : null;
  useEffect(() => {
    const st = useGame.getState();
    if (goKey && tip?.go) {
      if (guided.current !== goKey && (!st.guide || st.guide.label === tip.go.label || guided.current)) {
        guided.current = goKey;
        set({ guide: tip.go });
      }
    } else if (guided.current) {
      guided.current = null;
      if (st.guide && /Board here|The circle/.test(st.guide.label)) set({ guide: null });
    }
  }, [goKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Big flash for the moments that matter, plus first-time "How to play" and the games-played count. */
export function CoachMoments() {
  const g = useGame((s) => s.group);
  const me = useGame((s) => s.me?.id);
  const over = useGame((s) => s.over);
  const set = useGame((s) => s.set);
  const [flash, setFlash] = useState<{ text: string; sub: string; color: string } | null>(null);
  const last = useRef<string>("");
  const counted = useRef<string | null>(null);

  // first time in any game: show "How to play" once
  useEffect(() => {
    if (g && !store.get(SEEN_KEY)) { store.set(SEEN_KEY, "1"); set({ howTo: true }); }
  }, [g?.code, set]); // eslint-disable-line react-hooks/exhaustive-deps

  // count finished games (the Coach gets quieter after 3)
  useEffect(() => {
    if (over && counted.current !== over.gameId) { counted.current = over.gameId; store.set(GAMES_KEY, String(gamesPlayed() + 1)); }
  }, [over]);

  const r = g?.round;
  const key = g && r && me ? `${r.no}:${g.phase}` : "";
  useEffect(() => {
    if (!key || key === last.current || !g || !r || !me) return;
    last.current = key;
    const boju = r.seeker === me, hiding = r.state[me] === "hiding";
    let f: typeof flash = null;
    if (g.phase === "hide" && hiding && !boju) f = { text: "RUN & HIDE!", sub: "Boju is counting 🙈", color: "#30d158" };
    if (g.phase === "seek" && boju) f = { text: "FIND THEM!", sub: "Walk close to catch them 👀", color: "#ff9f0a" };
    if (g.phase === "seek" && hiding && !boju) f = { text: "BOJU IS COMING!", sub: "Stay hidden 🤫", color: "#ff453a" };
    if (!f) return;
    setFlash(f);
    if (g.phase === "hide") sound.play("whistle"); // the seek whistle already blows for everyone
    useGame.getState().closePhone(); // nothing should cover the screen when it's time to run or seek
    const id = setTimeout(() => setFlash(null), 2200);
    return () => clearTimeout(id);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!flash) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[38%] z-[45] flex flex-col items-center" data-testid="coach-flash">
      <div className="anim-pop text-center text-5xl font-black tracking-tight drop-shadow-[0_4px_12px_rgba(0,0,0,.6)]" style={{ color: flash.color }}>{flash.text}</div>
      <div className="anim-fade mt-1 text-lg font-bold text-white drop-shadow-[0_2px_6px_rgba(0,0,0,.7)]">{flash.sub}</div>
    </div>
  );
}
