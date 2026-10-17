"use client";

import { GAME_ONLY } from "@/lib/scope";
import { useEffect, useRef, useState } from "react";
import { sound } from "@/game/sound";
import { cam, input, local, remotes, sample } from "@/game/state";
import { buyCar, buyFurniture, buyPhone, loadAccount, naira, nairaShort } from "@/lib/api";
import { ITEM_ICON } from "@/game/furniture";
import { bedNear } from "@/game/seats";
import { startDecorating } from "./decorStart";
import { gamesPlayed, useTip } from "./Coach";
import dynamic from "next/dynamic";
const FurniturePreview = dynamic(() => import("@/game/Previews").then((m) => m.FurniturePreview), { ssr: false });
const CarPreview = dynamic(() => import("@/game/Previews").then((m) => m.CarPreview), { ssr: false });
import { net } from "@/lib/net";
import { useGame } from "@/lib/store";
import { fmtTime, useMap, useRole, useSecondsLeft, useTicker, useWhere } from "./hooks";

export function TopBar() {
  const balance = useGame((s) => s.balance);
  const streaks = useGame((s) => s.streaks);
  const connected = useGame((s) => s.connected);
  const openApp = useGame((s) => s.openApp);
  const badge = useGame((s) => s.unread + s.dmUnread + s.friendReqs);
  const group = useGame((s) => s.group);
  const phoneId = useGame((s) => s.life.phoneId);
  const onboard = useGame((s) => s.onboard);
  const phoneOpenNow = useGame((s) => s.phoneOpen);
  const phone = useGame((s) => s.content?.config.phones.find((p) => p.id === s.life.phoneId));
  const mini = useGame((s) => s.mini);
  useTicker(200);
  const stamina = local.stamina / 5;
  return (
    <div className="pointer-events-auto absolute left-2 right-2 top-2 z-20 flex items-start justify-between gap-2">
      <div className="panel flex min-w-0 items-center gap-2.5 px-3 py-2">
        {mini ? (
          <div className="min-w-0 text-left">
            <div className="truncate text-sm font-black leading-tight">🙈 {mini.name}</div>
            <div className="truncate text-[10px] leading-tight opacity-70">Boju Boju{mini.mode === "test" ? " · TEST" : ""}</div>
          </div>
        ) : (
          <button onClick={() => openApp("wallet")} className="text-left">
            <div className="text-base font-black leading-none text-[var(--accent)] sm:text-lg" title={naira(balance)}>{nairaShort(balance)}</div>
            <div className="text-[10px] opacity-70 max-sm:hidden">in-game naira · not real money</div>
          </button>
        )}
        {/* money (above) and streaks: hide streak (rounds in a row not found) and win streak (games in a row won) */}
        <div className="flex shrink-0 items-center gap-1 text-[11px] font-bold tabular-nums" title="Hide streak · win streak">
          <span className="rounded-full bg-white/10 px-1.5 py-0.5">🥷 {streaks.hide}</span>
          <span className="rounded-full bg-white/10 px-1.5 py-0.5">🏆 {streaks.win}</span>
        </div>
        <span title={connected ? "Online" : "Reconnecting"} className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-green-400" : "animate-pulse bg-red-500"}`} />
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {group && (
          <button className="btn btn-primary h-10 px-3 text-sm" onClick={() => openApp("boju")}>🙈 {group.code}</button>
        )}
        <button aria-label="Phone" onClick={() => openApp(null)}
          className={`relative grid h-12 w-9 place-items-center rounded-[10px] border-2 bg-[#0a1324] text-lg shadow-lg transition active:scale-90 ${onboard === "house" && !phoneOpenNow ? "phone-nudge" : ""}`}
          style={{ borderColor: phone?.color ?? "rgba(255,255,255,.35)" }}>
          <span className="absolute top-1 h-1 w-3 rounded-full bg-white/30" />
          {phoneId || mini ? "📱" : "🎒"}
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
  const onboarding = useGame((s) => s.onboard !== null); // the tour card sits where the location pill goes
  const tip = useTip();
  const guiding = useGame((s) => s.gameGuide === "on");
  const newPlayer = gamesPlayed() < 3;
  // the card says what's new, then tucks itself into a small ⓘ after a few seconds (tap to open or close it)
  const [open, setOpen] = useState(true);
  const tipKey = tip?.key ?? "";
  useEffect(() => {
    setOpen(true);
    if (!tipKey || tipKey === "lobby-host") return; // the host needs the lobby card until they start
    const id = setTimeout(() => setOpen(false), newPlayer ? 9000 : 6000);
    return () => clearTimeout(id);
  }, [tipKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (g?.phase === "over" && map?.kind === "arena") {
    return <Fleeting id="over" text={`🏁 Game over · ${useGame.getState().mini ? "🚌 the bus stop takes you back to the Motor Park" : "free to explore — 🚌 the bus stop takes you home"}`} />;
  }
  if (!g && onboarding) return null; // the tour's welcome orbit
  if (!g) {
    const inside = local.insideHome;
    const homeLabel = inside ? (inside === myHome?.id ? `🏠 Your house · ${myHome.name} — walk out the door to explore` : "🏠 Neighbour's house") : null;
    const label = homeLabel ?? (section ? `📍 ${section.name}` : null);
    return label ? <Fleeting id={label} text={label} /> : null;
  }
  if (guiding && g.phase !== "over") return null; // the guide card is the Coach (with the timer) while it runs
  if (g.phase === "dice" || g.phase === "reveal") return null; // the dice screen says it all (and has the timer)
  const r = g.round;
  const nick = (id?: string | null) => g.members.find((m) => m.id === id)?.nick ?? "?";
  const hiding = r ? Object.values(r.state).filter((s) => s === "hiding").length : 0;
  const safeTotal = useGame.getState().content?.config.game.safe_house_total_s ?? 20;
  const safeLeft = r && me && r.safe.includes(me) ? Math.max(0, safeTotal - (r.safe_used[me] ?? 0)) : null;
  const timed = g.phase !== "over" && g.phase !== "lobby";
  const live = r && ["hide", "seek"].includes(g.phase);
  // the timer bar is also the Coach: what to do right now, for your role (more detail for new players)
  const detail = newPlayer || live || g.phase === "lobby";
  if (!open) {
    // tucked away: a small round ⓘ (with the timer) that opens the full card again
    return (
      <button className="coach-dot pointer-events-auto absolute left-2 top-[3.9rem] z-10 flex items-center gap-1.5" data-testid="coach-dot" aria-label="What to do now"
        onClick={() => setOpen(true)}>
        <span className="relative grid h-10 w-10 place-items-center rounded-full bg-[#0a1324]/75 text-xl shadow-[inset_0_0_0_1.5px_rgba(148,180,255,.35)] backdrop-blur-md">
          {tip?.icon ?? "ⓘ"}
          <span className="absolute -right-0.5 -top-0.5 grid h-4 w-4 place-items-center rounded-full bg-[var(--accent)] text-[10px] font-black italic text-black">i</span>
        </span>
        {timed && <span className="rounded-full bg-[#0a1324]/75 px-2 py-0.5 text-sm font-black tabular-nums text-[var(--accent)] backdrop-blur-md">{fmtTime(left)}</span>}
        {safeLeft !== null && <span className="rounded-full bg-green-500/80 px-2 py-0.5 text-xs font-bold">🟢 {safeLeft.toFixed(0)}s</span>}
      </button>
    );
  }
  return (
    <div className="panel pointer-events-auto absolute left-1/2 top-[3.9rem] z-10 flex w-[min(26rem,calc(100vw-1rem))] -translate-x-1/2 items-center gap-2.5 px-3 py-2" data-testid="coach"
      onClick={() => setOpen(false)}>
      {tip && <span key={tip.key} className="anim-pop grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--accent)]/25 text-2xl leading-none">{tip.icon}</span>}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[15px] font-black leading-tight">{tip?.text ?? g.phase}</span>
          {timed && <span className="shrink-0 font-black tabular-nums text-[var(--accent)]">{fmtTime(left)}</span>}
        </div>
        {tip?.sub && detail && <div className="line-clamp-2 text-[12px] leading-snug opacity-80">{tip.sub}</div>}
        {g.phase === "gather" && g.gather && (
          <div className="text-[11px] opacity-70">⭕ {g.gather.in.length}/{g.members.filter((m) => !m.left && !m.retired).length} in the circle</div>
        )}
        {live && <div className="truncate text-[10.5px] opacity-60">Round {r.no}{r.final ? " (final)" : ""} · Boju: {nick(r.seeker)} · Found {r.found.length} · Hiding {hiding}</div>}
        {safeLeft !== null && <div className="text-xs font-bold text-green-400">🟢 Safe — {safeLeft.toFixed(0)}s left</div>}
      </div>
    </div>
  );
}

/** A small note at the top that shows for a few seconds when it changes, then gets out of the way. */
function Fleeting({ id, text }: { id: string; text: string }) {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    setShown(true);
    const t = setTimeout(() => setShown(false), 4500);
    return () => clearTimeout(t);
  }, [id]);
  if (!shown) return null;
  return <div className="panel anim-fade absolute left-1/2 top-[3.9rem] z-10 max-w-[88vw] -translate-x-1/2 truncate px-3 py-1 text-center text-xs">{text}</div>;
}

/**
 * Run: tap to keep running (tap again to walk), or hold it down. The ring is your breath:
 * it drains while you run and refills while you walk; out of breath, you slow to a walk.
 */
function RunButton() {
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 150); return () => clearInterval(id); }, []);
  const max = useGame((s) => s.content?.config.movement.stamina_max_s ?? 5);
  const downAt = useRef(0);
  const on = input.runToggle || input.runHeld;
  const p = Math.max(0, Math.min(1, local.stamina / max));
  const release = () => { input.runHeld = false; };
  return (
    <button aria-label="Run" aria-pressed={on} data-guide="run" className="ctl ctl-lg ctl-ring" data-on={on} data-tired={p < 0.2}
      style={{ "--p": p } as React.CSSProperties}
      onPointerDown={(e) => { downAt.current = performance.now(); input.runHeld = true; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ } }}
      onPointerUp={() => { if (performance.now() - downAt.current < 300) input.runToggle = !input.runToggle; release(); }}
      onPointerCancel={release} onLostPointerCapture={release} onContextMenu={(e) => e.preventDefault()}
    ><span className="ic">🏃🏾</span><span className="lb">{on ? "Running" : "Run"}</span></button>
  );
}

