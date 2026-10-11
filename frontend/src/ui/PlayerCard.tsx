"use client";

import { useEffect, useState } from "react";
import { getCard, loadAccount, requestFriend, respondFriend, type PlayerCard as Card } from "@/lib/api";
import { net } from "@/lib/net";
import { useGame } from "@/lib/store";
import { SKIN } from "@/game/palette";

/** Tap a real player in the world: their Boju points, add friend, invite to Boju. */
export function PlayerCard() {
  const id = useGame((s) => s.card);
  const set = useGame((s) => s.set);
  const group = useGame((s) => s.group);
  const meId = useGame((s) => s.me?.id);
  const cfg = useGame((s) => s.content?.config);
  const [card, setCard] = useState<Card | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setCard(null);
    const acc = loadAccount();
    if (id && acc) getCard(acc, id).then(setCard).catch((e) => { useGame.getState().toast((e as Error).message, "error"); set({ card: null }); });
  }, [id, set]);
  if (!id) return null;
  const close = () => set({ card: null });
  const acc = loadAccount();
  const friend = async () => {
    if (!acc || !card) return;
    setBusy(true);
    try {
      if (card.relation === "incoming") await respondFriend(acc, card.id, true);
      else await requestFriend(acc, card.username);
      setCard({ ...card, relation: card.relation === "incoming" ? "friends" : "requested" });
      useGame.getState().toast(card.relation === "incoming" ? `🤝 You and @${card.username} are friends` : `Friend request sent to @${card.username} 👋`, "good");
    } catch (e) { useGame.getState().toast((e as Error).message, "error"); } finally { setBusy(false); }
  };
  const lobby = group?.phase === "lobby";
  const inMyGroup = !!group?.members.some((m) => m.id === id && !m.left);
  const invite = () => {
    if (!card) return;
    if (lobby) net.send({ t: "g_invite", to: card.id });
    else if (!group && cfg) {
      // no game yet: open a lobby with the default settings, then invite (see net.ts g_state)
      const arena = cfg.cities[0]?.arenas[0] ?? "arena_park";
      const safe = useGame.getState().content?.maps[arena]?.safe_houses[0]?.id ?? "";
      set({ pendingInvite: card.id });
      net.send({ t: "g_create", arena, hide: cfg.game.default_hide_time, search: cfg.game.default_search_time, safe, bots: 0 });
    }
  };
  const level = card ? Math.floor(card.points / 100) + 1 : 1;
  return (
    <div className="anim-fade pointer-events-auto absolute inset-0 z-50 flex items-end justify-center bg-black/35 sm:items-center" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="panel anim-sheet mb-[max(env(safe-area-inset-bottom),8px)] w-[min(24rem,96vw)] p-4">
        {!card ? <div className="py-8 text-center text-sm opacity-70">Loading…</div> : (
          <>
            <div className="flex items-center gap-3">
              <span className="relative grid h-14 w-14 place-items-center rounded-2xl text-3xl" style={{ background: SKIN[(card.avatar?.[0] ?? 0) % 8] }}>
                🙈
                <span className={`absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-[#0d1830] ${card.online ? "bg-green-400" : "bg-gray-500"}`} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xl font-black">@{card.username}</div>
                <div className="text-xs opacity-70">📍 {card.home_area} · Level {level}</div>
              </div>
              <button className="btn btn-ghost px-3 py-1" onClick={close}>✕</button>
            </div>
            <div className="anim-pop mt-3 rounded-2xl bg-gradient-to-br from-[#2f7cf6] to-[#1d4fb0] p-3 text-center">
              <div className="text-[11px] font-semibold uppercase tracking-wider opacity-80">Boju points</div>
              <div className="text-4xl font-black tabular-nums">{card.points.toLocaleString("en-NG")}</div>
              <div className="mt-2 grid grid-cols-3 gap-1 text-xs">
                <div><b className="block text-base">{card.finds}</b>found as Boju</div>
                <div><b className="block text-base">{card.escapes}</b>escapes</div>
                <div><b className="block text-base">{card.games}</b>games</div>
              </div>
            </div>
            {card.relation !== "self" && card.id !== meId && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {card.relation === "friends" ? (
                  <button className="btn btn-ghost" onClick={() => { close(); useGame.getState().openApp(`dm:${card.id}`); }}>💬 Message</button>
                ) : (
                  <button className="btn btn-ghost" disabled={busy || card.relation === "requested"} onClick={friend}>
                    {card.relation === "requested" ? "Request sent ✓" : card.relation === "incoming" ? "🤝 Accept friend" : "➕ Add friend"}
                  </button>
                )}
                <button className="btn btn-primary" disabled={!card.online || inMyGroup || (!!group && !lobby)} onClick={invite}>
                  {inMyGroup ? "In your game ✓" : !card.online ? "Offline" : lobby ? "🙈 Invite to Boju" : group ? "Game in progress" : "🙈 Play Boju with them"}
                </button>
              </div>
            )}
            <p className="mt-2 text-center text-[10px] opacity-50">10 points for every hider you find, 10 for every round you stay hidden.</p>
          </>
        )}
      </div>
    </div>
  );
}

/** "X invited you to Boju" prompt with one-tap Join. */
export function InviteBanner() {
  const inv = useGame((s) => s.invite);
  const group = useGame((s) => s.group);
  const set = useGame((s) => s.set);
  useEffect(() => {
    if (!inv) return;
    const t = setTimeout(() => set({ invite: null }), 25000);
    return () => clearTimeout(t);
  }, [inv, set]);
  if (!inv) return null;
  return (
    <div className="pointer-events-auto absolute left-1/2 top-[7.5rem] z-[61] w-[min(24rem,94vw)] -translate-x-1/2">
      <div className="panel anim-banner flex items-center gap-3 p-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--accent)] text-xl">🙈</span>
        <div className="min-w-0 flex-1 text-sm"><b>@{inv.nick}</b> invited you to play Boju · <span className="font-mono">{inv.code}</span></div>
        <button className="btn btn-primary px-3 py-1.5 text-sm" onClick={() => {
          if (group && group.phase !== "over") net.send({ t: "g_leave" });
          net.send({ t: "g_join", code: inv.code });
          set({ invite: null, phoneOpen: true, phoneApp: "boju" });
        }}>Join</button>
        <button className="btn btn-ghost px-2 py-1.5 text-sm" onClick={() => set({ invite: null })}>✕</button>
      </div>
    </div>
  );
}
