"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getContent, getMe, loadAccount, naira, refreshToken } from "@/lib/api";
import { net } from "@/lib/net";
import { detectQuality, useGame, type Quality } from "@/lib/store";
import Controls from "@/game/Controls";
import { useMap } from "@/ui/hooks";
import { sound } from "@/game/sound";
import { ActionButtons, BlindOverlay, Minimap, PhaseBar, SafeCompass, Toasts, TopBar, ZonePanel } from "@/ui/Hud";
import { ChangelogPanel, WhatsNew } from "@/ui/WhatsNew";
import { ChatDrawer, DicePanel, GameOverPanel, GroupPanel, LeadersPanel, RoundResultPanel, SettingsPanel, WalletPanel } from "@/ui/Panels";

const Scene = dynamic(() => import("@/game/Scene"), { ssr: false });
const RideMap = dynamic(() => import("@/ui/RealMap").then((m) => m.RideMap), { ssr: false });

export default function PlayPage() {
  const router = useRouter();
  const set = useGame((s) => s.set);
  const me = useGame((s) => s.me);
  const panel = useGame((s) => s.panel);
  const map = useMap();
  const [error, setError] = useState("");
  const joined = useRef(false);

  useEffect(() => {
    const join = new URLSearchParams(window.location.search).get("join");
    const acc = loadAccount();
    if (!acc) {
      router.replace(join ? `/?join=${encodeURIComponent(join)}` : "/");
      return;
    }
    let stored: string | null = null;
    try { stored = localStorage.getItem("boju.quality"); } catch { /* ignore */ }
    set({ quality: (stored as Quality | null) ?? detectQuality() });
    (async () => {
      try {
        const fresh = await refreshToken(acc);
        const [content, profile] = await Promise.all([getContent(), getMe(fresh)]);
        set({ content, balance: profile.balance, hunger: profile.hunger, homeArea: profile.home_area });
        if (profile.daily_bonus > 0) useGame.getState().toast(`Daily bonus: +${naira(profile.daily_bonus)}`, "good");
        if (!profile.has_pin) setTimeout(() => useGame.getState().toast("🔐 Set a PIN in ⚙️ Settings so you can log in on any phone"), 6000);
        net.start(fresh);
      } catch (e) {
        setError((e as Error).message || "Can't connect");
      }
    })();
    return () => net.stop();
  }, [router, set]);

  // Audio: unlock on the first tap (browser rule), UI clicks, and music per scene.
  const phase = useGame((s) => s.group?.phase);
  const mapKind = map?.kind;
  useEffect(() => {
    const unlock = () => void sound.unlock();
    const click = (e: PointerEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.(".btn, .choice, .segmented button")) sound.play("click");
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("pointerdown", click, true);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("pointerdown", click, true);
      sound.setScene("off");
    };
  }, []);
  useEffect(() => {
    if (!mapKind) return;
    sound.setScene(mapKind === "hub" ? "hub" : phase === "hide" || phase === "seek" ? "tension" : "arena");
  }, [mapKind, phase]);

  // Auto-join from an invite link once we're connected.
  useEffect(() => {
    const join = new URLSearchParams(window.location.search).get("join");
    if (me && join && !joined.current) {
      joined.current = true;
      net.send({ t: "g_join", code: join });
      set({ panel: "group" });
      window.history.replaceState(null, "", "/play");
    }
  }, [me, set]);

  if (error) {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="text-xl font-bold">Omo, network wahala 😩</div>
        <div className="text-sm opacity-80">{error}</div>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>Try again</button>
      </main>
    );
  }

  return (
    <main className="game-root fixed inset-0 overflow-hidden">
      {map ? (
        <>
          <div className="absolute inset-0"><Scene map={map} /></div>
          <Controls />
          <div className="pointer-events-none absolute inset-0">
            <TopBar />
            <PhaseBar />
            <ZonePanel />
            <SafeCompass />
            <Minimap />
            <ActionButtons />
            <DicePanel />
            <RoundResultPanel />
            <GameOverPanel />
            <Toasts />
            <ChatDrawer />
            {panel === "group" && <GroupPanel />}
            {panel === "wallet" && <WalletPanel />}
            {panel === "settings" && <SettingsPanel />}
            {panel === "leaders" && <LeadersPanel />}
            {panel === "changelog" && <ChangelogPanel />}
            <WhatsNew />
          </div>
          <BlindOverlay />
          <RideMap />
          <div className="pointer-events-none absolute bottom-0 left-1/2 z-10 -translate-x-1/2 text-[10px] opacity-60">In-game naira only — not real money</div>
        </>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2">
          <div className="ride-bus text-6xl">🚌</div>
          <div className="text-lg font-bold">Entering Lagos…</div>
          <div className="text-xs opacity-70">Small download (about 1 MB) · works on mobile data</div>
          <div className="text-xs opacity-70">First visit of the day? The server may take up to a minute to wake up.</div>
        </div>
      )}
    </main>
  );
}
