import { decode, encode } from "@msgpack/msgpack";
import { WS_URL, refreshToken, type Account } from "./api";
import { useGame } from "./store";
import type { ChatMsg, GroupState, Home, PlacedItem, RosterEntry, Standing } from "./types";
import { setAllFurniture, setHomeFurniture } from "@/game/furniture";
import { sound } from "@/game/sound";
import { cam, clock, fx, local, pushSnapshot, remotes } from "@/game/state";

type Msg = { t: string } & Record<string, unknown>;

/** One WebSocket per player, msgpack frames, auto-reconnect. Mirrors backend/app/realtime/protocol.py. */
class Net {
  private ws: WebSocket | null = null;
  private account: Account | null = null;
  private retry = 0;
  private closedByUs = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastMsgAt = 0;
  private watching = false;

  start(account: Account): void {
    this.account = account;
    this.closedByUs = false;
    this.open();
    this.watchLifecycle();
  }

  /**
   * Phones freeze a minimised app, and the socket often comes back "open" but dead. On coming back (or getting
   * signal again), reconnect straight away instead of waiting out a long retry: your stand-in kept your place,
   * so you simply carry on from where it is.
   */
  private watchLifecycle(): void {
    if (this.watching || typeof window === "undefined") return;
    this.watching = true;
    // wall-clock time: phones pause performance.now() while the app is in the background, so a socket that died
    // while you were away still looked "fresh" — your taps went nowhere and the screen froze (e.g. on the dice)
    let hiddenAt = 0;
    const reconnect = () => {
      if (this.closedByUs || !this.account) return;
      const ws = this.ws;
      this.retry = 0;
      this.ws = null; // the old socket's close handler must not schedule another reconnect
      try { ws?.close(); } catch { /* already gone */ }
      this.open();
    };
    const revive = () => {
      if (this.closedByUs || !this.account) return;
      if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
      const away = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      const ws = this.ws;
      if (ws?.readyState === WebSocket.CONNECTING) return;
      // back after more than a moment: always start a fresh connection (cheap, and never a silent dead one)
      if (away > 2500 || ws?.readyState !== WebSocket.OPEN || Date.now() - this.lastMsgAt > 6000) reconnect();
    };
    document.addEventListener("visibilitychange", revive);
    window.addEventListener("pageshow", revive);
    window.addEventListener("online", revive);
    window.addEventListener("focus", revive);
    // a dead socket that never says so: no word from the server for a while while you're looking at the game
    setInterval(() => {
      if (document.visibilityState === "visible" && this.ws?.readyState === WebSocket.OPEN && Date.now() - this.lastMsgAt > 12000) reconnect();
    }, 4000);
  }

  stop(): void {
    this.closedByUs = true;
    this.ws?.close();
    if (this.pingTimer) clearInterval(this.pingTimer);
  }

