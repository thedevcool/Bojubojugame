"use client";

import { useEffect, useState } from "react";
import { sound } from "@/game/sound";
import { useGame } from "@/lib/store";

/**
 * "Here's where they were hiding!" — after a round, the camera flies over every hider Boju never
 * found (Scene.tsx draws the beam), and a card says who it was and how close Boju came.
 * The server makes the result phase longer by REVEAL_EACH seconds per spot, so the results wait for it.
 */
export const REVEAL_EACH = 3;

export function Reveal() {
  const g = useGame((s) => s.group);
  const me = useGame((s) => s.me?.id);
  const rv = useGame((s) => s.reveal);
  const set = useGame((s) => s.set);
  const [, tick] = useState(0);
  const r = g?.last_result;
  const spots = g?.phase === "result" ? r?.hidden_at ?? [] : [];

  // start the tour once per round
  useEffect(() => {
    if (!r || g?.phase !== "result" || !spots.length || rv?.round === r.round) return;
    useGame.getState().closePhone();
    set({ reveal: { spots, start: Date.now(), round: r.round } });
    sound.play("whistle");
  }, [g?.phase, r?.round]); // eslint-disable-line react-hooks/exhaustive-deps

  // advance / finish
  useEffect(() => {
    if (!rv) return;
    const id = setInterval(() => {
      const i = Math.floor((Date.now() - rv.start) / (REVEAL_EACH * 1000));
      if (i >= rv.spots.length || useGame.getState().group?.phase !== "result") set({ reveal: null });
      else { tick((n) => n + 1); }
    }, 250);
    return () => clearInterval(id);
  }, [rv, set]);
  const i = rv ? Math.floor((Date.now() - rv.start) / (REVEAL_EACH * 1000)) : -1;
  useEffect(() => { if (rv && i >= 0 && i < rv.spots.length) sound.play("pop"); }, [i, rv]);

  if (!rv || i < 0 || i >= rv.spots.length) return null;
  const sp = rv.spots[i];
  const iAmBoju = r?.seeker === me;
  const close = sp.closest !== null && sp.closest < 6;
  const line = sp.safe
    ? "Chilling in the safe house 🟢"
    : sp.closest === null
      ? "Boju never came this way 😎"
      : iAmBoju
        ? close ? `You passed just ${sp.closest.toFixed(1)} m away! 😩` : `You came within ${Math.round(sp.closest)} m`
        : close ? `Boju came within ${sp.closest.toFixed(1)} m 😱` : `Boju came within ${Math.round(sp.closest)} m`;
  const isMe = sp.id === me;
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-[9rem] z-[36] flex justify-center px-4" data-testid="reveal">
        <div className="anim-banner rounded-full bg-black/60 px-4 py-1.5 text-sm font-black text-white backdrop-blur">
          👀 Here&apos;s where they were hiding!
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-32 z-[36] flex justify-center px-4">
        <div key={sp.id} className="panel anim-pop w-[min(22rem,92vw)] p-3.5 text-center">
          <div className="text-[11px] font-bold uppercase tracking-widest opacity-60">Hider {i + 1} of {rv.spots.length}</div>
          <div className="mt-0.5 text-2xl font-black">{isMe ? "🥷 That was you!" : `🥷 ${sp.nick} was here`}</div>
          <div className={`mt-0.5 text-sm font-bold ${close && !sp.safe ? "text-[#ffd84f]" : "opacity-80"}`}>{line}</div>
          <div className="mt-2 flex justify-center gap-1.5">
            {rv.spots.map((_, k) => <span key={k} className={`h-1.5 rounded-full transition-all ${k === i ? "w-5 bg-[#ffd84f]" : "w-1.5 bg-white/30"}`} />)}
          </div>
        </div>
      </div>
    </>
  );
}
