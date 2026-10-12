"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import AvatarEditor from "@/ui/AvatarEditor";
import { getContent, loadAccount, register, type Account } from "@/lib/api";
import { LoginForm, PasswordInput, passwordProblem } from "@/ui/AuthForms";
import InstallApp from "@/ui/InstallApp";

const AvatarPreview = dynamic(() => import("@/game/Previews").then((m) => m.AvatarPreview), {
  ssr: false,
  loading: () => <div className="mx-auto h-56 w-40 animate-pulse rounded-3xl bg-white/5" />,
});

function Landing() {
  const router = useRouter();
  const [acc, setAcc] = useState<Account | null>(null);
  const [areas, setAreas] = useState<string[]>([]);
  const [nick, setNick] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [email, setEmail] = useState("");
  const [area, setArea] = useState("");
  const [av, setAv] = useState([2, 0, 0, 0, 0]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // "welcome" = this phone already has an account; the tabs are for a new account or another login
  const [mode, setMode] = useState<"welcome" | "new" | "login">("new");
  const join = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("join") : null;
  const playUrl = `/play${join ? `?join=${encodeURIComponent(join)}` : ""}`;

  useEffect(() => {
    const a = loadAccount();
    setAcc(a);
    if (a) setMode("welcome");
    getContent().then((c) => { setAreas(c.config.home_areas); setArea(c.config.home_areas[0]); }).catch(() => setErr("Can't reach the game server. Check your data and try again."));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await register(nick.trim(), pw, email, area, av);
      router.push(playUrl);
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="relative mx-auto flex min-h-full max-w-md flex-col justify-center px-4 py-8">
      <div className="bg-grid" aria-hidden />
      <div className="anim-pop flex items-center gap-3.5">
        <span className="logo-tile grid h-[68px] w-[68px] shrink-0 place-items-center text-4xl leading-none"><span className="logo-peek">🙈</span></span>
        <div>
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.32em] text-[var(--cyan)]">Lagos · Ibadan · Abuja</div>
          <h1 className="text-grad text-[44px] font-bold leading-[1.05] tracking-tight">Boju Boju</h1>
        </div>
      </div>
      <p className="mt-3 text-lg font-medium">Hide &amp; seek, Lagos style.</p>
      <p className="mt-0.5 text-sm text-white/65">Hide well, find your guys, earn naira, chop suya. &ldquo;Mo ti ri e!&rdquo;</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {["🎮 Live 3D multiplayer", "🙈 Hide · 👀 Seek", "🚌 Ride across Naija"].map((c) => <span key={c} className="chip">{c}</span>)}
      </div>

      {!acc && areas.length === 0 && !err && (
        <p className="mt-4 text-sm opacity-80">Waking up the game server… this can take up to a minute the first time.</p>
      )}
      {acc && mode === "welcome" ? (
        <div className="panel anim-rise mt-6 p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-white/55">Welcome back</div>
          <div className="font-display mt-0.5 text-3xl font-bold">{acc.nickname}</div>
          <Link href={playUrl} className="btn btn-primary mt-5 block py-3.5 text-center text-lg">Enter Lagos ▶</Link>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className="btn btn-ghost text-sm" onClick={() => setMode("login")}>Log in as someone else</button>
            <button className="btn btn-ghost text-sm" onClick={() => setMode("new")}>Create new account</button>
          </div>
        </div>
      ) : (
        <div className="panel anim-rise mt-6 p-5">
          <div className="segmented mb-5">
            <button type="button" data-on={mode === "new"} onClick={() => setMode("new")}>New player</button>
            <button type="button" data-on={mode === "login"} onClick={() => setMode("login")}>I have an account</button>
          </div>
          {mode === "login" ? (
            <LoginForm onDone={() => router.push(playUrl)} />
          ) : (
        <form onSubmit={submit} className="anim-step space-y-4">
          <label className="block text-[13px] font-semibold text-white/80">Username
            <input value={nick} onChange={(e) => setNick(e.target.value.replace(/[^A-Za-z0-9_.]/g, ""))} maxLength={16} minLength={3} required placeholder="e.g. tunde_fast"
              autoCapitalize="off" autoCorrect="off" autoComplete="username"
              className="field mt-1" />
          </label>
          <label className="block text-[13px] font-semibold text-white/80">Your Lagos area
            <select value={area} onChange={(e) => setArea(e.target.value)} className="field mt-1">
              {areas.map((a) => <option key={a}>{a}</option>)}
            </select>
          </label>
          <AvatarPreview av={av} className="mx-auto h-56 w-40" />
          <p className="-mt-2 text-center text-xs opacity-70">This na you — change your look below 👇</p>
          <AvatarEditor av={av} onChange={setAv} />
          {err && <div className="anim-pop rounded-xl bg-[var(--clay)]/85 px-3 py-2 text-sm">{err}</div>}
          <label className="block text-[13px] font-semibold text-white/80">Password
            <PasswordInput value={pw} onChange={setPw} autoComplete="new-password" placeholder="At least 8 characters" />
            {pw && passwordProblem(pw, nick) && <span className="mt-1 block text-xs font-normal text-[var(--clay)]">{passwordProblem(pw, nick)}</span>}
          </label>
          <label className="block text-[13px] font-semibold text-white/80">Type password again
            <PasswordInput value={pw2} onChange={setPw2} autoComplete="new-password" />
            {pw2 && pw2 !== pw && <span className="mt-1 block text-xs font-normal text-[var(--clay)]">Passwords don&apos;t match</span>}
          </label>
          <label className="block text-[13px] font-semibold text-white/80">Email <span className="font-normal opacity-60">(optional — only for password reset)</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" inputMode="email" autoComplete="email" placeholder="you@example.com"
              className="field mt-1" />
          </label>
          <button disabled={busy || nick.trim().length < 3 || !area || !!passwordProblem(pw, nick) || pw !== pw2} className="btn btn-primary w-full py-3.5 text-lg">{busy ? "Loading…" : "Start playing ▶"}</button>
          <p className="text-xs opacity-70">We never show your email to other players. We never ask for bank or card details.</p>
        </form>
          )}
        </div>
      )}
      <InstallApp className="mt-4" />
      <Link href="/leaderboards" className="mt-4 text-center text-sm underline opacity-80">🏆 Leaderboards</Link>
      <footer className="mt-8 text-center text-xs opacity-60">In-game naira only — not real money. No payments, no cash-out.</footer>
    </main>
  );
}

export default function Page() {
  return <Suspense><Landing /></Suspense>;
}
