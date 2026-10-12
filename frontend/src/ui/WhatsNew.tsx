"use client";

import { useEffect, useState } from "react";
import { CHANGELOG, LATEST, type Release } from "@/lib/changelog";
import { useGame } from "@/lib/store";

const KEY = "boju.seenVersion";

function ReleaseCard({ r, big }: { r: Release; big?: boolean }) {
  return (
    <div>
      {big ? (
        <div className="mb-4 text-center">
          <div className="anim-pop mx-auto mb-2 grid h-16 w-16 place-items-center rounded-[22px] bg-[var(--accent)] text-4xl shadow-lg shadow-blue-500/30">🙈</div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--accent-2)]">What&apos;s new · v{r.version}</div>
          <h2 className="text-2xl font-black">{r.title}</h2>
        </div>
      ) : (
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="font-black">{r.title}</h3>
          <span className="text-xs opacity-60">v{r.version} · {r.date}</span>
        </div>
      )}
      <div className="space-y-2">
        {r.items.map((it, i) => (
          <div key={it.title} className="anim-rise flex gap-3 rounded-2xl bg-white/5 p-3" style={{ animationDelay: `${120 + i * 70}ms` }}>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--accent)]/20 text-xl">{it.emoji}</span>
            <span className="text-sm">
              <span className="block font-bold">{it.title}</span>
              <span className="opacity-80">{it.text}</span>
              {it.tryIt && <span className="mt-1 block text-xs font-semibold text-[var(--accent-2)]">Try it: {it.tryIt}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Sheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div data-keep-phone className="anim-fade pointer-events-auto absolute inset-0 z-[70] flex items-end justify-center bg-black/45 backdrop-blur-[2px] sm:items-center" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel anim-sheet touch-scroll max-h-[88dvh] w-full max-w-md rounded-b-none p-5 sm:rounded-b-[20px]">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-white/25 sm:hidden" />
        {children}
      </div>
    </div>
  );
}

export function markSeen(): void {
  try { localStorage.setItem(KEY, LATEST.version); } catch { /* storage blocked */ }
}

/** Pops up once per new release (see lib/changelog.ts). */
export function WhatsNew() {
  const [open, setOpen] = useState(false);
  const openApp = useGame((s) => s.openApp);
  const onboarding = useGame((s) => s.onboard !== null);
  useEffect(() => {
    let seen: string | null = null;
    try { seen = localStorage.getItem(KEY); } catch { /* storage blocked */ }
    if (seen !== LATEST.version) setOpen(true);
  }, []);
  if (!open || onboarding) return null;
  const close = () => {
    try { localStorage.setItem(KEY, LATEST.version); } catch { /* ignore */ }
    setOpen(false);
  };
  return (
    <Sheet onClose={close}>
      <ReleaseCard r={LATEST} big />
      <div className="mt-5 grid gap-2">
        <button className="btn btn-primary text-lg" onClick={close}>Oya, let&apos;s go!</button>
        <button className="btn btn-ghost" onClick={() => { close(); openApp("news"); }}>See all updates</button>
      </div>
    </Sheet>
  );
}

/** Full changelog (phone → What's new). */
export function ChangelogContent() {
  return <div className="space-y-6">{CHANGELOG.map((r) => <ReleaseCard key={r.version} r={r} />)}</div>;
}
