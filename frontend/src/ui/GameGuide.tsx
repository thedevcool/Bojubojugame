"use client";

import { useEffect, useRef, useState } from "react";
import { serverFlags, setFlag } from "@/lib/api";
import { net } from "@/lib/net";
import { local } from "@/game/state";
import { useGame } from "@/lib/store";
import type { GroupState as Group } from "@/lib/types";
import { useTip } from "./Coach";
import { fmtTime, useSecondsLeft } from "./hooks";

/**
 * The first-game guide. A small card asks "want a quick guide?"; yes starts a practice game with
 * NPCs (or guides the game you just joined), and the Coach bar then walks you through it as it
 * really happens: the code and invites, Start, the bus, the circle, the dice, hiding or seeking,
 * and how a round is cleared. The button to press glows. "Exit guide" stops it at any moment.
 */
const KEY = "boju.gameGuide"; // "done" | "no"
const store = {
  get: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
  set: (v: string) => { try { localStorage.setItem(KEY, v); } catch { /* storage blocked */ } },
};
export const guideAnswered = () => store.get() !== null || !!serverFlags.guide;

export function endGuide(reason: "done" | "no" | "exit"): void {
  store.set(reason === "no" ? "no" : "done");
  setFlag("guide", reason === "no" ? "no" : "done");
  useGame.getState().set({ gameGuide: null });
  if (reason === "done") useGame.getState().toast("🎉 You've played your first Boju Boju — well done!", "good");
}

/**
 * The practice game is the shortest one there is: you and one NPC (with two players the first round
 * is also the last), the shortest hide and search times. Private, so nobody else wanders in.
 */
function startPractice(): void {
  const st = useGame.getState();
  const cfg = st.content?.config, maps = st.content?.maps;
  const arena = cfg?.cities[0]?.arenas[0] ?? "arena_park";
  const shortest = (opts: number[] | undefined, dflt: number) => (opts?.length ? Math.min(...opts) : dflt);
  const hide = shortest(cfg?.game.hide_time_options, cfg?.game.default_hide_time ?? 30);
  const search = shortest(cfg?.game.search_time_options, cfg?.game.default_search_time ?? 180);
  net.send({ t: "g_create", arena, hide, search, safe: maps?.[arena]?.safe_houses[0]?.id ?? "", bots: 1, public: false });
}

/** From the Boju Boju app: a practice game with the guide on. */
export function startGuidedPractice(): void {
  startPractice();
  useGame.getState().set({ gameGuide: "on" });
}

const STEPS = ["Lobby", "Bus", "Circle", "Dice", "Hide", "Seek", "Result"] as const;
interface Say { step: number; title?: string; text: string; glow?: string | null }