  send(msg: Msg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encode(msg));
  }

  private open(): void {
    if (!this.account) return;
    const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(this.account.token)}`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.lastMsgAt = Date.now();
      useGame.getState().set({ connected: true });
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.send({ t: "ping" }), 5000);
    };
    ws.onmessage = (ev) => {
      this.lastMsgAt = Date.now();
      try {
        this.onMessage(decode(new Uint8Array(ev.data as ArrayBuffer)) as Msg);
      } catch (e) {
        console.warn("bad frame", e);
      }
    };
    ws.onclose = async (ev) => {
      useGame.getState().set({ connected: false });
      if (this.closedByUs || this.ws !== ws) return;
      if (ev.code === 4001 && this.account) {
        try {
          this.account = await refreshToken(this.account);
        } catch {
          useGame.getState().toast("Session expired — reload the page", "error");
          return;
        }
      }
      const delay = Math.min(8000, 500 * 2 ** this.retry++);
      setTimeout(() => this.open(), delay);
    };
  }

  private onMessage(m: Msg): void {
    const g = useGame.getState();
    switch (m.t) {
      case "hello": {
        clock.offset = (m.server_time as number) - Date.now();
        g.set({ me: m.me as { id: string; nick: string; n: number }, home: (m.home as Home | null) ?? null });
        // the server says we're not in a game (it ended while we were away): drop any stale game screens
        if (m.in_group === false && g.group) { g.set({ group: null, over: null, dice: null, stayed: false, rematch: null }); local.frozen = false; }
        break;
      }
      case "pong":
        clock.offset = clock.offset * 0.8 + ((m.server_time as number) - Date.now()) * 0.2;
        break;
      case "zone":
        remotes.clear();
        cam.aerial.on = false;
        local.path = [];
        g.setBend(false); // never arrive somewhere still bent down
        local.sit = local.lie = local.drive = false;
        local.seatTarget = null;
        g.set({ aerial: false, sitting: false, sleeping: false, seatAsk: false, decor: null, stayed: false, driving: false, mapOpen: false });
        if (g.pin?.kind === "here" && g.pin.map !== (m.map as string)) g.set({ pin: null });
        if (g.pin?.kind === "trip" && g.pin.to === (m.map === "hub_plaza" ? "hub" : (m.map as string))) g.set({ pin: null }); // arrived
        local.x = m.x as number;
        local.z = m.z as number;
        g.set({ mapId: m.map as string });
        break;
      case "tp":
        local.x = m.x as number;
        local.z = m.z as number;
        local.path = [];
        local.sit = local.lie = false;
        g.set({ sitting: false, sleeping: false });
        break;
      case "home": {
        const home = (m.home as Home | null) ?? null;
        g.set({ home, life: { ...g.life, homeId: home?.id ?? null } });
        break;
      }
      case "furn_all":
        setAllFurniture(m.homes as Record<string, PlacedItem[]>);
        break;
      case "furn":
        setHomeFurniture(m.home as string, m.items as PlacedItem[]);
        break;
      case "doors":
        g.set({ doorOwners: m.owners as Record<string, string> });
        break;
      case "door": {
        const h = m.home as string;
        g.set({ openDoors: m.open ? [...g.openDoors.filter((x) => x !== h), h] : g.openDoors.filter((x) => x !== h) });
        break;
      }
      case "knock":
        g.set({ knock: { from: m.from as string, nick: m.nick as string, home: m.home as string, at: Date.now() } });
        sound.play("door");
        break;
      case "wsnap":
        if (!m.code) {
          if (g.watching) g.toast("That game don finish 🏁");
          g.set({ watching: null, wsnap: null });
        } else if (g.watching === m.code) g.set({ wsnap: m as unknown as NonNullable<typeof g.wsnap> });
        break;
      case "rematch_ask":
        g.set({ rematch: { kind: "asked", from: m.from as string, nick: m.nick as string, until: Date.now() + (m.secs as number) * 1000 } });
        sound.play("pop");
        break;
      case "rematch_wait":
        g.set({ rematch: { kind: "waiting", n: m.n as number, until: Date.now() + (m.secs as number) * 1000 } });
        break;
      case "rematch_end":
        g.set({ rematch: null });
        break;
      case "invite":
        g.set({ invite: { from: m.from as string, nick: m.nick as string, code: m.code as string, at: Date.now() } });
        sound.play("pop");
        break;
      case "dm":
        g.set({ dmLive: { from: m.from as string, username: m.username as string, text: m.text as string, id: m.id as number, ts: m.ts as number } });
        if (!(g.phoneOpen && g.phoneApp === `dm:${m.from as string}`)) {
          g.set({ dmUnread: g.dmUnread + 1 });
          const code = (m.text as string).match(/Join my Boju Boju game: ([A-Z0-9]{4,6})/)?.[1];
          g.toast(code ? `🙈 @${m.username as string} invited you to game ${code} — 📱 Messages to join` : `💬 ${m.username as string}: ${m.text as string}`, code ? "good" : "info");
          sound.play("pop");
        }
        break;
      case "friend":
        g.set({ friendsVersion: g.friendsVersion + 1, ...(m.event === "pending" ? { friendReqs: g.friendReqs + 1 } : {}) });
        if (m.event === "pending") g.toast(`👋 ${(m.username as string) ?? "Someone"} wants to be your friend — open 📱 Messages`, "good");
        else if (m.event === "accepted") g.toast(`🤝 ${(m.username as string) ?? "Your friend"} is now your friend!`, "good");
        break;
      case "corr":
        local.x = m.x as number;
        local.z = m.z as number;
        break;
      case "snap":
        pushSnapshot(m.ts as number, m.p as number[][]);
        break;
      case "roster": {
        const roster: Record<number, RosterEntry> = {};
        for (const r of m.players as RosterEntry[]) roster[r.n] = r;
        g.set({ roster });
        break;
      }
      case "wallet":
        if ((m.balance as number) > g.balance && g.balance > 0) sound.play("coin");
        g.set({ balance: m.balance as number, hunger: m.hunger as number });
        break;
      case "g_state": {
        const gs = m as unknown as GroupState;
        const prev = g.group;
        g.set({ group: gs });
        if (g.pendingInvite && gs.phase === "lobby" && gs.creator === g.me?.id) {
          this.send({ t: "g_invite", to: g.pendingInvite });
          g.set({ pendingInvite: null });
        }
        const me = g.me?.id;
        local.frozen = !!me && benched(gs, me);
        announce(gs, prev, me);
        break;
      }
      case "g_left":
        g.set({ group: null, over: null, dice: null, stayed: false });
        local.frozen = false;
        break;
      case "g_dice":
        g.set({ dice: { rolls: m.rolls as number[], seeker: m.seeker as string, numbers: (m.numbers as Record<string, number>) ?? {}, at: Date.now() } });
        sound.play("dice");
        break;
      case "g_tag":
        if (m.ok) {
          const mine = m.target === g.me?.id;
          g.toast(mine ? "Boju don catch you! 😩" : `Mo ti ri e! ${m.nick as string} don cast!`, mine ? "error" : "good");
          sound.play(mine ? "caught" : "gotcha");
          fx.shake = mine ? 1 : 0.5;
        } else {
          g.toast((m.msg as string) ?? "Missed", "error");
          sound.play("error");
        }
        break;
      case "g_over":
        g.set({ over: { gameId: m.game_id as string, results: m.results as Standing[] } });
        sound.play("win");
        break;
      case "g_event":
        break;
      case "ride":
        g.setBend(false);
        local.sit = false;
        g.set({
          sitting: false,
          over: m.dir === "home" ? null : g.over,
          ride: { until: Date.now() + (m.seconds as number) * 1000, seconds: m.seconds as number, mode: (m.mode as string) ?? "danfo", arena: (m.arena as string) ?? "", dir: m.dir === "home" ? "home" : "go" },
        });
        sound.play("horn");
        break;
      case "chat":
        g.addChat(m as unknown as ChatMsg);
        break;
      case "chat_hist":
        g.set({ chat: (m.msgs as ChatMsg[]).filter((c) => !g.muted.includes(c.from)) });
        break;
      case "emote":
        g.set({
          emotes: [...g.emotes.filter((e) => e.until > Date.now()), { n: m.n as number, text: m.text as string, until: Date.now() + 3000 }],
        });
        g.addChat({ ch: "group", from: m.from as string, nick: m.nick as string, text: m.text as string, ts: Date.now() });
        break;
      case "toast":
        g.toast(m.msg as string);
        break;
      case "err":
        if (m.msg === "You are not in a group" && (g.group || Date.now() - staleClearedAt < 4000)) {
          // our game already ended on the server: clear it instead of showing the error again and again
          if (g.group) {
            g.set({ group: null, over: null, dice: null, stayed: false, rematch: null });
            local.frozen = false;
            staleClearedAt = Date.now();
            g.toast("That game has ended");
          }
          break;
        }
        g.toast(m.msg as string, "error");
        sound.play("error");
        break;
      case "kicked":
        this.closedByUs = true;
        g.toast(m.msg as string, "error");
        break;
    }
  }
}

let staleClearedAt = 0;

function announce(gs: GroupState, prev: GroupState | null, me: string | undefined): void {
  const g = useGame.getState();
  if (prev?.phase === gs.phase) return;
  const seeker = gs.round?.seeker;
  switch (gs.phase) {
    // what to do at each step is said by the Coach (the timer bar) — no stacked toasts on top of it
    case "gather":
      if (gs.gather) g.set({ guide: { x: gs.gather.center[0], z: gs.gather.center[1], label: "⭕ The circle" } });
      break;
    case "dice": g.set({ dice: null, guide: null }); break;
    case "hide":
      if (seeker === me) { cam.aerial.on = false; g.set({ aerial: false }); }
      break;
    case "seek":
      sound.play("whistle");
      break;
  }
}

export const net = new Net();

/**
 * You stay put when it isn't your turn to move: Boju counting with eyes closed, and anyone out of the round (caught,
 * done as Boju, or sitting it out) waits in the stands until the next round instead of wandering the field.
 */
function benched(gs: GroupState, me: string): boolean {
  const r = gs.round;
  const m = gs.members.find((x) => x.id === me);
  if (!m || m.left || gs.phase === "lobby" || gs.phase === "over") return false;
  if (m.retired) return true;
  if (!r) return false;
  if (gs.phase === "result") return r.state[me] === "found"; // the caught wait in the stands for the next round
  if (gs.phase !== "hide" && gs.phase !== "seek") return false;
  if (r.seeker === me) return gs.phase === "hide";
  return r.state[me] !== "hiding";
}
