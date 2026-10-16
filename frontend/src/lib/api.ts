import type { Content } from "./types";

import { API_URL } from "./env";

export { API_URL };
export const WS_URL = API_URL.replace(/^http/, "ws") + "/ws";

const KEY = "boju.account.v1";

export interface Account { playerId: string; deviceSecret: string; token: string; nickname: string }

function safeGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function safeSet(k: string, v: string): void {
  try { localStorage.setItem(k, v); } catch { /* storage blocked */ }
}

/** LagosLife mini version: the account lives in memory only (third-party storage is often blocked in frames). */
let memAccount: Account | null = null;
export function setMemoryAccount(a: Account): void { memAccount = a; }

export function loadAccount(): Account | null {
  if (memAccount) return memAccount;
  const raw = safeGet(KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as Account; } catch { return null; }
}

let loggedOut = false; // after "Log out", late token refreshes must not bring the account back
export function saveAccount(a: Account): void {
  if (memAccount) { memAccount = a; return; }
  if (loggedOut) return;
  safeSet(KEY, JSON.stringify(a));
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === "string") msg = body.detail;
    } catch { /* not json */ }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export interface Session { token: string; player_id: string; device_secret: string; username: string; must_change_password: boolean }

function keep(r: Session): Account {
  const acc = { playerId: r.player_id, deviceSecret: r.device_secret, token: r.token, nickname: r.username };
  saveAccount(acc);
  return acc;
}

const post = (path: string, body: unknown, token?: string) =>
  fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

/** New account: username + password (+ optional email for password resets). */
export async function register(username: string, password: string, email: string, homeArea: string, avatar: number[]): Promise<Account> {
  return keep(await json<Session>(await post("/api/auth/register", { username, password, email: email.trim() || null, home_area: homeArea, avatar })));
}

/** Log in with username or email. */
export async function login(loginName: string, password: string): Promise<{ acc: Account; mustChange: boolean }> {
  const r = await json<Session>(await post("/api/auth/login", { login: loginName.trim(), password }));
  return { acc: keep(r), mustChange: r.must_change_password };
}

export async function changePassword(acc: Account, current: string, next: string): Promise<Account> {
  const r = await json<{ ok: boolean; token: string }>(await post("/api/auth/password", { current_password: current, new_password: next }, acc.token));
  const updated = { ...acc, token: r.token };
  saveAccount(updated);
  return updated;
}

export async function setEmail(acc: Account, email: string | null, password: string) {
  return json<{ ok: boolean; email: string | null }>(await post("/api/auth/email", { email, password }, acc.token));
}

export async function forgotPassword(loginName: string) {
  return json<{ ok: boolean; message: string }>(await post("/api/auth/forgot", { login: loginName.trim() }));
}

export async function resetPassword(token: string, newPassword: string) {
  return json<{ ok: boolean }>(await post("/api/auth/reset", { token, new_password: newPassword }));
}

export async function refreshToken(acc: Account): Promise<Account> {
  const r = await json<{ token: string }>(
    await fetch(`${API_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player_id: acc.playerId, device_secret: acc.deviceSecret }),
    }),
  );
  const next = { ...acc, token: r.token };
  saveAccount(next);
  return next;
}

export interface Me { id: string; nickname: string; home_area: string; avatar: number[]; balance: number; hunger: number; daily_bonus: number; topup?: number; username: string | null; email: string | null; must_change_password: boolean; phone_id: string | null; home_id: string | null; rent_until: string | null; car_id: string | null; flags?: Record<string, string> }

export function logout(): void {
  loggedOut = true;
  memAccount = null;
  try { localStorage.removeItem(KEY); } catch { /* storage blocked */ }
}

export async function getMe(acc: Account): Promise<Me> {
  return json<Me>(await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${acc.token}` } }));
}

let contentPromise: Promise<Content> | null = null;
export function getContent(): Promise<Content> {
  contentPromise ??= fetch(`${API_URL}/api/content`).then((r) => json<Content>(r));
  return contentPromise;
}

