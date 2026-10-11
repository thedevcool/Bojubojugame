"use client";

import { useEffect, useRef, useState } from "react";
import { local, cam } from "@/game/state";
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
import { useMap, useRole, useTicker } from "./hooks";

interface App { id: string; name: string; icon: string; bg: string; needsPhone?: boolean }

const APPS: App[] = [
  { id: "boju", name: "Boju Boju", icon: "🙈", bg: "from-[#4f95ff] to-[#1d5fd6]", needsPhone: true },
  { id: "messages", name: "Messages", icon: "💬", bg: "from-[#5be27a] to-[#1fa847]", needsPhone: true },
  { id: "houses", name: "Houses", icon: "🏠", bg: "from-[#ffb057] to-[#e8731a]", needsPhone: true },
  { id: "wallet", name: "Wallet", icon: "₦", bg: "from-[#1d2b44] to-[#0a1324]" },
  { id: "map", name: "Map", icon: "🛰️", bg: "from-[#7fd8ff] to-[#2a8fd6]", needsPhone: true },
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

export default function Phone() {
  const open = useGame((s) => s.phoneOpen);
  const app = useGame((s) => s.phoneApp);
  const openApp = useGame((s) => s.openApp);
  const close = useGame((s) => s.closePhone);
  const model = useGame((s) => s.content?.config.phones.find((p) => p.id === s.life.phoneId));
  const hasPhone = !!model;
  const inGroup = useGame((s) => !!s.group);
  const { isSeeker, inGame } = useRole();

  // launching "action" apps closes the phone and does the thing in the world
  useEffect(() => {
    if (!open || !app) return;
    if (app === "map") {
      close();
      if (isSeeker && inGame) { useGame.getState().toast("Boju no fit use the map while seeking 😅", "error"); return; }
      Object.assign(cam.aerial, { on: true, x: local.x, z: local.z, h: 40, tx: local.x, tz: local.z, th: 60, vx: 0, vz: 0, drag: false });
      useGame.getState().set({ aerial: true });
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
  }, [open, app, close, isSeeker, inGame]);

  if (!open) return null;
  const inApp = app && app !== "map" && app !== "camera";
  const title = app?.startsWith("dm:") ? names.get(app.slice(3)) ?? "Chat" : app ? TITLES[app] : "";
  const back = () => (app?.startsWith("dm:") ? openApp("messages") : openApp(null));
  return (
    <div className="anim-fade pointer-events-auto absolute inset-0 z-50 flex items-end justify-center bg-black/45 backdrop-blur-[3px] sm:items-center"
      onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="anim-phone relative mb-[max(env(safe-area-inset-bottom),8px)] flex h-[min(46rem,90dvh)] w-[min(23rem,94vw)] flex-col overflow-hidden rounded-[3rem] border-[9px] bg-[#0a1324] shadow-2xl"
        style={{ borderColor: model?.color ?? "#1c2433" }}>
        <StatusBar />
        <div className="relative min-h-0 flex-1">
          {inApp ? (
            <div key={app} className="anim-app absolute inset-0 flex flex-col bg-[#0d1830]">
              <div className="flex items-center gap-2 px-3 pb-2 pt-1">
                <button className="rounded-full px-2 py-1 text-sm font-semibold text-[var(--accent)] active:opacity-60" onClick={back}>‹ Back</button>
                <div className="min-w-0 flex-1 truncate text-center text-[15px] font-bold">{title}</div>
                <span className="w-14" />
              </div>
              <div className={`touch-scroll min-h-0 flex-1 px-3 pb-4 ${app === "messages" || app?.startsWith("dm:") ? "flex flex-col" : ""}`}>
                {!hasPhone && APPS.find((a) => a.id === app)?.needsPhone && !(app === "boju" && inGroup) ? <NoPhone /> : <AppBody app={app} />}
              </div>
            </div>
          ) : (
            <HomeScreen hasPhone={hasPhone} />
          )}
        </div>
        <button aria-label="Home" className="mx-auto mb-2 mt-1 h-1.5 w-32 shrink-0 rounded-full bg-white/70 active:bg-white" onClick={() => (inApp ? openApp(null) : close())} />
      </div>
    </div>
  );
}

function StatusBar() {
  useTicker(10000);
  const hunger = useGame((s) => s.hunger);
  const connected = useGame((s) => s.connected);
  const now = new Date();
  return (
    <div className="relative flex h-9 shrink-0 items-center justify-between px-6 text-[13px] font-semibold">
      <span className="tabular-nums">{now.getHours()}:{String(now.getMinutes()).padStart(2, "0")}</span>
      <span className="absolute left-1/2 top-1.5 h-6 w-24 -translate-x-1/2 rounded-full bg-black" />
      <span className="flex items-center gap-1.5 text-[11px]">
        <span>{connected ? "📶" : "⚠️"}</span>
        <span className="flex items-center gap-0.5" title="Battery = your belle">
          <span className="relative h-2.5 w-5 rounded-[3px] border border-white/70">
            <span className={`absolute inset-y-px left-px rounded-[1px] ${hunger < 25 ? "bg-red-400" : "bg-white"}`} style={{ width: `${Math.max(6, hunger) * 0.16}px` }} />
          </span>
        </span>
      </span>
    </div>
  );
}

function HomeScreen({ hasPhone }: { hasPhone: boolean }) {
  const openApp = useGame((s) => s.openApp);
  const balance = useGame((s) => s.balance);
  const username = useGame((s) => s.life.username || s.me?.nick || "");
  const home = useGame((s) => s.home);
  const badges: Record<string, number> = {
    messages: useGame((s) => s.unread + s.dmUnread + s.friendReqs),
    boju: useGame((s) => (s.group ? 1 : 0)),
  };
  useTicker(30000);
  const now = new Date();
  const icon = (a: App, i: number, dock = false) => {
    const locked = a.needsPhone && !hasPhone;
    return (
      <button key={a.id} aria-label={a.name} className="anim-pop flex flex-col items-center gap-1 active:scale-90" style={{ animationDelay: `${60 + i * 25}ms`, transition: "transform .2s var(--ease-spring)" }}
        onClick={() => { sound.play("click"); openApp(a.id); }}>
        <span className={`relative grid h-[3.4rem] w-[3.4rem] place-items-center rounded-[1.05rem] bg-gradient-to-b text-[1.7rem] font-black shadow-md ${a.bg} ${locked ? "opacity-40 grayscale" : ""}`}>
          {a.icon}
          {(badges[a.id] ?? 0) > 0 && <span className="absolute -right-1.5 -top-1.5 min-w-[20px] rounded-full bg-red-500 px-1 text-[11px] font-bold">{a.id === "boju" ? "●" : badges[a.id]}</span>}
        </span>
        {!dock && <span className="max-w-[4.4rem] truncate text-[11px] text-white/90">{a.name}</span>}
      </button>
    );
  };
  return (
    <div className="absolute inset-0 flex flex-col bg-[radial-gradient(120%_80%_at_20%_0%,#3d82ff_0%,#1a3f8f_45%,#0a1324_100%)] px-4">
      <div className="anim-rise mt-3 text-center">
        <div className="text-5xl font-thin tabular-nums tracking-tight">{now.getHours()}:{String(now.getMinutes()).padStart(2, "0")}</div>
        <div className="text-xs opacity-80">{now.toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "long" })}</div>
      </div>
      <div className="anim-rise mt-4 grid grid-cols-2 gap-2 text-left" style={{ animationDelay: "60ms" }}>
        <button className="rounded-2xl bg-white/12 p-2.5 backdrop-blur" onClick={() => openApp("wallet")}>
          <div className="text-[10px] uppercase opacity-70">Wallet</div>
          <div className="text-lg font-black">{nairaShort(balance)}</div>
          <div className="text-[9px] opacity-60">not real money</div>
        </button>
        <button className="rounded-2xl bg-white/12 p-2.5 backdrop-blur" onClick={() => openApp("houses")}>
          <div className="text-[10px] uppercase opacity-70">Home</div>
          <div className="truncate text-sm font-bold">{home ? home.name : "No house yet"}</div>
          <div className="truncate text-[10px] opacity-70">@{username}</div>
        </button>
      </div>
      {!hasPhone && (
        <div className="anim-rise mt-3 rounded-2xl bg-black/35 p-3 text-xs">
          <b>🎒 This is your pocket.</b> Buy a phone at the 📱 phone shop to unlock Boju Boju, Messages, Houses and more.
          <button className="btn btn-primary mt-2 w-full py-1.5 text-xs" onClick={() => { goToShop(); useGame.getState().closePhone(); }}>🧭 Walk me to the phone shop</button>
        </div>
      )}
      <div className="mt-5 grid grid-cols-4 gap-x-2 gap-y-4">{APPS.filter((a) => !DOCK.includes(a.id)).map((a, i) => icon(a, i))}</div>
      <div className="mt-auto mb-2 grid grid-cols-4 gap-2 rounded-[1.6rem] bg-white/15 p-2.5 backdrop-blur-md">
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
        <div className="py-6 text-center text-sm opacity-70">No friends yet. Add your padi by their username — then chat and invite them to your games. 🙈</div>
      ) : (
        <div className="divide-y divide-white/10 overflow-hidden rounded-2xl bg-white/5">
          {data.friends.map((f) => (
            <button key={f.id} className="flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-white/10"
              onClick={() => { names.set(f.id, f.username); openApp(`dm:${f.id}`); }}>
              <span className="relative grid h-10 w-10 place-items-center rounded-full bg-gradient-to-b from-[#4f95ff] to-[#1d5fd6] font-bold uppercase">
                {f.username[0]}
                <span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#0d1830] ${f.online ? "bg-green-400" : "bg-gray-500"}`} />
              </span>
              <span className="flex-1"><span className="block font-semibold">@{f.username}</span><span className="text-xs opacity-60">{f.online ? "Online" : "Offline"}</span></span>
              {f.unread > 0 && <span className="rounded-full bg-[var(--accent)] px-2 text-xs font-bold">{f.unread}</span>}
              <span className="opacity-40">›</span>
            </button>
          ))}
        </div>
      )}
      {!!data?.outgoing.length && <div className="text-xs opacity-60">Waiting for: {data.outgoing.map((f) => `@${f.username}`).join(", ")}</div>}
    </div>
  );
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
              <div className={`max-w-[80%] rounded-[1.1rem] px-3 py-1.5 text-sm ${m.mine ? "rounded-br-md bg-[var(--accent)]" : "rounded-bl-md bg-white/12"}`}>
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
            className="w-full rounded-full bg-white/10 px-4 py-2 text-sm outline-none" />
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
        <span className="opacity-75">One family per house — visit anyone, any time.</span>
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
              </div>
            </>
          ) : h.taken ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button className="btn btn-primary py-2 text-sm" onClick={() => {
                if (homeGeo && useGame.getState().mapId === "hub_plaza") { useGame.getState().set({ guide: { x: homeGeo.door[0], z: homeGeo.door[1], label: `🏠 @${h.owner}` } }); walkTo(homeGeo.door[0], homeGeo.door[1]); }
                else useGame.getState().toast("Ride back to Lagos first 🚌");
                useGame.getState().closePhone();
              }}>🧭 Visit</button>
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
