export type Rect = [number, number, number, number];

export interface Prop {
  kind: string;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  color?: string;
  text?: string;
  label?: string;
  dir?: "x" | "z";
  face?: "n" | "s" | "e" | "w";
  ad?: string;
  line?: string;
  style?: string;
  y?: number;
  collider: [number, number, number, number, number] | null;
}

export interface Zone { id: string; kind: string; name: string; rect: Rect }
export interface Area { id: string; name: string; rect: Rect }

export interface GameMap {
  id: string;
  name: string;
  kind: "hub" | "arena";
  bounds: Rect;
  ground: string;
  spawn: [number, number];
  found_area?: [number, number];
  props: Prop[];
  sections: Area[];
  safe_houses: Area[];
  zones: Zone[];
  homes?: Home[];
  arrival?: [number, number];
  npc_paths?: { pts: [number, number][]; n: number }[];
  vendors?: { x: number; z: number; ry: number; say: string }[];
  vehicles?: { kind: string; pts: [number, number][]; speed: number; n: number }[];
  city?: string;
  venue?: { name: string; lat: number; lng: number };
}

export interface Home { id: string; name: string; rect: Rect; spawn: [number, number]; door: [number, number] }

export interface Item { id: string; name: string; category: string; price: number; hunger: number; spot: string | null }
export interface Fare { id: string; name: string; price: number; ride_s: number }

export interface GameConfig {
  currency_symbol: string;
  money_disclaimer: string;
  scoring: Record<string, number>;
  game: {
    min_players: number;
    max_players: number;
    hide_time_options: number[];
    search_time_options: number[];
    default_hide_time: number;
    default_search_time: number;
    tag_range_m: number;
    safe_house_total_s: number;
    min_hunger_to_play: number;
  };
  movement: {
    walk_speed: number;
    run_speed: number;
    crouch_speed: number;
    stamina_max_s: number;
    stamina_regen_per_s: number;
    player_radius: number;
  };
  economy: { max_hunger: number };
  fares: Fare[];
  items: Item[];
  home_areas: string[];
  emotes: { id: string; text: string }[];
  chat: { max_len: number };
  cities: City[];
  home_coords: Record<string, [number, number]>;
}

export interface City { id: string; name: string; lat: number; lng: number; blurb: string; arenas: string[]; fares: Fare[] | null }

export interface Content { config: GameConfig; maps: Record<string, GameMap> }

export interface Member {
  id: string;
  nick: string;
  online: boolean;
  boarded: boolean;
  retired: boolean;
  left: boolean;
  pick: number | null;
  bot?: boolean;
}

export interface RoundInfo {
  no: number;
  seeker: string;
  final: boolean;
  state: Record<string, "hiding" | "found" | "idle">;
  found: string[];
  safe: string[];
  safe_used: Record<string, number>;
}

export interface RoundResult {
  round: number;
  seeker: string;
  skipped: boolean;
  found: string[];
  safe: string[];
  idle: string[];
  deltas: Record<string, number>;
  retired: string[];
  next_seeker: string | null;
  game_over: boolean;
}

export interface Standing { id: string; nick: string; earned: number; finds: number; survived: number }

export type Phase = "lobby" | "travel" | "dice" | "reveal" | "hide" | "seek" | "result" | "over";

export interface GroupState {
  id: string;
  code: string;
  creator: string;
  settings: { arena: string; hide: number; search: number; safe: string };
  phase: Phase;
  phase_end: number;
  members: Member[];
  dice_pool: string[];
  round: RoundInfo | null;
  pending_seeker: string | null;
  last_result: RoundResult | null;
  final: Standing[] | null;
  event: string;
}

export interface ChatMsg { ch: "group" | "near"; from: string; nick: string; text: string; ts: number }
export interface RosterEntry { n: number; id: string; nick: string; av: number[]; bot?: boolean }