function explain(g: Group, me: string, since: number, riding: boolean): Say {
  const r = g.round;
  const isBoju = r?.seeker === me;
  const mine = g.members.find((m) => m.id === me);
  const nick = (id?: string | null) => g.members.find((m) => m.id === id)?.nick ?? "someone";
  switch (g.phase) {
    case "lobby":
      return g.creator === me
        ? { step: 0, text: "This is your game. Friends join with the code (🙈 Boju Boju → Join with a code) or 📨 Share link — NPCs fill empty spots. Ready? Tap Start game.", glow: since < 5 ? "code" : "start" }
        : { step: 0, text: `You're in ${nick(g.creator)}'s game — you joined with their code. The host taps Start when everyone's here.` };
    case "travel":
      return mine?.boarded
        ? { step: 1, text: "You're on the bus to the arena. When you arrive, walk into the circle." }
        : { step: 1, text: "Everyone rides to the arena together. Follow the arrow to the 🚏 bus stop and tap Board.", glow: "board" };
    case "gather":
      if (riding) return { step: 1, text: "You're on the bus to the arena 🚌. When you arrive, you'll walk into the circle." };
      return { step: 2, text: "Walk into the ⭕ circle with the others. The dice roll as soon as everyone is in." };
    case "dice":
      return { step: 3, text: "Pick a number 🎲. If the dice lands on yours, you're Boju — the seeker. Everyone else hides.", glow: "dice" };
    case "reveal":
      return { step: 3, text: "The dice are choosing Boju… 🤞🏾" };
    case "hide":
      if (isBoju) return { step: 4, title: "You're Boju 🙈", text: "Your eyes are closed while everyone hides — that's the Boju Boju song. When it ends, you go and find them." };
      return since < 7
        ? { step: 4, title: "RUN & HIDE!", text: "Hold 🏃🏾 Run to sprint away from Boju. Go behind walls and inside buildings — Boju can't see through them.", glow: "run" }
        : since < 14
          ? { step: 4, title: "Hide well", text: "Tap 🧎 Bend to crouch low behind hedges and cars. Stay still once you're hidden.", glow: "bend" }
          : { step: 4, title: "The safe house", text: "The 🟢 compass points to the safe house: inside, Boju can't catch you — but only for 20 seconds in total.", glow: "safe" };
    case "seek":
      if (isBoju) return { step: 5, title: "FIND THEM! 👀", text: "Walk close to a hider to catch them — no button. Check behind walls, in buildings and behind hedges. Catch everyone to clear the round." };
      if (r?.state[me] === "found") return { step: 5, title: "Caught 😅", text: "Watch the rest of the round from the stands. The first person caught is the next Boju." };
      if (since >= 6 && since < 16) return { step: 5, title: "Watch Boju from above 🛰️", text: "Tap 🛰️ Aerial to look down from the sky and see where Boju is going — then slip away the other way. Tap it again to come back.", glow: "aerial" };
      return { step: 5, title: "Boju is looking 🤫", text: "Stay out of sight. Your heartbeat speeds up when Boju is near — move away and break their line of sight. Last until the timer ends to win the round.", glow: since < 6 ? "safe" : null };
    case "result": {
      const lr = g.last_result;
      if (!lr) return { step: 6, text: "Round over." };
      const hiders = Object.keys(lr.deltas).filter((id) => id !== lr.seeker);
      const cleared = hiders.length > 0 && hiders.every((id) => lr.found.includes(id));
      const next = lr.next_seeker ? ` Next Boju: ${nick(lr.next_seeker)} (the first one caught).` : "";
      return cleared
        ? { step: 6, title: "Round cleared ✅", text: `${nick(lr.seeker)} found everyone — Boju earns for every find.${next}` }
        : { step: 6, title: "Not cleared ⏱️", text: `Time ran out with ${hiders.length - lr.found.length} still hidden — they earn the most. Boju earns for each one found.${next}` };
    }
    default:
      return { step: 6, text: "" };
  }
}

/** Glows the thing to press (it may mount later, e.g. the Board button when you reach the stop). */
function useGlow(name: string | null | undefined): void {
  useEffect(() => {
    if (!name) return;
    let last: Element[] = [];
    const tick = () => {
      const els = Array.from(document.querySelectorAll(`[data-guide="${name}"]`));
      last.filter((e) => !els.includes(e)).forEach((e) => e.classList.remove("guide-glow"));
      els.forEach((e) => {
        if (!e.classList.contains("guide-glow")) e.scrollIntoView({ block: "center", behavior: "smooth" }); // e.g. Start, far down the lobby
        e.classList.add("guide-glow");
      });
      last = els;
    };
    tick();
    const id = setInterval(tick, 400);
    return () => { clearInterval(id); last.forEach((e) => e.classList.remove("guide-glow")); };
  }, [name]);
}

