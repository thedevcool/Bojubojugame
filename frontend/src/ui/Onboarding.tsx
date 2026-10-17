"use client";

import { GAME_ONLY } from "@/lib/scope";
import { useEffect, useRef, useState } from "react";
import { cam, local } from "@/game/state";
import { accountKey, serverFlags, setFlag } from "@/lib/api";
import { useGame, type TourStep } from "@/lib/store";
import { goToShop } from "./Phone";
import { useTicker } from "./hooks";

/**
 * The guided tour for new players: short, one step at a time, never in the way.
 * A small card says what to try; most steps finish by themselves when the player does it.
 * "Skip" ends it at any point; progress survives a reload.
 */
// kept per account: a new account on a phone where someone already took the tour still gets it
const DONE_KEY = "boju.onboarded";
const STEP_KEY = "boju.tourStep";
export const TOUR: TourStep[] = ["welcome", "move", "look", "phone", "house", "home", "map", "aerial", "roles", "play"];

/**
 * LagosLife is just the game: the tour is about playing Boju Boju (moving, looking, Aerial, hiding vs seeking, a first
 * game). The phone comes free, and houses, shops and travel aren't part of it.
 */
const MINI_SKIP: TourStep[] = ["phone", "house", "home", "map"];
const steps = (): TourStep[] => (useGame.getState().mini || GAME_ONLY ? TOUR.filter((s) => !MINI_SKIP.includes(s)) : TOUR);

export function onboardingDone(): boolean {
  if (serverFlags.tour === "done") return true;
  try { return localStorage.getItem(accountKey(DONE_KEY)) === "1"; } catch { return false; }
}
export function savedTourStep(): TourStep | null {
  let s: string | null = null;
  try { s = localStorage.getItem(accountKey(STEP_KEY)); } catch { /* storage blocked */ }
  s ??= serverFlags.tour ?? null;
  return s && steps().includes(s as TourStep) ? (s as TourStep) : null;
}
function save(step: TourStep | null): void {
  setFlag("tour", step ?? "done");
  try {
    if (step) localStorage.setItem(accountKey(STEP_KEY), step);
    else { localStorage.removeItem(accountKey(STEP_KEY)); localStorage.setItem(accountKey(DONE_KEY), "1"); }
  } catch { /* storage blocked */ }
}

export function finishTour(msg?: string): void {
  save(null);
  const st = useGame.getState();
  st.set({ onboard: null, guide: null });
  if (msg) st.toast(msg, "good");
}

function next(from: TourStep): void {
  const st = useGame.getState();
  const life = st.life;
  const list = steps();
  let i = list.indexOf(from) + 1;
  // skip what the player already has (e.g. a phone bought before the tour reached it)
  while (i < list.length && ((list[i] === "phone" && life.phoneId) || (list[i] === "house" && life.homeId))) i++;
  const step = list[i] ?? null;
  if (!step) { finishTour("🎉 You're ready! Have fun — and hide well 🙈"); return; }
  save(step);
  st.set({ onboard: step });
}

