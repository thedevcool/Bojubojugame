"use client";

import { useState } from "react";
import { changePassword, forgotPassword, login, type Account } from "@/lib/api";

const field = "mt-1 w-full rounded-lg bg-white/10 px-3 py-2 font-normal outline-none";

export function PasswordInput({ value, onChange, placeholder, autoComplete = "current-password" }: { value: string; onChange: (v: string) => void; placeholder?: string; autoComplete?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative mt-1">
      <input type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        autoComplete={autoComplete} maxLength={128} className={`${field} mt-0 pr-12`} />
      <button type="button" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow(!show)}
        className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-sm opacity-75">{show ? "🙈" : "👁️"}</button>
    </div>
  );
}

/** Same rules as the server; shown live so people know before they submit. */
export function passwordProblem(pw: string, username = ""): string | null {
  if (pw.length < 8) return "At least 8 characters";
  if (new Set(pw).size < 3) return "Too easy to guess";
  if (username && pw.toLowerCase().includes(username.toLowerCase())) return "Don't put your username inside it";
  return null;
}

function ErrorBox({ msg }: { msg: string }) {
  return msg ? <div className="anim-pop rounded-lg bg-[var(--clay)]/85 px-3 py-2 text-sm">{msg}</div> : null;
}

/** Existing players: username (or email) + password, with "forgot password". */
export function LoginForm({ onDone }: { onDone: (acc: Account, mustChange: boolean) => void }) {
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      if (mode === "login") {
        const r = await login(name, pw);
        onDone(r.acc, r.mustChange);
        return;
      }
      setNote((await forgotPassword(name)).message);
    } catch (e2) {
      setErr((e2 as Error).message);
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="anim-step space-y-4">
      <label className="block text-sm font-bold">Username or email
        <input value={name} onChange={(e) => setName(e.target.value)} autoCapitalize="off" autoCorrect="off" autoComplete="username"
          placeholder="e.g. tolu_fast" className={field} />
      </label>
      {mode === "login" ? (
        <label className="block text-sm font-bold">Password
          <PasswordInput value={pw} onChange={setPw} placeholder="Your password" />
        </label>
      ) : (
        <p className="text-sm opacity-80">We&apos;ll email a reset link to the address saved on your account.</p>
      )}
      <ErrorBox msg={err} />
      {note && <div className="anim-pop rounded-lg bg-[var(--leaf)]/80 px-3 py-2 text-sm">{note}</div>}
      <button disabled={busy || name.trim().length < 3 || (mode === "login" && !pw)} className="btn btn-primary w-full text-lg">
        {busy ? "Please wait…" : mode === "login" ? "Log in ▶" : "Send reset link"}
      </button>
      <button type="button" className="w-full text-center text-xs underline opacity-75" onClick={() => { setMode(mode === "login" ? "forgot" : "login"); setErr(""); setNote(""); }}>
        {mode === "login" ? "Forgot password?" : "← Back to log in"}
      </button>
      {mode === "forgot" && <p className="text-xs opacity-70">No email on your account? Ask the Boju Boju team on X to help you get back in.</p>}
    </form>
  );
}

/** Choose a new password (forced for legacy accounts; also used in Settings). */
export function NewPasswordForm({ acc, username, temporary, onDone }: { acc: Account; username: string; temporary?: string; onDone: (acc: Account) => void }) {
  const [current, setCurrent] = useState(temporary ?? "");
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const problem = pw ? passwordProblem(pw, username) : null;
  const mismatch = again && pw !== again ? "Passwords don't match" : null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      onDone(await changePassword(acc, current, pw));
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      {!temporary && (
        <label className="block text-sm font-bold">Current password
          <PasswordInput value={current} onChange={setCurrent} />
        </label>
      )}
      <label className="block text-sm font-bold">New password
        <PasswordInput value={pw} onChange={setPw} autoComplete="new-password" placeholder="At least 8 characters" />
        {problem && <span className="mt-1 block text-xs font-normal text-[var(--clay)]">{problem}</span>}
      </label>
      <label className="block text-sm font-bold">Type it again
        <PasswordInput value={again} onChange={setAgain} autoComplete="new-password" />
        {mismatch && <span className="mt-1 block text-xs font-normal text-[var(--clay)]">{mismatch}</span>}
      </label>
      <ErrorBox msg={err} />
      <button disabled={busy || !!problem || !pw || pw !== again || !current} className="btn btn-primary w-full">{busy ? "Saving…" : "Save new password"}</button>
    </form>
  );
}
