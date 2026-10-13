"use client";

import { useEffect, useMemo, useState } from "react";
import { adsState } from "@/lib/ads";
import { createAd, getAdsConfig, getAdsOnMap, getMe, getVatarConfig, loadAccount, naira, type AdRect, type AdsConfig, type AdSize } from "@/lib/api";
import { useGame, type AdSpot } from "@/lib/store";

/**
 * "Advertise here": pick a size that fits this wall without covering anyone else's ad,
 * add your poster, and pay with Paystack. REAL money — nothing to do with game naira.
 */

const GAP = 0.06; // keep posters a little apart (server: 0.05)

/** Position along the wall (horizontal) for this face. */
const alongOf = (s: { x: number; z: number; nx: number }) => (s.nx ? s.z : s.x);

function samePlane(spot: AdSpot, r: AdRect) {
  if (r.nx !== spot.nx || r.nz !== spot.nz) return false;
  return Math.abs(spot.nx ? r.x - spot.x : r.z - spot.z) <= 0.15;
}

/** Nearest free spot for a w×h poster to where you tapped, or null if this wall has no room for it. */
function place(spot: AdSpot, size: AdSize, taken: AdRect[], want: { a: number; y: number }) {
  const aMin = spot.lo + size.w / 2 + 0.05, aMax = spot.hi - size.w / 2 - 0.05;
  const yMin = 0.2 + size.h / 2 + 0.02, yMax = spot.top - size.h / 2 - 0.05;
  if (aMin > aMax || yMin > yMax) return null;
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  const others = taken.filter((r) => samePlane(spot, r));
  const free = (a: number, y: number) => others.every((r) => Math.abs(alongOf(r) - a) >= (r.w + size.w) / 2 + GAP || Math.abs(r.y - y) >= (r.h + size.h) / 2 + GAP);
  const a0 = clamp(want.a, aMin, aMax), y0 = clamp(want.y, yMin, yMax);
  if (free(a0, y0)) return { a: a0, y: y0 };
  const cands: { a: number; y: number; d: number }[] = [];
  for (let a = aMin; a <= aMax + 1e-6; a += 0.1)
    for (let y = yMin; y <= yMax + 1e-6; y += 0.1) cands.push({ a, y, d: Math.hypot(a - a0, y - y0) });
  cands.sort((p, q) => p.d - q.d);
  const c = cands.find((p) => free(p.a, p.y));
  return c ? { a: Math.round(c.a * 100) / 100, y: Math.round(c.y * 100) / 100 } : null;
}

/** Crop to the poster's shape and shrink to a JPEG under ~380 KB (the server takes 400 KB). */
async function prepareImage(file: File, aspect: number): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => bad(new Error("That file isn't an image we can read — use a JPG or PNG"));
      i.src = url;
    });
    let sw = img.naturalWidth, sh = img.naturalHeight;
    if (sw / sh > aspect) sw = sh * aspect; else sh = sw / aspect;
    const sx = (img.naturalWidth - sw) / 2, sy = (img.naturalHeight - sh) / 2;
    for (const width of [1024, 800, 640, 480]) {
      const c = document.createElement("canvas");
      c.width = Math.min(width, Math.round(sw));
      c.height = Math.round(c.width / aspect);
      const g = c.getContext("2d");
      if (!g) break;
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
      for (const q of [0.86, 0.75, 0.62]) {
        const out = c.toDataURL("image/jpeg", q);
        if ((out.length - 23) * 0.75 < 380_000) return out;
      }
    }
    throw new Error("That image is too big — try a smaller one");
  } finally {
    URL.revokeObjectURL(url);
  }
}

const ratio = (s?: AdSize) => {
  const r = s ? s.w / s.h : 4 / 3;
  return Math.abs(r - 4 / 3) < 0.02 ? "4:3" : Math.abs(r - 1.5) < 0.02 ? "3:2" : `${r.toFixed(2)}:1`;
};

export function AdSheet() {
  const spot = useGame((s) => s.adSheet);
  if (!spot) return null;
  return <Sheet key={spot.at} spot={spot} />;
}