export default function Onboarding() {
  const step = useGame((s) => s.onboard);
  const set = useGame((s) => s.set);
  const phoneOpen = useGame((s) => s.phoneOpen);
  const phoneApp = useGame((s) => s.phoneApp);
  const phoneId = useGame((s) => s.life.phoneId);
  const homeId = useGame((s) => s.life.homeId);
  const home = useGame((s) => s.home);
  const mapOpen = useGame((s) => s.mapOpen);
  const aerial = useGame((s) => s.aerial);
  const group = useGame((s) => !!s.group);
  const username = useGame((s) => s.mini?.name || s.life.username || s.me?.nick || "");
  const cityBuilt = useGame((s) => s.cityBuilt && !s.building);
  const guide = useGame((s) => s.gameGuide);
  const mini = useGame((s) => !!s.mini);
  const front = useGame((s) => s.front);
  useTicker(300);
  const mark = useRef<{ step: TourStep | null; x: number; z: number; yaw: number; turned: number; seenOn: boolean }>({ step: null, x: 0, z: 0, yaw: 0, turned: 0, seenOn: false });

  // where the step started (to see the player walk / look around)
  if (step && mark.current.step !== step) mark.current = { step, x: local.x, z: local.z, yaw: cam.yaw, turned: 0, seenOn: false };
  const m = mark.current;
  if (step === "look") { m.turned = Math.max(m.turned, Math.abs(cam.yaw - m.yaw)); }
  if (step === "aerial" && aerial) m.seenOn = true;

  // each step finishes by itself once the player has done it
  const done =
    (step === "move" && Math.hypot(local.x - m.x, local.z - m.z) > 3) ||
    (step === "look" && m.turned > 0.8) ||
    (step === "phone" && !!phoneId) ||
    (step === "house" && !!homeId) ||
    (step === "home" && !!home && local.insideHome === home.id) ||
    (step === "map" && mapOpen) ||
    (step === "aerial" && m.seenOn && !aerial) ||
    (step === "play" && (group || guide === "on"));
  useEffect(() => {
    if (!step || !done) return;
    if (step === "play") { finishTour("🎉 That's it — you're ready! Have fun and hide well 🙈"); return; }
    const id = setTimeout(() => next(step), step === "map" ? 1200 : 500);
    return () => clearTimeout(id);
  }, [step, done]);

  // arrows to where you need to go
  useEffect(() => {
    if (step === "phone") {
      const z = useGame.getState().content?.maps.hub_plaza?.zones.find((x) => x.kind === "phone_shop");
      if (z) set({ guide: { x: (z.rect[0] + z.rect[2]) / 2, z: (z.rect[1] + z.rect[3]) / 2, label: "📱 Tini Tech" } });
    }
    if (step === "home") {
      const h = useGame.getState().content?.maps.hub_plaza?.homes?.find((x) => x.id === useGame.getState().home?.id);
      if (h) set({ guide: { x: h.door[0], z: h.door[1], label: "🏠 Your house" } });
    }
    if (step === "map" || step === "roles") set({ guide: null });
  }, [step, set]);

  if (!step || guide || front) return null; // the first-game guide takes over from here; Baba Boju speaks first
  const skip = () => finishTour("Tour skipped — 📱 ⚙️ Settings → How to play has the rules any time");
  const n = steps().indexOf(step), total = steps().length - 1;

  // ---- the invitation (small, at the bottom, nothing blocked)
  if (step === "welcome") {
    if (!cityBuilt || group) return null; // say hello once the city is standing (and never in the middle of a game)
    return (
      <div className="pointer-events-auto absolute inset-x-0 bottom-[max(env(safe-area-inset-bottom),12px)] z-[56] flex justify-center px-3" data-testid="tour" data-keep-phone>
        <div className="panel anim-sheet guide-attn w-full max-w-md p-4">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[var(--accent)] text-3xl leading-none"><span className="logo-peek">🙈</span></span>
            <div className="min-w-0">
              <div className="text-lg font-black leading-tight">Ẹ káàbọ̀, {username}!</div>
              <div className="text-[13px] leading-snug opacity-85">{mini || GAME_ONLY
                ? "Welcome to Boju Boju — hide & seek, Lagos style. Want a quick guide to playing?"
                : "Welcome to Boju Boju. Before you start to dey Boju — we get more than that here. Want me to show you around?"}</div>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button className="btn btn-ghost flex-1" onClick={skip}>Not now</button>
            <button className="btn btn-primary flex-[2]" onClick={() => next("welcome")}>{mini || GAME_ONLY ? "Show me how ▶" : "Show me around ▶"}</button>
          </div>
        </div>
      </div>
    );
  }

  const STEPS: Record<Exclude<TourStep, "welcome">, { icon: string; title: string; text: string; action?: { label: string; on: () => void } }> = {
    move: { icon: "👆🏾", title: "Tap the ground to walk", text: "Tap anywhere on the ground and you walk there. (Prefer a joystick? ⚙️ Settings → Controls.)" },
    look: { icon: "👀", title: "Drag to look around", text: "Slide your finger across the screen to turn the camera. Pinch to zoom." },
    phone: { icon: "📱", title: "Buy a phone at Tini Tech", text: "Your phone is how you play, chat and travel. Follow the glowing arrows on the ground to the shop (or tap Walk me there), then pick one.", action: { label: "Walk me there", on: goToShop } },
    house: phoneOpen
      ? { icon: "🏠", title: phoneApp === "houses" ? "Pick a house and rent it" : "Open 🏠 Houses", text: phoneApp === "houses" ? "Choose any free house on the list, then pay the rent to move in." : "Tap the Houses app on your phone." }
      : { icon: "🏠", title: "Rent a house", text: "Open your phone (top right) → 🏠 Houses, and rent one to call home.", action: { label: "Open Houses", on: () => useGame.getState().openApp("houses") } },
    home: { icon: "🚶🏾", title: "Walk home", text: `Follow the glowing arrows on the ground to ${home?.name ?? "your new house"} and walk in through the door — it's yours. Lost? Tap the arrow at the edge of the screen.` },
    map: { icon: "🗺️", title: "See every place", text: "Tap the round MAP (top left): Lagos up close, and every city in Naija. Pin a place to walk, ride or drive there." },
    aerial: { icon: "🛰️", title: "Look from above", text: "Tap 🛰️ Aerial at the bottom to see the area from the sky — great for scouting hiding spots, and for watching Boju while you hide. Tap it again to come back." },
    roles: { icon: "🙈", title: "Hiding vs seeking", text: "", action: { label: "Got it", on: () => next("roles") } },
    play: { icon: "🎉", title: "Start your first Boju Boju", text: `Open 🙈 Boju Boju on your phone${mini ? " (top right — it's free)" : ""}. I'll guide you through a practice game with NPCs.`, action: { label: "Open Boju Boju", on: () => useGame.getState().openApp("boju") } },
  };
  const s = STEPS[step];
  // show, don't tell: a finger tapping the ground / swiping across the screen
  const hint = step === "move" ? (
    <div className="pointer-events-none absolute left-1/2 top-[56%] z-[55] flex -translate-x-1/2 flex-col items-center" data-testid="move-hint">
      <div className="hint-tap"><span>👆🏾</span></div>
      <div className="hint-label">Tap here to walk</div>
    </div>
  ) : step === "look" ? (
    <div className="pointer-events-none absolute left-1/2 top-[56%] z-[55] flex -translate-x-1/2 flex-col items-center">
      <div className="hint-swipe"><span>👆🏾</span></div>
      <div className="hint-label">Slide to look around</div>
    </div>
  ) : null;
  // at the top like the in-game coach: the bottom stays free for shop panels and buttons
  const top = phoneOpen || mapOpen; // the phone / map fill the screen: sit small at the very top
  return (
    <>
    {hint}
    <div className={`pointer-events-none absolute inset-x-0 z-[56] flex justify-center px-3 ${top ? "top-2" : "top-[3.9rem]"}`} data-testid="tour" data-keep-phone>
      <div key={step} className="panel anim-banner guide-attn pointer-events-auto w-full max-w-md p-3" style={top ? ({ "--glass": "rgba(10, 16, 34, 0.97)" } as React.CSSProperties) : undefined}>
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--accent)]/25 text-2xl leading-none">{s.icon}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-[15px] font-black leading-tight">{s.title}</div>
              <span className="shrink-0 text-[10px] font-bold tabular-nums opacity-50">{n}/{total}</span>
            </div>
            {step === "roles" ? (
              <div className="mt-1 grid grid-cols-2 gap-2 text-[12px] leading-snug">
                <div className="rounded-xl bg-white/5 p-2"><b className="block">🏃🏾 When you hide</b>Get behind walls. <b>Bend</b> behind hedges. Tap <b>Run</b>. Follow the 🟢 compass to the safe house.</div>
                <div className="rounded-xl bg-white/5 p-2"><b className="block">👀 When you&apos;re Boju</b>Eyes closed while they hide, then walk close to anyone to catch them — no button.</div>
              </div>
            ) : (
              !top && <div className="mt-0.5 text-[12.5px] leading-snug opacity-85">{s.text}</div>
            )}
            <div className="mt-2 flex items-center gap-3">
              {s.action && <button className="btn btn-primary px-3 py-1.5 text-xs" onClick={s.action.on}>{s.action.label}</button>}
              <button className="text-[11px] opacity-60" onClick={skip}>Skip tour</button>
            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}

