"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getContent, getFriends, getMe, loadAccount, naira, refreshToken, type Account } from "@/lib/api";
import { NewPasswordForm } from "@/ui/AuthForms";
import { net } from "@/lib/net";
import { detectQuality, useGame, type Quality } from "@/lib/store";
import Controls from "@/game/Controls";
import { useMap } from "@/ui/hooks";
import { sound } from "@/game/sound";
import { MapScreen, MiniMapWidget } from "@/ui/MapView";
import { WatchView } from "@/ui/Live";
import { AdBubble } from "@/ui/AdBubble";
import { ActionButtons, BlindOverlay, PhaseBar, SafeCompass, SeatAsk, Toasts, TopBar, ZonePanel } from "@/ui/Hud";

import { WhatsNew, markSeen } from "@/ui/WhatsNew";
import { DicePanel, GameOverPanel, RoundResultPanel } from "@/ui/Panels";
import Phone from "@/ui/Phone";
import { InviteBanner, PlayerCard } from "@/ui/PlayerCard";
import { DoorPanel, KnockPrompt } from "@/ui/Doors";
import Onboarding, { onboardingDone } from "@/ui/Onboarding";

const Scene = dynamic(() => import("@/game/Scene"), { ssr: false });
const DecorateOverlay = dynamic(() => import("@/ui/Decorate").then((m) => m.DecorateOverlay), { ssr: false });
const AdSheet = dynamic(() => import("@/ui/AdSheet").then((m) => m.AdSheet), { ssr: false });
const RideMap = dynamic(() => import("@/ui/RealMap").then((m) => m.RideMap), { ssr: false });

export default function PlayPage() {
  const router = useRouter();
  const set = useGame((s) => s.set);
  const me = useGame((s) => s.me);
  const map = useMap();
  const decor = useGame((s) => !!s.decor);
  const onboarding = useGame((s) => s.onboard !== null);
  const [error, setError] = useState("");
  const [forceChange, setForceChange] = useState<{ acc: Account; username: string } | null>(null);
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
        if (profile.must_change_password) {
          // Legacy account on the temporary password: no game until a real password is chosen.
          setForceChange({ acc: fresh, username: profile.username ?? profile.nickname });
          return;
        }
        set({
          content, balance: profile.balance, hunger: profile.hunger, homeArea: profile.home_area,
          life: { phoneId: profile.phone_id, homeId: profile.home_id, rentUntil: profile.rent_until, username: profile.username ?? profile.nickname, carId: profile.car_id },
        });
        // first launch (or no phone/house yet): the welcome tour
        if (!onboardingDone() && (!profile.phone_id || !profile.home_id)) {
          set({ onboard: profile.phone_id ? "launch" : "welcome" });
          markSeen(); // the tour is the "what's new" for them — don't stack a second sheet on top
        }
        getFriends(fresh).then((d) => set({ dmUnread: d.friends.reduce((a, f) => a + f.unread, 0), friendReqs: d.incoming.length })).catch(() => {});
        if (profile.topup) useGame.getState().toast(`🎉 Test-phase bonus: +${naira(profile.topup)} — enjoy!`, "good");
        if (profile.daily_bonus > 0) useGame.getState().toast(`Daily bonus: +${naira(profile.daily_bonus)}`, "good");
        if (!profile.email) setTimeout(() => useGame.getState().toast("✉️ Add an email in 📱 Settings so you can reset your password"), 60000);
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
      set({ phoneOpen: true, phoneApp: "boju", onboard: null });
      window.history.replaceState(null, "", "/play");
    }
  }, [me, set]);

  if (forceChange) {
    return (
      <main className="mx-auto flex min-h-full max-w-md flex-col justify-center px-4 py-8">
        <div className="panel anim-pop p-5">
          <div className="mb-3 text-center text-5xl">🔐</div>
          <h1 className="text-center text-2xl font-black">Choose your new password</h1>
          <p className="mt-2 text-center text-sm opacity-85">
            Boju Boju now uses proper accounts. Your username is <b>{forceChange.username}</b> and your temporary password
            is <b>123456</b>. Pick your own password to keep playing — your naira and house are safe.
          </p>
          <div className="mt-4">
            <NewPasswordForm acc={forceChange.acc} username={forceChange.username} temporary="123456" onDone={() => window.location.reload()} />
          </div>
        </div>
      </main>
    );
  }

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
          <Controls disabled={decor} />
          <div className="pointer-events-none absolute inset-0">
            <TopBar />
            <PhaseBar />
            <ZonePanel />
            <SafeCompass />
            {!decor && !onboarding && <MiniMapWidget />}
            {!decor && <ActionButtons />}
            <DicePanel />
            <RoundResultPanel />
            <GameOverPanel />
            <Toasts />
            <Onboarding />
            <Phone />
            <PlayerCard />
            <InviteBanner />
            <DoorPanel />
            <SeatAsk />
            <KnockPrompt />
            <WhatsNew />
            {!decor && <AdBubble />}
            <AdSheet />
          </div>
          <DecorateOverlay />
          <MapScreen />
          <WatchView />
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
