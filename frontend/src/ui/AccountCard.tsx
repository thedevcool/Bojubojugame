"use client";

import { useEffect, useState } from "react";
import { getMe, loadAccount, logout, setEmail } from "@/lib/api";
import { useGame } from "@/lib/store";
import { NewPasswordForm, PasswordInput } from "./AuthForms";

/** Settings → Your account: username, optional reset email, change password, log out. */
export default function AccountCard() {
  const toast = useGame((s) => s.toast);
  const [username, setUsername] = useState<string | null>(null);
  const [email, setEmailValue] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "password" | "email">("view");
  const [newEmail, setNewEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const acc = loadAccount();

  useEffect(() => {
    const a = loadAccount();
    if (a) getMe(a).then((m) => { setUsername(m.username); setEmailValue(m.email); setNewEmail(m.email ?? ""); }).catch(() => undefined);
  }, []);

  const saveEmail = async () => {
    if (!acc) return;
    setBusy(true);
    try {
      const r = await setEmail(acc, newEmail.trim() || null, pw);
      setEmailValue(r.email);
      setMode("view");
      setPw("");
      toast(r.email ? "Email saved — you can now reset your password" : "Email removed", "good");
    } catch (e) {
      toast((e as Error).message, "error");
    }
    setBusy(false);
  };
  const signOut = () => {
    if (!window.confirm("Log out of this phone? Log back in any time with your username and password.")) return;
    logout();
    window.location.href = "/";
  };

  return (
    <div className="mb-4 rounded-2xl bg-white/5 p-3">
      <div className="mb-2 text-sm font-bold">👤 Your account</div>
      <div className="rounded-xl bg-black/20 px-3 py-2">
        <span className="block text-[10px] uppercase tracking-wide opacity-60">Username</span>
        <span className="block truncate text-base font-bold">{username ?? "…"}</span>
        <span className="mt-1 block text-[10px] uppercase tracking-wide opacity-60">Reset email</span>
        <span className="block truncate text-sm">{email ?? <span className="opacity-60">not set</span>}</span>
      </div>
      {!email && mode === "view" && (
        <p className="mt-2 text-xs text-[var(--danfo)]">Tip: add an email so you can reset your password if you forget it. It&apos;s never shown to other players.</p>
      )}
      {mode === "password" && acc && (
        <div className="anim-rise mt-3">
          <NewPasswordForm acc={acc} username={username ?? ""} onDone={() => { setMode("view"); toast("Password changed", "good"); }} />
          <button className="btn btn-ghost mt-2 w-full" onClick={() => setMode("view")}>Cancel</button>
        </div>
      )}
      {mode === "email" && (
        <div className="anim-rise mt-3 space-y-2">
          <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} type="email" inputMode="email" placeholder="you@example.com (leave empty to remove)"
            className="w-full rounded-lg bg-white/10 px-3 py-2 outline-none" />
          <label className="block text-xs font-bold">Confirm with your password<PasswordInput value={pw} onChange={setPw} /></label>
          <div className="flex gap-2">
            <button className="btn btn-ghost" onClick={() => setMode("view")}>Cancel</button>
            <button className="btn btn-primary flex-1" disabled={busy || !pw} onClick={saveEmail}>{busy ? "Saving…" : "Save email"}</button>
          </div>
        </div>
      )}
      {mode === "view" && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <button className="btn btn-primary px-2 text-xs" onClick={() => setMode("password")}>🔑 Password</button>
          <button className="btn btn-ghost px-2 text-xs" onClick={() => setMode("email")}>✉️ {email ? "Email" : "Add email"}</button>
          <button className="btn btn-ghost px-2 text-xs" onClick={signOut}>Log out</button>
        </div>
      )}
    </div>
  );
}
