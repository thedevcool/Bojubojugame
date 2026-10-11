"use client";

import { useEffect, useState } from "react";
import { inRect } from "@/game/physics";
import { local, serverNow } from "@/game/state";
import { useGame } from "@/lib/store";
import type { Area, GameMap, Zone } from "@/lib/types";

/** Re-render every ``ms`` (for countdowns and position-derived UI). */
export function useTicker(ms = 250): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return n;
}

export function useSecondsLeft(endMs: number | undefined): number {
  useTicker(250);
  if (!endMs) return 0;
  return Math.max(0, Math.ceil((endMs - serverNow()) / 1000));
}

export function useMap(): GameMap | null {
  const content = useGame((s) => s.content);
  const mapId = useGame((s) => s.mapId);
  return content && mapId ? content.maps[mapId] ?? null : null;
}

/** Zone / section the local player is standing in (sampled 4x per second). */
export function useWhere(): { zone: Zone | null; section: Area | null } {
  useTicker(250);
  const map = useMap();
  if (!map) return { zone: null, section: null };
  return {
    zone: map.zones.find((z) => inRect(z.rect, local.x, local.z)) ?? null,
    section: map.sections.find((s) => inRect(s.rect, local.x, local.z)) ?? null,
  };
}

export function useRole(): { isSeeker: boolean; inGame: boolean; myState: string | null } {
  const g = useGame((s) => s.group);
  const me = useGame((s) => s.me?.id);
  const r = g?.round;
  const live = g && ["hide", "seek"].includes(g.phase) && r;
  return {
    isSeeker: !!(live && r!.seeker === me),
    inGame: !!live,
    myState: live && me ? (r!.state[me] ?? null) : null,
  };
}

export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
