"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { loadAccount, naira, verifyAd } from "@/lib/api";

/** Paystack sends advertisers back here (?reference=bojuad_…) after checkout. */
export default function AdReturn() {
  const [state, setState] = useState<{ status: string; title?: string; price?: number; err?: string }>({ status: "checking" });
  const [back, setBack] = useState("/play");
  useEffect(() => {
    try { setBack(sessionStorage.getItem("boju.adReturn") || "/play"); } catch { /* ignore */ }
    const ref = new URLSearchParams(window.location.search).get("reference") ?? "";
    const acc = loadAccount();
    if (!ref || !acc) { setState({ status: "error", err: "Open this page on the phone you play Boju Boju with." }); return; }
    let tries = 0;
    const check = () =>
      verifyAd(acc, ref)
        .then((r) => {
          // the payment can take a few seconds to settle
          if (r.status === "awaiting_payment" && ++tries < 6) { setTimeout(check, 2500); return; }
          setState({ status: r.status, title: r.title, price: r.price });
        })
        .catch((e) => setState({ status: "error", err: e instanceof Error ? e.message : "Couldn't check your payment" }));
    check();
  }, []);

  const view: Record<string, [string, string, string]> = {
    checking: ["⏳", "Checking your payment…", "Hold on small."],
    review: ["🎉", "Payment received!", "We'll check your poster shortly and put it up. If we can't approve it, you get a full refund."],
    live: ["📢", "Your ad is live!", "Go and see it on the wall."],
    awaiting_payment: ["🤔", "Payment not confirmed yet", "If you paid, it will show up in a few minutes — Paystack will tell us. Your spot is held for 30 minutes."],
    rejected: ["🙏🏾", "This ad wasn't approved", "Your refund is on its way."],
    refunded: ["↩️", "Refunded", "This ad wasn't approved and your money was refunded."],
    error: ["😩", "Something went wrong", state.err ?? ""],
  };
  const [icon, head, body] = view[state.status] ?? view.error;
  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <div className="panel w-full max-w-sm p-6 text-center" data-testid="ad-return">
        <div className="text-5xl leading-none">{icon}</div>
        <h1 className="mt-3 text-xl font-black">{head}</h1>
        {state.title && <div className="mt-1 text-sm opacity-80">“{state.title}”{state.price ? ` · ${naira(state.price)}` : ""}</div>}
        <p className="mt-2 text-sm opacity-75">{body}</p>
        <Link href={back} className="btn btn-primary mt-5 inline-block w-full">Back to the game</Link>
      </div>
    </main>
  );
}
