"use client";

import { useEffect, useRef, useState } from "react";
import { getMyAds, loadAccount, naira, vatarMatchLink, type MyAd } from "@/lib/api";
import { net } from "@/lib/net";
import { useGame } from "@/lib/store";
import { claimAdPurchase, freshSession, vatar, vatarMessage, type VMatch } from "@/lib/vatar";

/**
 * The LagosLife (mini version) parts of the phone: play a LagosLife match with friends,
 * the LagosLife leaderboard, and paying for approved ads with LagosLife's pay sheet.
 */

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sends each finished game's points to the LagosLife leaderboard (it keeps your best game). */
export function MiniBridge() {
  const over = useGame((s) => s.over);
  const me = useGame((s) => s.me?.id);
  const sent = useRef<string | null>(null);
  useEffect(() => {
    const v = vatar();
    const mine = over?.results.find((r) => r.id === me);
    if (!v || !over || !mine || sent.current === over.gameId) return;
    sent.current = over.gameId;
    if (mine.earned > 0) v.submitScore(Math.round(mine.earned)).catch(() => {});
  }, [over, me]);
  return null;
}

// ------------------------------------------------------------------ matches
/** Turn a LagosLife match into one private Boju Boju game (the first player in creates it). */
async function playMatch(m: VMatch, say: (s: string) => void): Promise<void> {
  const acc = loadAccount();
  if (!acc) return;
  const st = useGame.getState;
  for (let i = 0; i < 40; i++) {
    const r = await vatarMatchLink(acc, await freshSession(), m.id);
    if (r.group_code) {
      if (st().group?.code !== r.group_code) net.send({ t: "g_join", code: r.group_code });
      say("Joining the game…");
      return;
    }
    if (r.create) {
      const cfg = st().content?.config, maps = st().content?.maps;
      const arena = cfg?.cities[0]?.arenas[0] ?? "arena_park";
      if (!st().group || st().group?.phase === "over") {
        net.send({ t: "g_create", arena, hide: cfg?.game.default_hide_time ?? 30, search: cfg?.game.default_search_time ?? 180,
          safe: maps?.[arena]?.safe_houses[0]?.id ?? "", bots: 0, public: false });
      }
      for (let j = 0; j < 50 && !(st().group && st().group?.phase === "lobby"); j++) await wait(200);
      const code = st().group?.code;
      if (!code) throw new Error("Couldn't create the game — try again");
      await vatarMatchLink(acc, await freshSession(), m.id, code);
      say("Waiting for everyone to join…");
      // start as soon as every match player is in the lobby. Anyone not here after 45 s (a friend whose
      // game didn't open, or LagosLife's sandbox test bot) gets NPCs in their place so the match can finish.
      for (let j = 0; j < 300; j++) {
        const g = st().group;
        if (!g || g.phase !== "lobby") return;
        const humans = g.members.filter((x) => !x.left && !x.bot && x.online).length;
        if (humans >= m.players.length) {
          net.send({ t: "g_start" });
          return;
        }
        if (j === 45) {
          say("Not everyone made it — NPCs are filling in");
          const npcs = g.members.filter((x) => !x.left && x.bot).length;
          for (let k = humans + npcs; k < Math.max(3, m.players.length); k++) net.send({ t: "g_add_bot" });
          await wait(800);
          net.send({ t: "g_start" });
          return;
        }
        await wait(1000);
      }
      return;
    }
    say("Your friend is setting up the game…");
    await wait(1500);
  }
}

