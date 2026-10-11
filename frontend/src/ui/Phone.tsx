"use client";

import { useEffect, useRef, useState } from "react";
import { local } from "@/game/state";
import { walkTo } from "@/game/nav";
import { sound } from "@/game/sound";
import {
  getDms, getFriends, getHomes, loadAccount, naira, nairaShort, removeFriend, rentHome, requestFriend, respondFriend, sendDm,
  type Dm, type Friend, type HouseInfo,
} from "@/lib/api";
import { net } from "@/lib/net";
import { useGame } from "@/lib/store";
import { ChatContent, GroupPanel, LeadersPanel, SettingsPanel, WalletPanel, screenshot } from "./Panels";
import { ChangelogContent } from "./WhatsNew";
import { startDecorating } from "./Decorate";
import { LiveGamesList } from "./Live";
import { useMap, useTicker } from "./hooks";

interface App { id: string; name: string; icon: string; bg: string; needsPhone?: boolean }

const APPS: App[] = [
  { id: "boju", name: "Boju Boju", icon: "🙈", bg: "from-[#4f95ff] to-[#1d5fd6]", needsPhone: true },
  { id: "messages", name: "Messages", icon: "💬", bg: "from-[#5be27a] to-[#1fa847]", needsPhone: true },
  { id: "houses", name: "Houses", icon: "🏠", bg: "from-[#ffb057] to-[#e8731a]", needsPhone: true },
  { id: "wallet", name: "Wallet", icon: "₦", bg: "from-[#1d2b44] to-[#0a1324]" },
  { id: "map", name: "Map", icon: "🛰️", bg: "from-[#7fd8ff] to-[#2a8fd6]", needsPhone: true },
  { id: "live", name: "Live games", icon: "📺", bg: "from-[#ff6b81] to-[#d6224a]", needsPhone: true },
  { id: "leaders", name: "Rankings", icon: "🏆", bg: "from-[#ffd84f] to-[#e0a800]", needsPhone: true },
  { id: "events", name: "Events", icon: "🎉", bg: "from-[#ff7ab6] to-[#d62f7a]", needsPhone: true },
  { id: "camera", name: "Camera", icon: "📸", bg: "from-[#9aa3b2] to-[#4b5566]", needsPhone: true },
  { id: "news", name: "What's new", icon: "✨", bg: "from-[#b48cff] to-[#6c3fd6]" },
  { id: "settings", name: "Settings", icon: "⚙️", bg: "from-[#a7b0bf] to-[#5d6778]" },
];
const DOCK = ["boju", "messages", "map", "camera"];
const TITLES: Record<string, string> = Object.fromEntries(APPS.map((a) => [a.id, a.name]));
/** usernames for open DM threads (dm:<id>) */
const names = new Map<string, string>();

const shade = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(k > 0 ? c + (255 - c) * k : c * (1 + k))));
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
};

