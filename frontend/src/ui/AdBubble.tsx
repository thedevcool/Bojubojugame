"use client";

import { useEffect } from "react";
import { useGame } from "@/lib/store";

/** The tiny "📢 Place ad here" bubble where you tapped a wall (HUD layer; fades after a few seconds). */
export function AdBubble() {
  const spot = useGame((s) => s.adTap);
  const set = useGame((s) => s.set);
  useEffect(() => {
    if (!spot) return;
    const id = setTimeout(() => { if (useGame.getState().adTap === spot) set({ adTap: null }); }, 4500);
    return () => clearTimeout(id);
  }, [spot, set]);
  if (!spot) return null;
  return (
    <button
      data-testid="ad-bubble"
      style={{ left: Math.max(70, Math.min(spot.sx, window.innerWidth - 70)), top: Math.max(60, spot.sy - 44) }}
      className="anim-pop pointer-events-auto absolute z-20 -translate-x-1/2 whitespace-nowrap rounded-full bg-white px-3.5 py-2 text-xs font-bold text-slate-900 shadow-lg shadow-black/30"
      onClick={() => set({ adTap: null, adSheet: spot })}
    >
      📢 Place ad here
    </button>
  );
}
