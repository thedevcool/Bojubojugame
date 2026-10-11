"use client";

import { useCallback, useEffect, useState } from "react";
import { adminAct, adminAdImage, adminListAds, naira, type AdminAd } from "@/lib/api";

/** Approve / reject paid wall ads. Protected by ADMIN_TOKEN on the server (kept in this tab only). */
export default function Admin() {
  const [token, setToken] = useState("");
  const [input, setInput] = useState("");
  const [ads, setAds] = useState<AdminAd[] | null>(null);
  const [imgs, setImgs] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { try { setToken(sessionStorage.getItem("boju.admin") ?? ""); } catch { /* ignore */ } }, []);

  const load = useCallback(async (t: string) => {
    setErr("");
    try {
      const r = await adminListAds(t);
      setAds(r.ads);
      try { sessionStorage.setItem("boju.admin", t); } catch { /* ignore */ }
      for (const a of r.ads) adminAdImage(t, a.id).then((u) => setImgs((m) => ({ ...m, [a.id]: u }))).catch(() => {});
    } catch (e) {
      setAds(null);
      setErr(e instanceof Error ? e.message : "Failed");
      try { sessionStorage.removeItem("boju.admin"); } catch { /* ignore */ }
    }
  }, []);
  useEffect(() => { if (token) load(token); }, [token, load]);

  const act = async (id: string, action: "approve" | "reject" | "remove") => {
    if (action !== "approve" && !confirm(action === "reject" ? "Reject and refund this ad?" : "Take this live ad down (no refund)?")) return;
    setBusy(id);
    try { await adminAct(token, id, action); await load(token); } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    setBusy(null);
  };

  if (!token || !ads) {
    return (
      <main className="flex min-h-full items-center justify-center p-6">
        <form className="panel w-full max-w-sm p-5" onSubmit={(e) => { e.preventDefault(); setToken(input.trim()); load(input.trim()); }}>
          <h1 className="text-lg font-black">Boju admin</h1>
          <input type="password" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Admin token"
            className="mt-3 w-full rounded-xl bg-white/10 px-3 py-2.5 text-sm outline-none" />
          {err && <div className="mt-2 text-sm text-red-300">{err}</div>}
          <button className="btn btn-primary mt-3 w-full">Open</button>
        </form>
      </main>
    );
  }

  const groups: [string, AdminAd[]][] = [["Waiting for review", ads.filter((a) => a.status === "review")], ["Live", ads.filter((a) => a.status === "live")]];
  return (
    <main className="mx-auto max-w-3xl p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black">📢 Wall ads</h1>
        <button className="btn btn-ghost text-sm" onClick={() => load(token)}>Refresh</button>
      </div>
      {err && <div className="mt-2 text-sm text-red-300">{err}</div>}
      {groups.map(([name, list]) => (
        <section key={name} className="mt-5">
          <h2 className="text-sm font-bold uppercase tracking-wide opacity-70">{name} ({list.length})</h2>
          {list.length === 0 && <div className="mt-2 text-sm opacity-60">Nothing here.</div>}
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {list.map((a) => (
              <div key={a.id} className="panel p-3" data-testid="admin-ad">
                {imgs[a.id]
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={imgs[a.id]} alt={a.title} className="w-full rounded-lg bg-white object-contain" />
                  : <div className="grid h-32 place-items-center rounded-lg bg-white/5 text-xs opacity-60">loading…</div>}
                <div className="mt-2 font-bold">{a.title}</div>
                <div className="text-xs opacity-70">{a.size.toUpperCase()} · {naira(a.price)} · {a.map_id} · by @{a.by} · {a.email}</div>
                {a.live_until && <div className="text-xs opacity-70">Until {new Date(a.live_until).toLocaleString()}</div>}
                <div className="mt-2 flex gap-2">
                  {a.status === "review" ? (
                    <>
                      <button disabled={busy === a.id} className="btn btn-leaf flex-1 text-sm" onClick={() => act(a.id, "approve")}>Approve</button>
                      <button disabled={busy === a.id} className="btn btn-ghost flex-1 text-sm" onClick={() => act(a.id, "reject")}>Reject + refund</button>
                    </>
                  ) : (
                    <button disabled={busy === a.id} className="btn btn-ghost flex-1 text-sm" onClick={() => act(a.id, "remove")}>Take down</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