export interface LeaderRow { id: string; nickname: string; home_area: string; score: number }
export async function getLeaderboard(kind: "seeker" | "hider", period: "weekly" | "all", gameId?: string) {
  const q = new URLSearchParams({ kind, period, ...(gameId ? { game_id: gameId } : {}) });
  return json<{ rows: LeaderRow[] }>(await fetch(`${API_URL}/api/leaderboards?${q}`));
}

export interface WalletEntry { amount: number; reason: string; ref: string | null; at: string }
export async function getWallet(acc: Account) {
  return json<{ balance: number; disclaimer: string; entries: WalletEntry[] }>(
    await fetch(`${API_URL}/api/wallet`, { headers: { Authorization: `Bearer ${acc.token}` } }),
  );
}

export async function reportPlayer(acc: Account, targetId: string, reason: string, context?: string) {
  return json<{ ok: boolean }>(
    await fetch(`${API_URL}/api/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${acc.token}` },
      body: JSON.stringify({ target_id: targetId, reason, context }),
    }),
  );
}

const authed = (acc: Account) => ({ Authorization: `Bearer ${acc.token}` });
const get = async <T,>(acc: Account, path: string) => json<T>(await fetch(`${API_URL}${path}`, { headers: authed(acc) }));
const send = async <T,>(acc: Account, path: string, body: unknown) => json<T>(await post(path, body, acc.token));

export const saveAvatar = (acc: Account, avatar: number[]) => send<{ ok: boolean; avatar: number[] }>(acc, "/api/me/avatar", { avatar });

/** A browser-storage key for this account only (several people can sign up on one phone). */
export function accountKey(base: string): string {
  const id = loadAccount()?.playerId;
  return id ? `${base}.${id}` : base;
}

/** Per-account UI progress (tour step, first-game guide). Fire and forget. */
export const serverFlags: Record<string, string> = {};
export function setFlag(key: "tour" | "guide", value: string): void {
  serverFlags[key] = value;
  const acc = loadAccount();
  if (acc) send<{ ok: boolean }>(acc, "/api/me/flag", { key, value }).catch(() => {});
}

// ---------------------------------------------------------------- life: phone, house, friends, DMs
export const buyPhone = (acc: Account, phoneId: string) =>
  send<{ ok: boolean; phone_id: string }>(acc, "/api/shop/phone", { phone_id: phoneId, key: crypto.randomUUID() });

export interface HouseInfo { id: string; name: string; rent: number; duplex: boolean; door: [number, number]; owner: string | null; owner_id: string | null; taken: boolean; owner_online: boolean }
export const getHomes = (acc: Account) => get<{ days: number; mine: string | null; rent_until: string | null; free: number; homes: HouseInfo[] }>(acc, "/api/homes");
export const rentHome = (acc: Account, homeId: string) =>
  send<{ ok: boolean; rent_until: string }>(acc, "/api/home/rent", { home_id: homeId, key: crypto.randomUUID() });

export interface OwnedItem { id: number; item: string; lx: number; lz: number; rot: number; placed: boolean }
export const getFurniture = (acc: Account) => get<{ items: OwnedItem[] }>(acc, "/api/furniture");
export const buyFurniture = (acc: Account, item: string) =>
  send<{ ok: boolean; item: OwnedItem }>(acc, "/api/shop/furniture", { item, key: crypto.randomUUID() });
export const saveLayout = (acc: Account, items: OwnedItem[]) =>
  send<{ ok: boolean }>(acc, "/api/home/layout", { items: items.map(({ id, placed, lx, lz, rot }) => ({ id, placed, lx, lz, rot })) });

export const buyCar = (acc: Account, carId: string) =>
  send<{ ok: boolean; car_id: string }>(acc, "/api/shop/car", { car_id: carId, key: crypto.randomUUID() });

export interface LiveGame { code: string; creator: string; arena: string; arena_name: string; phase: string; humans: number; bots: number; max: number; public: boolean; joinable: boolean; round: number }
export const getLiveGames = (acc: Account) => get<{ games: LiveGame[] }>(acc, "/api/games/live");