export default function Phone() {
  const open = useGame((s) => s.phoneOpen);
  const app = useGame((s) => s.phoneApp);
  const openApp = useGame((s) => s.openApp);
  const close = useGame((s) => s.closePhone);
  const model = useGame((s) => s.content?.config.phones.find((p) => p.id === s.life.phoneId));
  const hasPhone = !!model;
  const inGroup = useGame((s) => !!s.group);

  // launching "action" apps closes the phone and does the thing in the world
  useEffect(() => {
    if (!open || !app) return;
    if (app === "map") {
      close();
      useGame.getState().set({ mapOpen: true });
      sound.play("pop");
    } else if (app === "camera") {
      close();
      setTimeout(() => {
        screenshot();
        sound.play("click");
        const f = document.createElement("div");
        f.className = "anim-flash pointer-events-none fixed inset-0 z-[90] bg-white";
        document.body.appendChild(f);
        setTimeout(() => f.remove(), 600);
      }, 350);
    }
  }, [open, app, close]);

  if (!open) return null;
  const inApp = app && app !== "map" && app !== "camera";
  const title = app?.startsWith("dm:") ? names.get(app.slice(3)) ?? "Chat" : app ? TITLES[app] : "";
  const backLabel = app?.startsWith("dm:") ? "Messages" : "Home";
  const back = () => (app?.startsWith("dm:") ? openApp("messages") : openApp(null));
  const metal = model?.color ?? "#3a4150";
  const chat = app === "messages" || app?.startsWith("dm:");
  return (
    <div className="anim-fade pointer-events-auto absolute inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-[4px] sm:items-center"
      onPointerDown={(e) => e.target === e.currentTarget && close()}>
      {/* device: metal band (phone colour) -> black bezel -> screen */}
      <div className="anim-phone relative mb-[max(env(safe-area-inset-bottom),8px)] h-[min(46rem,90dvh)] w-[min(23rem,94vw)] rounded-[3.3rem] p-[3px] shadow-[0_30px_60px_-20px_rgba(0,0,0,.8)]"
        style={{ background: `linear-gradient(145deg, ${shade(metal, 0.45)}, ${metal} 35%, ${shade(metal, -0.35)} 70%, ${shade(metal, 0.2)})` }}>
        {[["left", "18%", "2.2rem"], ["left", "27%", "3.4rem"], ["left", "37%", "3.4rem"], ["right", "30%", "5rem"]].map(([side, top, h]) => (
          <span key={`${side}${top}`} className="absolute w-[3px] rounded-full" style={{ [side]: "-3px", top, height: h, background: shade(metal, -0.2) } as React.CSSProperties} />
        ))}
        <div className="h-full w-full rounded-[3.1rem] bg-black p-[7px]">
          <div className="phone-screen relative flex h-full w-full flex-col overflow-hidden rounded-[2.65rem] bg-[var(--sys-bg)]">
            {!inApp && <Wallpaper color={model?.color} />}
            <StatusBar dark={!inApp} />
            <div className="relative min-h-0 flex-1">
              {inApp ? (
                <div key={app} className="anim-app absolute inset-0 flex flex-col">
                  <div className="relative z-10 flex h-11 shrink-0 items-center px-2 backdrop-blur-xl" style={{ background: "rgba(11,17,32,.78)", boxShadow: "inset 0 -0.5px 0 rgba(255,255,255,.1)" }}>
                    <button aria-label="Back" className="flex items-center gap-0.5 rounded-full px-1.5 py-1 text-[15px] text-[var(--accent)] active:opacity-50" onClick={back}>
                      <span className="text-2xl leading-none">‹</span>{backLabel}
                    </button>
                    <div className="pointer-events-none absolute left-1/2 max-w-[55%] -translate-x-1/2 truncate text-[15px] font-semibold">{title}</div>
                  </div>
                  <div className={`touch-scroll min-h-0 flex-1 px-3 pb-6 ${chat ? "flex flex-col" : ""}`}>
                    {!app?.startsWith("dm:") && <div className="ios-large-title anim-rise">{title}</div>}
                    {!hasPhone && APPS.find((a) => a.id === app)?.needsPhone && !(app === "boju" && inGroup) ? <NoPhone /> : <AppBody app={app} />}
                  </div>
                </div>
              ) : (
                <HomeScreen hasPhone={hasPhone} />
              )}
            </div>
            <button aria-label="Home" className="absolute bottom-1.5 left-1/2 z-20 h-[5px] w-[7.5rem] -translate-x-1/2 rounded-full bg-white/80 active:bg-white" onClick={() => (inApp ? openApp(null) : close())} />
            {/* glass glare */}
            <span className="pointer-events-none absolute inset-0 rounded-[2.65rem] bg-[linear-gradient(115deg,rgba(255,255,255,.07)_0%,rgba(255,255,255,0)_38%)]" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Wallpaper({ color }: { color?: string }) {
  const c = color ?? "#2f7cf6";
  return (
    <div className="absolute inset-0" style={{
      background: `radial-gradient(90% 55% at 15% 8%, ${shade(c, 0.25)}cc 0%, transparent 60%),
        radial-gradient(80% 60% at 95% 45%, #7b5cff99 0%, transparent 55%),
        radial-gradient(90% 70% at 20% 100%, #0fb5a088 0%, transparent 60%),
        linear-gradient(180deg, #13244d 0%, #0a1324 100%)`,
    }}>
      <span className="absolute -right-6 top-1/3 select-none text-[11rem] opacity-[0.06]">🙈</span>
    </div>
  );
}

function StatusBar({ dark }: { dark: boolean }) {
  useTicker(10000);
  const hunger = useGame((s) => s.hunger);
  const connected = useGame((s) => s.connected);
  const now = new Date();
  const level = Math.max(0.06, Math.min(1, hunger / 100));
  return (
    <div className={`relative z-20 flex h-11 shrink-0 items-center justify-between px-7 pt-1 text-[14px] font-semibold ${dark ? "" : "bg-[rgba(11,17,32,.72)]"}`}>
      <span className="tabular-nums tracking-tight">{now.getHours()}:{String(now.getMinutes()).padStart(2, "0")}</span>
      <span className="absolute left-1/2 top-2 flex h-[1.65rem] w-[6.6rem] -translate-x-1/2 items-center justify-end rounded-full bg-black pr-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#141a2a] ring-1 ring-[#24304a]" />
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="17" height="11" viewBox="0 0 17 11" aria-label={connected ? "Online" : "Offline"}>
          {[0, 1, 2, 3].map((i) => <rect key={i} x={i * 4.5} y={8 - i * 2.6} width="3" height={3 + i * 2.6} rx="0.8" fill={connected || i === 0 ? "white" : "rgba(255,255,255,.3)"} />)}
        </svg>
        <svg width="15" height="11" viewBox="0 0 15 11"><path d="M7.5 2.2c2.4 0 4.6.9 6.2 2.5l1.1-1.1A10.3 10.3 0 0 0 7.5.6 10.3 10.3 0 0 0 .2 3.6l1.1 1.1A8.8 8.8 0 0 1 7.5 2.2Zm0 3.2c1.5 0 2.9.6 3.9 1.6l1.1-1.1a7 7 0 0 0-10 0L3.6 7c1-1 2.4-1.6 3.9-1.6Zm0 3.2c-.6 0-1.2.3-1.6.7l1.6 1.6 1.6-1.6c-.4-.4-1-.7-1.6-.7Z" fill={connected ? "white" : "rgba(255,255,255,.3)"} /></svg>
        <span className="flex items-center" title="Battery = your belle">
          <span className="relative h-[11px] w-[22px] rounded-[3.5px] border border-white/45 p-[1.5px]">
            <span className={`block h-full rounded-[2px] ${hunger < 25 ? "bg-[#ff453a]" : "bg-white"}`} style={{ width: `${level * 100}%` }} />
          </span>
          <span className="ml-[1px] h-1 w-[1.5px] rounded-r bg-white/45" />
        </span>
      </span>
    </div>
  );
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Ẹ káàrọ̀ ☀️" : h < 16 ? "Ẹ káàsán 🌤️" : "Ẹ kú alẹ́ 🌙";
};

function HomeScreen({ hasPhone }: { hasPhone: boolean }) {
  const openApp = useGame((s) => s.openApp);
  const balance = useGame((s) => s.balance);
  const username = useGame((s) => s.life.username || s.me?.nick || "");
  const home = useGame((s) => s.home);
  const group = useGame((s) => s.group);
  const badges: Record<string, number> = {
    messages: useGame((s) => s.unread + s.dmUnread + s.friendReqs),
    boju: group ? 1 : 0,
  };
  useTicker(30000);
  const now = new Date();
  const icon = (a: App, i: number, dock = false) => {
    const locked = a.needsPhone && !hasPhone;
    return (
      <button key={a.id} aria-label={a.name} className="anim-pop flex flex-col items-center gap-1.5" style={{ animationDelay: `${80 + i * 22}ms` }}
        onClick={() => { sound.play("click"); openApp(a.id); }}>
        <span className={`app-icon bg-gradient-to-b ${a.bg} ${locked ? "opacity-45 grayscale" : ""}`}>
          <span className="glyph">{a.icon}</span>
          {(badges[a.id] ?? 0) > 0 && (
            <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-[#ff3b30] px-1 text-[11px] font-bold text-white shadow ring-2 ring-black/10">
              {a.id === "boju" ? "1" : badges[a.id]}
            </span>
          )}
        </span>
        {!dock && <span className="app-label max-w-[4.6rem] truncate">{a.name}</span>}
      </button>
    );
  };
  return (
    <div className="absolute inset-0 flex flex-col px-5 pb-6">
      {/* widgets */}
      <div className="anim-rise mt-2 grid grid-cols-2 gap-3" style={{ animationDelay: "40ms" }}>
        <div className="glass col-span-2 flex items-center justify-between rounded-[1.4rem] px-4 py-3">
          <div>
            <div className="text-[13px] font-semibold opacity-85">{greeting()}</div>
            <div className="text-[22px] font-bold leading-tight">@{username}</div>
            <div className="text-[12px] opacity-70">{now.toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "long" })}</div>
          </div>
          <div className="text-right">
            <div className="text-[34px] font-extralight tabular-nums leading-none">{now.getHours()}:{String(now.getMinutes()).padStart(2, "0")}</div>
            <div className="text-[11px] opacity-70">Lagos</div>
          </div>
        </div>
        <button className="glass rounded-[1.4rem] p-3 text-left active:scale-[.97]" style={{ transition: "transform .25s var(--ease-spring)" }} onClick={() => openApp("wallet")}>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold opacity-80"><span className="ios-glyph h-5 w-5 rounded-md bg-[#1d5fd6] text-[11px]">₦</span>Wallet</div>
          <div className="mt-1 text-[22px] font-bold tracking-tight">{nairaShort(balance)}</div>
          <div className="text-[10px] opacity-60">in-game · not real money</div>
        </button>
        <button className="glass rounded-[1.4rem] p-3 text-left active:scale-[.97]" style={{ transition: "transform .25s var(--ease-spring)" }} onClick={() => openApp(group ? "boju" : "houses")}>
          {group ? (
            <>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold opacity-80"><span className="ios-glyph h-5 w-5 rounded-md bg-[#2f7cf6] text-[11px]">🙈</span>Boju Boju</div>
              <div className="mt-1 font-mono text-[20px] font-bold tracking-widest">{group.code}</div>
              <div className="truncate text-[10px] capitalize opacity-60">{group.phase} · {group.members.filter((m) => !m.left).length} players</div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold opacity-80"><span className="ios-glyph h-5 w-5 rounded-md bg-[#e8731a] text-[11px]">🏠</span>Home</div>
              <div className="mt-1 truncate text-[15px] font-bold leading-tight">{home ? home.name : "No house yet"}</div>
              <div className="text-[10px] opacity-60">{home ? "tap to manage" : "rent one in Houses"}</div>
            </>
          )}
        </button>
      </div>
      {!hasPhone && (
        <div className="glass anim-rise mt-3 rounded-[1.2rem] p-3 text-[12px]">
          <b>🎒 This is your pocket.</b> Buy a phone at Tini Tech to unlock Boju Boju, Messages, Houses and more.
          <button className="btn btn-primary mt-2 w-full py-1.5 text-xs" onClick={() => { goToShop(); useGame.getState().closePhone(); }}>🧭 Walk me to Tini Tech</button>
        </div>
      )}
      <div className="mt-5 grid grid-cols-4 gap-x-1 gap-y-5">{APPS.filter((a) => !DOCK.includes(a.id)).map((a, i) => icon(a, i))}</div>
      <div className="mt-auto flex justify-center gap-1.5 pb-2.5">
        <span className="h-1.5 w-1.5 rounded-full bg-white" />
        <span className="h-1.5 w-1.5 rounded-full bg-white/35" />
      </div>
      <div className="glass grid grid-cols-4 gap-2 rounded-[1.9rem] px-3 py-2.5">
        {DOCK.map((id, i) => icon(APPS.find((a) => a.id === id)!, i + 8, true))}
      </div>
    </div>
  );
}

export function goToShop(): void {
  const map = useGame.getState().content?.maps.hub_plaza;
  const z = map?.zones.find((x) => x.kind === "phone_shop");
  if (!z) return;
  const x = (z.rect[0] + z.rect[2]) / 2, y = (z.rect[1] + z.rect[3]) / 2;
  if (useGame.getState().mapId !== "hub_plaza") { useGame.getState().toast("The phone shop is in Lagos — ride home first"); return; }
  useGame.getState().set({ guide: { x, z: y, label: "📱 Phone shop" } });
  walkTo(x, y);
}

function NoPhone() {
  return (
    <div className="py-10 text-center">
      <div className="text-5xl">📵</div>
      <div className="mt-2 font-bold">You need a phone for this app</div>
      <p className="mt-1 text-sm opacity-75">The phone shop is in the hub, just beside where you started.</p>
      <button className="btn btn-primary mt-4" onClick={() => { goToShop(); useGame.getState().closePhone(); }}>🧭 Walk me there</button>
    </div>
  );
}

function AppBody({ app }: { app: string | null }) {
  if (app?.startsWith("dm:")) return <DmThread id={app.slice(3)} />;
  switch (app) {
    case "boju": return <GroupPanel />;
    case "messages": return <MessagesApp />;
    case "houses": return <HousesApp />;
    case "wallet": return <WalletPanel />;
    case "leaders": return <LeadersPanel />;
    case "live": return <LiveGamesList />;
    case "events": return <EventsApp />;
    case "settings": return <SettingsPanel />;
    case "news": return <ChangelogContent />;
    default: return null;
  }
}

// ------------------------------------------------------------------ Messages
function useFriends() {
  const version = useGame((s) => s.friendsVersion);
  const [data, setData] = useState<{ friends: Friend[]; incoming: Friend[]; outgoing: Friend[] } | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    const acc = loadAccount();
    if (!acc) return;
    let alive = true;
    const load = () => getFriends(acc).then((d) => {
      if (!alive) return;
      setData(d);
      useGame.getState().set({ dmUnread: d.friends.reduce((a, f) => a + f.unread, 0), friendReqs: d.incoming.length });
    }).catch(() => {});
    load();
    const id = setInterval(load, 15000);
    return () => { alive = false; clearInterval(id); };
  }, [version, n]);
  return { data, reload: () => setN((x) => x + 1) };
}

function MessagesApp() {
  const [tab, setTab] = useState<"friends" | "nearby">("friends");
  const unread = useGame((s) => s.unread);
  const group = useGame((s) => s.group);
  return (
    <>
      <div className="segmented mb-3 shrink-0">
        <button data-on={tab === "friends"} onClick={() => setTab("friends")}>Friends</button>
        <button data-on={tab === "nearby"} onClick={() => setTab("nearby")}>{group ? "Group" : "Nearby"}{unread > 0 && tab !== "nearby" ? ` (${unread})` : ""}</button>
      </div>
      {tab === "friends" ? <FriendsList /> : <div className="min-h-0 flex-1"><ChatContent /></div>}
    </>
  );
}

function FriendsList() {
  const { data, reload } = useFriends();
  const openApp = useGame((s) => s.openApp);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const acc = loadAccount();
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); if (ok) useGame.getState().toast(ok, "good"); reload(); } catch (e) { useGame.getState().toast((e as Error).message, "error"); } finally { setBusy(false); }
  };
  if (!acc) return null;
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value.replace(/[^A-Za-z0-9_.]/g, "").slice(0, 16))} placeholder="Add friend by username"
          className="w-full rounded-xl bg-white/10 px-3 py-2 text-sm outline-none" onKeyDown={(e) => e.stopPropagation()} />
        <button className="btn btn-primary px-3" disabled={busy || name.length < 3}
          onClick={() => act(async () => { const r = await requestFriend(acc, name); setName(""); useGame.getState().toast(r.status === "accepted" ? "🤝 You're now friends!" : "Friend request sent 👋", "good"); })}>Add</button>
      </div>
      {data?.incoming.map((f) => (
        <div key={f.id} className="anim-rise flex items-center gap-2 rounded-2xl bg-[var(--accent)]/15 p-2.5 text-sm">
          <span className="flex-1"><b>@{f.username}</b> wants to be friends</span>
          <button className="btn btn-primary px-2.5 py-1 text-xs" disabled={busy} onClick={() => act(() => respondFriend(acc, f.id, true), "🤝 Friend added")}>Accept</button>
          <button className="btn btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={() => act(() => respondFriend(acc, f.id, false))}>✕</button>
        </div>
      ))}
      {data === null ? <div className="text-sm opacity-60">Loading…</div> : data.friends.length === 0 && data.incoming.length === 0 ? (
        <div className="anim-pop flex flex-col items-center px-4 py-8 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-b from-[#5be27a] to-[#1fa847] text-3xl shadow-lg">💬</span>
          <div className="mt-3 text-[17px] font-semibold">No friends yet</div>
          <div className="mt-1 text-[13px] opacity-60">Add your padi by their username — or tap someone in the street to see their card. Then chat and invite them to your games.</div>
        </div>
      ) : (
        <div className="ios-group">
          {data.friends.map((f) => (
            <button key={f.id} className="ios-row"
              onClick={() => { names.set(f.id, f.username); openApp(`dm:${f.id}`); }}>
              <span className="relative grid h-10 w-10 place-items-center rounded-full font-bold uppercase shadow-inner" style={{ background: avatarGrad(f.username) }}>
                {f.username[0]}
                <span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#0d1830] ${f.online ? "bg-green-400" : "bg-gray-500"}`} />
              </span>
              <span className="flex-1"><span className="block font-semibold">@{f.username}</span><span className="text-xs opacity-60">{f.online ? "Online" : "Offline"}</span></span>
              {f.unread > 0 && <span className="rounded-full bg-[var(--accent)] px-2 text-xs font-bold">{f.unread}</span>}
              <span className="ios-chevron">›</span>
            </button>
          ))}
        </div>
      )}
      {!!data?.outgoing.length && <div className="text-xs opacity-60">Waiting for: {data.outgoing.map((f) => `@${f.username}`).join(", ")}</div>}
    </div>
  );
}

