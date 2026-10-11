"use client";

import { useEffect, useRef, useState } from "react";
import { getFriends, loadAccount, naira, reportPlayer, getLeaderboard, getWallet, sendDm, type Friend, type LeaderRow, type WalletEntry } from "@/lib/api";
import { sound } from "@/game/sound";
import { siteUrl } from "@/lib/env";
import { net } from "@/lib/net";
import { useGame, type Quality } from "@/lib/store";
import AccountCard from "./AccountCard";
import InstallApp from "./InstallApp";
import CreateGame from "./CreateGame";
import { LiveGamesList } from "./Live";
import { useRole, useSecondsLeft } from "./hooks";

/** Phone apps render their content straight into the phone screen (the phone draws the title bar). */
function Modal({ children }: { children: React.ReactNode }) {
  return <div className="anim-fade">{children}</div>;
}

export function GroupPanel() {
  const g = useGame((s) => s.group);
  const me = useGame((s) => s.me?.id);
  const cfg = useGame((s) => s.content?.config);
  const maps = useGame((s) => s.content?.maps);
  const [code, setCode] = useState("");
  const arenas = Object.values(maps ?? {}).filter((m) => m.kind === "arena");
  // Defaults for the one-tap quick game; the step-by-step creator has its own state.
  const arena = cfg?.cities[0]?.arenas[0] ?? arenas[0]?.id ?? "arena_park"; // quick game = home city (Lagos)
  const hide = cfg?.game.default_hide_time ?? 30;
  const search = cfg?.game.default_search_time ?? 180;
  const arenaMap = maps?.[g?.settings.arena ?? arena];
  const safe = maps?.[arena]?.safe_houses[0]?.id ?? "";
  const close = useGame((s) => s.closePhone);
  const [mode, setMode] = useState<null | "create">(null);
  const pendingFor = useGame((s) => (s.pendingInvite ? Object.values(s.roster).find((r) => r.id === s.pendingInvite)?.nick ?? "your friend" : null));
  if (!cfg) return null;

  if (!g || g.phase === "over") {
    return (
      <Modal>
        {pendingFor && (
          <div className="anim-rise mb-2 rounded-2xl bg-[var(--accent)]/20 p-2.5 text-xs">📨 Pick how you want to play — <b>@{pendingFor}</b> gets your invite as soon as the game is ready.</div>
        )}
        {mode === "create" ? (
          <div className="space-y-2">
            <button className="text-sm text-[var(--accent)]" onClick={() => setMode(null)}>‹ All options</button>
            <div className="panel anim-rise p-3"><CreateGame isPublic /></div>
          </div>
        ) : (
        <div className="space-y-3">
          <div className="ios-group">
            {[
              { icon: "🌍", bg: "#2f7cf6", title: "Create a game for real players", text: "Anyone in Live games can join you", on: () => setMode("create") },
              { icon: "📨", bg: "#30d158", title: "Play with friends", text: "Private game — invite friends or share the code", on: () => net.send({ t: "g_create", arena, hide, search, safe, bots: 0, public: false }) },
              { icon: "🤖", bg: "#bf5af2", title: "Quick game with 3 NPCs", text: "Start now — real players can still join", on: () => net.send({ t: "g_create", arena, hide, search, safe, bots: 3, public: true }) },
              { icon: "📺", bg: "#ff375f", title: "Watch games live", text: "See games in progress on the map", on: () => useGame.getState().openApp("live") },
            ].map((o) => (
              <button key={o.title} className="ios-row" onClick={o.on}>
                <span className="ios-glyph" style={{ background: o.bg }}>{o.icon}</span>
                <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold">{o.title}</span><span className="block truncate text-[12px] opacity-60">{o.text}</span></span>
                <span className="ios-chevron">›</span>
              </button>
            ))}
          </div>
          <LiveGamesList only="join" />
          <div className="panel p-3">
            <div className="mb-2 font-bold">Join with a code</div>
            <div className="flex gap-2">
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))} placeholder="ABC123"
                className="w-full rounded-lg bg-white/10 px-3 py-2 font-mono tracking-widest outline-none" />
              <button className="btn btn-leaf" disabled={code.length < 4} onClick={() => net.send({ t: "g_join", code })}>Join</button>
            </div>
          </div>
        </div>
        )}
      </Modal>
    );
  }

  const isCreator = g.creator === me;
  const link = `${siteUrl()}/play?join=${g.code}`;
  const share = async () => {
    const text = `Join my Boju Boju group in Lagos! Code ${g.code}`;
    try {
      if (navigator.share) await navigator.share({ title: "Boju Boju", text, url: link });
      else { await navigator.clipboard.writeText(`${text} ${link}`); useGame.getState().toast("Invite link copied!", "good"); }
    } catch { /* share cancelled */ }
  };
  const active = g.members.filter((m) => !m.left);
  return (
    <Modal>
      <div className="anim-pop mb-3 rounded-2xl bg-gradient-to-br from-[#2f7cf6] to-[#1d4fb0] p-3 text-center">
        <div className="text-[11px] font-semibold uppercase tracking-wider opacity-80">Your game code</div>
        <button className="my-1 font-mono text-4xl font-black tracking-[0.3em]" title="Tap to copy" onClick={async () => {
          try { await navigator.clipboard.writeText(g.code); useGame.getState().toast(`Code ${g.code} copied`, "good"); } catch { /* clipboard blocked */ }
        }}>{g.code}</button>
        <div className="text-[11px] opacity-80">Friends type this in Boju Boju → Join with a code. Tap it to copy.</div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button className="btn bg-white/20 py-1.5 text-sm" onClick={share}>📨 Share link</button>
          <button className="btn bg-white/10 py-1.5 text-sm" onClick={() => { net.send({ t: "g_leave" }); close(); }}>Leave</button>
        </div>
      </div>
      {g.phase === "lobby" && <InviteFriends code={g.code} memberIds={active.map((m) => m.id)} />}
      <div className="mb-3 space-y-1">
        {active.map((m) => (
          <div key={m.id} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-1.5 text-sm">
            <span>{m.bot ? "🤖" : m.online ? "🟢" : "⚪"} {m.nick} {m.bot && <span className="rounded bg-[var(--accent)] px-1 text-[10px] text-black">NPC</span>} {m.id === g.creator && "👑"} {m.id === me && "(you)"}</span>
            <span className="flex items-center gap-2 text-xs opacity-70">
              {m.retired ? "retired" : m.boarded ? "on board" : ""}
              {m.bot && isCreator && g.phase === "lobby" && (
                <button className="rounded bg-white/10 px-1.5" onClick={() => net.send({ t: "g_remove_bot", id: m.id })}>✕</button>
              )}
            </span>
          </div>
        ))}
        <div className="text-xs opacity-60">{active.length}/{cfg.game.max_players} players · min {cfg.game.min_players}</div>
      </div>
      {g.phase === "lobby" ? (
        isCreator ? (
          <>
            <Settings arenas={arenas.map((a) => ({ id: a.id, name: a.name }))} arena={g.settings.arena} setArena={(v) => net.send({ t: "g_settings", arena: v })}
              hide={g.settings.hide} setHide={(v) => net.send({ t: "g_settings", hide: v })} search={g.settings.search} setSearch={(v) => net.send({ t: "g_settings", search: v })}
              safe={g.settings.safe} setSafe={(v) => net.send({ t: "g_settings", safe: v })} safes={arenaMap?.safe_houses ?? []}
              hideOpts={cfg.game.hide_time_options} searchOpts={cfg.game.search_time_options} />
            <button className="btn btn-ghost mt-3 w-full" disabled={active.length >= cfg.game.max_players} onClick={() => net.send({ t: "g_add_bot" })}>
              + Add NPC player
            </button>
            <button className="btn btn-leaf mt-2 w-full text-lg" disabled={active.length < cfg.game.min_players} onClick={() => net.send({ t: "g_start" })}>Start game</button>
            <p className="mt-2 text-xs opacity-70">Everyone needs belle at least {cfg.game.min_hunger_to_play}% — chop before you start!</p>
          </>
        ) : (
          <p className="text-sm opacity-80">Waiting for the creator to start… Hide {g.settings.hide}s · Search {g.settings.search}s</p>
        )
      ) : (
        <p className="text-sm opacity-80">Game in progress — phase: {g.phase}</p>
      )}
    </Modal>
  );
}