export interface Friend { id: string; username: string; online: boolean; unread: number }
export const getFriends = (acc: Account) => get<{ friends: Friend[]; incoming: Friend[]; outgoing: Friend[] }>(acc, "/api/friends");
export const requestFriend = (acc: Account, username: string) => send<{ ok: boolean; status: string }>(acc, "/api/friends/request", { username });
export const respondFriend = (acc: Account, playerId: string, accept: boolean) => send<{ ok: boolean }>(acc, "/api/friends/respond", { player_id: playerId, accept });
export const removeFriend = (acc: Account, playerId: string) => send<{ ok: boolean }>(acc, "/api/friends/remove", { player_id: playerId });

export interface PlayerCard {
  id: string; username: string; home_area: string; avatar: number[]; points: number; finds: number; escapes: number;
  rounds: number; games: number; online: boolean; relation: "self" | "none" | "requested" | "incoming" | "friends";
}
export const getCard = (acc: Account, id: string) => get<PlayerCard>(acc, `/api/players/${encodeURIComponent(id)}/card`);

export interface Dm { id: number; mine: boolean; text: string; ts: number }
export const getDms = (acc: Account, other: string) => get<{ messages: Dm[] }>(acc, `/api/dm/${encodeURIComponent(other)}`);
export const sendDm = (acc: Account, other: string, text: string) => send<Dm>(acc, `/api/dm/${encodeURIComponent(other)}`, { text });

export const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;

/** Short form for tight spaces: ₦100M, ₦2.5M, ₦850K, ₦4,500. */
export const nairaShort = (n: number) => {
  const a = Math.abs(n), sign = n < 0 ? "-" : "";
  const fmt = (v: number, u: string) => `${sign}₦${(Math.round(v * 10) / 10).toLocaleString("en-NG")}${u}`;
  if (a >= 1e9) return fmt(a / 1e9, "B");
  if (a >= 1e6) return fmt(a / 1e6, "M");
  if (a >= 1e5) return fmt(a / 1e3, "K");
  return naira(n);
};

// ---------------------------------------------------------------- wall ads (REAL naira via Paystack — separate from game money)
export interface AdSize { id: string; name: string; w: number; h: number; price: number }
export interface AdsConfig { days: number; currency_note: string; sizes: AdSize[]; enabled: boolean }
export interface AdRect { x: number; y: number; z: number; nx: number; nz: number; w: number; h: number }
export interface LiveAd extends AdRect { id: string; title: string; image: string }
export interface MyAd { id: string; title: string; status: string; price: number; map_id: string; size: string; live_until: string | null; provider?: string; product?: string }
let adsConfigPromise: Promise<AdsConfig> | null = null;
export const getAdsConfig = () => (adsConfigPromise ??= fetch(`${API_URL}/api/ads/config`).then((r) => json<AdsConfig>(r)).catch((e) => { adsConfigPromise = null; throw e; }));
export const getAdsOnMap = async (mapId: string) => json<{ live: LiveAd[]; taken: AdRect[] }>(await fetch(`${API_URL}/api/ads/map/${encodeURIComponent(mapId)}`));
export const createAd = (acc: Account, body: Omit<AdRect, "w" | "h"> & { map_id: string; size: string; title: string; email: string; image: string }) =>
  send<{ id: string; price: number; reference?: string; pay_url?: string; status?: string; product?: string }>(acc, "/api/ads", body);
export const verifyAd = (acc: Account, reference: string) =>
  get<{ status: string; title: string; price: number; map_id: string }>(acc, `/api/ads/verify?reference=${encodeURIComponent(reference)}`);
export const getMyAds = (acc: Account) => get<{ ads: MyAd[] }>(acc, "/api/ads/mine");

