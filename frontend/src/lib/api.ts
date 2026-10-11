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

export async function createGuest(nickname: string, homeArea: string, avatar: number[]): Promise<Account> {
  const r = await json<{ token: string; player_id: string; device_secret: string }>(
    await fetch(`${API_URL}/api/auth/guest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname, home_area: homeArea, avatar }),
    }),
  );
  const acc = { playerId: r.player_id, deviceSecret: r.device_secret, token: r.token, nickname };
  saveAccount(acc);
  return acc;
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

export interface Me { id: string; nickname: string; home_area: string; avatar: number[]; balance: number; hunger: number; daily_bonus: number; topup?: number; boju_id: string | null; has_pin: boolean }

/** Log in on a new phone with Boju ID (e.g. Tolu#4821) + 6-digit PIN. */
export async function login(bojuId: string, pin: string): Promise<Account> {
  const r = await json<{ token: string; player_id: string; device_secret: string; nickname: string }>(
    await fetch(`${API_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ boju_id: bojuId.trim(), pin }),
    }),
  );
  const acc = { playerId: r.player_id, deviceSecret: r.device_secret, token: r.token, nickname: r.nickname };
  saveAccount(acc);
  return acc;
}

export async function setPin(acc: Account, pin: string, currentPin?: string) {
  return json<{ ok: boolean; boju_id: string }>(
    await fetch(`${API_URL}/api/auth/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${acc.token}` },
      body: JSON.stringify({ pin, ...(currentPin ? { current_pin: currentPin } : {}) }),
    }),
  );
}

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
