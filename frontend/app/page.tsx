"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { BOTTOMS, SKIN, TOPS } from "@/game/palette";
import { createGuest, getContent, loadAccount, type Account } from "@/lib/api";

const AvatarPreview = dynamic(() => import("@/game/Previews").then((m) => m.AvatarPreview), {
  ssr: false,
  loading: () => <div className="mx-auto h-56 w-40 animate-pulse rounded-3xl bg-white/5" />,
});

function Landing() {
  const router = useRouter();
  const [acc, setAcc] = useState<Account | null>(null);
  const [areas, setAreas] = useState<string[]>([]);
  const [nick, setNick] = useState("");
  const [area, setArea] = useState("");
  const [av, setAv] = useState([2, 0, 0]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
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
      await createGuest(nick, area, av);
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
      {acc ? (
        <div className="panel anim-rise mt-6 p-4">
          <div className="text-sm opacity-80">Welcome back,</div>
          <div className="text-2xl font-black">{acc.nickname}</div>
          <Link href={playUrl} className="btn btn-primary mt-4 block text-center text-lg">Enter Lagos ▶</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="panel anim-rise mt-6 space-y-4 p-4">
          <label className="block text-sm font-bold">Nickname
            <input value={nick} onChange={(e) => setNick(e.target.value)} maxLength={16} minLength={2} required placeholder="e.g. Tunde_Fast"
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
          <button disabled={busy || nick.trim().length < 2 || !area} className="btn btn-primary w-full text-lg">{busy ? "Loading…" : "Start playing ▶"}</button>
          <p className="text-xs opacity-70">No email or phone needed. We never ask for bank or card details.</p>
        </form>
      )}
      <Link href="/leaderboards" className="mt-4 text-center text-sm underline opacity-80">🏆 Leaderboards</Link>
      <footer className="mt-8 text-center text-xs opacity-60">In-game naira only — not real money. No payments, no cash-out.</footer>
    </main>
  );
}

export default function Page() {
  return <Suspense><Landing /></Suspense>;
}
