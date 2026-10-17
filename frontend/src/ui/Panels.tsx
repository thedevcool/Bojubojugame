"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { getFriends, loadAccount, saveAvatar, naira, nairaShort, reportPlayer, getLeaderboard, getWallet, sendDm, type Friend, type LeaderRow, type WalletEntry } from "@/lib/api";
import { sound } from "@/game/sound";
import { siteUrl } from "@/lib/env";
import { net } from "@/lib/net";
import { useGame, type Quality } from "@/lib/store";
import type { Standing } from "@/lib/types";
import AccountCard from "./AccountCard";
import AvatarEditor, { fullAvatar } from "./AvatarEditor";
import InstallApp from "./InstallApp";
import CreateGame from "./CreateGame";
import { LiveGamesList } from "./Live";
import { useRole, useSecondsLeft, useTicker } from "./hooks";
import { gamesPlayed } from "./Coach";
import { startGuidedPractice } from "./GameGuide";
import { getSongVoice, setSongVoice, type SongVoice } from "./BojuSong";

const AvatarPreview = dynamic(() => import("@/game/Previews").then((m) => m.AvatarPreview), { ssr: false });

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
  const firstGame = gamesPlayed() === 0;
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
              { icon: "🤖", bg: "#bf5af2", title: "Quick game with 3 NPCs", text: firstGame ? "👍 Best for your first game — start now" : "Start now — real players can still join", on: () => net.send({ t: "g_create", arena, hide, search, safe, bots: 3, public: true }) },
              { icon: "🧭", bg: "#ffb020", title: "Guided practice game", text: "Learn by playing — I'll guide you step by step", on: () => { startGuidedPractice(); } },
              { icon: "📺", bg: "#ff375f", title: "Watch games live", text: "See games in progress on the map", on: () => useGame.getState().openApp("live") },
              { icon: "❓", bg: "#64748b", title: "How to play", text: "The rules in 30 seconds", on: () => { useGame.getState().closePhone(); useGame.getState().set({ howTo: true }); } },
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
      <div data-guide="code" className="anim-pop mb-3 rounded-2xl bg-gradient-to-br from-[#2f7cf6] to-[#1d4fb0] p-3 text-center">
        <div className="text-[11px] font-semibold uppercase tracking-wider opacity-80">Your game code</div>
        <button className="my-1 font-mono text-4xl font-black tracking-[0.3em]" title="Tap to copy" onClick={async () => {
          try { await navigator.clipboard.writeText(g.code); useGame.getState().toast(`Code ${g.code} copied`, "good"); } catch { /* clipboard blocked */ }
        }}>{g.code}</button>
        <div className="text-[11px] opacity-80">Friends type this in Boju Boju → Join with a code. Tap it to copy.</div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button className="btn bg-white/20 py-1.5 text-sm" onClick={share}>📨 Share link</button>
          {g.phase === "lobby" && g.creator === me ? (
            <button className="btn bg-white/10 py-1.5 text-sm" onClick={() => { if (confirm("Cancel this game for everyone?")) { net.send({ t: "g_cancel" }); close(); } }}>Cancel game</button>
          ) : (
            <button className="btn bg-white/10 py-1.5 text-sm" onClick={() => { net.send({ t: "g_leave" }); close(); }}>Leave</button>
          )}
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
            <button data-guide="start" className="btn btn-leaf mt-2 w-full text-lg" disabled={active.length < cfg.game.min_players} onClick={() => net.send({ t: "g_start" })}>Start game</button>
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

/** Pips on a die face (3×3 grid cells, 1 = top-left … 9 = bottom-right). */
const PIPS: Record<number, number[]> = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
/** How to turn the cube so face n looks at you. */
const SHOW: Record<number, string> = { 1: "rotateX(0deg) rotateY(0deg)", 2: "rotateX(-90deg)", 3: "rotateY(-90deg)", 4: "rotateY(90deg)", 5: "rotateX(90deg)", 6: "rotateY(180deg)" };