export function MatchApp() {
  const [m, setM] = useState<VMatch | null>(null);
  const [stake, setStake] = useState(0);
  const [seats, setSeats] = useState(2);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const linked = useRef<string | null>(null);
  const v = vatar();

  useEffect(() => {
    if (!v) return;
    v.match.current().then(setM).catch(() => {});
    return v.match.onUpdate(setM);
  }, [v]);

  useEffect(() => {
    if (!m || m.status !== "playing" || linked.current === m.id) return;
    linked.current = m.id;
    playMatch(m, setMsg).catch((e) => { linked.current = null; setErr(vatarMessage(e)); });
  }, [m]);

  if (!v) return <p className="py-6 text-center text-sm opacity-70">Open Boju Boju from LagosLife to play matches.</p>;
  const act = async (f: () => Promise<VMatch>) => {
    setErr(""); setBusy(true);
    try { setM(await f()); } catch (e) { setErr(vatarMessage(e)); }
    setBusy(false);
  };

  if (m && (m.status === "open" || m.status === "playing")) {
    return (
      <div className="anim-fade space-y-3" data-testid="ll-match">
        <div className="ios-group p-4 text-center">
          <div className="text-[12px] opacity-70">{m.status === "open" ? "Tell your friends to enter this code in Boju Boju → Play with friends" : "Match on!"}</div>
          <div className="my-1 font-mono text-4xl font-black tracking-[0.25em]">{m.code}</div>
          <div className="text-[12px] opacity-70">{m.stake ? `${naira(m.stake)} each · winner takes the pot` : "Friendly match"} · {m.players.length}/{m.seats} players</div>
        </div>
        <div className="ios-group">
          {m.players.map((p) => <div key={p.id} className="ios-row text-[15px]">🙈 {p.name}{p.id === m.me ? " (you)" : ""}</div>)}
        </div>
        {msg && <div className="text-center text-sm">{msg}</div>}
        {err && <div className="text-center text-sm text-red-300">{err}</div>}
        {m.status === "open" && (
          <button className="btn btn-ghost w-full" disabled={busy} onClick={() => { setBusy(true); v.match.leave().then(() => setM(null), (e) => setErr(vatarMessage(e))).finally(() => setBusy(false)); }}>
            Leave match{m.stake ? " (stake back)" : ""}
          </button>
        )}
        <p className="text-[11px] opacity-60">Stakes are LagosLife game money, held by LagosLife. The player with the most points wins.</p>
      </div>
    );
  }

  return (
    <div className="anim-fade space-y-3" data-testid="ll-match">
      {m?.status === "done" && <div className="ios-group p-3 text-center text-sm">Last match: {m.winner ? (m.winner === m.me ? "you won! 🏆" : `${m.players.find((p) => p.id === m.winner)?.name ?? "someone"} won`) : "a draw"}</div>}
      <div className="ios-section-title">Join a friend</div>
      <div className="flex gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))} placeholder="6-letter code"
          className="min-w-0 flex-1 rounded-xl bg-white/10 px-3 py-2.5 font-mono text-lg tracking-widest outline-none" />
        <button className="btn btn-leaf" disabled={busy || code.length !== 6} onClick={() => act(() => v.match.join(code))}>Join</button>
      </div>
      <div className="ios-section-title">Start a match</div>
      <div className="ios-group space-y-2 p-3">
        <div className="text-[12px] opacity-70">Stake (LagosLife game money)</div>
        <div className="segmented">
          {[0, 500, 1000, 5000].map((n) => <button key={n} data-on={stake === n} onClick={() => setStake(n)}>{n ? naira(n) : "Friendly"}</button>)}
        </div>
        <div className="text-[12px] opacity-70">Players</div>
        <div className="segmented">
          {[2, 3, 4].map((n) => <button key={n} data-on={seats === n} onClick={() => setSeats(n)}>{n}</button>)}
        </div>
        <button className="btn btn-primary w-full" disabled={busy} onClick={() => act(() => v.match.create({ stake, seats }))}>Create · get a code</button>
        <button className="btn btn-ghost w-full" disabled={busy} onClick={() => act(() => v.match.quick({ stake }))}>⚡ Quick match with anyone</button>
      </div>
      {err && <div className="text-center text-sm text-red-300">{err}</div>}
      <p className="text-[11px] opacity-60">Or just play: 🙈 Boju Boju and 📺 Live games work like always, with LagosLife players and NPCs.</p>
    </div>
  );
}