function Sheet({ spot }: { spot: AdSpot }) {
  const set = useGame((s) => s.set);
  const mapName = useGame((s) => s.content?.maps[spot.map]?.name ?? "this place");
  const [cfg, setCfg] = useState<AdsConfig | null>(null);
  const [taken, setTaken] = useState<AdRect[]>([]);
  const [sizeId, setSizeId] = useState<string>("s");
  const [want, setWant] = useState({ a: alongOf(spot), y: spot.y });
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const close = () => set({ adSheet: null });
  // LagosLife mini version: no Paystack, no email — we approve first, then they pay in LagosLife
  const mini = useGame((s) => !!s.mini);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    Promise.all([getAdsConfig(), mini ? getVatarConfig() : null])
      .then(([c, v]) => { const enabled = v ? v.enabled : c.enabled; setCfg({ ...c, enabled }); adsState.enabled = enabled; })
      .catch(() => setErr("Couldn't load ad prices — check your network"));
    getAdsOnMap(spot.map).then((r) => setTaken(r.taken)).catch(() => {});
    const acc = loadAccount();
    if (acc && !mini) getMe(acc).then((m) => setEmail((e) => e || m.email || "")).catch(() => {});
  }, [spot.map, mini]);

  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const fits = useMemo(() => {
    const out: Record<string, { a: number; y: number } | null> = {};
    for (const s of cfg?.sizes ?? []) out[s.id] = place(spot, s, taken, want);
    return out;
  }, [cfg, spot, taken, want]);
  const size = cfg?.sizes.find((s) => s.id === sizeId);
  const at = size ? fits[size.id] : null;

  // keep a size that fits picked
  useEffect(() => {
    if (!cfg || (size && fits[size.id])) return;
    const first = cfg.sizes.find((s) => fits[s.id]);
    if (first) setSizeId(first.id);
  }, [cfg, fits, size]);

  // wall preview: as seen from the front (left-to-right on screen)
  const len = spot.hi - spot.lo;
  const sgn = spot.nx ? -spot.nx : spot.nz; // which way "right" runs along this wall
  const px = (a: number) => (sgn > 0 ? a - spot.lo : spot.hi - a);
  const tapPreview = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const u = ((e.clientX - r.left) / r.width) * len, v = (1 - (e.clientY - r.top) / r.height) * spot.top;
    setWant({ a: sgn > 0 ? spot.lo + u : spot.hi - u, y: v });
  };

  const pay = async () => {
    setErr("");
    const acc = loadAccount();
    if (!acc || !size || !at) return;
    if (title.trim().length < 2) return setErr("Add your brand or business name");
    if (!mini && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setErr("Add an email for your Paystack receipt");
    if (!file) return setErr("Add your poster image (JPG or PNG)");
    setBusy(true);
    try {
      const image = await prepareImage(file, size.w / size.h);
      const r = await createAd(acc, {
        map_id: spot.map, x: spot.nx ? spot.x : at.a, z: spot.nx ? at.a : spot.z, y: at.y, nx: spot.nx, nz: spot.nz,
        size: size.id, title: title.trim(), email: mini ? "" : email.trim(), image,
      });
      if (mini || !r.pay_url) {
        setSent(true);
        setBusy(false);
        set({ adsVersion: useGame.getState().adsVersion + 1 });
        return;
      }
      const payUrl = r.pay_url;
      try { sessionStorage.setItem("boju.adReturn", window.location.pathname + window.location.search); } catch { /* ignore */ }
      window.location.href = payUrl;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong — try again");
      setBusy(false);
      getAdsOnMap(spot.map).then((x) => setTaken(x.taken)).catch(() => {});
    }
  };

  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center" onClick={close}>
      <div data-testid="ad-sheet" className="panel anim-sheet touch-scroll max-h-[92%] w-full max-w-md overflow-y-auto rounded-b-none p-4 sm:rounded-b-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-amber-400 text-2xl leading-none">📢</span>
          <div className="min-w-0 flex-1">
            <div className="text-lg font-black leading-tight">Advertise here</div>
            <div className="truncate text-xs opacity-75">A wall at {mapName} · seen by everyone who walks (or hides!) here</div>
          </div>
          <button className="btn btn-ghost h-9 w-9 shrink-0 p-0" onClick={close} aria-label="Close">✕</button>
        </div>

        {!cfg ? (
          <div className="py-8 text-center text-sm opacity-75">{err || "Loading prices…"}</div>
        ) : !cfg.enabled ? (
          <div className="py-6 text-center">
            <div className="text-3xl">🚧</div>
            <div className="mt-1 font-bold">Wall ads are coming soon</div>
            <div className="text-xs opacity-75">Payments aren&apos;t switched on yet. Check back shortly!</div>
          </div>
        ) : (
          <>
            {sent ? (
              <div className="py-6 text-center" data-testid="ad-sent">
                <div className="text-4xl">📨</div>
                <div className="mt-1 font-bold">Sent for approval!</div>
                <div className="mx-auto max-w-xs text-xs opacity-75">We&apos;ll check your poster. Once it&apos;s approved, pay in 📱 → My ads and it goes up for {cfg.days} days.</div>
                <button className="btn btn-primary mt-3" onClick={close}>Done</button>
              </div>
            ) : (<>
            {mini ? (
              <div className="mt-3 rounded-2xl bg-emerald-400/15 px-3 py-2 text-[11px] leading-snug text-emerald-100">
                ✅ <b>Free to send.</b> We check your poster first. Once it&apos;s approved you pay in LagosLife (📱 → My ads), and it stays up for {cfg.days} days.
              </div>
            ) : (
            <div className="mt-3 rounded-2xl bg-amber-400/15 px-3 py-2 text-[11px] leading-snug text-amber-100">
              💳 <b>Real money</b>, paid securely with Paystack — separate from your game naira. Your poster goes up after a quick check
              and stays for {cfg.days} days. If we can&apos;t approve it, you get a full refund.
            </div>
            )}

            <div className="mt-3 text-xs font-bold uppercase tracking-wide opacity-70">Where on this wall</div>
            <svg viewBox={`0 0 ${len} ${spot.top}`} preserveAspectRatio="xMidYMid meet" onPointerDown={tapPreview}
              className="mt-1 h-28 w-full cursor-crosshair touch-none rounded-xl bg-black/25" aria-label="Wall preview — tap to move your poster">
              <rect x={0} y={0} width={len} height={spot.top} fill="#c9b79c" opacity={0.35} />
              <rect x={0} y={spot.top - 0.2} width={len} height={0.2} fill="#000" opacity={0.25} />
              {taken.filter((r) => samePlane(spot, r)).map((r, i) => (
                <rect key={i} x={px(alongOf(r)) - r.w / 2} y={spot.top - r.y - r.h / 2} width={r.w} height={r.h} fill="#64748b" stroke="#0f172a" strokeWidth={0.04} />
              ))}
              {size && at && (
                <rect x={px(at.a) - size.w / 2} y={spot.top - at.y - size.h / 2} width={size.w} height={size.h} rx={0.04}
                  fill="#2f7cf6" fillOpacity={0.55} stroke="#fff" strokeWidth={0.05} strokeDasharray="0.12 0.08" />
              )}
            </svg>
            <div className="mt-1 text-[11px] opacity-65">Tap the wall to move yours · grey boxes are other people&apos;s ads (we never cover them)</div>

            <div className="mt-3 text-xs font-bold uppercase tracking-wide opacity-70">Size</div>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {cfg.sizes.map((s) => {
                const ok = !!fits[s.id];
                return (
                  <button key={s.id} disabled={!ok} data-testid={`ad-size-${s.id}`} onClick={() => setSizeId(s.id)}
                    className={`rounded-2xl border p-2.5 text-left transition ${s.id === sizeId && ok ? "border-[var(--accent)] bg-[var(--accent)]/20" : "border-white/10 bg-white/5"} ${ok ? "" : "opacity-40"}`}>
                    <div className="text-sm font-bold">{s.name}</div>
                    <div className="text-[11px] opacity-70">{s.w} × {s.h} m</div>
                    <div className="mt-0.5 text-sm font-black">{ok ? naira(s.price) : "No room here"}</div>
                  </button>
                );
              })}
            </div>

            <div className="mt-3 grid gap-2">
              <input className="w-full rounded-xl bg-white/10 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]" maxLength={40} placeholder="Brand or business name" value={title} onChange={(e) => setTitle(e.target.value)} />
              {!mini && <input className="w-full rounded-xl bg-white/10 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]" type="email" maxLength={254} placeholder="Email for your receipt" value={email} onChange={(e) => setEmail(e.target.value)} />}
              <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-white/20 p-2.5">
                {preview && size ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview} alt="" className="h-12 rounded-lg object-cover" style={{ aspectRatio: `${size.w} / ${size.h}` }} />
                ) : <span className="grid h-12 w-16 place-items-center rounded-lg bg-white/10 text-xl">🖼️</span>}
                <span className="min-w-0 flex-1 text-xs">
                  <b>{file ? file.name : "Add your poster"}</b>
                  <span className="block opacity-65">JPG or PNG · we crop it to fit ({ratio(size)})</span>
                </span>
                <input type="file" accept="image/jpeg,image/png" className="hidden" data-testid="ad-file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>

            {err && <div className="mt-2 text-sm text-red-300">{err}</div>}
            <button data-testid="ad-pay" className="btn btn-primary mt-3 w-full" disabled={busy || !size || !at} onClick={pay}>
              {mini
                ? busy ? "Sending…" : size && at ? `Send for approval · ${naira(size.price)} after` : "Pick a size"
                : busy ? "Opening Paystack…" : size && at ? `Pay ${naira(size.price)} with Paystack` : "Pick a size"}
            </button>
            <div className="mt-1.5 text-center text-[10px] opacity-60">
              No ads on people&apos;s houses. Nothing offensive, misleading or 18+.{mini ? " No prices, payment details or \"pay here\" links." : ""}
            </div>
            </>)}
          </>
        )}
      </div>
    </div>
  );
}