/** A real-looking die: a 3D cube that tumbles while rolling and lands on `face`. */
function Die({ face, rolling }: { face: number | null; rolling: boolean }) {
  return (
    <div className="die-stage">
      <div className={`die ${rolling ? "die-tumble" : ""}`} style={!rolling && face ? { transform: SHOW[face] } : undefined}>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <div key={n} className={`die-face die-f${n}`}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((c) => <span key={c} className={PIPS[n].includes(c) ? "pip" : ""} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Who go dey Boju? A die in the middle, the six numbers round it: pick yours. Then the die really rolls,
 * lands, the winning number glows and Boju is named (and marked over their head in the game).
 */
export function DicePanel() {
  const g = useGame((s) => s.group);
  const me = useGame((s) => s.me?.id);
  const dice = useGame((s) => s.dice);
  const left = useSecondsLeft(g?.phase_end);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!dice) return;
    setShown(0);
    const id = setInterval(() => setShown((n) => (n < dice.rolls.length ? n + 1 : n)), 420);
    return () => clearInterval(id);
  }, [dice]);
  if (!g || !["dice", "reveal"].includes(g.phase)) return null;
  const nick = (id?: string | null) => g.members.find((m) => m.id === id)?.nick ?? "?";
  const picking = g.phase === "dice";
  const inPool = me ? g.dice_pool.includes(me) : false;
  // who holds which number: live picks while picking; the final numbers (the server fills in anyone who didn't pick)
  const holders: Record<number, string> = {};
  if (picking) for (const m of g.members) { if (m.pick) holders[m.pick] = m.id; }
  else if (dice) for (const [id, n] of Object.entries(dice.numbers)) holders[n] = id;
  const mine = Object.entries(holders).find(([, id]) => id === me)?.[0];
  const timeUp = picking && left <= 0;
  const rolling = !picking && !!dice && shown < dice.rolls.length;
  const face = !picking && dice?.rolls.length ? dice.rolls[Math.max(0, Math.min(shown, dice.rolls.length) - 1)] : null;
  const landed = !picking && !rolling && face != null;
  const autoPicked = !picking && dice && me && dice.numbers[me] && !g.members.find((m) => m.id === me)?.pick;
  return (
    <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center" data-testid="dice">
      <div className="dice-ring anim-pop">
        <div className="dice-title">
          {picking
            ? (timeUp ? "Rolling…" : inPool ? (mine ? "Fingers crossed 🤞🏾" : "Pick your number") : "Others are picking…")
            : landed ? (g.pending_seeker === me ? "Na you dey Boju! 🙈" : `${nick(g.pending_seeker)} dey Boju!`) : "Rolling…"}
          {picking && !timeUp && <span className="dice-time">{left}s</span>}
        </div>
        <Die face={face} rolling={rolling || timeUp} />
        {[1, 2, 3, 4, 5, 6].map((n, i) => {
          const a = ((-90 + i * 60) * Math.PI) / 180;
          const holder = holders[n];
          const win = landed && face === n;
          const canPick = picking && !timeUp && inPool && (!holder || holder === me);
          return (
            <button key={n} data-guide={n === 1 ? "dice" : undefined} disabled={!canPick} aria-label={`Number ${n}`}
              className="dice-num pointer-events-auto" data-mine={holder === me && !!me} data-taken={!!holder && holder !== me} data-win={win}
              style={{ left: `${50 + Math.cos(a) * 37.5}%`, top: `${50 + Math.sin(a) * 37.5}%` }}
              onClick={() => net.send({ t: "g_pick", n })}>
              <b>{n}</b>
              {holder && <small>{holder === me ? "you" : nick(holder).slice(0, 6)}</small>}
            </button>
          );
        })}
        {autoPicked && <div className="dice-note">Time up — we picked {dice?.numbers[me!]} for you</div>}
      </div>
    </div>
  );
}

