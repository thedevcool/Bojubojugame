"use client";

import { useState } from "react";
import { login, type Account } from "@/lib/api";

/** Existing players: Boju ID (nickname#1234) + 6-digit PIN. No email or phone needed. */
export default function LoginForm({ onDone }: { onDone: (acc: Account) => void }) {
  const [id, setId] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = /^.{2,}#\d{4}$/.test(id.trim()) && /^\d{6}$/.test(pin);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      onDone(await login(id, pin));
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="anim-step space-y-4">
      <label className="block text-sm font-bold">Your Boju ID
        <input value={id} onChange={(e) => setId(e.target.value)} placeholder="e.g. Tolu#4821" autoCapitalize="off" autoCorrect="off"
          className="mt-1 w-full rounded-lg bg-white/10 px-3 py-2 font-normal outline-none" />
        <span className="mt-1 block text-[11px] font-normal opacity-70">Find it on your old phone: ⚙️ Settings → Your account.</span>
      </label>
      <label className="block text-sm font-bold">6-digit PIN
        <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" type="password"
          autoComplete="current-password" placeholder="••••••" className="mt-1 w-full rounded-lg bg-white/10 px-3 py-2 text-lg tracking-[0.5em] outline-none" />
      </label>
      {err && <div className="anim-pop rounded-lg bg-[var(--clay)]/85 px-3 py-2 text-sm">{err}</div>}
      <button disabled={busy || !valid} className="btn btn-primary w-full text-lg">{busy ? "Checking…" : "Log in ▶"}</button>
      <p className="text-xs opacity-70">No PIN yet? Open the game on your old phone and set one in ⚙️ Settings → Your account.</p>
    </form>
  );
}