/** A stable, friendly gradient per username (like iOS contact avatars). */
export function avatarGrad(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `linear-gradient(180deg, hsl(${h} 70% 62%), hsl(${(h + 25) % 360} 65% 42%))`;
}

const JOIN_RE = /Join my Boju Boju game: ([A-Z0-9]{4,6})/;

function DmThread({ id }: { id: string }) {
  const [msgs, setMsgs] = useState<Dm[] | null>(null);
  const [text, setText] = useState("");
  const live = useGame((s) => s.dmLive);
  const group = useGame((s) => s.group);
  const myGroup = useGame((s) => s.group?.code);
  const end = useRef<HTMLDivElement>(null);
  const acc = loadAccount();
  useEffect(() => {
    if (!acc) return;
    getDms(acc, id).then((r) => {
      setMsgs(r.messages);
      // the server marked them read; refresh the badge
      getFriends(acc).then((d) => useGame.getState().set({ dmUnread: d.friends.reduce((a, f) => a + f.unread, 0), friendReqs: d.incoming.length })).catch(() => {});
    }).catch((e) => { useGame.getState().toast((e as Error).message, "error"); setMsgs([]); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    if (live && live.from === id) setMsgs((m) => (m && !m.some((x) => x.id === live.id) ? [...m, { id: live.id, mine: false, text: live.text, ts: live.ts }] : m));
  }, [live, id]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs?.length]);
  const send = async (body: string) => {
    if (!acc || !body.trim()) return;
    try {
      const m = await sendDm(acc, id, body);
      setMsgs((x) => [...(x ?? []), m]);
      setText("");
    } catch (e) { useGame.getState().toast((e as Error).message, "error"); }
  };
  const remove = async () => {
    if (!acc || !confirm(`Remove @${names.get(id) ?? "friend"} from your friends?`)) return;
    await removeFriend(acc, id).catch(() => {});
    useGame.getState().openApp("messages");
  };
  return (
    <>
      <div className="touch-scroll min-h-0 flex-1 space-y-1.5 py-1">
        {msgs === null && <div className="text-sm opacity-60">Loading…</div>}
        {msgs?.length === 0 && <div className="py-6 text-center text-xs opacity-60">Say hi 👋🏾 — messages are only between friends.</div>}
        {msgs?.map((m) => {
          const join = m.text.match(JOIN_RE)?.[1];
          return (
            <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
              <div className={`bubble anim-pop ${m.mine ? "me" : "them"}`}>
                <span className="break-words">{m.text}</span>
                {join && !m.mine && join !== myGroup && (
                  <button className="btn btn-leaf mt-1.5 block w-full py-1 text-xs" disabled={!!group}
                    onClick={() => { net.send({ t: "g_join", code: join }); useGame.getState().openApp("boju"); }}>
                    {group ? "Leave your group to join" : `🙈 Join game ${join}`}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <div className="shrink-0 space-y-2 pt-2">
        <div className="flex gap-2 text-xs">
          {myGroup && group?.phase === "lobby" && (
            <button className="btn btn-ghost flex-1 py-1 text-xs" onClick={() => send(`Join my Boju Boju game: ${myGroup}`)}>🙈 Invite to my game</button>
          )}
          <button className="btn btn-ghost py-1 text-xs" onClick={remove}>Remove friend</button>
        </div>
        <div className="flex gap-2">
          <input value={text} maxLength={300} onChange={(e) => setText(e.target.value)} placeholder="Message"
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") void send(text); }}
            className="w-full rounded-full border border-white/10 bg-[#161f33] px-4 py-2 text-[15px] outline-none focus:border-[var(--accent)]" />
          <button aria-label="Send" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--accent)] font-bold" onClick={() => send(text)}>↑</button>
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ Houses
function HousesApp() {
  const [data, setData] = useState<{ days: number; mine: string | null; rent_until: string | null; free: number; homes: HouseInfo[] } | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const balance = useGame((s) => s.balance);
  const onboard = useGame((s) => s.onboard);
  const hub = useGame((s) => s.content?.maps.hub_plaza);
  const acc = loadAccount();
  useEffect(() => {
    if (acc) getHomes(acc).then((d) => { setData(d); setSel((s) => s ?? d.mine ?? d.homes.find((x) => !x.taken)?.id ?? d.homes[0]?.id ?? null); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!data || !acc) return <div className="text-sm opacity-60">Loading houses…</div>;
  const h = data.homes.find((x) => x.id === sel);
  const mine = h && h.id === data.mine;
  const until = data.rent_until ? new Date(data.rent_until) : null;
  const daysLeft = until ? Math.max(0, Math.ceil((until.getTime() - Date.now()) / 86400000)) : 0;
  const homeGeo = hub?.homes?.find((x) => x.id === sel);
  const rent = async () => {
    if (!h) return;
    setBusy(true);
    try {
      const r = await rentHome(acc, h.id);
      const st = useGame.getState();
      st.set({ life: { ...st.life, homeId: h.id, rentUntil: r.rent_until } });
      setData({ ...data, mine: h.id, rent_until: r.rent_until, free: data.free - (mine ? 0 : 1), homes: data.homes.map((x) => (x.id === h.id ? { ...x, owner: null, owner_id: null, taken: false } : x)) });
      sound.play("coin");
      st.toast(mine ? `Rent renewed — ${data.days} more days 🏠` : `🔑 ${h.name} is yours for ${data.days} days!`, "good");
      if (!mine && homeGeo) {
        st.set({ guide: { x: homeGeo.door[0], z: homeGeo.door[1], label: "🏠 Your house" }, ...(st.onboard ? { onboard: "home" } : {}) });
        st.closePhone();
      }
    } catch (e) {
      useGame.getState().toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs">
        <span className="opacity-75">One family per house — knock to visit when they&apos;re home.</span>
        <span className="rounded-full bg-white/10 px-2 py-0.5 font-semibold">{data.free} of {data.homes.length} free</span>
      </div>
      {data.free === 0 && !data.mine && <div className="rounded-2xl bg-[var(--clay)]/25 p-2.5 text-xs">🏗️ Every house is taken right now — new streets are being built. Check back soon!</div>}
      {onboard === "rent" && <div className="anim-rise rounded-2xl bg-[var(--accent)]/20 p-2.5 text-xs">👇🏾 Pick a house on the map or the list, then pay the rent to move in.</div>}
      <HouseMap homes={data.homes} sel={sel} mine={data.mine} onSelect={setSel} />
      {h && (
        <div key={h.id} className="anim-pop rounded-2xl bg-white/7 p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-black">{h.name}</div>
              <div className="text-xs opacity-70">{h.duplex ? "🏡 Duplex" : "🏠 Bungalow"} · {mine ? "yours" : h.taken ? `🔑 @${h.owner} lives here` : "✨ available"}</div>
            </div>
            <div className="text-right">
              <div className="font-black text-[var(--accent)]">{naira(h.rent)}</div>
              <div className="text-[10px] opacity-60">per {data.days} days</div>
            </div>
          </div>
          {mine ? (
            <>
              <div className="mt-2 text-xs text-green-400">✓ Your house · rent paid for {daysLeft} more day{daysLeft === 1 ? "" : "s"}</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button className="btn btn-primary py-2 text-sm" onClick={() => {
                  if (homeGeo && useGame.getState().mapId === "hub_plaza") { useGame.getState().set({ guide: { x: homeGeo.door[0], z: homeGeo.door[1], label: "🏠 Home" } }); walkTo(homeGeo.spawn[0], homeGeo.spawn[1]); }
                  else useGame.getState().toast("Ride back to Lagos first 🚌");
                  useGame.getState().closePhone();
                }}>🧭 Walk me home</button>
                <button className="btn btn-ghost py-2 text-sm" disabled={busy || balance < h.rent} onClick={rent}>Renew +{data.days}d</button>
                <button className="btn btn-ghost col-span-2 py-2 text-sm" onClick={() => {
                  if (local.insideHome === h.id) void startDecorating();
                  else { useGame.getState().toast("Walk inside your house, then tap 🛋️ Decor"); if (homeGeo) walkTo(homeGeo.spawn[0], homeGeo.spawn[1]); useGame.getState().closePhone(); }
                }}>🛋️ Decorate my house</button>
              </div>
            </>
          ) : h.taken ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button className="btn btn-primary py-2 text-sm" disabled={!h.owner_online} onClick={() => {
                if (homeGeo && useGame.getState().mapId === "hub_plaza") { useGame.getState().set({ guide: { x: homeGeo.door[0], z: homeGeo.door[1], label: `🚪 Knock here` } }); walkTo(homeGeo.door[0], homeGeo.door[1]); }
                else useGame.getState().toast("Ride back to Lagos first 🚌");
                useGame.getState().closePhone();
              }}>{h.owner_online ? "🧭 Visit" : "😴 Not home"}</button>
              <button className="btn btn-ghost py-2 text-sm" onClick={() => { useGame.getState().closePhone(); useGame.getState().set({ card: h.owner_id }); }}>👤 @{h.owner}</button>
            </div>
          ) : (
            <button className="btn btn-primary mt-3 w-full" disabled={busy || balance < h.rent} onClick={rent}>
              {balance < h.rent ? "Your money no reach" : data.mine ? `Move here · pay ${naira(h.rent)}` : `Rent & move in · ${naira(h.rent)}`}
            </button>
          )}
        </div>
      )}
      <div className="divide-y divide-white/10 overflow-hidden rounded-2xl bg-white/5">
        {data.homes.map((x) => (
          <button key={x.id} className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${x.id === sel ? "bg-[var(--accent)]/20" : ""}`} onClick={() => setSel(x.id)}>
            <span>{x.id === data.mine ? "🔑 " : x.duplex ? "🏡 " : "🏠 "}{x.name}</span>
            <span className="text-xs opacity-75">{x.id === data.mine ? "yours" : x.taken ? `@${x.owner}` : nairaShort(x.rent)}</span>
          </button>
        ))}
      </div>
      <p className="text-[10px] opacity-50">In-game naira only. Rent lasts {data.days} days; renew any time. If rent runs out, the house can go to someone new.</p>
    </div>
  );
}

/** Top-down street map of the hub with every house (tap one to select it). */
function HouseMap({ homes, sel, mine, onSelect }: { homes: HouseInfo[]; sel: string | null; mine: string | null; onSelect: (id: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hub = useGame((s) => s.content?.maps.hub_plaza);
  const onHub = useMap()?.id === "hub_plaza";
  useTicker(500);
  const geo = hub?.homes ?? [];
  const [x0, z0, x1, z1] = hub?.bounds ?? [0, 0, 1, 1];
  const W = 320, S = W / (x1 - x0);
  useEffect(() => {
    const c = ref.current, ctx = c?.getContext("2d");
    if (!c || !ctx || !hub) return;
    ctx.fillStyle = "#c9b48f";
    ctx.fillRect(0, 0, W, W);
    for (const p of hub.props) {
      if (p.kind === "road") { ctx.fillStyle = "#3b3f46"; ctx.fillRect((p.x - p.w / 2 - x0) * S, (p.z - p.d / 2 - z0) * S, p.w * S, p.d * S); }
      else if (p.kind === "lawn" || p.kind === "field") { ctx.fillStyle = "#7bb661"; ctx.fillRect((p.x - p.w / 2 - x0) * S, (p.z - p.d / 2 - z0) * S, p.w * S, p.d * S); }
    }
    for (const z of hub.zones) {
      ctx.fillStyle = z.kind === "bus_stop" ? "#f7c500" : z.kind === "phone_shop" ? "#b48cff" : "#ff7a1a";
      ctx.fillRect((z.rect[0] - x0) * S, (z.rect[1] - z0) * S, (z.rect[2] - z.rect[0]) * S, (z.rect[3] - z.rect[1]) * S);
    }
    for (const h of geo) {
      const on = h.id === sel, own = h.id === mine, taken = homes.find((x) => x.id === h.id)?.taken;
      ctx.fillStyle = on ? "#2f7cf6" : own ? "#39d353" : taken ? "#8a8f96" : "#f2e6cf";
      ctx.strokeStyle = on ? "#ffffff" : "#6b4a2b";
      ctx.lineWidth = on ? 2.5 : 1;
      const r = h.rect;
      ctx.fillRect((r[0] - x0) * S, (r[1] - z0) * S, (r[2] - r[0]) * S, (r[3] - r[1]) * S);
      ctx.strokeRect((r[0] - x0) * S, (r[1] - z0) * S, (r[2] - r[0]) * S, (r[3] - r[1]) * S);
    }
    if (onHub) {
      ctx.fillStyle = "#ff3b30";
      ctx.beginPath();
      ctx.arc((local.x - x0) * S, (local.z - z0) * S, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  const pick = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const wx = x0 + ((e.clientX - r.left) / r.width) * (x1 - x0), wz = z0 + ((e.clientY - r.top) / r.height) * (z1 - z0);
    let best: string | null = null, bd = 12;
    for (const h of geo) {
      const d = Math.hypot((h.rect[0] + h.rect[2]) / 2 - wx, (h.rect[1] + h.rect[3]) / 2 - wz);
      if (d < bd && homes.some((x) => x.id === h.id)) { bd = d; best = h.id; }
    }
    if (best) { onSelect(best); sound.play("click"); }
  };
  return (
    <div className="relative overflow-hidden rounded-2xl">
      <canvas ref={ref} width={W} height={W} className="block aspect-square w-full" onPointerDown={pick} />
      <div className="absolute bottom-1.5 left-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[10px]">🔴 you · 🟦 selected · 🟩 yours · ⬜ free · ◼️ taken</div>
    </div>
  );
}

// ------------------------------------------------------------------ Events
function EventsApp() {
  const items = [
    { icon: "🎭", name: "Eyo Festival Hide-off", text: "City-wide game across Lagos Island with masquerade disguises." },
    { icon: "🌙", name: "Detty December Night Hunt", text: "Lights off, torches on. Hide in the dark streets of the hub." },
    { icon: "🏆", name: "Weekend Boju League", text: "Top seekers and hiders win trophies and bragging rights." },
  ];
  return (
    <div className="space-y-3">
      <div className="anim-pop rounded-3xl bg-gradient-to-br from-[#ff7ab6] to-[#6c3fd6] p-4 text-center">
        <div className="text-4xl">🎉</div>
        <div className="mt-1 text-lg font-black">Events are coming soon</div>
        <div className="text-xs opacity-85">Big group games, festivals and leagues. Watch this space!</div>
      </div>
      {items.map((e, i) => (
        <div key={e.name} className="anim-rise flex gap-3 rounded-2xl bg-white/7 p-3" style={{ animationDelay: `${100 + i * 70}ms` }}>
          <span className="text-3xl">{e.icon}</span>
          <span className="text-sm"><b className="block">{e.name}</b><span className="opacity-75">{e.text}</span></span>
          <span className="ml-auto self-center rounded-full bg-white/10 px-2 py-0.5 text-[10px]">Soon</span>
        </div>
      ))}
    </div>
  );
}
