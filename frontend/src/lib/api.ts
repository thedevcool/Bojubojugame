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

export function loadAccount(): Account | null {
  const raw = safeGet(KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as Account; } catch { return null; }
}

export function saveAccount(a: Account): void { safeSet(KEY, JSON.stringify(a)); }

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

export interface Me { id: string; nickname: string; home_area: string; avatar: number[]; balance: number; hunger: number; daily_bonus: number; topup?: number; username: string | null; email: string | null; must_change_password: boolean; phone_id: string | null; home_id: string | null; rent_until: string | null }

export function logout(): void {
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

// ---------------------------------------------------------------- life: phone, house, friends, DMs
export const buyPhone = (acc: Account, phoneId: string) =>
  send<{ ok: boolean; phone_id: string }>(acc, "/api/shop/phone", { phone_id: phoneId, key: crypto.randomUUID() });

export interface HouseInfo { id: string; name: string; rent: number; tenants: number; duplex: boolean; door: [number, number] }
export const getHomes = (acc: Account) => get<{ days: number; mine: string | null; rent_until: string | null; homes: HouseInfo[] }>(acc, "/api/homes");
export const rentHome = (acc: Account, homeId: string) =>
  send<{ ok: boolean; rent_until: string }>(acc, "/api/home/rent", { home_id: homeId, key: crypto.randomUUID() });

export interface Friend { id: string; username: string; online: boolean; unread: number }
export const getFriends = (acc: Account) => get<{ friends: Friend[]; incoming: Friend[]; outgoing: Friend[] }>(acc, "/api/friends");
export const requestFriend = (acc: Account, username: string) => send<{ ok: boolean; status: string }>(acc, "/api/friends/request", { username });
export const respondFriend = (acc: Account, playerId: string, accept: boolean) => send<{ ok: boolean }>(acc, "/api/friends/respond", { player_id: playerId, accept });
export const removeFriend = (acc: Account, playerId: string) => send<{ ok: boolean }>(acc, "/api/friends/remove", { player_id: playerId });

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