export function RoundResultPanel() {
  const g = useGame((s) => s.group);
  const me = useGame((s) => s.me?.id);
  const left = useSecondsLeft(g?.phase_end);
  const r = g?.last_result;
  const touring = useGame((s) => !!s.reveal);
  if (!g || g.phase !== "result" || !r || touring) return null; // the hiding-spot tour goes first
  const nick = (id?: string | null) => g.members.find((m) => m.id === id)?.nick ?? "?";
  const mine = me ? r.deltas[me] : undefined;
  return (
    <div className="pointer-events-auto absolute left-1/2 top-1/2 z-30 w-80 max-w-[calc(100%-1rem)] -translate-x-1/2 -translate-y-1/2"><div className="panel anim-pop touch-scroll max-h-[80dvh] overflow-y-auto p-4">
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

const AV_COLORS = ["#2f7cf6", "#30d158", "#ff9f0a", "#bf5af2", "#ff375f", "#64d2ff", "#ffd60a", "#ac8e68"];
function Avatar({ nick, size = 44, ring }: { nick: string; size?: number; ring?: string }) {
  let h = 0;
  for (const ch of nick) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span className="grid shrink-0 place-items-center rounded-full font-black text-white shadow-lg"
      style={{ width: size, height: size, fontSize: size * 0.4, background: `linear-gradient(140deg, ${AV_COLORS[h % 8]}, ${AV_COLORS[(h >> 3) % 8]})`, boxShadow: ring ? `0 0 0 3px ${ring}` : undefined }}>
      {nick.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "🙈"}
    </span>
  );
}

function Confetti() {
  const bits = Array.from({ length: 26 }, (_, i) => i);
  return (
    <div className="confetti pointer-events-none absolute inset-x-0 top-0 h-0" aria-hidden>
      {bits.map((i) => (
        <span key={i} style={{ left: `${(i * 37) % 100}%`, background: AV_COLORS[i % 8], animationDelay: `${(i % 7) * 0.12}s`, animationDuration: `${2.2 + (i % 5) * 0.25}s` }} />
      ))}
    </div>
  );
}

export function GameOverPanel() {
  const over = useGame((s) => s.over);
  const g = useGame((s) => s.group);
  const me = useGame((s) => s.me?.id);
  const set = useGame((s) => s.set);
  const stayed = useGame((s) => s.stayed);
  const mini = useGame((s) => !!s.mini);
  const inArena = useGame((s) => !!s.mapId && s.content?.maps[s.mapId]?.kind === "arena");
  // only at the venue of the game that just ended — never back in Lagos
  if (!over || g?.phase !== "over" || stayed || !inArena) return null;
  const res = over.results;
  const url = `${siteUrl()}/share/${over.gameId}`;
  const winner = res[0];
  const pts = (n: number) => (mini ? `${n.toLocaleString("en-NG")} pts` : nairaShort(n));
  const myRank = res.findIndex((x) => x.id === me);
  const mine = myRank >= 0 ? res[myRank] : null;
  const iWon = myRank === 0;
  const tweet = `I just played Boju Boju in Lagos! ${winner ? `${iWon ? "I" : winner.nick} won ${naira(winner.earned)} 🏆` : ""} Come play:`;
  // fun awards
  const best = (k: "finds" | "survived") => res.reduce<Standing | null>((b, x) => (x[k] > (b?.[k] ?? 0) ? x : b), null);
  const eyes = best("finds"), ninja = best("survived");
  const podium = [res[1], res[0], res[2]].map((x, i) => (x ? { x, place: [2, 1, 3][i] } : null));
  const explore = () => { set({ stayed: true }); if (!mini) useGame.getState().toast("Waka around! The 🚏 bus stop takes you home when you're ready.", "good"); };
  return (
    <div className="anim-fade pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/55 p-3 backdrop-blur-[3px]" data-testid="game-over">
      <div className="panel anim-pop touch-scroll relative max-h-[94%] w-[24rem] max-w-full overflow-y-auto overflow-x-hidden p-4">
        <Confetti />
        <div className="text-center text-[11px] font-bold uppercase tracking-[0.2em] opacity-60">🏁 Game over</div>

        {/* winner hero */}
        {winner && (
          <div className="mt-6 flex flex-col items-center text-center">
            <div className="relative">
              <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-2xl">👑</span>
              <Avatar nick={winner.nick} size={68} ring="#ffd84f" />
            </div>
            <div className="mt-2 text-2xl font-black leading-tight">{iWon ? "You win! 🎉" : `${winner.nick} wins!`}</div>
            <div className="mt-1 rounded-full bg-[#ffd84f]/15 px-3 py-0.5 text-sm font-black text-[#ffd84f]">{pts(winner.earned)}</div>
          </div>
        )}

        {/* podium */}
        {res.length >= 3 && (
          <div className="mt-4 grid grid-cols-3 items-end gap-2">
            {podium.map((p, i) => p ? (
              <div key={p.x.id} className="flex flex-col items-center text-center">
                <Avatar nick={p.x.nick} size={p.place === 1 ? 40 : 34} ring={p.x.id === me ? "var(--accent)" : undefined} />
                <div className="mt-1 w-full truncate text-[12px] font-bold">{p.x.id === me ? "You" : p.x.nick}</div>
                <div className="text-[11px] opacity-70">{pts(p.x.earned)}</div>
                <div className={`mt-1 grid w-full place-items-center rounded-t-xl text-xl font-black ${p.place === 1 ? "h-16 bg-[#ffd84f]/25" : p.place === 2 ? "h-12 bg-white/15" : "h-9 bg-[#c67c48]/25"}`}>
                  {["🥇", "🥈", "🥉"][p.place - 1]}
                </div>
              </div>
            ) : <div key={i} />)}
          </div>
        )}

        {/* your game */}
        {mine && !iWon && (
          <div className="mt-3 rounded-2xl bg-[var(--accent)]/15 p-3">
            <div className="flex items-baseline justify-between">
              <div className="text-sm font-black">You finished #{myRank + 1} of {res.length}</div>
              <div className={`text-sm font-black ${mine.earned >= 0 ? "text-green-400" : "text-red-400"}`}>{mine.earned >= 0 ? "+" : ""}{pts(mine.earned)}</div>
            </div>
          </div>
        )}
        {mine && (
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            {[["🔎", mine.finds, "finds"], ["🥷", mine.survived, "hides"], ["🙈", mine.rounds_as_seeker ?? 0, "as Boju"]].map(([icon, n, label]) => (
              <div key={label as string} className="rounded-xl bg-white/5 py-2">
                <div className="text-lg font-black leading-none">{icon} {n}</div>
                <div className="mt-0.5 text-[10px] uppercase tracking-wide opacity-60">{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* awards */}
        {(eyes || ninja) && (
          <div className="mt-2 flex flex-wrap justify-center gap-1.5 text-[11px] font-semibold">
            {eyes && <span className="rounded-full bg-white/8 px-2.5 py-1">🔎 Sharpest eyes: {eyes.id === me ? "you" : eyes.nick} ({eyes.finds})</span>}
            {ninja && <span className="rounded-full bg-white/8 px-2.5 py-1">🥷 Master hider: {ninja.id === me ? "you" : ninja.nick} ({ninja.survived})</span>}
          </div>
        )}

        {/* everyone else */}
        {(res.length > 3 || res.length === 2) && (
          <div className="mt-3 space-y-1">
            {res.slice(res.length === 2 ? 0 : 3).map((x, i) => (
              <div key={x.id} className={`flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-sm ${x.id === me ? "bg-[var(--accent)]/15" : "bg-white/5"}`}>
                <span className="w-5 text-center text-xs font-bold opacity-60">{res.length === 2 ? ["🥇", "🥈"][i] : i + 4}</span>
                <span className="min-w-0 flex-1 truncate">{x.id === me ? "You" : x.nick}</span>
                <span className="text-xs opacity-70">{pts(x.earned)}</span>
              </div>
            ))}
          </div>
        )}

        {/* actions: one clear next step */}
        <div className="mt-4">
          <PlayAgain />
          <div className="grid grid-cols-2 gap-2">
            <button className="btn btn-ghost" onClick={explore}>🚶🏾 Explore</button>
            <button className="btn btn-ghost" onClick={() => net.send({ t: "g_return" })}>{mini ? "🚌 Motor Park" : "🏠 Go home"}</button>
          </div>
          {mini ? (
            <div className="mt-2 text-center text-[11px] opacity-60">Your best game is on the LagosLife leaderboard · going home? Tap ← at the top.</div>
          ) : (
            <div className="mt-2 flex justify-center gap-4 text-[13px] font-semibold">
              <a className="opacity-80 hover:opacity-100" target="_blank" rel="noopener noreferrer"
                href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}&url=${encodeURIComponent(url)}`}>𝕏 Share</a>
              <button className="opacity-80 hover:opacity-100" onClick={() => screenshot()}>📸 Screenshot</button>
            </div>
          )}
        </div>
      </div>
    </div>
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
  const streaks = useGame((s) => s.streaks);
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
      <div className="ios-section-title">Streaks</div>
      <div className="ios-group">
        <div className="ios-row">
          <span className="ios-glyph bg-[#5e5ce6]">🥷</span>
          <div className="flex-1 text-[15px]">Hide streak <span className="block text-xs opacity-60">rounds in a row nobody found you · best {streaks.bestHide}</span></div>
          <span className="text-lg font-bold tabular-nums">{streaks.hide}</span>
        </div>
        <div className="ios-row">
          <span className="ios-glyph bg-[#ff9f0a]">🏆</span>
          <div className="flex-1 text-[15px]">Win streak <span className="block text-xs opacity-60">games in a row you won · best {streaks.bestWin}</span></div>
          <span className="text-lg font-bold tabular-nums">{streaks.win}</span>
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

/** Change your look any time: male or female, hair, skin and clothes (everyone sees it at once). */
function MyLook() {
  const mine = useGame((s) => (s.me ? Object.values(s.roster).find((r) => r.id === s.me?.id)?.av : undefined));
  const [open, setOpen] = useState(false);
  const [av, setAv] = useState<number[] | null>(null);
  const [busy, setBusy] = useState(false);
  const cur = av ?? fullAvatar(mine ?? [2, 0, 0]);
  const save = async () => {
    const acc = loadAccount();
    if (!acc) return;
    setBusy(true);
    try {
      await saveAvatar(acc, cur);
      useGame.getState().toast("New look saved 🔥", "good");
      setOpen(false);
    } catch (e) {
      useGame.getState().toast((e as Error).message, "error");
    }
    setBusy(false);
  };
  return (
    <>
      <div className="ios-section-title">My look</div>
      <div className="ios-group">
        <button className="ios-row" onClick={() => setOpen(!open)} data-testid="my-look">
          <span className="ios-glyph bg-[#ff9f0a]">👤</span><span className="flex-1 text-left text-[15px]">Change how you look</span><span className="ios-chevron">{open ? "⌄" : "›"}</span>
        </button>
        {open && (
          <div className="anim-fade space-y-3 p-3">
            <AvatarPreview av={cur} className="mx-auto h-48 w-36" />
            <AvatarEditor av={cur} onChange={setAv} />
            <button className="btn btn-primary w-full" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save my look"}</button>
          </div>
        )}
      </div>
    </>
  );
}

export function SettingsPanel() {
  const set = useGame((s) => s.set);
  const openApp = useGame((s) => s.openApp);
  const quality = useGame((s) => s.quality);
  const [prefs, setPrefs] = useState({ ...sound.prefs });
  const [help, setHelp] = useState(false);
  const mini = useGame((s) => !!s.mini);
  const [songVoice, setSongVoiceState] = useState<SongVoice>(() => getSongVoice());
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
      <MyLook />
      <div className="ios-section-title">Controls</div>
      <ControlModePicker bare />
      <div className="ios-section-title">Sound</div>
      <div className="ios-group">
        <div className="ios-row"><span className="ios-glyph bg-[#ff375f]">🔊</span><span className="flex-1 text-[15px]">Sound effects</span><Switch label="Sound effects" on={prefs.sound} onChange={(v) => flip("sound", v)} /></div>
        <div className="ios-row"><span className="ios-glyph bg-[#bf5af2]">🎶</span><span className="flex-1 text-[15px]">Music</span><Switch label="Music" on={prefs.music} onChange={(v) => flip("music", v)} /></div>
      </div>
      <div className="ios-section-title">Boju Boju song (while Boju counts)</div>
      <div className="segmented" data-testid="song-voice">
        {([["auto", "Take turns"], ["male", "Male"], ["female", "Female"], ["off", "Off"]] as [SongVoice, string][]).map(([v, label]) => (
          <button key={v} data-on={songVoice === v} onClick={() => { setSongVoiceState(v); setSongVoice(v); }}>{label}</button>
        ))}
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
        <button className="ios-row" onClick={() => { useGame.getState().closePhone(); set({ howTo: true }); }}><span className="ios-glyph bg-[#2f7cf6]">❓</span><span className="text-[15px]">How to play</span><span className="ios-chevron">›</span></button>
        <button className="ios-row" onClick={() => setHelp(!help)}><span className="ios-glyph bg-[#64748b]">🎮</span><span className="text-[15px]">Controls & tips</span><span className="ios-chevron">{help ? "⌄" : "›"}</span></button>
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

/** Play again = ask the others for a rematch; it starts if at least one of them accepts. */
function PlayAgain() {
  const r = useGame((s) => s.rematch);
  useTicker(500);
  const left = r ? Math.max(0, Math.ceil((r.until - Date.now()) / 1000)) : 0;
  if (r?.kind === "waiting") {
    return (
      <div className="mb-2 rounded-2xl bg-white/10 p-2.5 text-center text-sm" data-testid="rematch-wait">
        ⏳ Rematch request sent to {r.n} player{r.n === 1 ? "" : "s"} — waiting {left}s
        <div className="text-[11px] opacity-70">It starts if anyone accepts. No one? No rematch.</div>
      </div>
    );
  }
  return (
    <>
      <button className="btn btn-primary mb-2 w-full text-lg" data-testid="play-again" onClick={() => net.send({ t: "g_rematch" })}>
        {r?.kind === "asked" ? `✅ Accept @${r.nick}'s rematch` : "🔁 Play again"}
      </button>
      {!r && <div className="-mt-1 mb-2 text-center text-[11px] opacity-70">Asks the other players for a rematch — it&apos;s on if anyone accepts</div>}
    </>
  );
}