/**
 * For players who skipped the tour: if they haven't walked anywhere ~20 s after arriving, show the
 * tapping-finger hint once (per account) until they move.
 */
export function MoveHint() {
  const ready = useGame((s) => s.cityBuilt && s.onboard === null && !s.group && !s.phoneOpen && !s.mapOpen && !s.mini && !s.front);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!ready) return;
    let seen = false;
    try { seen = localStorage.getItem(accountKey("boju.moveHint")) === "1"; } catch { /* storage blocked */ }
    if (seen) return;
    const x0 = local.x, z0 = local.z;
    const moved = () => Math.hypot(local.x - x0, local.z - z0) > 2;
    const t = setTimeout(() => { if (!moved()) setShow(true); }, 20000);
    const id = setInterval(() => {
      if (!moved()) return;
      setShow(false);
      try { localStorage.setItem(accountKey("boju.moveHint"), "1"); } catch { /* storage blocked */ }
      clearInterval(id);
    }, 500);
    return () => { clearTimeout(t); clearInterval(id); };
  }, [ready]);
  if (!show || !ready) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-[56%] z-[55] flex -translate-x-1/2 flex-col items-center" data-testid="move-hint">
      <div className="hint-tap"><span>👆🏾</span></div>
      <div className="hint-label">Tap the ground to walk there</div>
    </div>
  );
}