export function ActionButtons() {
  const { isSeeker, inGame, myState } = useRole();
  const g = useGame((s) => s.group);
  const emotes = useGame((s) => s.content?.config.emotes ?? []);
  const crouch = useGame((s) => s.bend);
  const setBend = useGame((s) => s.setBend);
  const sitting = useGame((s) => s.sitting);
  const sleeping = useGame((s) => s.sleeping);
  const driving = useGame((s) => s.driving);
  const hasCar = useGame((s) => !!s.life.carId);
  const myHome = useGame((s) => s.home?.id);
  const [wheel, setWheel] = useState(false);
  const [tucked, setTucked] = useState(() => { try { return localStorage.getItem("boju.ctlTucked") === "1"; } catch { return false; } });
  useTicker(400);
  const nearBed = bedNear(local.x, local.z);
  const insideMine = !!myHome && local.insideHome === myHome;
  const canTaunt = !isSeeker && (!inGame || (g?.phase === "seek" && myState === "hiding"));
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
  // hiding while Boju looks: the Aerial view shows where Boju is, so you know if they're close — point at it
  const watchBoju = canAerial && inGame && g?.phase === "seek" && myState === "hiding" && !aerial;
  const extras: { key: string; node: React.ReactNode }[] = [];
  if (!aerial) {
    extras.push({ key: "bend", node: (
      <button aria-label="Bend" data-guide="bend" className="ctl" data-on={crouch}
        onClick={() => { setBend(!crouch); if (!crouch) set({ sitting: false }); }}
      ><span className="ic">🧎</span><span className="lb">{crouch ? "Stand" : "Bend"}</span></button>
    ) });
  }
  if (canAerial) {
    extras.push({ key: "aerial", node: (
      <button aria-label="Aerial view" data-guide="aerial" className={`ctl ${watchBoju ? "ctl-attn" : ""}`} data-on={aerial} onClick={toggleAerial}>
        <span className="ic">🛰️</span><span className="lb">{aerial ? "Back" : watchBoju ? "Watch" : "Aerial"}</span>
      </button>
    ) });
  }
  if (!aerial && !inGame && !sleeping) {
    extras.push({ key: "sit", node: (
      <button aria-label="Sit" className="ctl" data-on={sitting}
        onClick={() => {
          const on = !sitting;
          if (on) { setBend(false); local.path = []; }
          local.sit = on;
          set({ sitting: on });
        }}
      ><span className="ic">🪑</span><span className="lb">{sitting ? "Stand" : "Sit"}</span></button>
    ) });
  }
  if (canTaunt) extras.push({ key: "emote", node: <button aria-label="Emotes" className="ctl" data-on={wheel} onClick={() => setWheel(!wheel)}><span className="ic">😜</span></button> });
  if (!GAME_ONLY && !aerial && !inGame && hasCar && !local.insideHome && !sleeping) {
    extras.push({ key: "drive", node: (
      <button aria-label="Drive" className="ctl" data-on={driving}
        onClick={() => { local.drive = !driving; local.sit = false; set({ driving: !driving, sitting: false }); setBend(false); sound.play(driving ? "door" : "horn"); }}
      ><span className="ic">{driving ? "🚶🏾" : "🚗"}</span><span className="lb">{driving ? "Walk" : "Drive"}</span></button>
    ) });
  }
  if (!GAME_ONLY && !aerial && !inGame && insideMine && !sleeping) {
    extras.push({ key: "decor", node: <button aria-label="Decorate" className="ctl" onClick={() => void startDecorating()}><span className="ic">🛋️</span><span className="lb">Decor</span></button> });
  }
  if (!GAME_ONLY && !aerial && !inGame && (sleeping || nearBed)) {
    extras.push({ key: "sleep", node: (
      <button aria-label="Sleep" className="ctl" data-on={sleeping} onClick={() => (sleeping ? wake() : sleep())}>
        <span className="ic">{sleeping ? "🌅" : "😴"}</span><span className="lb">{sleeping ? "Wake" : "Sleep"}</span>
      </button>
    ) });
  }
  if (g && (g.phase === "dice" || g.phase === "reveal")) return null; // nothing to do but pick: keep the dice clear
  // folded away for a clean screen: only Run stays (and Aerial whenever it's the thing to press, or you're up there)
  const shown = tucked ? extras.filter((e) => e.key === "aerial" && (watchBoju || aerial)) : extras;
  return (
    <div className="ctl-cluster pointer-events-none absolute bottom-[max(env(safe-area-inset-bottom),14px)] right-3 z-20" data-tucked={tucked}>
      {wheel && (
        <div className="panel pointer-events-auto absolute bottom-[210px] right-0 grid grid-cols-2 gap-1 p-2">
          {emotes.map((e) => (
            <button key={e.id} className="btn btn-ghost text-sm" onClick={() => { net.send({ t: "emote", id: e.id }); setWheel(false); }}>{e.text}</button>
          ))}
        </div>
      )}
      {/* the buttons sit on arcs round Run (thumb reach), nearest first */}
      {shown.map((e, i) => {
        const [r, deg] = ARC[i] ?? ARC[ARC.length - 1];
        const rad = (deg * Math.PI) / 180;
        return (
          <div key={e.key} className="ctl-slot pointer-events-auto absolute" style={{ right: 32 - Math.cos(rad) * r - 26, bottom: 32 + Math.sin(rad) * r - 26 }}>
            {e.node}
          </div>
        );
      })}
      <div className="pointer-events-auto absolute bottom-0 right-0">{!aerial && <RunButton />}</div>
      {extras.length > 0 && !aerial && (
        <button aria-label={tucked ? "Show controls" : "Hide controls"} className="ctl-fold pointer-events-auto absolute"
          onClick={() => { const v = !tucked; setTucked(v); try { localStorage.setItem("boju.ctlTucked", v ? "1" : "0"); } catch { /* storage blocked */ } }}>
          {tucked ? "⋯" : "✕"}
        </button>
      )}
    </div>
  );
}