// ------------------------------------------------------------------ leaderboard
export function MiniLeaders() {
  const [b, setB] = useState<Awaited<ReturnType<NonNullable<ReturnType<typeof vatar>>["leaderboard"]>> | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    vatar()?.leaderboard().then(setB).catch((e) => setErr(vatarMessage(e)));
  }, []);
  if (err) return <p className="py-6 text-center text-sm opacity-70">{err}</p>;
  if (!b) return <p className="py-6 text-center text-sm opacity-70">Loading…</p>;
  return (
    <div className="anim-fade">
      <div className="ios-group">
        {b.top.length === 0 && <div className="ios-row text-sm opacity-70">No scores yet — finish a game to get on the board!</div>}
        {b.top.map((r) => (
          <div key={r.rank} className="ios-row text-[15px]">
            <span className="w-8 font-bold">{["🥇", "🥈", "🥉"][r.rank - 1] ?? r.rank}</span><span className="flex-1 truncate">{r.name}</span>
            <span className="tabular-nums">{r.score.toLocaleString("en-NG")}</span>
          </div>
        ))}
      </div>
      {b.me && <div className="mt-2 text-center text-sm">You: <b>{b.me.label}</b> · best game {b.me.score.toLocaleString("en-NG")} pts</div>}
      <p className="mt-2 text-center text-[11px] opacity-60">Your best single game counts.</p>
    </div>
  );
}

// ------------------------------------------------------------------ my ads (pay after approval)
const STATUS: Record<string, string> = {
  review: "⏳ Waiting for approval", approved: "✅ Approved — pay to put it up", live: "📢 Live", rejected: "Not approved", refunded: "Refunded",
};

export function MyAdsApp() {
  const version = useGame((s) => s.adsVersion);
  const [ads, setAds] = useState<MyAd[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    // refresh while open, so an approval shows up without leaving the app
    const load = () => {
      const acc = loadAccount();
      if (!acc) { setErr("Sign-in lost — close and reopen Boju Boju from LagosLife"); setAds([]); return; }
      getMyAds(acc).then((r) => { setAds(r.ads); setErr((e) => (e.startsWith("Couldn't load") ? "" : e)); })
        .catch((e) => { setErr(`Couldn't load your ads (${e instanceof Error ? e.message : "network"}) — trying again…`); setAds((a) => a ?? []); });
    };
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [version]);
  const pay = async (a: MyAd) => {
    const v = vatar();
    if (!v || !a.product) return;
    setErr(""); setBusy(a.id);
    try {
      const p = await v.purchase(a.product);
      if (!(await claimAdPurchase(p, a.id))) setErr("Paid — we'll put it up as soon as LagosLife confirms (a minute or two)");
    } catch (e) { setErr(vatarMessage(e)); }
    setBusy(null);
  };
  return (
    <div className="anim-fade space-y-2" data-testid="my-ads">
      <p className="text-[12px] opacity-75">Tap a kiosk, shop, billboard or arena wall to place an ad. We check it first; you only pay in LagosLife once it&apos;s approved.</p>
      {ads === null ? <p className="text-sm opacity-60">Loading…</p> : ads.length === 0 ? <p className="text-sm opacity-60">No ads yet.</p> : (
        <div className="ios-group">
          {ads.map((a) => (
            <div key={a.id} className="ios-row flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold">{a.title}</div>
                <div className="text-[11px] opacity-70">{STATUS[a.status] ?? a.status}{a.live_until && a.status === "live" ? ` · until ${new Date(a.live_until).toLocaleDateString()}` : ""}</div>
              </div>
              {a.status === "approved" && a.provider === "vatar" && (
                <button className="btn btn-primary px-3 py-1.5 text-sm" disabled={busy === a.id} onClick={() => pay(a)}>Pay {naira(a.price)}</button>
              )}
            </div>
          ))}
        </div>
      )}
      {err && <div className="text-sm text-red-300">{err}</div>}
    </div>
  );
}
