import { create } from "zustand";
import { input, local } from "@/game/state";
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
  ride: { until: number; seconds: number; mode: string; arena: string; dir: "go" | "home" } | null;
  aerial: boolean;
  controlMode: "joystick" | "tap";
  bend: boolean;
  phoneOpen: boolean;
  phoneApp: string | null;
  life: { phoneId: string | null; homeId: string | null; rentUntil: string | null; username: string; carId: string | null };
  /** map pin: a spot in this area, or a place in Naija to travel to */
  pin: { kind: "here"; map: string; x: number; z: number; label: string } | { kind: "trip"; to: string; label: string } | null;
  mapOpen: boolean;
  /** spectating a game from the map (Live games -> Watch) */
  watching: string | null;
  wsnap: { code: string; arena: string; phase: string; phase_end: number; found: number; hiding: number; players: [string, string, number, number, string, boolean][] } | null;
  driving: boolean;
  dmUnread: number;
  friendReqs: number;
  /** last live direct message (Messages app listens to this) */
  dmLive: { from: string; username: string; text: string; id: number; ts: number } | null;
  friendsVersion: number;
  /** onboarding step for brand-new players (null = done) */
  onboard: null | "welcome" | "controls" | "phone" | "launch" | "rent" | "home";
  /** player chose "Stay & explore" after the final whistle */
  stayed: boolean;
  sitting: boolean;
  sleeping: boolean;
  /** arrived at a bed you tapped: ask "sleep or sit?" */
  seatAsk: boolean;
  /** player card open for this player id (tap a person in the world) */
  card: string | null;
  /** live invite to someone's lobby */
  invite: { from: string; nick: string; code: string; at: number } | null;
  /** invite this player as soon as our new lobby exists */
  pendingInvite: string | null;
  /** house id -> tenant id; houses whose owner let me in; someone knocking at my door */
  doorOwners: Record<string, string>;
  openDoors: string[];
  knock: { from: string; nick: string; home: string; at: number } | null;
  /** decorate mode: a draft of your house's furniture (local coords) */
  decor: { home: string; items: { id: number; item: string; lx: number; lz: number; rot: number; placed: boolean }[]; sel: number | null } | null;
  /** onboarding guide target in the world (arrow + "walk me there") */
  guide: { x: number; z: number; label: string } | null;
  homeArea: string | null;
  dice: { rolls: number[]; seeker: string; at: number } | null;
  over: { gameId: string; results: Standing[] } | null;
  emotes: { n: number; text: string; until: number }[];
  quality: Quality;
  muted: string[];
  set: (p: Partial<GameStore>) => void;
  openApp: (app: string | null) => void;
  closePhone: () => void;
  setBend: (on: boolean) => void;
  toast: (msg: string, kind?: Toast["kind"]) => void;
  addChat: (m: ChatMsg) => void;
}

let toastId = 0;

/** The movement style the player picked on first launch (null = not chosen yet). */
export function savedControls(): "joystick" | "tap" | null {
  try {
    const v = localStorage.getItem("boju.controls");
    return v === "tap" || v === "joystick" ? v : null;
  } catch { return null; }
}

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
  controlMode: savedControls() ?? "joystick",
  bend: false,
  phoneOpen: false,
  phoneApp: null,
  life: { phoneId: null, homeId: null, rentUntil: null, username: "", carId: null },
  pin: null,
  mapOpen: false,
  watching: null,
  wsnap: null,
  driving: false,
  dmUnread: 0,
  friendReqs: 0,
  dmLive: null,
  friendsVersion: 0,
  onboard: null,
  stayed: false,
  sitting: false,
  sleeping: false,
  seatAsk: false,
  card: null,
  invite: null,
  pendingInvite: null,
  doorOwners: {},
  openDoors: [],
  knock: null,
  decor: null,
  guide: null,
  homeArea: null,
  dice: null,
  over: null,
  emotes: [],
  quality: "medium",
  muted: [],
  set: (p) => set(p),
  openApp: (app) => set({ phoneOpen: true, phoneApp: app }),
  closePhone: () => set({ phoneOpen: false, phoneApp: null }),
  setBend: (on) => {
    input.crouchToggle = on;
    if (on) local.sit = false;
    set({ bend: on, ...(on ? { sitting: false } : {}) });
  },
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