/** [radius from Run's centre, angle] for each control: 180° = straight left of Run, 90° = straight above. */
const ARC: [number, number][] = [[92, 180], [92, 135], [92, 90], [158, 165], [158, 125], [158, 90], [158, 195]];

/** Shops and the bus stop appear when you walk into their zone. */
export function ZonePanel() {
  const { zone } = useWhere();
  const cfg = useGame((s) => s.content?.config);
  const g = useGame((s) => s.group);
  const balance = useGame((s) => s.balance);
  const me = useGame((s) => s.me?.id);
  const home = useGame((s) => s.home);
  const map = useMap();
  const mini = useGame((s) => !!s.mini);
  const driving = useGame((s) => s.driving);
  if (!zone || !cfg) return null;
  // LagosLife players shop, eat and live in LagosLife: only the bus stops work here (rides are free)
  if ((mini || GAME_ONLY) && zone.kind !== "bus_stop") return null; // just the game: no shops (see lib/scope)
  // in the car: the pedals own the bottom of the screen; shops and buses are for people on foot
  if (driving) {
    return (
      <div className="pointer-events-none absolute left-1/2 top-[7.4rem] z-20 max-w-[80vw] -translate-x-1/2">
        <div className="panel anim-rise truncate px-3 py-1.5 text-xs font-semibold">🚗 {zone.name} — park and tap 🚶 Walk to go in</div>
      </div>
    );
  }
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
  if (zone.kind === "furniture_shop") return <FurnitureShop />;
  if (zone.kind === "car_shop") return <CarShop />;
  if (zone.kind === "bus_stop" && map?.kind === "arena") {
    return (
      <div className="pointer-events-auto absolute bottom-28 left-1/2 z-20 w-72 -translate-x-1/2"><div className="panel anim-rise p-3">
        <div className="mb-1 font-bold">🚏 Bus stop</div>
        {g?.phase === "over" ? (
          <>
            <button className="btn btn-primary mb-1 w-full" onClick={() => net.send({ t: "g_return" })}>🏠 Ride home</button>
            <div className="text-xs opacity-70">{mini ? "Free ride back to the Motor Park. Your LagosLife home is one tap away: ← at the top." : `Free ride back to Lagos — your house${home ? ` (${home.name})` : " / the Motor Park"}.`}</div>
          </>
        ) : !g ? (
          <TravelOptions />
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
            <button key={f.id} data-guide="board" disabled={!mini && balance < f.price} className="btn btn-primary mb-1 flex w-full justify-between" onClick={() => net.send({ t: "g_board", fare: f.id })}>
              <span>Board {f.name}</span><span>{mini ? "Free" : naira(f.price)}</span>
            </button>
          ))
        ) : g && g.phase !== "over" ? (
          <div className="text-xs opacity-80">Rides to the arena leave when your group starts a game.</div>
        ) : (
          <TravelOptions />
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
    // a small round compass, not a card: an arrow to the safe house and how far
    <div data-guide="safe" className="anim-rise pointer-events-none absolute left-[14px] top-[16.2rem] z-20 flex flex-col items-center gap-1" aria-label={`${safe.name}: ${Math.round(dist)} m`}>
      <span className="grid h-12 w-12 place-items-center rounded-full bg-[#0a1324]/70 shadow-[inset_0_0_0_2px_var(--leaf),0_6px_16px_rgba(0,0,0,.35)] backdrop-blur-md">
        <span className="text-xl transition-transform duration-150" style={{ transform: inside ? undefined : `rotate(${-rel}rad)` }}>{inside ? "🏠" : "⬆️"}</span>
      </span>
      <span className="rounded-full bg-[#0a1324]/75 px-1.5 text-[10px] font-bold tabular-nums leading-4">{inside ? "Safe" : `🟢 ${Math.round(dist)} m`}</span>
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
      st.set({ life: { ...st.life, phoneId: chosen.id }, ...(st.onboard === "phone" ? { guide: null } : {}) });
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
      <div className="touch-scroll-x mb-3 flex gap-2 overflow-x-auto pb-1">
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

/** Ọ̀ṣọ́ Home & Furniture: browse by room, see it turn in 3D, buy into your store room. */
export function FurnitureShop() {
  const catalog = useGame((s) => s.content?.config.furniture ?? []);
  const balance = useGame((s) => s.balance);
  const hasHome = useGame((s) => !!s.home);
  const cats = [...new Set(catalog.map((f) => f.category))];
  const [cat, setCat] = useState(cats[0] ?? "Bedroom");
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const items = catalog.filter((f) => f.category === cat);
  const chosen = catalog.find((f) => f.id === pick) ?? items[0];
  const buy = async () => {
    const acc = loadAccount();
    if (!acc || !chosen) return;
    setBusy(true);
    try {
      await buyFurniture(acc, chosen.id);
      sound.play("coin");
      useGame.getState().toast(hasHome ? `📦 ${chosen.name} is in your store room — go home and tap 🛋️ Decorate` : `📦 ${chosen.name} bought! Rent a house to put it in`, "good");
    } catch (e) {
      useGame.getState().toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  if (!chosen) return null;
  return (
    <div className="pointer-events-auto absolute bottom-20 left-1/2 z-20 w-[min(23rem,95vw)] -translate-x-1/2"><div className="panel anim-sheet p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <div className="font-black">🛋️ Ọ̀ṣọ́ Home & Furniture</div>
        <div className="text-[10px] opacity-60">in-game naira only</div>
      </div>
      <div className="segmented mb-2">
        {cats.map((c) => <button key={c} data-on={c === cat} onClick={() => { setCat(c); setPick(null); }}>{c}</button>)}
      </div>
      <div className="flex gap-3">
        <FurniturePreview key={chosen.id} spec={chosen} className="anim-pop h-32 w-32 shrink-0 overflow-hidden rounded-2xl bg-[#f3ead9]" />
        <div className="touch-scroll grid max-h-32 flex-1 grid-cols-1 gap-1 overflow-y-auto">
          {items.map((f) => (
            <button key={f.id} onClick={() => setPick(f.id)} data-on={f.id === chosen.id}
              className="choice flex items-center justify-between px-2 py-1.5 text-left text-xs">
              <span className="truncate font-semibold">{ITEM_ICON[f.id] ?? "📦"} {f.name}</span>
              <span className="shrink-0 pl-1 text-[var(--accent)]">{nairaShort(f.price)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="mt-2 text-[11px] opacity-70">{chosen.bed ? "😴 You can sleep on it" : chosen.seat ? "🪑 You can sit on it" : chosen.solid ? `${chosen.w} × ${chosen.d} m` : "Goes under or over other things"}</div>
      <button className="btn btn-primary mt-2 w-full" disabled={busy || balance < chosen.price} onClick={buy}>
        {balance < chosen.price ? "Your money no reach" : `Buy ${chosen.name} · ${naira(chosen.price)}`}
      </button>
    </div></div>
  );
}

export function sleep(): void {
  const st = useGame.getState();
  st.setBend(false);
  local.path = [];
  local.sit = false;
  local.lie = true;
  st.set({ sleeping: true, sitting: false, seatAsk: false });
  st.toast("😴 Sleeping… your stamina is refilling", "good");
}

export function wake(): void {
  local.lie = false;
  useGame.getState().set({ sleeping: false });
}

/** You walked to a bed you tapped: sleep on it or just sit on the edge? */
export function SeatAsk() {
  const ask = useGame((s) => s.seatAsk);
  const set = useGame((s) => s.set);
  if (!ask) return null;
  return (
    <div className="pointer-events-auto absolute bottom-28 left-1/2 z-30 -translate-x-1/2">
      <div className="panel anim-pop flex items-center gap-2 p-2">
        <button className="btn btn-primary px-4" onClick={sleep}>😴 Sleep</button>
        <button className="btn btn-ghost px-4" onClick={() => { local.sit = true; set({ sitting: true, seatAsk: false }); }}>🪑 Sit</button>
        <button className="btn btn-ghost px-3" onClick={() => set({ seatAsk: false })}>✕</button>
      </div>
    </div>
  );
}

/** Board to anywhere from a bus stop (your pinned place first). Fares depend on the city. */
function TravelOptions() {
  const cfg = useGame((s) => s.content?.config);
  const maps = useGame((s) => s.content?.maps);
  const mapId = useGame((s) => s.mapId);
  const pin = useGame((s) => (s.pin?.kind === "trip" ? s.pin : null));
  const balance = useGame((s) => s.balance);
  const mini = useGame((s) => !!s.mini);
  const [to, setTo] = useState<string | null>(null);
  if (!cfg || !maps) return null;
  const here = mapId === "hub_plaza" ? "hub" : mapId;
  if (mini || GAME_ONLY) {
    // just the game: no sightseeing trips. Buses run to games, and back to the Motor Park after.
    if (here === "hub") return <div className="text-xs opacity-80">Buses leave from here when your game starts. Open 🙈 on your phone to play.</div>;
    const city = cfg.cities.find((c) => c.arenas.includes(mapId ?? ""));
    const back = (city?.fares ?? cfg.fares)[0];
    return (
      <button className="btn btn-primary w-full py-1.5 text-sm" onClick={() => back && net.send({ t: "trip", to: "hub", mode: back.id, key: crypto.randomUUID() })}>
        🚌 Ride home
      </button>
    );
  }
  const dests = [
    ...(here !== "hub" ? [{ to: "hub", label: "🏠 Home (Lagos)" }] : []),
    ...cfg.cities.flatMap((c) => c.arenas.filter((a) => a !== here).map((a) => ({ to: a, label: `${c.name} · ${maps[a]?.venue?.name ?? maps[a]?.name}` }))),
  ];
  const dest = to ?? pin?.to ?? dests[0]?.to;
  const fares = cfg.cities.find((c) => c.arenas.includes(dest === "hub" ? (mapId ?? "") : (dest ?? "")))?.fares ?? cfg.fares;
  return (
    <div className="space-y-1.5">
      <select value={dest ?? ""} onChange={(e) => setTo(e.target.value)} className="w-full rounded-lg bg-white/10 px-2 py-1.5 text-sm outline-none">
        {dests.map((d) => <option key={d.to} value={d.to} className="text-black">{d.to === pin?.to ? "📌 " : ""}{d.label}</option>)}
      </select>
      {fares.map((f) => (
        <button key={f.id} disabled={balance < f.price} className="btn btn-primary flex w-full justify-between py-1.5 text-sm"
          onClick={() => dest && net.send({ t: "trip", to: dest, mode: f.id, key: crypto.randomUUID() })}>
          <span>Board {f.name}</span><span>{naira(f.price)}</span>
        </button>
      ))}
      <div className="text-[10px] opacity-60">Explore any city without a game. Pin places on the 🗺️ map.</div>
    </div>
  );
}

/** Tokunbo Autos: buy a car, then drive it around and to any city. */
export function CarShop() {
  const cars = useGame((s) => s.content?.config.cars ?? []);
  const balance = useGame((s) => s.balance);
  const mine = useGame((s) => s.life.carId);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = cars.find((c) => c.id === (pick ?? mine ?? cars[0]?.id));
  if (!chosen) return null;
  const buy = async () => {
    const acc = loadAccount();
    if (!acc) return;
    setBusy(true);
    try {
      await buyCar(acc, chosen.id);
      const st = useGame.getState();
      st.set({ life: { ...st.life, carId: chosen.id } });
      sound.play("coin");
      st.toast(`🚗 ${chosen.name} is yours! Tap 🚗 Drive to enter it`, "good");
    } catch (e) {
      useGame.getState().toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pointer-events-auto absolute bottom-20 left-1/2 z-20 w-[min(23rem,95vw)] -translate-x-1/2"><div className="panel anim-sheet p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <div className="font-black">🚗 Tokunbo Autos</div>
        <div className="text-[10px] opacity-60">in-game naira only</div>
      </div>
      <div className="flex gap-3">
        <CarPreview key={chosen.id} color={chosen.color} className="anim-pop h-28 w-32 shrink-0 overflow-hidden rounded-2xl bg-[#dfe7ef]" />
        <div className="grid flex-1 gap-1">
          {cars.map((c) => (
            <button key={c.id} onClick={() => setPick(c.id)} data-on={c.id === chosen.id} className="choice flex items-center justify-between px-2 py-1 text-left text-xs">
              <span className="truncate font-semibold"><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: c.color }} />{c.name}</span>
              <span className="shrink-0 pl-1 text-[var(--accent)]">{nairaShort(c.price)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="mt-2 text-[11px] opacity-75">{chosen.tagline} · top speed {Math.round(chosen.speed * 3.6)} km/h</div>
      {mine === chosen.id ? (
        <div className="mt-2 text-center text-sm font-bold text-green-400">✓ This is your car</div>
      ) : (
        <button className="btn btn-primary mt-2 w-full" disabled={busy || balance < chosen.price} onClick={buy}>
          {balance < chosen.price ? "Your money no reach" : `${mine ? "Trade up to" : "Buy"} ${chosen.name} · ${naira(chosen.price)}`}
        </button>
      )}
    </div></div>
  );
}

/** While driving: steering on the left thumb, gas and brake (reverse) pedals on the right. */
export function DriveControls() {
  const driving = useGame((s) => s.driving);
  const aerial = useGame((s) => s.aerial);
  const decor = useGame((s) => !!s.decor);
  useEffect(() => () => { Object.assign(input.pedal, { gas: false, brake: false, left: false, right: false }); }, []);
  if (!driving || aerial || decor) return null;
  const hold = (k: keyof typeof input.pedal) => ({
    onPointerDown: (e: React.PointerEvent) => { e.stopPropagation(); input.pedal[k] = true; try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ } },
    onPointerUp: () => { input.pedal[k] = false; },
    onPointerCancel: () => { input.pedal[k] = false; },
    onLostPointerCapture: () => { input.pedal[k] = false; },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });
  return (
    <>
      <div className="pointer-events-auto absolute bottom-24 left-3 z-20 flex gap-2.5" data-testid="steer">
        <button aria-label="Steer left" className="pedal h-16 w-16 text-2xl" {...hold("left")}>◀</button>
        <button aria-label="Steer right" className="pedal h-16 w-16 text-2xl" {...hold("right")}>▶</button>
      </div>
      <div className="pointer-events-auto absolute bottom-24 right-[5.5rem] z-20 flex items-end gap-2.5" data-testid="pedals">
        <button aria-label="Brake" className="pedal pedal-brake h-14 w-14" {...hold("brake")}><span className="text-lg leading-none">■</span><span className="lb">Brake</span></button>
        <button aria-label="Gas" className="pedal pedal-gas h-20 w-14" {...hold("gas")}><span className="text-lg leading-none">▲</span><span className="lb">Gas</span></button>
      </div>
    </>
  );
}

/** While the city's buildings are being put together (a second or two on slow phones). */
export function BuildingWorld() {
  const building = useGame((s) => s.building);
  if (!building) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-40 z-20 flex justify-center">
      <div className="panel anim-fade px-3 py-1.5 text-xs font-semibold">🏗️ Building the city…</div>
    </div>
  );
}
