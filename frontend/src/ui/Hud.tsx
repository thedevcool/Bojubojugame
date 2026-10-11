"use client";

import { useEffect, useRef, useState } from "react";
import { sound } from "@/game/sound";
import { cam, input, local, remotes, sample } from "@/game/state";
import { buyPhone, loadAccount, naira, nairaShort } from "@/lib/api";
import { net } from "@/lib/net";
import { useGame } from "@/lib/store";
import { fmtTime, useMap, useRole, useSecondsLeft, useTicker, useWhere } from "./hooks";

export function TopBar() {
  const balance = useGame((s) => s.balance);
  const hunger = useGame((s) => s.hunger);
  const connected = useGame((s) => s.connected);
  const openApp = useGame((s) => s.openApp);
  const badge = useGame((s) => s.unread + s.dmUnread + s.friendReqs);
  const group = useGame((s) => s.group);
  const phoneId = useGame((s) => s.life.phoneId);
  const onboard = useGame((s) => s.onboard);
  const phone = useGame((s) => s.content?.config.phones.find((p) => p.id === s.life.phoneId));
  useTicker(200);
  const stamina = local.stamina / 5;
  return (
    <div className="pointer-events-auto absolute left-2 right-2 top-2 z-20 flex items-start justify-between gap-2">
      <div className="panel flex min-w-0 items-center gap-2.5 px-3 py-2">
        <button onClick={() => openApp("wallet")} className="text-left">
          <div className="text-base font-black leading-none text-[var(--accent)] sm:text-lg" title={naira(balance)}>{nairaShort(balance)}</div>
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
        {group && (
          <button className="btn btn-primary h-10 px-3 text-sm" onClick={() => openApp("boju")}>🙈 {group.code}</button>
        )}
        <button aria-label="Phone" onClick={() => openApp(null)}
          className={`relative grid h-12 w-9 place-items-center rounded-[10px] border-2 bg-[#0a1324] text-lg shadow-lg transition active:scale-90 ${onboard === "launch" ? "phone-nudge" : ""}`}
          style={{ borderColor: phone?.color ?? "rgba(255,255,255,.35)" }}>
          <span className="absolute top-1 h-1 w-3 rounded-full bg-white/30" />
          {phoneId ? "📱" : "🎒"}
          {badge > 0 && <span className="absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full bg-red-500 px-1 text-[10px] font-bold">{badge}</span>}
        </button>
      </div>
    </div>
  );
}

