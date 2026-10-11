"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { BOTTOMS, SKIN, TOPS } from "@/game/palette";
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
  const [av, setAv] = useState([2, 0, 0]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"new" | "login">("new");
  const join = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("join") : null;
  const playUrl = `/play${join ? `?join=${encodeURIComponent(join)}` : ""}`;

  useEffect(() => {
    setAcc(loadAccount());
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

  const swatch = (palette: string[], idx: number) => (
    <div className="flex flex-wrap gap-1.5">
      {palette.map((c, i) => (
        <button type="button" key={c} aria-label={`colour ${i + 1}`} onClick={() => setAv(av.map((v, j) => (j === idx ? i : v)))}
          className={`h-8 w-8 rounded-full border-2 transition-transform duration-300 [transition-timing-function:var(--ease-spring)] ${av[idx] === i ? "scale-125 border-white" : "border-transparent"}`} style={{ background: c }} />
      ))}
    </div>
  );

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center px-4 py-8">
      <div className="anim-pop flex items-center gap-3">
        <span className="logo-peek grid h-16 w-16 place-items-center rounded-[22px] bg-[var(--accent)] text-4xl shadow-lg shadow-blue-500/30">🙈</span>
        <h1 className="text-5xl font-black tracking-tight">Boju Boju</h1>
      </div>
      <p className="mt-1 text-lg">Hide &amp; seek, Lagos style. 🚌🌴</p>
      <p className="mt-1 text-sm opacity-75">Hide well, find your guys, earn naira, chop suya. &ldquo;Mo ti ri e!&rdquo;</p>

      {!acc && areas.length === 0 && !err && (
        <p className="mt-4 text-sm opacity-80">Waking up the game server… this can take up to a minute the first time.</p>
      )}
      {acc && mode === "new" ? (
        <div className="panel anim-rise mt-6 p-4">
          <div className="text-sm opacity-80">Welcome back,</div>
          <div className="text-2xl font-black">{acc.nickname}</div>
          <Link href={playUrl} className="btn btn-primary mt-4 block text-center text-lg">Enter Lagos ▶</Link>
          <button className="mt-3 w-full text-center text-xs underline opacity-75" onClick={() => setMode("login")}>Not you? Log in to another account</button>
        </div>
      ) : (
        <div className="panel anim-rise mt-6 p-4">
          <div className="segmented mb-4">
            <button type="button" data-on={mode === "new"} onClick={() => setMode("new")}>New player</button>
            <button type="button" data-on={mode === "login"} onClick={() => setMode("login")}>I have an account</button>
          </div>
          {mode === "login" ? (
            <LoginForm onDone={() => router.push(playUrl)} />
          ) : (
        <form onSubmit={submit} className="anim-step space-y-4">
          <label className="block text-sm font-bold">Username
            <input value={nick} onChange={(e) => setNick(e.target.value.replace(/[^A-Za-z0-9_.]/g, ""))} maxLength={16} minLength={3} required placeholder="e.g. tunde_fast"
              autoCapitalize="off" autoCorrect="off" autoComplete="username"
              className="mt-1 w-full rounded-lg bg-white/10 px-3 py-2 font-normal outline-none" />
          </label>
          <label className="block text-sm font-bold">Your Lagos area
            <select value={area} onChange={(e) => setArea(e.target.value)} className="mt-1 w-full rounded-lg bg-white/10 px-3 py-2 font-normal outline-none">
              {areas.map((a) => <option key={a} className="text-black">{a}</option>)}
            </select>
          </label>
          <AvatarPreview av={av} className="mx-auto h-56 w-40" />
          <p className="-mt-2 text-center text-xs opacity-70">This na you — change your look below 👇</p>
          <div className="space-y-2 text-sm font-bold">
            <div>Skin {swatch(SKIN, 0)}</div>
            <div>Ankara shirt {swatch(TOPS, 1)}</div>
            <div>Trousers {swatch(BOTTOMS, 2)}</div>
          </div>
          {err && <div className="rounded bg-red-600/80 px-3 py-2 text-sm">{err}</div>}
          <label className="block text-sm font-bold">Password
            <PasswordInput value={pw} onChange={setPw} autoComplete="new-password" placeholder="At least 8 characters" />
            {pw && passwordProblem(pw, nick) && <span className="mt-1 block text-xs font-normal text-[var(--clay)]">{passwordProblem(pw, nick)}</span>}
          </label>
          <label className="block text-sm font-bold">Type password again
            <PasswordInput value={pw2} onChange={setPw2} autoComplete="new-password" />
            {pw2 && pw2 !== pw && <span className="mt-1 block text-xs font-normal text-[var(--clay)]">Passwords don&apos;t match</span>}
          </label>
          <label className="block text-sm font-bold">Email <span className="font-normal opacity-60">(optional — only for password reset)</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" inputMode="email" autoComplete="email" placeholder="you@example.com"
              className="mt-1 w-full rounded-lg bg-white/10 px-3 py-2 font-normal outline-none" />
          </label>
          <button disabled={busy || nick.trim().length < 3 || !area || !!passwordProblem(pw, nick) || pw !== pw2} className="btn btn-primary w-full text-lg">{busy ? "Loading…" : "Start playing ▶"}</button>
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