/** One tap per friend: sends them a DM invite with a Join button (and a toast if they're online). */
function InviteFriends({ code, memberIds }: { code: string; memberIds: string[] }) {
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [sent, setSent] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const acc = loadAccount();
    if (acc) getFriends(acc).then((d) => setFriends(d.friends)).catch(() => setFriends([]));
  }, []);
  const invite = async (f: Friend) => {
    const acc = loadAccount();
    if (!acc) return;
    try {
      await sendDm(acc, f.id, `Join my Boju Boju game: ${code}`);
      setSent((s) => ({ ...s, [f.id]: true }));
      useGame.getState().toast(`Invite sent to @${f.username} 📨`, "good");
    } catch (e) { useGame.getState().toast((e as Error).message, "error"); }
  };
  if (friends === null) return null;
  const list = friends.filter((f) => !memberIds.includes(f.id));
  return (
    <div className="mb-3">
      <div className="mb-1 text-sm font-bold">Invite friends</div>
      {list.length === 0 ? (
        <div className="rounded-xl bg-white/5 p-2.5 text-xs opacity-75">
          {friends.length ? "All your friends are already here 🙌🏾" : "No friends yet — add them by username in 📱 Messages, or share the code above."}
        </div>
      ) : (
        <div className="divide-y divide-white/10 overflow-hidden rounded-xl bg-white/5">
          {list.map((f) => (
            <div key={f.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className={`h-2.5 w-2.5 rounded-full ${f.online ? "bg-green-400" : "bg-gray-500"}`} />
              <span className="flex-1 truncate">@{f.username}</span>
              <button className={`btn px-3 py-1 text-xs ${sent[f.id] ? "btn-ghost" : "btn-primary"}`} disabled={sent[f.id]} onClick={() => invite(f)}>
                {sent[f.id] ? "Sent ✓" : "Invite"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Settings(p: {
  arenas: { id: string; name: string }[]; arena: string; setArena: (v: string) => void;
  hide: number; setHide: (v: number) => void; search: number; setSearch: (v: number) => void;
  safe: string; setSafe: (v: string) => void; safes: { id: string; name: string }[]; hideOpts: number[]; searchOpts: number[];
}) {
  const sel = "w-full rounded-lg bg-white/10 px-2 py-1.5 text-sm outline-none";
  return (
    <div className="grid grid-cols-2 gap-2 text-xs">
      <label className="col-span-2">Arena<select className={sel} value={p.arena} onChange={(e) => p.setArena(e.target.value)}>{p.arenas.map((a) => <option key={a.id} value={a.id} className="text-black">{a.name}</option>)}</select></label>
      <label>Hide time<select className={sel} value={p.hide} onChange={(e) => p.setHide(+e.target.value)}>{p.hideOpts.map((o) => <option key={o} value={o} className="text-black">{o}s</option>)}</select></label>
      <label>Search time<select className={sel} value={p.search} onChange={(e) => p.setSearch(+e.target.value)}>{p.searchOpts.map((o) => <option key={o} value={o} className="text-black">{Math.round(o / 60 * 10) / 10} min</option>)}</select></label>
      <label className="col-span-2">Safe house<select className={sel} value={p.safe} onChange={(e) => p.setSafe(e.target.value)}>{p.safes.map((s) => <option key={s.id} value={s.id} className="text-black">{s.name}</option>)}</select></label>
    </div>
  );
}

const DICE = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

export function DicePanel() {
  const g = useGame((s) => s.group);
  const me = useGame((s) => s.me?.id);
  const dice = useGame((s) => s.dice);
  const left = useSecondsLeft(g?.phase_end);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!dice) return;
    setShown(0);
    const id = setInterval(() => setShown((n) => (n < dice.rolls.length ? n + 1 : n)), 450);
    return () => clearInterval(id);
  }, [dice]);
  if (!g || !["dice", "reveal"].includes(g.phase)) return null;
  const nick = (id?: string | null) => g.members.find((m) => m.id === id)?.nick ?? "?";
  if (g.phase === "dice") {
    const mine = g.members.find((m) => m.id === me)?.pick;
    const inPool = me ? g.dice_pool.includes(me) : false;
    const taken = new Set(g.members.map((m) => m.pick).filter(Boolean));
    return (
      <div className="pointer-events-auto absolute left-1/2 top-1/2 z-30 w-80 -translate-x-1/2 -translate-y-1/2"><div className="panel anim-pop p-4 text-center">
        <div className="text-lg font-black">Who go dey Boju? 🎲</div>
        <div className="mb-3 text-xs opacity-80">{inPool ? "Pick your number — if the dice lands on it, you seek!" : "Others are picking…"} ({left}s)</div>
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <button key={n} disabled={!inPool || (taken.has(n) && mine !== n)} onClick={() => net.send({ t: "g_pick", n })}
              className={`btn text-3xl ${mine === n ? "btn-primary" : "btn-ghost"}`}>{DICE[n]}</button>
          ))}
        </div>
        <div className="mt-2 text-xs opacity-80">{g.members.filter((m) => m.pick).map((m) => `${m.nick}: ${m.pick}`).join(" · ")}</div>
      </div></div>
    );
  }
  const rolling = dice && shown < dice.rolls.length;
  const face = dice && dice.rolls.length ? dice.rolls[Math.max(0, Math.min(shown, dice.rolls.length) - 1)] : null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 z-30 w-80 -translate-x-1/2 -translate-y-1/2"><div className="panel anim-pop p-5 text-center">
      {face && <div className={`text-7xl ${rolling ? "dice-rolling" : ""}`}>{DICE[face]}</div>}
      {!rolling && (
        <div className="mt-2 text-xl font-black text-[var(--accent)]">
          {g.pending_seeker === me ? "Na you dey Boju! 🙈" : `${nick(g.pending_seeker)} dey Boju!`}
        </div>
      )}
    </div></div>
  );
}

export function RoundResultPanel() {
  const g = useGame((s) => s.group);
  const me = useGame((s) => s.me?.id);
  const left = useSecondsLeft(g?.phase_end);
  const r = g?.last_result;
  if (!g || g.phase !== "result" || !r) return null;
  const nick = (id?: string | null) => g.members.find((m) => m.id === id)?.nick ?? "?";
  const mine = me ? r.deltas[me] : undefined;
  return (
    <div className="pointer-events-auto absolute left-1/2 top-1/2 z-30 w-80 -translate-x-1/2 -translate-y-1/2"><div className="panel anim-pop p-4">
      <div className="text-center text-lg font-black">Round {r.round} {r.skipped && "skipped"}</div>
      {mine !== undefined && <div className={`text-center text-2xl font-black ${mine >= 0 ? "text-green-400" : "text-red-400"}`}>{mine >= 0 ? "+" : ""}{naira(mine)}</div>}
      <div className="mt-2 space-y-1 text-sm">
        {Object.entries(r.deltas).map(([id, d]) => (
          <div key={id} className="flex justify-between">
            <span>{id === r.seeker ? "🙈" : r.found.includes(id) ? "😩" : r.safe.includes(id) ? "🏠" : "🥷"} {nick(id)}</span>
            <span className={d >= 0 ? "text-green-400" : "text-red-400"}>{d >= 0 ? "+" : ""}{naira(d)}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 text-center text-xs opacity-80">
        {r.game_over ? "Final results coming…" : r.next_seeker ? `Next Boju: ${nick(r.next_seeker)}` : "Next Boju will be rolled by dice"} · {left}s
      </div>
    </div></div>
  );
}

export function GameOverPanel() {
  const over = useGame((s) => s.over);
  const g = useGame((s) => s.group);
  const set = useGame((s) => s.set);
  const stayed = useGame((s) => s.stayed);
  const mini = useGame((s) => !!s.mini);
  if (!over || g?.phase !== "over" || stayed) return null;
  const url = `${siteUrl()}/share/${over.gameId}`;
  const winner = over.results[0];
  const tweet = `I just played Boju Boju in Lagos! ${winner ? `${winner.nick} won ${naira(winner.earned)} 🏆` : ""} Come play:`;
  return (
    <div className="pointer-events-auto absolute left-1/2 top-1/2 z-30 w-[22rem] max-w-[94vw] -translate-x-1/2 -translate-y-1/2"><div className="panel anim-pop p-4">
      <div className="text-center text-2xl font-black text-[var(--accent)]">Game over! 🎉</div>
      <div className="my-3 space-y-1">
        {over.results.map((s, i) => (
          <div key={s.id} className="flex justify-between rounded-lg bg-white/5 px-3 py-1.5 text-sm">
            <span>{["🥇", "🥈", "🥉"][i] ?? `${i + 1}.`} {s.nick}</span>
            <span className="text-xs opacity-80">{s.finds} finds · {s.survived} hides</span>
            <span className={s.earned >= 0 ? "text-green-400" : "text-red-400"}>{mini ? `${s.earned.toLocaleString("en-NG")} pts` : naira(s.earned)}</span>
          </div>
        ))}
      </div>
      {mini ? (
        <div className="grid grid-cols-2 gap-2">
          <button className="btn btn-leaf" onClick={() => net.send({ t: "g_return" })}>🚌 Motor Park</button>
          <button className="btn btn-ghost" onClick={() => set({ stayed: true })}>🚶🏾 Stay & explore</button>
          <div className="col-span-2 text-center text-[11px] opacity-70">Your score is on the LagosLife leaderboard. Going home? Tap ← at the top.</div>
        </div>
      ) : (
      <div className="grid grid-cols-2 gap-2">
        <a className="btn btn-primary text-center" target="_blank" rel="noopener noreferrer"
          href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}&url=${encodeURIComponent(url)}`}>Share on X</a>
        <button className="btn btn-ghost" onClick={() => screenshot()}>📸 Screenshot</button>
        <button className="btn btn-leaf" onClick={() => net.send({ t: "g_return" })}>🏠 Go home</button>
        <button className="btn btn-ghost" onClick={() => { set({ stayed: true }); useGame.getState().toast("Waka around! The 🚏 bus stop takes you home when you're ready.", "good"); }}>🚶🏾 Stay & explore</button>
      </div>
      )}
    </div></div>
  );
}

export function screenshot(): void {
  const canvas = document.querySelector("canvas");
  if (!canvas) return;
  const a = document.createElement("a");
  a.download = `boju-boju-${Date.now()}.png`;
  a.href = (canvas as HTMLCanvasElement).toDataURL("image/png");
  a.click();
}

export function ChatContent() {
  const chat = useGame((s) => s.chat);
  const g = useGame((s) => s.group);
  const set = useGame((s) => s.set);
  const muted = useGame((s) => s.muted);
  const me = useGame((s) => s.me?.id);
  const max = useGame((s) => s.content?.config.chat.max_len ?? 300);
  const { inGame } = useRole();
  const [text, setText] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); set({ unread: 0 }); }, [chat.length, set]);
  const locked = inGame && !!g;
  const send = () => {
    if (!text.trim()) return;
    net.send({ t: "chat", text, ch: g ? "group" : "near" });
    setText("");
  };
  const report = async (id: string, nick: string) => {
    const acc = loadAccount();
    if (!acc) return;
    try {
      await reportPlayer(acc, id, `Chat report: ${nick}`, g ? `group:${g.id}` : "hub");
      useGame.getState().toast("Report sent. Thank you.", "good");
    } catch (e) { useGame.getState().toast((e as Error).message, "error"); }
    setMenu(null);
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-1 px-1 text-xs font-bold opacity-70">{g ? `Group chat · ${g.code}` : "Nearby — people around you"}</div>
      <div className="touch-scroll min-h-0 flex-1 space-y-1 px-1 text-sm">
        {chat.length === 0 && <div className="py-6 text-center text-xs opacity-60">No messages yet. Say hi! 👋🏾</div>}
        {chat.map((m, i) => (
          <div key={i}>
            <button className="font-bold text-[var(--accent)]" onClick={() => m.from !== me && setMenu(menu === `${i}` ? null : `${i}`)}>{m.nick}</button>
            <span className="opacity-60">{m.ch === "near" ? " (nearby)" : ""}: </span>
            <span className="break-words">{m.text}</span>
            {menu === `${i}` && (
              <span className="ml-2 inline-flex gap-1">
                <button className="rounded bg-white/10 px-1.5 text-xs" onClick={() => { set({ muted: muted.includes(m.from) ? muted.filter((x) => x !== m.from) : [...muted, m.from] }); setMenu(null); }}>
                  {muted.includes(m.from) ? "Unmute" : "Mute"}
                </button>
                <button className="rounded bg-red-600/70 px-1.5 text-xs" onClick={() => report(m.from, m.nick)}>Report</button>
              </span>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>
      {locked ? (
        <div className="p-2 text-center text-xs opacity-80">Chat is locked while the round is live — use the 😜 taunts!</div>
      ) : (
        <div className="flex gap-1 pt-1">
          <input value={text} maxLength={max} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") send(); }}
            placeholder="Talk your own…" className="w-full rounded-lg bg-white/10 px-3 py-2 text-sm outline-none" />
          <button className="btn btn-primary" onClick={send}>Send</button>
        </div>
      )}
    </div>
  );
}

const LEDGER_ICON: Record<string, [string, string]> = {
  starting_balance: ["🎁", "#2fbf71"], daily_bonus: ["📅", "#2fbf71"], round: ["🙈", "#2f7cf6"], fare: ["🚌", "#e0a800"], food: ["🍢", "#ff7a1a"],
  phone: ["📱", "#7b5cff"], rent: ["🏠", "#e8731a"], topup: ["🎉", "#2fbf71"], furniture: ["🛋️", "#a5672f"], car: ["🚗", "#e04f5f"],
};

export function WalletPanel() {
  const hunger = useGame((s) => s.hunger);
  const username = useGame((s) => s.life.username);
  const [data, setData] = useState<{ balance: number; disclaimer: string; entries: WalletEntry[] } | null>(null);
  useEffect(() => {
    const acc = loadAccount();
    if (acc) getWallet(acc).then(setData).catch(() => setData(null));
  }, []);
  const reasons: Record<string, string> = { starting_balance: "Welcome money", daily_bonus: "Daily bonus", round: "Round reward", fare: "Transport fare", food: "Food", phone: "Phone", rent: "House rent", topup: "Test-phase bonus", furniture: "Furniture", car: "Car" };
  return (
    <Modal>
      <div className="wallet-card anim-pop">
        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider opacity-85">
          <span>Boju Naira</span><span>🙈</span>
        </div>
        <div className="mt-5 text-[34px] font-bold tracking-tight">{naira(data?.balance ?? useGame.getState().balance)}</div>
        <div className="mt-3 flex items-end justify-between text-[11px] opacity-85">
          <span>@{username}</span>
          <span>{data?.disclaimer ?? "In-game naira — not real money"}</span>
        </div>
      </div>
      <p className="mt-2 px-1 text-[11px] opacity-60">It cannot be bought, sold or cashed out.</p>
      <div className="ios-section-title">Belle</div>
      <div className="ios-group">
        <div className="ios-row">
          <span className="ios-glyph bg-[#ff7a1a]">🍲</span>
          <div className="flex-1">
            <div className="text-[15px]">Hunger</div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#ff7a1a]" style={{ width: `${hunger}%` }} /></div>
          </div>
          <span className="text-sm tabular-nums opacity-80">{Math.round(hunger)}%</span>
        </div>
      </div>
      <div className="ios-section-title">Recent activity</div>
      <div className="ios-group">
        {!data ? <div className="ios-row text-sm opacity-60">Loading…</div> : data.entries.filter((e) => e.amount !== 0).map((e, i) => {
          const [ic, bg] = LEDGER_ICON[e.reason] ?? ["₦", "#5d6778"];
          return (
            <div key={i} className="ios-row">
              <span className="ios-glyph" style={{ background: bg }}>{ic}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px]">{reasons[e.reason] ?? e.reason}</div>
                <div className="text-[11px] opacity-50">{new Date(e.at).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
              </div>
              <span className={`text-[15px] font-semibold tabular-nums ${e.amount >= 0 ? "text-[#30d158]" : ""}`}>{e.amount >= 0 ? "+" : ""}{naira(e.amount)}</span>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

/** iOS-style switch. */
export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-300 ${on ? "bg-[#30d158]" : "bg-white/20"}`}>
      <span className="absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-md transition-[left] duration-300" style={{ left: on ? 22 : 2, transitionTimingFunction: "var(--ease-spring)" }} />
    </button>
  );
}

export function SettingsPanel() {
  const set = useGame((s) => s.set);
  const openApp = useGame((s) => s.openApp);
  const quality = useGame((s) => s.quality);
  const [prefs, setPrefs] = useState({ ...sound.prefs });
  const [help, setHelp] = useState(false);
  const mini = useGame((s) => !!s.mini);
  const flip = (k: "sound" | "music", v: boolean) => {
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    sound.setPrefs(next);
    void sound.unlock();
  };
  const choose = (q: Quality) => {
    set({ quality: q });
    try { localStorage.setItem("boju.quality", q); } catch { /* ignore */ }
  };
  return (
    <div className="anim-fade">
      {mini ? <p className="px-1 pb-1 text-[12px] opacity-70">Signed in with LagosLife. Your money, home and friends live there.</p> : <AccountCard />}
      <div className="ios-section-title">Controls</div>
      <ControlModePicker bare />
      <div className="ios-section-title">Sound</div>
      <div className="ios-group">
        <div className="ios-row"><span className="ios-glyph bg-[#ff375f]">🔊</span><span className="flex-1 text-[15px]">Sound effects</span><Switch label="Sound effects" on={prefs.sound} onChange={(v) => flip("sound", v)} /></div>
        <div className="ios-row"><span className="ios-glyph bg-[#bf5af2]">🎶</span><span className="flex-1 text-[15px]">Music</span><Switch label="Music" on={prefs.music} onChange={(v) => flip("music", v)} /></div>
      </div>
      <div className="ios-section-title">Graphics</div>
      <div className="segmented">
        {(["low", "medium", "high"] as Quality[]).map((q) => <button key={q} data-on={quality === q} className="capitalize" onClick={() => choose(q)}>{q}</button>)}
      </div>
      <p className="px-1 pt-1 text-[11px] opacity-50">Low saves battery and data. High adds soft shadows.</p>
      <div className="ios-section-title">App</div>
      {!mini && <InstallApp className="mb-2" />}
      <div className="ios-group">
        <button className="ios-row" onClick={() => openApp("news")}><span className="ios-glyph bg-[#7b5cff]">✨</span><span className="text-[15px]">What&apos;s new</span><span className="ios-chevron">›</span></button>
        <button className="ios-row" onClick={() => setHelp(!help)}><span className="ios-glyph bg-[#2f7cf6]">❓</span><span className="text-[15px]">How to play</span><span className="ios-chevron">{help ? "⌄" : "›"}</span></button>
        {help && (
          <ul className="list-disc space-y-1 px-5 py-3 pl-9 text-[13px] opacity-85">
            <li>Joystick: left thumb moves, right thumb drags to look. Tap-to-go: tap the ground and you walk there.</li>
            <li>Two fingers pinch to zoom. Tap the round map (top left) to pin places and travel.</li>
            <li>Bend down behind hedges and low walls. Tap a bed to sleep, sofas and benches to sit.</li>
            <li>Boju catches you just by reaching you — keep your distance and break line of sight.</li>
          </ul>
        )}
      </div>
    </div>
  );
}

/** Joystick or tap-to-go — chosen on first launch, changeable here. */
export function ControlModePicker({ onPick, bare }: { onPick?: () => void; bare?: boolean }) {
  const mode = useGame((s) => s.controlMode);
  const set = useGame((s) => s.set);
  const pick = (m: "joystick" | "tap") => {
    set({ controlMode: m });
    try { localStorage.setItem("boju.controls", m); } catch { /* ignore */ }
    onPick?.();
  };
  const opts = [
    { id: "joystick" as const, icon: "🕹️", name: "Joystick", text: "Thumb stick on the left, drag right side to look" },
    { id: "tap" as const, icon: "👆🏾", name: "Tap to go", text: "Tap anywhere on the ground — you walk there" },
  ];
  return (
    <div className={bare ? "" : "mb-4"}>
      {!bare && <div className="mb-1 text-sm font-bold">Controls</div>}
      <div className="grid grid-cols-2 gap-2">
        {opts.map((o) => (
          <button key={o.id} className="choice flex flex-col items-start gap-0.5 p-3 text-left" data-on={mode === o.id} onClick={() => pick(o.id)}>
            <span className="text-2xl">{o.icon}</span>
            <span className="text-sm font-bold">{o.name}</span>
            <span className="text-[11px] leading-snug opacity-75">{o.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function LeadersPanel() {
  const g = useGame((s) => s.group);
  const [kind, setKind] = useState<"seeker" | "hider">("seeker");
  const [period, setPeriod] = useState<"weekly" | "all">("weekly");
  const [scope, setScope] = useState<"global" | "group">("global");
  const [rows, setRows] = useState<LeaderRow[] | null>(null);
  useEffect(() => {
    setRows(null);
    getLeaderboard(kind, period, scope === "group" ? g?.id : undefined).then((r) => setRows(r.rows)).catch(() => setRows([]));
  }, [kind, period, scope, g?.id]);
  const tab = (on: boolean) => `btn flex-1 py-1 text-xs ${on ? "btn-primary" : "btn-ghost"}`;
  return (
    <Modal>
      <div className="mb-2 flex gap-1"><button className={tab(kind === "seeker")} onClick={() => setKind("seeker")}>Top Seeker</button><button className={tab(kind === "hider")} onClick={() => setKind("hider")}>Top Hider</button></div>
      <div className="mb-3 flex gap-1">
        <button className={tab(period === "weekly")} onClick={() => setPeriod("weekly")}>This week</button>
        <button className={tab(period === "all")} onClick={() => setPeriod("all")}>All time</button>
        {g && <button className={tab(scope === "group")} onClick={() => setScope(scope === "group" ? "global" : "group")}>This group</button>}
      </div>
      {rows === null ? <div className="text-sm opacity-70">Loading…</div> : rows.length === 0 ? <div className="text-sm opacity-70">No scores yet — go and play!</div> : (
        <ol className="space-y-1">
          {rows.map((r, i) => (
            <li key={r.id} className="flex justify-between rounded-lg bg-white/5 px-3 py-1.5 text-sm">
              <span>{i + 1}. {r.nickname} <span className="text-xs opacity-60">{r.home_area}</span></span>
              <span className="font-bold">{r.score} {kind === "seeker" ? "finds" : "escapes"}</span>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}
