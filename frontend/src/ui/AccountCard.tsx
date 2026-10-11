"use client";

import { useEffect, useState } from "react";
import { getMe, loadAccount, logout, setPin } from "@/lib/api";
import { useGame } from "@/lib/store";

/** Settings → Your account: Boju ID, PIN for logging in on other phones, log out. */
export default function AccountCard() {
  const toast = useGame((s) => s.toast);
  const [bid, setBid] = useState<string | null>(null);
  const [hasPin, setHasPin] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pin, setPinValue] = useState("");
  const [current, setCurrent] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const acc = loadAccount();
    if (acc) getMe(acc).then((m) => { setBid(m.boju_id); setHasPin(m.has_pin); }).catch(() => undefined);
  }, []);

  const copy = async () => {
    if (!bid) return;
    try { await navigator.clipboard.writeText(bid); toast("Boju ID copied", "good"); } catch { /* clipboard blocked */ }
  };
  const save = async () => {
    const acc = loadAccount();
    if (!acc) return;
    setBusy(true);
    try {
      const r = await setPin(acc, pin, hasPin ? current : undefined);
      setBid(r.boju_id);
      setHasPin(true);
      setEditing(false);
      setPinValue("");
      setCurrent("");
      toast("PIN saved — you can now log in on any phone", "good");
    } catch (e) {
      toast((e as Error).message, "error");
    }
    setBusy(false);
  };
  const signOut = () => {
    const warn = hasPin
      ? "Log out of this phone? You can log back in with your Boju ID and PIN."
      : "You haven't set a PIN — if you log out you can't get this account back. Log out anyway?";
    if (!window.confirm(warn)) return;
    logout();
    window.location.href = "/";
  };
  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 6);
  const input = "w-full rounded-lg bg-white/10 px-3 py-2 text-center text-lg tracking-[0.4em] outline-none";

  return (
    <div className="mb-4 rounded-2xl bg-white/5 p-3">
      <div className="mb-2 text-sm font-bold">👤 Your account</div>
      <div className="flex items-center justify-between gap-2 rounded-xl bg-black/20 px-3 py-2">
        <span className="min-w-0">
          <span className="block text-[10px] uppercase tracking-wide opacity-60">Boju ID</span>
          <span className="block truncate font-mono text-base font-bold">{bid ?? "…"}</span>
        </span>
        <button className="btn btn-ghost px-3 py-1 text-xs" onClick={copy} disabled={!bid}>Copy</button>
      </div>
      {!hasPin && !editing && (
        <p className="mt-2 text-xs text-[var(--danfo)]">⚠️ Set a PIN so you can log in on another phone — otherwise this account lives only here.</p>
      )}
      {editing ? (
        <div className="anim-rise mt-3 space-y-2">
          {hasPin && <input className={input} type="password" inputMode="numeric" placeholder="current PIN" value={current} onChange={(e) => setCurrent(digits(e.target.value))} />}
          <input className={input} type="password" inputMode="numeric" placeholder="new 6-digit PIN" value={pin} onChange={(e) => setPinValue(digits(e.target.value))} />
          <div className="flex gap-2">
            <button className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn btn-primary flex-1" disabled={busy || pin.length !== 6 || (hasPin && current.length !== 6)} onClick={save}>{busy ? "Saving…" : "Save PIN"}</button>
          </div>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button className="btn btn-primary text-sm" onClick={() => setEditing(true)}>{hasPin ? "Change PIN" : "🔐 Set PIN"}</button>
          <button className="btn btn-ghost text-sm" onClick={signOut}>Log out</button>
        </div>
      )}
    </div>
  );
}
