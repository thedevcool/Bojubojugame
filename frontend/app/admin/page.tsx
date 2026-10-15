"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { adminAct, adminAdImage, adminAnalytics, adminListAds, naira, type AdminAd, type AdminAnalytics } from "@/lib/api";

const duration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
};

const number = (value: number) => new Intl.NumberFormat().format(value);

/** Admin analytics and wall ad review. Both protected by ADMIN_TOKEN held in this tab only. */
export default function Admin() {
  const [token, setToken] = useState("");
  const [input, setInput] = useState("");
  const [ads, setAds] = useState<AdminAd[] | null>(null);
  const [analytics, setAnalytics] = useState<AdminAnalytics | null>(null);
  const [days, setDays] = useState(14);
  const [imgs, setImgs] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const imageIds = useRef(new Set<string>());

  useEffect(() => { try { setToken(sessionStorage.getItem("boju.admin") ?? ""); } catch { /* ignore */ } }, []);

  const load = useCallback(async (t: string, period = days) => {
    setErr("");
    try {
      const [adResult, analyticsResult] = await Promise.all([adminListAds(t), adminAnalytics(t, period)]);
      setAds(adResult.ads);
      setAnalytics(analyticsResult);
      try { sessionStorage.setItem("boju.admin", t); } catch { /* ignore */ }
      for (const ad of adResult.ads) {
        if (imageIds.current.has(ad.id)) continue;
        imageIds.current.add(ad.id);
        adminAdImage(t, ad.id).then((url) => setImgs((current) => ({ ...current, [ad.id]: url }))).catch(() => {
          imageIds.current.delete(ad.id);
        });
      }
    } catch (e) {
      setAds(null);
      setAnalytics(null);
      setErr(e instanceof Error ? e.message : "Failed");
      try { sessionStorage.removeItem("boju.admin"); } catch { /* ignore */ }
    }
  }, [days]);

  useEffect(() => { if (token) void load(token); }, [token, load]);
  useEffect(() => {
    if (!token) return;
    const timer = window.setInterval(() => { void load(token); }, 15_000);
    return () => window.clearInterval(timer);
  }, [token, load]);

  const act = async (id: string, action: "approve" | "reject" | "remove") => {
    if (action !== "approve" && !confirm(action === "reject" ? "Reject and refund this ad?" : "Take this live ad down (no refund)?")) return;
    setBusy(id);
    try { await adminAct(token, id, action); await load(token); } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    setBusy(null);
  };

  if (!token || !ads || !analytics) {
    return (
      <main className="flex min-h-full items-center justify-center p-6">
        <form className="panel w-full max-w-sm p-5" onSubmit={(e) => { e.preventDefault(); setToken(input.trim()); void load(input.trim()); }}>
          <h1 className="text-lg font-black">Boju admin</h1>
          <p className="mt-1 text-sm opacity-70">Sign in to view live game and player analytics.</p>
          <input type="password" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Admin token"
            className="mt-3 w-full rounded-xl bg-white/10 px-3 py-2.5 text-sm outline-none" />
          {err && <div className="mt-2 text-sm text-red-300">{err}</div>}
          <button className="btn btn-primary mt-3 w-full">Open</button>
        </form>
      </main>
    );
  }

  const { totals, activity, leaderboards } = analytics;
  const maxVisits = Math.max(1, ...activity.map((day) => day.visits));
  const groups: [string, AdminAd[]][] = [["Waiting for review", ads.filter((ad) => ad.status === "review")], ["Live", ads.filter((ad) => ad.status === "live")]];
  const cards = [
    ["Total players", totals.players, "all accounts"],
    ["Active now", totals.active_players, "connected players"],
    ["New players", totals.new_players, `last ${days} days`],
    ["Total visits", totals.visits, "tracked app sessions"],
    ["Players in games", totals.players_in_current_plays, "connected to a live game"],
    ["Current plays", totals.current_plays, "live game rooms"],
    ["Total plays", totals.plays, `${number(totals.completed_plays)} completed`],
    ["Active visits", totals.active_visits, "open app sessions"],
  ] as const;

  return (
    <main className="mx-auto max-w-6xl p-4 pb-12 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-200/70">Boju Boju · Admin</p>
          <h1 className="mt-1 text-2xl font-black sm:text-3xl">Game analytics</h1>
          <p className="mt-1 text-xs opacity-60">Updated {new Date(analytics.generated_at).toLocaleTimeString()} · refreshes every 15 seconds</p>
        </div>
        <div className="flex items-center gap-2">
          <select aria-label="Activity period" className="field w-auto py-2 text-sm" value={days}
            onChange={(e) => setDays(Number(e.target.value))}>
            {[7, 14, 30, 90].map((period) => <option key={period} value={period}>{period} days</option>)}
          </select>
          <button className="btn btn-ghost text-sm" onClick={() => void load(token)}>Refresh</button>
        </div>
      </header>
      {err && <div role="alert" className="mt-3 rounded-xl bg-red-500/15 p-3 text-sm text-red-200">{err}</div>}

      <section aria-label="Player and game totals" className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map(([label, value, detail]) => (
          <article key={label} className="panel min-h-28 p-4">
            <div className="text-xs font-semibold opacity-65">{label}</div>
            <div className="mt-2 text-3xl font-black tabular-nums">{number(value)}</div>
            <div className="mt-1 text-xs opacity-55">{detail}</div>
          </article>
        ))}
      </section>

      <section className="panel mt-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div><h2 className="text-lg font-bold">Activity</h2><p className="text-xs opacity-60">Visits, new players and games started per day</p></div>
          <div className="flex gap-3 text-[11px] opacity-75"><span>🟦 Visits</span><span>🟪 New players</span><span>🟩 Plays</span></div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <div className="grid h-36 gap-2" style={{ gridTemplateColumns: `repeat(${activity.length}, minmax(20px, 1fr))`, minWidth: `${Math.max(280, activity.length * 26)}px` }}>
            {activity.map((day) => {
            const date = new Date(`${day.date}T12:00:00`);
            const bars = [day.visits / maxVisits, day.new_players / maxVisits, day.plays / maxVisits];
            return (
              <div key={day.date} className="flex min-w-0 flex-col items-center justify-end gap-1" title={`${day.date}: ${day.visits} visits, ${day.new_players} new players, ${day.plays} plays`}>
                <div className="flex h-28 w-full items-end justify-center gap-0.5 border-b border-white/10">
                  {bars.map((height, index) => <div key={index} className={`w-1/4 min-w-1 rounded-t-sm ${["bg-blue-400", "bg-violet-400", "bg-emerald-400"][index]}`}
                    style={{ height: `${Math.max(height > 0 ? 4 : 0, height * 100)}%` }} />)}
                </div>
                <span className="text-[10px] opacity-50">{date.getDate()}</span>
              </div>
            );
            })}
          </div>
        </div>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {([
          ["🔎 Top seekers", leaderboards.seekers.map((row) => ({ id: row.id, name: row.nickname, value: `${number(row.score)} finds` }))],
          ["🙈 Top hiders", leaderboards.hiders.map((row) => ({ id: row.id, name: row.nickname, value: `${number(row.score)} survived` }))],
          ["⏱️ Most time spent", leaderboards.playtime.map((row) => ({ id: row.id, name: row.nickname, value: `${duration(row.seconds)} · ${number(row.visits)} visits` }))],
        ] as const).map(([title, rows]) => (
          <section key={title} className="panel p-4">
            <h2 className="font-bold">{title}</h2>
            {rows.length === 0 ? <p className="mt-3 text-sm opacity-50">No tracked results yet.</p> : (
              <ol className="mt-3 space-y-2">
                {rows.map((row, index) => <li key={row.id} className="flex items-center gap-2 text-sm">
                  <span className="w-5 text-xs font-bold opacity-50">{index + 1}.</span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{row.name}</span>
                  <span className="text-right text-xs opacity-65">{row.value}</span>
                </li>)}
              </ol>
            )}
          </section>
        ))}
      </div>

      <section className="panel mt-4 p-4">
        <h2 className="font-bold">🗺️ Most played arenas</h2>
        {analytics.arenas.length === 0 ? <p className="mt-2 text-sm opacity-50">No games recorded yet.</p> : (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {analytics.arenas.map((arena) => <div key={arena.id} className="flex justify-between rounded-xl bg-white/5 px-3 py-2 text-sm">
              <span className="truncate">{arena.name}</span><span className="ml-2 font-bold tabular-nums">{number(arena.plays)}</span>
            </div>)}
          </div>
        )}
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between"><h2 className="text-xl font-black">📢 Wall ads</h2>
          <span className="text-xs opacity-55">{ads.filter((ad) => ad.status === "review").length} waiting for review</span></div>
        {groups.map(([name, list]) => (
          <section key={name} className="mt-4">
            <h3 className="text-sm font-bold uppercase tracking-wide opacity-70">{name} ({list.length})</h3>
            {list.length === 0 && <div className="mt-2 text-sm opacity-60">Nothing here.</div>}
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {list.map((ad) => (
                <div key={ad.id} className="panel p-3" data-testid="admin-ad">
                  {imgs[ad.id]
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={imgs[ad.id]} alt={ad.title} className="w-full rounded-lg bg-white object-contain" />
                    : <div className="grid h-32 place-items-center rounded-lg bg-white/5 text-xs opacity-60">loading…</div>}
                  <div className="mt-2 font-bold">{ad.title}</div>
                  <div className="text-xs opacity-70">{ad.size.toUpperCase()} · {naira(ad.price)} · {ad.map_id} · by @{ad.by} · {ad.email}</div>
                  {ad.live_until && <div className="text-xs opacity-70">Until {new Date(ad.live_until).toLocaleString()}</div>}
                  <div className="mt-2 flex gap-2">
                    {ad.status === "review" ? <>
                      <button disabled={busy === ad.id} className="btn btn-leaf flex-1 text-sm" onClick={() => void act(ad.id, "approve")}>Approve</button>
                      <button disabled={busy === ad.id} className="btn btn-ghost flex-1 text-sm" onClick={() => void act(ad.id, "reject")}>Reject + refund</button>
                    </> : <button disabled={busy === ad.id} className="btn btn-ghost flex-1 text-sm" onClick={() => void act(ad.id, "remove")}>Take down</button>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </section>
    </main>
  );
}
