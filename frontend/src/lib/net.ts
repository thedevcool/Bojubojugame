import { decode, encode } from "@msgpack/msgpack";
import { WS_URL, refreshToken, type Account } from "./api";
import { useGame } from "./store";
import type { ChatMsg, GroupState, Home, RosterEntry, Standing } from "./types";
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

  start(account: Account): void {
    this.account = account;
    this.closedByUs = false;
    this.open();
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
      useGame.getState().set({ connected: true });
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.send({ t: "ping" }), 5000);
    };
    ws.onmessage = (ev) => {
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
        break;
      }
      case "pong":
        clock.offset = clock.offset * 0.8 + ((m.server_time as number) - Date.now()) * 0.2;
        break;
      case "zone":
        remotes.clear();
        cam.aerial.on = false;
        g.set({ aerial: false });
        local.x = m.x as number;
        local.z = m.z as number;
        g.set({ mapId: m.map as string });
        break;
      case "tp":
        local.x = m.x as number;
        local.z = m.z as number;
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
        const me = g.me?.id;
        if (gs.round && me) local.frozen = gs.round.seeker === me && gs.phase === "hide";
        else local.frozen = false;
        announce(gs, prev, me);
        break;
      }
      case "g_left":
        g.set({ group: null, over: null, dice: null });
        local.frozen = false;
        break;
      case "g_dice":
        g.set({ dice: { rolls: m.rolls as number[], seeker: m.seeker as string, at: Date.now() } });
        sound.play("dice");
        break;
      case "g_tag":
        if (m.ok) {
          const mine = m.target === g.me?.id;
          g.toast(mine ? "Omo, you don cast! 😩" : `Mo ti ri e! ${m.nick as string} don cast!`, mine ? "error" : "good");
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
        g.set({ ride: { until: Date.now() + (m.seconds as number) * 1000, seconds: m.seconds as number, mode: (m.mode as string) ?? "danfo", arena: (m.arena as string) ?? "" } });
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

function announce(gs: GroupState, prev: GroupState | null, me: string | undefined): void {
  const g = useGame.getState();
  if (prev?.phase === gs.phase) return;
  const seeker = gs.round?.seeker;
  const nick = (id?: string | null) => gs.members.find((x) => x.id === id)?.nick ?? "?";
  switch (gs.phase) {
    case "travel": g.toast("Game don start! Waka go the Motor Park and board a danfo.", "good"); break;
    case "dice": g.set({ dice: null }); g.toast("Pick your number 1–6!"); break;
    case "hide":
      g.toast(seeker === me ? "You be Boju! Close your eyes…" : `Run! ${nick(seeker)} is counting!`, "good");
      if (seeker === me) { cam.aerial.on = false; g.set({ aerial: false }); }
      break;
    case "seek":
      g.toast(seeker === me ? "Open your eyes — go find them!" : "Boju is coming… hide well!", "good");
      sound.play("whistle");
      break;
  }
}

export const net = new Net();
