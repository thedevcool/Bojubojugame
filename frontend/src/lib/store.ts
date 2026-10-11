import { create } from "zustand";
import type { ChatMsg, Content, GroupState, Home, RosterEntry, Standing } from "./types";

export type Quality = "low" | "medium" | "high";

export function detectQuality(): Quality {
  if (typeof navigator === "undefined") return "medium";
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mobile = /Android|iPhone|iPad|Mobile/i.test(nav.userAgent);
  const mem = nav.deviceMemory ?? 4;
  const cores = nav.hardwareConcurrency ?? 4;
  if (mem <= 3 || cores <= 4) return "low";
  return mobile ? "medium" : "high";
}

export interface Toast { id: number; msg: string; kind: "info" | "error" | "good" }

interface GameStore {
  content: Content | null;
  me: { id: string; nick: string; n: number } | null;
  home: Home | null;
  connected: boolean;
  mapId: string | null;
  roster: Record<number, RosterEntry>;
  balance: number;
  hunger: number;
  group: GroupState | null;
  chat: ChatMsg[];
  unread: number;
  chatOpen: boolean;
  toasts: Toast[];
  ride: { until: number; seconds: number; mode: string; arena: string } | null;
  aerial: boolean;
  homeArea: string | null;
  dice: { rolls: number[]; seeker: string; at: number } | null;
  over: { gameId: string; results: Standing[] } | null;
  emotes: { n: number; text: string; until: number }[];
  quality: Quality;
  muted: string[];
  panel: null | "wallet" | "settings" | "group" | "leaders" | "changelog";
  set: (p: Partial<GameStore>) => void;
  toast: (msg: string, kind?: Toast["kind"]) => void;
  addChat: (m: ChatMsg) => void;
}

let toastId = 0;

export const useGame = create<GameStore>((set, get) => ({
  content: null,
  me: null,
  home: null,
  connected: false,
  mapId: null,
  roster: {},
  balance: 0,
  hunger: 0,
  group: null,
  chat: [],
  unread: 0,
  chatOpen: false,
  toasts: [],
  ride: null,
  aerial: false,
  homeArea: null,
  dice: null,
  over: null,
  emotes: [],
  quality: "medium",
  muted: [],
  panel: null,
  set: (p) => set(p),
  toast: (msg, kind = "info") => {
    const id = ++toastId;
    set({ toasts: [...get().toasts.slice(-3), { id, msg, kind }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 3500);
  },
  addChat: (m) => {
    if (get().muted.includes(m.from)) return;
    set({ chat: [...get().chat.slice(-99), m], unread: get().chatOpen ? 0 : get().unread + 1 });
  },
}));