export function PhaseBar() {
  const g = useGame((s) => s.group);
  const me = useGame((s) => s.me?.id);
  const left = useSecondsLeft(g?.phase_end);
  const { section } = useWhere();
  const { isSeeker } = useRole();
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
  const onboarding = useGame((s) => s.onboard !== null);
  if (g?.phase === "over" && map?.kind === "arena") {
    return <div className="panel absolute left-1/2 top-[3.9rem] z-10 max-w-[88vw] -translate-x-1/2 truncate px-3 py-1 text-center text-xs">🏁 Game over · free to explore — 🚌 the bus stop takes you home</div>;
  }
  if (!g && onboarding) return null; // the tour banner sits here
  if (!g || g.phase === "lobby") {
    const inside = local.insideHome;
    const homeLabel = inside ? (inside === myHome?.id ? `🏠 Your house · ${myHome.name} — walk out the door to explore` : "🏠 Neighbour's house") : null;
    const label = homeLabel ?? (section ? `📍 ${section.name}` : null);
    return label ? <div className="panel absolute left-1/2 top-[3.9rem] z-10 max-w-[88vw] -translate-x-1/2 truncate px-3 py-1 text-center text-xs">{label}</div> : null;
  }
  const r = g.round;
  const nick = (id?: string | null) => g.members.find((m) => m.id === id)?.nick ?? "?";
  const labels: Record<string, string> = {
    travel: "Travel to the arena", gather: "Gather inside the circle", dice: "Pick a number", reveal: "Dice don talk!", hide: "Hide!", seek: "Seek!", result: "Round result", over: "Game over",
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
      {g.phase === "gather" && g.gather && (
        <div className="text-[11px] opacity-90">⭕ {g.gather.in.length}/{g.members.filter((m) => !m.left && !m.retired).length} in the circle — the dice roll when everybody is in</div>
      )}
      {isSeeker && g.phase === "seek" && <div className="text-[11px] font-semibold text-[var(--accent)]">Reach a hider to catch them — no button needed</div>}
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
  const crouch = useGame((s) => s.bend);
  const setBend = useGame((s) => s.setBend);
  const sitting = useGame((s) => s.sitting);
  const [wheel, setWheel] = useState(false);
  const canTaunt = !isSeeker && (!inGame || (g?.phase === "seek" && myState === "hiding"));
  const hold = (v: boolean) => () => { input.runHeld = v; };
  const aerial = useGame((s) => s.aerial);
  const set = useGame((s) => s.set);
  // Boju can't use the aerial view while counting or seeking — that would be cheating.
  const canAerial = !(isSeeker && inGame);
  const toggleAerial = () => {
    const on = !cam.aerial.on;
    cam.aerial.on = on;
    if (on) Object.assign(cam.aerial, { x: local.x, z: local.z, h: 40, tx: local.x, tz: local.z, th: 55, vx: 0, vz: 0, drag: false });
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
            {!inGame && (
              <button aria-label="Sit"
                className={`btn h-12 w-12 rounded-full sm:h-14 sm:w-14 text-[11px] leading-tight ${sitting ? "btn-leaf" : "btn-ghost"}`}
                onClick={() => {
                  const on = !sitting;
                  if (on) { setBend(false); local.path = []; }
                  local.sit = on;
                  set({ sitting: on });
                }}
              >🪑<br />{sitting ? "Stand" : "Sit"}</button>
            )}
            <button
              className={`btn h-12 w-12 rounded-full sm:h-14 sm:w-14 text-[11px] leading-tight ${crouch ? "btn-leaf" : "btn-ghost"}`}
              onClick={() => { setBend(!crouch); if (!crouch) set({ sitting: false }); }}
            >🧎<br />{crouch ? "Stand" : "Bend"}</button>
            <button
              className="btn btn-ghost h-14 w-14 rounded-full text-[11px] leading-tight"
              onPointerDown={hold(true)} onPointerUp={hold(false)} onPointerLeave={hold(false)} onPointerCancel={hold(false)} onLostPointerCapture={hold(false)}
            >🏃🏾<br />Run</button>
          </>
        )}
      </div>
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
  const home = useGame((s) => s.home);
  const map = useMap();
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
  if (zone.kind === "phone_shop") return <PhoneShop />;
  if (zone.kind === "bus_stop" && map?.kind === "arena") {
    return (
      <div className="pointer-events-auto absolute bottom-28 left-1/2 z-20 w-72 -translate-x-1/2"><div className="panel anim-rise p-3">
        <div className="mb-1 font-bold">🚏 Bus stop</div>
        {g?.phase === "over" ? (
          <>
            <button className="btn btn-primary mb-1 w-full" onClick={() => net.send({ t: "g_return" })}>🏠 Ride home</button>
            <div className="text-xs opacity-70">Free ride back to Lagos — your house{home ? ` (${home.name})` : " / the Motor Park"}.</div>
          </>
        ) : (
          <div className="text-xs opacity-80">Buses go home once the game is over. Play on! 🙈</div>
        )}
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

/** The phone shop beside the newcomer spawn: pick any phone (in-game naira). */
export function PhoneShop() {
  const phones = useGame((s) => s.content?.config.phones ?? []);
  const balance = useGame((s) => s.balance);
  const mine = useGame((s) => s.life.phoneId);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = phones.find((p) => p.id === (pick ?? mine ?? phones[0]?.id));
  const buy = async () => {
    const acc = loadAccount();
    if (!acc || !chosen) return;
    setBusy(true);
    try {
      await buyPhone(acc, chosen.id);
      const st = useGame.getState();
      st.set({ life: { ...st.life, phoneId: chosen.id }, ...(st.onboard === "phone" ? { onboard: "launch", guide: null } : {}) });
      st.toast(`📱 ${chosen.name} is yours! Tap the phone (top right) to launch it.`, "good");
      sound.play("coin");
    } catch (e) {
      useGame.getState().toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  if (!chosen) return null;
  return (
    <div className="pointer-events-auto absolute bottom-24 left-1/2 z-20 w-[min(22rem,94vw)] -translate-x-1/2"><div className="panel anim-sheet p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <div className="font-black">📱 Tini Tech</div>
        <div className="text-[10px] opacity-60">in-game naira only</div>
      </div>
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {phones.map((p, i) => (
          <button key={p.id} onClick={() => setPick(p.id)} data-on={chosen.id === p.id}
            className="choice anim-rise flex w-24 shrink-0 flex-col items-center gap-1 p-2" style={{ animationDelay: `${i * 50}ms` }}>
            <span className="relative grid h-16 w-9 place-items-center rounded-[9px] border-[3px] bg-gradient-to-b from-[#2f7cf6] to-[#0a1324] text-xs transition-transform"
              style={{ borderColor: p.color, transform: chosen.id === p.id ? "translateY(-4px) rotate(-6deg)" : undefined }}>
              <span className="absolute top-1 h-1 w-3 rounded-full bg-black/60" />🙈
            </span>
            <span className="text-xs font-bold leading-tight">{p.name}</span>
            <span className="text-[11px] text-[var(--accent)]">{nairaShort(p.price)}</span>
          </button>
        ))}
      </div>
      <div className="mb-2 text-xs opacity-80">{chosen.tagline}</div>
      {mine === chosen.id ? (
        <div className="text-center text-sm font-bold text-green-400">✓ You own this phone</div>
      ) : (
        <button className="btn btn-primary w-full" disabled={busy || balance < chosen.price} onClick={buy}>
          {balance < chosen.price ? "Your money no reach" : `${mine ? "Upgrade to" : "Buy"} ${chosen.name} · ${naira(chosen.price)}`}
        </button>
      )}
    </div></div>
  );
}
