"use client";

import { useEffect, useState } from "react";
import { setMemoryAccount, vatarSignIn } from "@/lib/api";
import { useGame } from "@/lib/store";
import { claimAdPurchase, loadSdk, vatarMessage } from "@/lib/vatar";
import { sound } from "@/game/sound";
import { net } from "@/lib/net";
import PlayPage from "../play/page";

/**
 * Boju Boju inside LagosLife (their Games app frames this page). LagosLife signs the player in;
 * their money, home and friends stay in LagosLife, and this is the hide & seek part.
 */
export default function LagosLifeMini() {
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let off: (() => void)[] = [];
    (async () => {
      try {
        const v = await loadSdk();
        const { player, session, mode } = await v.init();
        const acc = await vatarSignIn(session);
        setMemoryAccount(acc);
        useGame.getState().set({ mini: { mode, name: player.name } });
        off = [
          // LagosLife rule 4: sound and timers stop. The server only freezes a solo game (you + NPCs);
          // a game with other people keeps going and your stand-in holds your place.
          v.onPause(() => {
            sound.pause(true);
            if (useGame.getState().group) net.send({ t: "g_pause" });
          }),
          v.onResume(() => {
            sound.pause(false);
            if (useGame.getState().group) net.send({ t: "g_resume" });
          }),
          v.onPurchase((p) => void claimAdPurchase(p)), // paid while we were away (e.g. a bank page)
        ];
        setReady(true);
        // anything paid earlier that a crash or reload interrupted
        v.purchases().then((list) => list.forEach((p) => void claimAdPurchase(p))).catch(() => {});
      } catch (e) {
        setErr(vatarMessage(e));
      }
    })();
    return () => off.forEach((f) => f());
  }, []);

  if (ready) return <PlayPage />;
  return (
    <main className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-[22px] bg-[var(--accent)] text-4xl leading-none"><span className="logo-peek">🙈</span></span>
      {err ? (
        <>
          <div className="text-lg font-bold">Boju Boju couldn&apos;t start</div>
          <div className="max-w-xs text-sm opacity-80">{err}</div>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>Try again</button>
        </>
      ) : (
        <>
          <div className="text-lg font-bold">Boju Boju</div>
          <div className="text-xs opacity-70">Signing you in with LagosLife…</div>
        </>
      )}
    </main>
  );
}
