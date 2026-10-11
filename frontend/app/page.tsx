"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { BOTTOMS, SKIN, TOPS } from "@/game/palette";
import { createGuest, getContent, loadAccount, type Account } from "@/lib/api";

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
          className={`h-7 w-7 rounded-full border-2 ${av[idx] === i ? "border-white" : "border-transparent"}`} style={{ background: c }} />
      ))}
    </div>
  );

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center px-4 py-8">
      <h1 className="text-5xl font-black text-[var(--danfo)]">Boju Boju</h1>
      <p className="mt-1 text-lg">Hide &amp; seek, Lagos style. 🚌🌴</p>
      <p className="mt-1 text-sm opacity-75">Hide well, find your guys, earn naira, chop suya. &ldquo;Mo ti ri e!&rdquo;</p>

      {!acc && areas.length === 0 && !err && (
        <p className="mt-4 text-sm opacity-80">Waking up the game server… this can take up to a minute the first time.</p>
      )}
      {acc ? (
        <div className="panel mt-6 p-4">
          <div className="text-sm opacity-80">Welcome back,</div>
          <div className="text-2xl font-black">{acc.nickname}</div>
          <Link href={playUrl} className="btn btn-danfo mt-4 block text-center text-lg">Enter Lagos ▶</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="panel mt-6 space-y-4 p-4">
          <label className="block text-sm font-bold">Nickname
            <input value={nick} onChange={(e) => setNick(e.target.value)} maxLength={16} minLength={2} required placeholder="e.g. Tunde_Fast"
              className="mt-1 w-full rounded-lg bg-white/10 px-3 py-2 font-normal outline-none" />
          </label>
          <label className="block text-sm font-bold">Your Lagos area
            <select value={area} onChange={(e) => setArea(e.target.value)} className="mt-1 w-full rounded-lg bg-white/10 px-3 py-2 font-normal outline-none">
              {areas.map((a) => <option key={a} className="text-black">{a}</option>)}
            </select>
          </label>
          <div className="space-y-2 text-sm font-bold">
            <div>Skin {swatch(SKIN, 0)}</div>
            <div>Top {swatch(TOPS, 1)}</div>
            <div>Trousers {swatch(BOTTOMS, 2)}</div>
          </div>
          {err && <div className="rounded bg-red-600/80 px-3 py-2 text-sm">{err}</div>}
          <button disabled={busy || nick.trim().length < 2 || !area} className="btn btn-danfo w-full text-lg">{busy ? "Loading…" : "Start playing ▶"}</button>
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