export interface AdminAd extends MyAd { by: string; email: string; paid?: boolean }
const admin = (token: string) => ({ "X-Admin-Token": token });
export const adminListAds = async (token: string) => json<{ ads: AdminAd[] }>(await fetch(`${API_URL}/api/admin/ads`, { headers: admin(token) }));
export interface AdminAnalytics {
  generated_at: string;
  period_days: number;
  totals: {
    players: number; active_players: number; new_players: number; visits: number; active_visits: number;
    plays: number; completed_plays: number; current_plays: number; players_in_current_plays: number;
  };
  activity: { date: string; visits: number; new_players: number; plays: number }[];
  leaderboards: {
    seekers: { id: string; nickname: string; score: number }[];
    hiders: { id: string; nickname: string; score: number }[];
    playtime: { id: string; nickname: string; home_area: string; seconds: number; visits: number }[];
  };
  arenas: { id: string; name: string; plays: number }[];
  ad_revenue: {
    currency: string; confirmed_transactions: number; gross_collected: number; refunded: number;
    net_after_refunds: number; note: string;
  };
}
export const adminAnalytics = async (token: string, days: number) =>
  json<AdminAnalytics>(await fetch(`${API_URL}/api/admin/analytics?days=${days}`, { headers: admin(token) }));
export interface AdminPlayerRow {
  id: string; nickname: string; username: string | null; home_area: string; created_at: string; online: boolean;
  visits: number; time_spent_seconds: number; games_played: number;
}
export interface AdminPlayerDetail {
  profile: {
    id: string; nickname: string; username: string | null; email: string | null; home_area: string;
    avatar: number[]; created_at: string; online: boolean; login_method: string; must_change_password: boolean;
    locked_until: string | null; phone_id: string | null; car_id: string | null; home_id: string | null;
    rent_until: string | null; hunger: number;
  };
  activity: {
    visits: number; time_spent_seconds: number; last_visit_at: string | null; registered_devices: number;
    friends: number; furniture_items: number; reports_received: number;
  };
  gameplay: {
    games_played: number; rounds_played: number; seeker_rounds: number; finds: number; hider_rounds: number;
    survived_hider_rounds: number; in_game_naira_earned: number;
  };
  ad_payments: {
    paystack_confirmed_total: number; paystack_refunded_total: number;
    transactions: { id: string; title: string; status: string; amount: number; provider: string;
      paystack_verified: boolean; paid_at: string | null; created_at: string }[];
  };
}
export const adminPlayers = async (token: string, q: string, limit: number, offset: number) => {
  const params = new URLSearchParams({ q, limit: String(limit), offset: String(offset) });
  return json<{ total: number; limit: number; offset: number; players: AdminPlayerRow[] }>(
    await fetch(`${API_URL}/api/admin/players?${params}`, { headers: admin(token) }),
  );
};
export const adminPlayerDetail = async (token: string, id: string) =>
  json<AdminPlayerDetail>(await fetch(`${API_URL}/api/admin/players/${encodeURIComponent(id)}`, { headers: admin(token) }));
export const adminAct = async (token: string, id: string, action: "approve" | "reject" | "remove") =>
  json<{ ok: boolean; status: string }>(await fetch(`${API_URL}/api/admin/ads/${id}/${action}`, { method: "POST", headers: admin(token) }));
export const adminAdImage = async (token: string, id: string) => {
  const r = await fetch(`${API_URL}/api/ads/${id}/image`, { headers: admin(token) });
  if (!r.ok) throw new Error("image");
  return URL.createObjectURL(await r.blob());
};

// ---------------------------------------------------------------- LagosLife mini version (Vatar Games SDK)
export async function vatarSignIn(session: string): Promise<Account & { mode: "live" | "test" }> {
  const r = await json<{ token: string; player_id: string; device_secret: string; username: string; nickname: string; mode: "live" | "test" }>(
    await post("/api/vatar/session", { session }),
  );
  return { playerId: r.player_id, deviceSecret: r.device_secret, token: r.token, nickname: r.nickname, mode: r.mode };
}
export const getVatarConfig = async () => json<{ enabled: boolean; products: Record<string, string> }>(await fetch(`${API_URL}/api/vatar/config`));
export const vatarClaim = (acc: Account, session: string, purchaseId: string, adId?: string) =>
  send<{ ok: boolean; ad: string; status: string }>(acc, "/api/vatar/ads/claim", { session, purchase_id: purchaseId, ad_id: adId ?? null });
export const vatarMatchLink = (acc: Account, session: string, matchId: string, groupCode?: string) =>
  send<{ group_code: string | null; create: boolean }>(acc, "/api/vatar/match", { session, match_id: matchId, group_code: groupCode ?? null });
