"use client";

import { useEffect, useRef } from "react";
import { cam, local } from "@/game/state";
import { useGame, type TourStep } from "@/lib/store";
import { goToShop } from "./Phone";
import { useTicker } from "./hooks";

/**
 * The guided tour for new players: short, one step at a time, never in the way.
 * A small card says what to try; most steps finish by themselves when the player does it.
 * "Skip" ends it at any point; progress survives a reload.
 */
const DONE_KEY = "boju.onboarded";
const STEP_KEY = "boju.tourStep";
export const TOUR: TourStep[] = ["welcome", "move", "look", "phone", "house", "home", "map", "aerial", "roles", "play"];

export function onboardingDone(): boolean {
  try { return localStorage.getItem(DONE_KEY) === "1"; } catch { return false; }
}
export function savedTourStep(): TourStep | null {
  try {
    const s = localStorage.getItem(STEP_KEY) as TourStep | null;
    return s && TOUR.includes(s) ? s : null;
  } catch { return null; }
}
function save(step: TourStep | null): void {
  try {
    if (step) localStorage.setItem(STEP_KEY, step);
    else { localStorage.removeItem(STEP_KEY); localStorage.setItem(DONE_KEY, "1"); }
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
  let i = TOUR.indexOf(from) + 1;
  // skip what the player already has (e.g. a phone bought before the tour reached it)
  while (i < TOUR.length && ((TOUR[i] === "phone" && life.phoneId) || (TOUR[i] === "house" && life.homeId))) i++;
  const step = TOUR[i] ?? null;
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
  const username = useGame((s) => s.life.username || s.me?.nick || "");
  const building = useGame((s) => s.building);
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
    (step === "play" && group);
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

  if (!step) return null;
  const skip = () => finishTour("Tour skipped — 📱 ⚙️ Settings → How to play has the rules any time");
  const n = TOUR.indexOf(step);

  // ---- the invitation (small, at the bottom, nothing blocked)
  if (step === "welcome") {
    if (building) return null; // say hello once the city is standing, not over an empty field
    return (
      <div className="pointer-events-auto absolute inset-x-0 bottom-[max(env(safe-area-inset-bottom),12px)] z-[56] flex justify-center px-3" data-testid="tour" data-keep-phone>
        <div className="panel anim-sheet w-full max-w-md p-4">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[var(--accent)] text-3xl leading-none"><span className="logo-peek">🙈</span></span>
            <div className="min-w-0">
              <div className="text-lg font-black leading-tight">Ẹ káàbọ̀, {username}!</div>
              <div className="text-[13px] leading-snug opacity-85">Welcome to Boju Boju. Before you start to dey Boju — we get more than that here. Want me to show you around?</div>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button className="btn btn-ghost flex-1" onClick={skip}>Not now</button>
            <button className="btn btn-primary flex-[2]" onClick={() => next("welcome")}>Show me around ▶</button>
          </div>
        </div>
      </div>
    );
  }

  const STEPS: Record<Exclude<TourStep, "welcome">, { icon: string; title: string; text: string; action?: { label: string; on: () => void } }> = {
    move: { icon: "👆🏾", title: "Tap the ground to walk", text: "Tap anywhere on the ground and you walk there. (Prefer a joystick? ⚙️ Settings → Controls.)" },
    look: { icon: "👀", title: "Drag to look around", text: "Slide your finger across the screen to turn the camera. Pinch to zoom." },
    phone: { icon: "📱", title: "Buy a phone at Tini Tech", text: "Your phone is how you play, chat and travel. Follow the arrow to the shop and pick one.", action: { label: "Walk me there", on: goToShop } },
    house: phoneOpen
      ? { icon: "🏠", title: phoneApp === "houses" ? "Pick a house and rent it" : "Open 🏠 Houses", text: phoneApp === "houses" ? "Choose any free house on the list, then pay the rent to move in." : "Tap the Houses app on your phone." }
      : { icon: "🏠", title: "Rent a house", text: "Open your phone (top right) → 🏠 Houses, and rent one to call home.", action: { label: "Open Houses", on: () => useGame.getState().openApp("houses") } },
    home: { icon: "🚶🏾", title: "Walk home", text: `Follow the arrow to ${home?.name ?? "your new house"} and walk in through the door — it's yours.` },
    map: { icon: "🗺️", title: "See every place", text: "Tap the round MAP (top left): Lagos up close, and every city in Naija. Pin a place to walk, ride or drive there." },
    aerial: { icon: "🛰️", title: "Look from above", text: "Tap 🛰️ Aerial (bottom right) to see the area from the sky — great for scouting hiding spots. Tap it again to come back." },
    roles: { icon: "🙈", title: "Hiding vs seeking", text: "", action: { label: "Got it", on: () => next("roles") } },
    play: { icon: "🎉", title: "Start your first Boju Boju", text: "📱 → 🙈 Boju Boju → “Quick game with NPCs” is perfect for a first try. Friends can join with your code.", action: { label: "Open Boju Boju", on: () => useGame.getState().openApp("boju") } },
  };
  const s = STEPS[step];
  // at the top like the in-game coach: the bottom stays free for shop panels and buttons
  const top = phoneOpen || mapOpen; // the phone / map fill the screen: sit small at the very top
  return (
    <div className={`pointer-events-none absolute inset-x-0 z-[56] flex justify-center px-3 ${top ? "top-2" : "top-[3.9rem]"}`} data-testid="tour" data-keep-phone>
      <div key={step} className="panel anim-banner pointer-events-auto w-full max-w-md p-3">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--accent)]/25 text-2xl leading-none">{s.icon}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-[15px] font-black leading-tight">{s.title}</div>
              <span className="shrink-0 text-[10px] font-bold tabular-nums opacity-50">{n}/{TOUR.length - 1}</span>
            </div>
            {step === "roles" ? (
              <div className="mt-1 grid grid-cols-2 gap-2 text-[12px] leading-snug">
                <div className="rounded-xl bg-white/5 p-2"><b className="block">🏃🏾 When you hide</b>Get behind walls. <b>Bend</b> behind hedges. Hold <b>Run</b>. Follow the 🟢 compass to the safe house.</div>
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
  );
}
