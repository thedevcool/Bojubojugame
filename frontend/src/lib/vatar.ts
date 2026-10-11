/**
 * LagosLife mini version: the Vatar Games SDK v1 (https://lagoslife.app/developers/docs).
 * One script from LagosLife gives us the player, purchases (their pay sheet), the leaderboard and
 * matches. Our server checks everything with LagosLife's API before it counts.
 */
import { loadAccount, vatarClaim } from "./api";
import { useGame } from "./store";

export const SDK_URL = "https://lagoslife.app/sdk/vatar-games-v1.js";

export interface VMatch {
  id: string; code: string; status: "open" | "playing" | "done" | "cancelled" | "void"; stake: number; seats: number;
  players: { id: string; name: string }[]; me: string; winner: string | null; mode: string;
}
interface VError extends Error { code?: string }
export interface VatarSdk {
  init(): Promise<{ player: { id: string; name: string; avatar: string | null }; session: string; mode: "live" | "test" }>;
  session(): Promise<{ session: string; exp: number }>;
  purchase(productId: string): Promise<{ purchaseId: string; productId: string }>;
  onPurchase(fn: (p: { purchaseId: string; productId: string }) => void): () => void;
  purchases(): Promise<{ purchaseId: string; productId: string }[]>;
  submitScore(n: number): Promise<{ best: number; accepted: boolean }>;
  leaderboard(): Promise<{ top: { rank: number; name: string; score: number }[]; me: { rank: number | null; label: string; score: number } | null }>;
  onPause(fn: () => void): () => void;
  onResume(fn: () => void): () => void;
  match: {
    create(o: { stake: number; seats: number }): Promise<VMatch>;
    join(code: string): Promise<VMatch>;
    quick(o: { stake: number }): Promise<VMatch>;
    current(): Promise<VMatch | null>;
    leave(): Promise<unknown>;
    onUpdate(fn: (m: VMatch) => void): () => void;
  };
}

declare global { interface Window { Vatar?: VatarSdk } }

export const vatar = (): VatarSdk | null => (typeof window !== "undefined" ? window.Vatar ?? null : null);

export function loadSdk(): Promise<VatarSdk> {
  return new Promise((ok, bad) => {
    if (window.Vatar) return ok(window.Vatar);
    const s = document.createElement("script");
    s.src = SDK_URL;
    s.async = true;
    s.onload = () => (window.Vatar ? ok(window.Vatar) : bad(new Error("LagosLife didn't load")));
    s.onerror = () => bad(new Error("LagosLife didn't load"));
    document.head.appendChild(s);
  });
}

/** A fresh, signed LagosLife session for our server (they last 15 minutes). */
export async function freshSession(): Promise<string> {
  const v = vatar();
  if (!v) throw new Error("Open Boju Boju from LagosLife");
  return (await v.session()).session;
}

/** Friendly words for the SDK's error codes. */
export function vatarMessage(e: unknown): string {
  const code = (e as VError)?.code;
  const map: Record<string, string> = {
    cancelled: "Payment cancelled",
    payment_failed: "The payment didn't go through",
    busy: "A pay sheet is already open",
    not_for_sale: "That isn't on sale in LagosLife yet",
    not_available: "LagosLife matches aren't switched on for Boju Boju yet — play a normal game for now",
    friendly_only: "Stakes aren't switched on yet — play a friendly (₦0) match",
    limit: "That's over LagosLife's limit for today",
    not_found: "No open match with that code",
    not_open: "That match is full or already started",
    rate_limited: "Easy — try again in a few seconds",
    signed_out: "Sign in to LagosLife first",
    not_framed: "Open Boju Boju from the Games app in LagosLife",
  };
  return (code && map[code]) || (e as Error)?.message || "Something went wrong — try again";
}

/** Verify a paid ad purchase on our server, which checks it with LagosLife before the poster goes live. */
export async function claimAdPurchase(p: { purchaseId: string; productId: string }, adId?: string): Promise<boolean> {
  const acc = loadAccount();
  if (!acc || !p.productId.startsWith("ad_")) return false;
  try {
    await vatarClaim(acc, await freshSession(), p.purchaseId, adId);
    const st = useGame.getState();
    st.set({ adsVersion: st.adsVersion + 1 });
    st.toast("📢 Paid! Your ad is now live on the wall", "good");
    return true;
  } catch {
    return false;
  }
}
