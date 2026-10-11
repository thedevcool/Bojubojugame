"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { resetPassword } from "@/lib/api";
import { PasswordInput, passwordProblem } from "@/ui/AuthForms";

function Reset() {
  const [token, setToken] = useState("");
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") ?? "");
    window.history.replaceState(null, "", "/reset"); // keep the token out of history/screenshots
  }, []);
  const problem = pw ? passwordProblem(pw) : null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await resetPassword(token, pw);
      setDone(true);
    } catch (e2) {
      setErr((e2 as Error).message);
    }
    setBusy(false);
  };
  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center px-4 py-8">
      <div className="panel anim-pop p-5">
        <div className="mb-2 text-center text-5xl">🙈</div>
        <h1 className="text-center text-2xl font-black">Reset your password</h1>
        {done ? (
          <div className="mt-4 space-y-3 text-center">
            <p>Password changed ✓ For safety, every phone was logged out.</p>
            <Link href="/" className="btn btn-primary block">Log in ▶</Link>
          </div>
        ) : !token ? (
          <p className="mt-4 text-center text-sm">This link is missing its code. Request a new one from the login screen.</p>
        ) : (
          <form onSubmit={submit} className="mt-4 space-y-3">
            <label className="block text-sm font-bold">New password
              <PasswordInput value={pw} onChange={setPw} autoComplete="new-password" placeholder="At least 8 characters" />
              {problem && <span className="mt-1 block text-xs font-normal text-[var(--clay)]">{problem}</span>}
            </label>
            <label className="block text-sm font-bold">Type it again
              <PasswordInput value={again} onChange={setAgain} autoComplete="new-password" />
            </label>
            {err && <div className="rounded-lg bg-[var(--clay)]/85 px-3 py-2 text-sm">{err}</div>}
            <button disabled={busy || !!problem || !pw || pw !== again} className="btn btn-primary w-full">{busy ? "Saving…" : "Save new password"}</button>
          </form>
        )}
      </div>
    </main>
  );
}

export default function Page() {
  return <Suspense><Reset /></Suspense>;
}
