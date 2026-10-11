"use client";

import { useEffect } from "react";
import { walkTo } from "@/game/nav";
import { local } from "@/game/state";
import { savedControls, useGame } from "@/lib/store";
import { ControlModePicker } from "./Panels";
import { goToShop } from "./Phone";
import { useTicker } from "./hooks";

const DONE_KEY = "boju.onboarded";

export function onboardingDone(): boolean {
  try { return localStorage.getItem(DONE_KEY) === "1"; } catch { return false; }
}

function finish(): void {
  try { localStorage.setItem(DONE_KEY, "1"); } catch { /* ignore */ }
  useGame.getState().set({ onboard: null, guide: null });
}

/** First-launch story: welcome → controls → buy a phone → rent a house → move in. */
export default function Onboarding() {
  const step = useGame((s) => s.onboard);
  const set = useGame((s) => s.set);
  const phoneOpen = useGame((s) => s.phoneOpen);
  const phoneApp = useGame((s) => s.phoneApp);
  const phoneId = useGame((s) => s.life.phoneId);
  const home = useGame((s) => s.home);
  const username = useGame((s) => s.life.username || s.me?.nick || "");
  const mapId = useGame((s) => s.mapId);
  useTicker(300);

  // advance automatically as the player does each thing
  useEffect(() => {
    if (step === "phone" && phoneId) set({ onboard: "launch", guide: null });
    if (step === "launch" && phoneOpen && phoneApp === "houses") set({ onboard: "rent" });
    if (step === "phone" && mapId === "hub_plaza") {
      const z = useGame.getState().content?.maps.hub_plaza?.zones.find((x) => x.kind === "phone_shop");
      if (z && !useGame.getState().guide) set({ guide: { x: (z.rect[0] + z.rect[2]) / 2, z: (z.rect[1] + z.rect[3]) / 2, label: "📱 Phone shop" } });
    }
  }, [step, phoneId, phoneOpen, phoneApp, mapId, set]);
  const atHome = step === "home" && !!home && local.insideHome === home.id;
  useEffect(() => {
    if (!atHome) return;
    finish();
    useGame.getState().toast("🏠 Welcome home! Sit down, relax — then 📱 → Boju Boju to play.", "good");
  }, [atHome]);

  if (!step) return null;

  if (step === "welcome") {
    return (
      <div className="anim-fade pointer-events-auto absolute inset-0 z-[65] flex flex-col justify-end bg-gradient-to-t from-[#0a1324] via-[#0a1324]/55 to-transparent p-4 pb-[max(env(safe-area-inset-bottom),16px)]">
        <div className="mx-auto w-full max-w-md">
          <div className="anim-pop mx-auto mb-3 grid h-20 w-20 place-items-center rounded-[26px] bg-[var(--accent)] text-5xl shadow-xl shadow-blue-500/40"><span className="logo-peek">🙈</span></div>
          <h1 className="anim-rise text-center text-3xl font-black" style={{ animationDelay: "120ms" }}>Ẹ káàbọ̀, {username}!</h1>
          <p className="anim-rise mt-1 text-center text-sm opacity-85" style={{ animationDelay: "220ms" }}>Welcome to Lagos. You just landed — let&apos;s set you up.</p>
          <div className="mt-4 space-y-2">
            {[
              ["📱", "Buy a phone", "The phone shop is right beside you"],
              ["🏠", "Rent a house", "Open the Houses app and move in"],
              ["🙈", "Play Boju Boju", "With friends or NPCs, anywhere in Naija"],
            ].map(([icon, title, text], i) => (
              <div key={title} className="anim-step panel flex items-center gap-3 p-3" style={{ animationDelay: `${350 + i * 120}ms` }}>
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--accent)]/25 text-xl">{icon}</span>
                <span className="text-sm"><b className="block">{i + 1}. {title}</b><span className="opacity-75">{text}</span></span>
              </div>
            ))}
          </div>
          <button className="btn btn-primary anim-rise mt-4 w-full text-lg" style={{ animationDelay: "750ms" }}
            onClick={() => set({ onboard: savedControls() ? (phoneId ? "launch" : "phone") : "controls" })}>Oya, let&apos;s go ▶</button>
          <button className="mt-2 w-full text-center text-xs opacity-60" onClick={finish}>Skip the tour</button>
        </div>
      </div>
    );
  }

  if (step === "controls") {
    return (
      <div className="anim-fade pointer-events-auto absolute inset-0 z-[65] flex items-end justify-center bg-black/50 p-3 sm:items-center">
        <div className="panel anim-sheet w-full max-w-md p-4">
          <h2 className="text-xl font-black">How do you want to move?</h2>
          <p className="mb-3 text-sm opacity-75">You can change this any time in 📱 Settings.</p>
          <ControlModePicker onPick={() => set({ onboard: phoneId ? "launch" : "phone" })} />
        </div>
      </div>
    );
  }

  if (phoneOpen) return null; // the phone has its own hints
  const banner = (n: number, text: React.ReactNode, action?: React.ReactNode) => (
    <div className="pointer-events-auto absolute left-1/2 top-[3.9rem] z-20 w-[min(24rem,94vw)] -translate-x-1/2">
      <div key={step} className="panel anim-banner flex items-center gap-3 p-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--accent)] text-sm font-black">{n}/3</span>
        <div className="min-w-0 flex-1 text-sm leading-snug">{text}</div>
        {action}
      </div>
      <button className="mx-auto mt-1 block text-[10px] opacity-60" onClick={finish}>Skip tour</button>
    </div>
  );

  if (step === "phone") {
    return banner(1, <><b>Buy a phone.</b> The 📱 shop is just beside you — walk in and pick any phone.</>,
      <button className="btn btn-primary shrink-0 px-3 py-1.5 text-xs" onClick={goToShop}>Walk me there</button>);
  }
  if (step === "launch" || step === "rent") {
    return banner(2, <><b>Launch your phone</b> (top right) and open <b>🏠 Houses</b> to rent a house.</>,
      <button className="btn btn-primary shrink-0 px-3 py-1.5 text-xs" onClick={() => useGame.getState().openApp("houses")}>Open</button>);
  }
  const homeGeo = useGame.getState().content?.maps.hub_plaza?.homes?.find((h) => h.id === home?.id);
  return banner(3, <><b>Move in!</b> Walk to {home?.name ?? "your new house"} — it&apos;s yours.</>,
    homeGeo && <button className="btn btn-primary shrink-0 px-3 py-1.5 text-xs" onClick={() => walkTo(homeGeo.spawn[0], homeGeo.spawn[1])}>Walk me home</button>);
}
