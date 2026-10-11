"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getLeaderboard, type LeaderRow } from "@/lib/api";

export default function LeaderboardsPage() {
  const [kind, setKind] = useState<"seeker" | "hider">("seeker");
  const [period, setPeriod] = useState<"weekly" | "all">("weekly");
  const [rows, setRows] = useState<LeaderRow[] | null>(null);
  useEffect(() => {
    setRows(null);
    getLeaderboard(kind, period).then((r) => setRows(r.rows)).catch(() => setRows([]));
  }, [kind, period]);
  const tab = (on: boolean) => `btn flex-1 ${on ? "btn-danfo" : "btn-ghost"}`;
  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <h1 className="text-3xl font-black text-[var(--danfo)]">Leaderboards</h1>
      <div className="mt-4 flex gap-2"><button className={tab(kind === "seeker")} onClick={() => setKind("seeker")}>Top Seeker</button><button className={tab(kind === "hider")} onClick={() => setKind("hider")}>Top Hider</button></div>
      <div className="mt-2 flex gap-2"><button className={tab(period === "weekly")} onClick={() => setPeriod("weekly")}>This week</button><button className={tab(period === "all")} onClick={() => setPeriod("all")}>All time</button></div>
      <ol className="mt-4 space-y-1">
        {rows === null && <li className="opacity-70">Loading…</li>}
        {rows?.length === 0 && <li className="opacity-70">No scores yet — be the first!</li>}
        {rows?.map((r, i) => (
          <li key={r.id} className="panel flex justify-between px-3 py-2">
            <span>{i + 1}. {r.nickname} <span className="text-xs opacity-60">{r.home_area}</span></span>
            <span className="font-bold">{r.score}</span>
          </li>
        ))}
      </ol>
      <Link href="/" className="btn btn-ghost mt-6 block text-center">← Back</Link>
    </main>
  );
}
