"use client";

import { useEffect, useRef, useState } from "react";
import { loadAccount, naira, reportPlayer, getLeaderboard, getWallet, type LeaderRow, type WalletEntry } from "@/lib/api";
import { siteUrl } from "@/lib/env";
import { net } from "@/lib/net";
import { useGame, type Quality } from "@/lib/store";
import CreateGame from "./CreateGame";
import { useRole, useSecondsLeft } from "./hooks";

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="anim-fade pointer-events-auto absolute inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-[2px] sm:items-center" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel anim-sheet max-h-[88vh] w-full max-w-md overflow-y-auto rounded-b-none p-4 sm:rounded-b-[20px]">
        <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-white/25 sm:hidden" />
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-black">{title}</h2>
          <button className="btn btn-ghost px-3 py-1" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function GroupPanel() {
  const set = useGame((s) => s.set);
  const g = useGame((s) => s.group);
  const me = useGame((s) => s.me?.id);
  const cfg = useGame((s) => s.content?.config);
  const maps = useGame((s) => s.content?.maps);
  const [code, setCode] = useState("");
  const arenas = Object.values(maps ?? {}).filter((m) => m.kind === "arena");
  // Defaults for the one-tap quick game; the step-by-step creator has its own state.
  const arena = arenas[0]?.id ?? "arena_park";
  const hide = cfg?.game.default_hide_time ?? 30;
  const search = cfg?.game.default_search_time ?? 180;
  const arenaMap = maps?.[g?.settings.arena ?? arena];
  const safe = maps?.[arena]?.safe_houses[0]?.id ?? "";
  const close = () => set({ panel: null });
  if (!cfg) return null;

  if (!g || g.phase === "over") {
    return (
      <Modal title="Play Boju Boju" onClose={close}>
        <div className="space-y-3">
          <button className="choice anim-rise flex w-full items-center gap-3 p-3 text-left" data-on="false"
            onClick={() => net.send({ t: "g_create", arena, hide, search, safe, bots: 3 })}>
            <span className="text-3xl">⚡</span>
            <span><span className="block font-bold">Quick game vs 3 NPCs</span><span className="text-xs opacity-70">Jump straight in — default settings</span></span>
          </button>
          <div className="panel anim-rise p-3" style={{ animationDelay: "60ms" }}>
            <CreateGame />
          </div>
          <div className="panel p-3">
            <div className="mb-2 font-bold">Join with a code</div>
            <div className="flex gap-2">
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))} placeholder="ABC123"
                className="w-full rounded-lg bg-white/10 px-3 py-2 font-mono tracking-widest outline-none" />
              <button className="btn btn-leaf" disabled={code.length < 4} onClick={() => net.send({ t: "g_join", code })}>Join</button>
            </div>
          </div>
        </div>
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
    <Modal title={`Group ${g.code}`} onClose={close}>
      <div className="mb-3 flex gap-2">
        <button className="btn btn-primary flex-1" onClick={share}>📨 Invite friends</button>
        <button className="btn btn-ghost" onClick={() => { net.send({ t: "g_leave" }); close(); }}>Leave</button>
      </div>
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
        <div className="text-lg font-black">Who go be Boju? 🎲</div>
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
          {g.pending_seeker === me ? "Na you be Boju! 🙈" : `${nick(g.pending_seeker)} na Boju!`}
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
  if (!over || g?.phase !== "over") return null;
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
            <span className={s.earned >= 0 ? "text-green-400" : "text-red-400"}>{naira(s.earned)}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <a className="btn btn-primary text-center" target="_blank" rel="noopener noreferrer"
          href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}&url=${encodeURIComponent(url)}`}>Share on X</a>
        <button className="btn btn-ghost" onClick={() => screenshot()}>📸 Screenshot</button>
        <button className="btn btn-leaf col-span-2" onClick={() => { net.send({ t: "g_leave" }); set({ over: null }); }}>Back to the hub</button>
      </div>
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

export function ChatDrawer() {
  const open = useGame((s) => s.chatOpen);
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
  useEffect(() => { end.current?.scrollIntoView(); }, [chat.length, open]);
  if (!open) return null;
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
    <div className="panel anim-sheet pointer-events-auto absolute bottom-2 left-2 right-2 z-40 flex h-[45vh] flex-col p-2 sm:left-auto sm:w-96">
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-sm font-bold">{g ? `Group chat · ${g.code}` : "Nearby chat"}</span>
        <button className="btn btn-ghost px-2 py-0.5" onClick={() => set({ chatOpen: false, unread: 0 })}>✕</button>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto px-1 text-sm">
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

export function WalletPanel() {
  const set = useGame((s) => s.set);
  const hunger = useGame((s) => s.hunger);
  const [data, setData] = useState<{ balance: number; disclaimer: string; entries: WalletEntry[] } | null>(null);
  useEffect(() => {
    const acc = loadAccount();
    if (acc) getWallet(acc).then(setData).catch(() => setData(null));
  }, []);
  const reasons: Record<string, string> = { starting_balance: "Welcome money", daily_bonus: "Daily bonus", round: "Round reward", fare: "Transport fare", food: "Food" };
  return (
    <Modal title="Wallet" onClose={() => set({ panel: null })}>
      <div className="rounded-xl bg-[var(--accent)] p-4 text-[var(--ink)]">
        <div className="text-xs font-bold uppercase">Balance</div>
        <div className="text-3xl font-black">{naira(data?.balance ?? useGame.getState().balance)}</div>
        <div className="text-xs font-semibold">{data?.disclaimer ?? "In-game naira — not real money"}. It cannot be bought, sold or cashed out.</div>
      </div>
      <div className="mt-2 text-sm">Belle (hunger): {Math.round(hunger)}%</div>
      <div className="mt-3 space-y-1 text-sm">
        {data?.entries.map((e, i) => (
          <div key={i} className="flex justify-between border-b border-white/10 py-1">
            <span>{reasons[e.reason] ?? e.reason}</span>
            <span className={e.amount >= 0 ? "text-green-400" : "text-red-400"}>{e.amount >= 0 ? "+" : ""}{naira(e.amount)}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function SettingsPanel() {
  const set = useGame((s) => s.set);
  const quality = useGame((s) => s.quality);
  const choose = (q: Quality) => {
    set({ quality: q });
    try { localStorage.setItem("boju.quality", q); } catch { /* ignore */ }
  };
  return (
    <Modal title="Settings" onClose={() => set({ panel: null })}>
      <div className="mb-1 text-sm font-bold">Graphics quality</div>
      <div className="mb-4 grid grid-cols-3 gap-2">
        {(["low", "medium", "high"] as Quality[]).map((q) => (
          <button key={q} className={`btn capitalize ${quality === q ? "btn-primary" : "btn-ghost"}`} onClick={() => choose(q)}>{q}</button>
        ))}
      </div>
      <div className="text-sm font-bold">Controls</div>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs opacity-85">
        <li>Phone: left thumb = joystick, right thumb = drag to look.</li>
        <li>Desktop: WASD / arrows to move, drag mouse to look, Shift to run, C to crouch, scroll to zoom.</li>
        <li>Crouch behind hedges and low walls — Boju can&apos;t see you from far.</li>
        <li>Boju! tags the nearest hider within 3 m that you can see.</li>
      </ul>
      <button className="btn btn-ghost mt-4 w-full" onClick={screenshot}>📸 Take screenshot</button>
      <button className="btn btn-ghost mt-2 w-full" onClick={() => set({ panel: "changelog" })}>✨ What&apos;s new</button>
    </Modal>
  );
}

export function LeadersPanel() {
  const set = useGame((s) => s.set);
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
    <Modal title="Leaderboards" onClose={() => set({ panel: null })}>
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
