"use client";

import { useEffect, useRef, useState } from "react";
import { sound } from "@/game/sound";
import { cam, input, local, remotes, sample } from "@/game/state";
import { naira } from "@/lib/api";
import { net } from "@/lib/net";
import { useGame } from "@/lib/store";
import { fmtTime, useMap, useRole, useSecondsLeft, useTicker, useWhere } from "./hooks";

export function TopBar() {
  const balance = useGame((s) => s.balance);
  const hunger = useGame((s) => s.hunger);
  const connected = useGame((s) => s.connected);
  const set = useGame((s) => s.set);
  const unread = useGame((s) => s.unread);
  const group = useGame((s) => s.group);
  useTicker(200);
  const stamina = local.stamina / 5;
  return (
    <div className="pointer-events-auto absolute left-2 right-2 top-2 z-20 flex items-start justify-between gap-2">
      <div className="panel flex min-w-0 items-center gap-2.5 px-3 py-2">
        <button onClick={() => set({ panel: "wallet" })} className="text-left">
          <div className="text-base font-black leading-none text-[var(--accent)] sm:text-lg">{naira(balance)}</div>
          <div className="text-[10px] opacity-70 max-sm:hidden">in-game naira · not real money</div>
        </button>
        <div className="w-14 sm:w-20">
          <div className="text-[10px] opacity-80">Belle {Math.round(hunger)}%</div>
          <div className="h-1.5 rounded bg-white/15"><div className="h-1.5 rounded bg-[var(--clay)]" style={{ width: `${hunger}%` }} /></div>
          <div className="mt-1 h-1 rounded bg-white/15"><div className="h-1 rounded bg-sky-300" style={{ width: `${stamina * 100}%` }} /></div>
        </div>
        <span title={connected ? "Online" : "Reconnecting"} className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-green-400" : "animate-pulse bg-red-500"}`} />
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button className="btn btn-primary relative h-10 px-3 text-sm sm:px-4" onClick={() => set({ panel: "group" })}>
          {group ? `🙈 ${group.code}` : "Play Boju"}
        </button>
        <button aria-label="Chat" className="btn btn-ghost relative grid h-10 w-10 place-items-center p-0" onClick={() => set({ chatOpen: true, unread: 0 })}>
          💬{unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1.5 text-[10px]">{unread}</span>}
        </button>
        <button aria-label="Leaderboards" className="btn btn-ghost grid h-10 w-10 place-items-center p-0 max-sm:hidden" onClick={() => set({ panel: "leaders" })}>🏆</button>
        <button aria-label="Settings" className="btn btn-ghost grid h-10 w-10 place-items-center p-0" onClick={() => set({ panel: "settings" })}>⚙️</button>
      </div>
    </div>
  );
}

export function PhaseBar() {
  const g = useGame((s) => s.group);
  const me = useGame((s) => s.me?.id);
  const left = useSecondsLeft(g?.phase_end);
  const { section } = useWhere();
  // last-10-seconds countdown ticks while hiding/seeking
  const lastTick = useRef(-1);
  useEffect(() => {
    if (g && (g.phase === "hide" || g.phase === "seek") && left > 0 && left <= 10 && left !== lastTick.current) {
      lastTick.current = left;
      sound.play("tick");
    }
  }, [left, g]);
  const map = useMap();
  const myHome = useGame((s) => s.home);
  if (!g || g.phase === "lobby") {
    const inside = local.insideHome;
    const homeLabel = inside ? (inside === myHome?.id ? `🏠 Your house · ${myHome.name} — walk out the door to explore` : "🏠 Neighbour's house") : null;
    const label = homeLabel ?? (section ? `📍 ${section.name}` : null);
    return label ? <div className="panel absolute left-1/2 top-[3.9rem] z-10 max-w-[88vw] -translate-x-1/2 truncate px-3 py-1 text-center text-xs">{label}</div> : null;
  }
  const r = g.round;
  const nick = (id?: string | null) => g.members.find((m) => m.id === id)?.nick ?? "?";
  const labels: Record<string, string> = {
    travel: "Travel to the arena", dice: "Pick a number", reveal: "Dice don talk!", hide: "Hide!", seek: "Seek!", result: "Round result", over: "Game over",
  };
  const hiding = r ? Object.values(r.state).filter((s) => s === "hiding").length : 0;
  const safeTotal = useGame.getState().content?.config.game.safe_house_total_s ?? 20;
  const safeLeft = r && me && r.safe.includes(me) ? Math.max(0, safeTotal - (r.safe_used[me] ?? 0)) : null;
  const safeName = map?.safe_houses.find((s) => s.id === g.settings.safe)?.name;
  return (
    <div className="panel absolute left-1/2 top-[3.9rem] z-10 w-max max-w-[92vw] -translate-x-1/2 px-4 py-1.5 text-center">
      <div className="text-sm font-bold">
        {labels[g.phase]} {g.phase !== "over" && <span className="tabular-nums text-[var(--accent)]">{fmtTime(left)}</span>}
      </div>
      {r && ["hide", "seek"].includes(g.phase) && (
        <div className="text-[11px] opacity-90">
          Round {r.no}{r.final ? " (final)" : ""} · Boju: {nick(r.seeker)} · Found {r.found.length} · Hiding {hiding}
          {safeName && <> · Safe: {safeName}</>}
        </div>
      )}
      {safeLeft !== null && <div className="text-xs font-bold text-green-400">🏠 Safe — {safeLeft.toFixed(0)}s left</div>}
      {section && <div className="text-[10px] opacity-70">📍 {section.name}</div>}
    </div>
  );
}

export function ActionButtons() {
  const { isSeeker, inGame, myState } = useRole();
  const g = useGame((s) => s.group);
  const emotes = useGame((s) => s.content?.config.emotes ?? []);
  const [crouch, setCrouch] = useState(false);
  const [wheel, setWheel] = useState(false);
  const canTag = isSeeker && g?.phase === "seek";
  const canTaunt = !isSeeker && (!inGame || (g?.phase === "seek" && myState === "hiding"));
  const hold = (v: boolean) => () => { input.runHeld = v; };
  const aerial = useGame((s) => s.aerial);
  const set = useGame((s) => s.set);
  // Boju can't use the aerial view while counting or seeking — that would be cheating.
  const canAerial = !(isSeeker && inGame);
  const toggleAerial = () => {
    const on = !cam.aerial.on;
    cam.aerial.on = on;
    if (on) Object.assign(cam.aerial, { x: local.x, z: local.z, h: 55 });
    set({ aerial: on });
    sound.play("pop");
  };
  return (
    <div className="pointer-events-auto absolute bottom-6 right-3 z-20 flex flex-col items-end gap-2">
      {wheel && (
        <div className="panel grid grid-cols-2 gap-1 p-2">
          {emotes.map((e) => (
            <button key={e.id} className="btn btn-ghost text-sm" onClick={() => { net.send({ t: "emote", id: e.id }); setWheel(false); }}>{e.text}</button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        {canTaunt && <button className="btn btn-ghost h-14 w-14 rounded-full text-xl" onClick={() => setWheel(!wheel)}>😜</button>}
        {canAerial && (
          <button aria-label="Aerial view" className={`btn h-12 w-12 rounded-full sm:h-14 sm:w-14 text-[11px] leading-tight ${aerial ? "btn-primary" : "btn-ghost"}`} onClick={toggleAerial}>
            🛰️<br />{aerial ? "Back" : "Aerial"}
          </button>
        )}
        {!aerial && (
          <>
            <button
              className={`btn h-12 w-12 rounded-full sm:h-14 sm:w-14 text-[11px] leading-tight ${crouch ? "btn-leaf" : "btn-ghost"}`}
              onClick={() => { input.crouchToggle = !crouch; setCrouch(!crouch); }}
            >🧎<br />{crouch ? "Stand" : "Bend"}</button>
            <button
              className="btn btn-ghost h-14 w-14 rounded-full text-[11px] leading-tight"
              onPointerDown={hold(true)} onPointerUp={hold(false)} onPointerLeave={hold(false)} onPointerCancel={hold(false)} onLostPointerCapture={hold(false)}
            >🏃🏾<br />Run</button>
          </>
        )}
      </div>
      {canTag && (
        <button className="btn h-20 w-20 rounded-full bg-[var(--clay)] text-lg font-black text-white shadow-lg" onClick={() => net.send({ t: "g_tag" })}>
          BOJU!
        </button>
      )}
    </div>
  );
}

/** Shops and the bus stop appear when you walk into their zone. */
export function ZonePanel() {
  const { zone } = useWhere();
  const cfg = useGame((s) => s.content?.config);
  const g = useGame((s) => s.group);
  const balance = useGame((s) => s.balance);
  const me = useGame((s) => s.me?.id);
  if (!zone || !cfg) return null;
  if (zone.kind === "food") {
    const items = cfg.items.filter((i) => i.spot === zone.id);
    return (
      <div className="pointer-events-auto absolute bottom-28 left-1/2 z-20 w-72 -translate-x-1/2"><div className="panel anim-rise p-3">
        <div className="mb-2 font-bold">🍽️ {zone.name}</div>
        {items.map((i) => (
          <button key={i.id} disabled={balance < i.price} className="btn btn-ghost mb-1 flex w-full justify-between text-sm"
            onClick={() => net.send({ t: "buy", item: i.id, key: crypto.randomUUID() })}>
            <span>{i.name} <span className="opacity-60">+{i.hunger}% belle</span></span><span className="text-[var(--accent)]">{naira(i.price)}</span>
          </button>
        ))}
      </div></div>
    );
  }
  if (zone.kind === "bus_stop") {
    const boarded = g?.members.find((m) => m.id === me)?.boarded;
    return (
      <div className="pointer-events-auto absolute bottom-28 left-1/2 z-20 w-72 -translate-x-1/2"><div className="panel anim-rise p-3">
        <div className="mb-1 font-bold">🚌 Motor Park</div>
        {g?.phase === "travel" && !boarded ? (
          (cfg.cities.find((c) => c.arenas.includes(g.settings.arena))?.fares ?? cfg.fares).map((f) => (
            <button key={f.id} disabled={balance < f.price} className="btn btn-primary mb-1 flex w-full justify-between" onClick={() => net.send({ t: "g_board", fare: f.id })}>
              <span>Board {f.name}</span><span>{naira(f.price)}</span>
            </button>
          ))
        ) : (
          <div className="text-xs opacity-80">Rides to the arena leave when your group starts a game.</div>
        )}
      </div></div>
    );
  }
  return null;
}

export function Minimap() {
  const ref = useRef<HTMLCanvasElement>(null);
  const map = useMap();
  const g = useGame((s) => s.group);
  useEffect(() => {
    if (!map) return;
    const draw = () => {
      const c = ref.current;
      const ctx = c?.getContext("2d");
      if (!c || !ctx) return;
      const [x0, z0, x1, z1] = map.bounds;
      const S = c.width / Math.max(x1 - x0, z1 - z0);
      const px = (x: number) => (x - x0) * S, pz = (z: number) => (z - z0) * S;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.fillStyle = "rgba(0,0,0,.45)";
      ctx.fillRect(0, 0, (x1 - x0) * S, (z1 - z0) * S);
      ctx.fillStyle = "rgba(255,255,255,.55)";
      for (const p of map.props) {
        const cl = p.collider;
        if (cl) ctx.fillRect(px(cl[0]), pz(cl[1]), Math.max(1, (cl[2] - cl[0]) * S), Math.max(1, (cl[3] - cl[1]) * S));
      }
      for (const z of map.zones) {
        ctx.fillStyle = z.kind === "bus_stop" ? "#f7c500" : "#ff7a1a";
        ctx.fillRect(px(z.rect[0]), pz(z.rect[1]), (z.rect[2] - z.rect[0]) * S, (z.rect[3] - z.rect[1]) * S);
      }
      const safe = map.safe_houses.find((s) => s.id === g?.settings.safe);
      if (safe) {
        ctx.fillStyle = "rgba(57,211,83,.7)";
        ctx.fillRect(px(safe.rect[0]), pz(safe.rect[1]), (safe.rect[2] - safe.rect[0]) * S, (safe.rect[3] - safe.rect[1]) * S);
      }
      ctx.fillStyle = "#7dd3fc";
      for (const n of remotes.keys()) {
        const s = sample(n);
        if (s) ctx.fillRect(px(s.x) - 2, pz(s.z) - 2, 4, 4);
      }
      ctx.fillStyle = "#66a8ff";
      ctx.beginPath();
      ctx.arc(px(local.x), pz(local.z), 3.5, 0, Math.PI * 2);
      ctx.fill();
    };
    const id = setInterval(draw, 200);
    return () => clearInterval(id);
  }, [map, g?.settings.safe]);
  return <canvas ref={ref} width={110} height={110} className="pointer-events-none absolute bottom-6 left-3 z-10 rounded-lg opacity-90 max-sm:hidden" />;
}

export function Toasts() {
  const toasts = useGame((s) => s.toasts);
  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-[60] flex w-[min(24rem,92vw)] -translate-x-1/2 flex-col items-center gap-1.5">
      {toasts.map((t) => (
        <div key={t.id} className="panel anim-banner flex w-full items-center gap-2.5 px-3 py-2 text-sm font-semibold">
          <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-base ${t.kind === "error" ? "bg-[var(--clay)]" : t.kind === "good" ? "bg-[var(--leaf)]" : "bg-[var(--accent)]"}`}>
            {t.kind === "error" ? "!" : t.kind === "good" ? "✓" : "🙈"}
          </span>
          <span className="leading-snug">{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

export function BlindOverlay() {
  const { isSeeker } = useRole();
  const g = useGame((s) => s.group);
  const left = useSecondsLeft(g?.phase_end);
  if (!isSeeker || g?.phase !== "hide") return null;
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black text-center">
      <div className="text-3xl font-black text-[var(--accent)]">Boju Boju…</div>
      <div className="mt-2 text-lg">Counting… eyes closed 🙈</div>
      <div className="mt-4 text-6xl font-black tabular-nums">{left}</div>
    </div>
  );
}

/** Hiders get a compass to the safe house during hide/seek (points relative to the camera). */
export function SafeCompass() {
  useTicker(100);
  const g = useGame((s) => s.group);
  const me = useGame((s) => s.me?.id);
  const map = useMap();
  const r = g?.round;
  if (!g || !r || !me || !map || !["hide", "seek"].includes(g.phase) || r.seeker === me || r.state[me] !== "hiding") return null;
  const safe = map.safe_houses.find((s) => s.id === g.settings.safe);
  if (!safe) return null;
  const sx = (safe.rect[0] + safe.rect[2]) / 2, sz = (safe.rect[1] + safe.rect[3]) / 2;
  const dist = Math.hypot(sx - local.x, sz - local.z);
  const inside = r.safe.includes(me);
  const rel = Math.atan2(sx - local.x, sz - local.z) - (cam.yaw + Math.PI);
  return (
    <div className="panel anim-rise pointer-events-none absolute bottom-28 left-3 z-20 flex items-center gap-2 px-3 py-2 max-sm:bottom-40">
      <span className="grid h-9 w-9 place-items-center rounded-full bg-[var(--leaf)]/25">
        <span className="text-lg transition-transform duration-150" style={{ transform: `rotate(${-rel}rad)` }}>{inside ? "🏠" : "⬆️"}</span>
      </span>
      <span className="text-xs leading-tight">
        <span className="block font-bold">{inside ? "You're safe!" : safe.name}</span>
        <span className="opacity-75">{inside ? "Time is ticking…" : `${Math.round(dist)} m away`}</span>
      </span>
    </div>
  );
}