export function GameGuide() {
  const mode = useGame((s) => s.gameGuide);
  const g = useGame((s) => s.group);
  const me = useGame((s) => s.me?.id);
  const phoneOpen = useGame((s) => s.phoneOpen);
  const phoneApp = useGame((s) => s.phoneApp);
  const onboard = useGame((s) => s.onboard);
  const set = useGame((s) => s.set);
  const tip = useTip();
  const left = useSecondsLeft(g?.phase_end);
  // seconds since this phase began (the hide step shows Run, then Bend, then the safe house)
  const phaseKey = g ? `${g.code}:${g.round?.no ?? 0}:${g.phase}` : "";
  const began = useRef({ key: "", at: 0 });
  if (began.current.key !== phaseKey) began.current = { key: phaseKey, at: Date.now() };
  const [, force] = useState(0);
  useEffect(() => {
    if (mode !== "on") return;
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [mode]);
  const since = (Date.now() - began.current.at) / 1000;

  // ask once: the first time you open 🙈 Boju Boju, or land in someone's lobby (not mid-tour)
  useEffect(() => {
    if (mode || guideAnswered() || (onboard && onboard !== "play")) return;
    if ((phoneOpen && phoneApp === "boju" && !g) || g?.phase === "lobby") set({ gameGuide: "ask" });
  }, [mode, phoneOpen, phoneApp, g, onboard, set]);

  // the game ended (or you left it): the guide is done
  const over = !!g && g.phase === "over";
  const hadGame = useRef(false);
  if (g && g.phase !== "over") hadGame.current = true;
  useEffect(() => {
    if (mode !== "on") return;
    if (over) endGuide("done");
    else if (!g && hadGame.current) { hadGame.current = false; endGuide("exit"); }
  }, [mode, over, g]);

  const riding = useGame((s) => !!s.ride);
  const say = mode === "on" && g && me ? explain(g, me, since, riding) : null;

  // the phone gets out of the way: once the bus is called (guide on), and for everyone on reaching the stop
  const travel = g?.phase === "travel";
  useEffect(() => {
    if (mode !== "on" || !travel) return;
    const id = setTimeout(() => useGame.getState().closePhone(), 1500); // a moment to see the game has started
    return () => clearTimeout(id);
  }, [mode, travel]);
  useEffect(() => {
    if (!travel) return;
    let closed = false;
    const id = setInterval(() => {
      const st = useGame.getState();
      const stop = st.content?.maps.hub_plaza?.zones.find((z) => z.kind === "bus_stop")?.rect;
      const there = !!stop && local.x >= stop[0] && local.x <= stop[2] && local.z >= stop[1] && local.z <= stop[3];
      if (there && !closed) { closed = true; if (st.phoneOpen) st.closePhone(); } // the Board buttons are on screen
      if (!there) closed = false;
    }, 500);
    return () => clearInterval(id);
  }, [travel]);
  useGlow(say?.glow);

  if (!mode) return null;
  const top = phoneOpen ? "top-2" : "top-[3.9rem]";
  const solid = phoneOpen ? ({ "--glass": "rgba(10, 16, 34, 0.97)" } as React.CSSProperties) : undefined; // readable over the phone's screen

  if (mode === "ask") {
    const inGame = !!g;
    return (
      <div className={`pointer-events-none absolute inset-x-0 ${top} z-[57] flex justify-center px-3`} data-testid="guide-ask" data-keep-phone>
        <div className="panel anim-banner guide-attn pointer-events-auto flex w-full max-w-md items-center gap-3 p-3" style={solid}>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--accent)] text-2xl leading-none">🙈</span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-black leading-tight">{inGame ? "First game? Want a quick guide?" : "First time? Want a quick guide?"}</div>
            <div className="text-[12px] leading-snug opacity-80">{inGame ? "I'll walk you through this game, step by step." : "I'll walk you through a practice game with NPCs, step by step."}</div>
            <div className="mt-2 flex items-center gap-2">
              <button className="btn btn-primary px-3 py-1.5 text-xs" onClick={() => { if (!inGame) startPractice(); set({ gameGuide: "on" }); }}>Yes, guide me</button>
              <button className="btn btn-ghost px-3 py-1.5 text-xs" onClick={() => endGuide("no")}>No thanks</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // guide on, waiting for the practice game to be created
  if (!g || !say) {
    return (
      <div className={`pointer-events-none absolute inset-x-0 ${top} z-[57] flex justify-center px-3`} data-testid="guide" data-keep-phone>
        <div className="panel pointer-events-auto w-full max-w-md p-3 text-[13px]" style={solid}>Setting up your practice game… <button className="ml-2 text-[11px] opacity-60" onClick={() => endGuide("exit")}>Exit guide</button></div>
      </div>
    );
  }
  return (
    <div className={`pointer-events-none absolute inset-x-0 ${top} z-[57] flex justify-center px-3`} data-testid="guide" data-keep-phone>
      <div key={say.title ?? say.text} className="panel guide-attn pointer-events-auto w-full max-w-md p-3" style={solid}>
        <div className="flex items-start gap-3">
          {tip && <span key={tip.key} className="anim-pop grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--accent)]/25 text-2xl leading-none">{tip.icon}</span>}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[15px] font-black leading-tight">{say.title ?? tip?.text ?? ""}</span>
              {g.phase !== "lobby" && <span className="shrink-0 font-black tabular-nums text-[var(--accent)]">{fmtTime(left)}</span>}
            </div>
            <div key={say.text} className="anim-fade mt-0.5 text-[12.5px] leading-snug opacity-90">{say.text}</div>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-1">
          {STEPS.map((name, i) => (
            <span key={name} className={`h-1.5 flex-1 rounded-full ${i < say.step ? "bg-[var(--accent)]/60" : i === say.step ? "bg-[var(--accent)]" : "bg-white/15"}`} title={name} />
          ))}
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[10.5px]">
          <span className="font-semibold opacity-70">Guide · {STEPS[say.step]}</span>
          <button className="opacity-60" onClick={() => endGuide("exit")}>Exit guide</button>
        </div>
      </div>
    </div>
  );
}
