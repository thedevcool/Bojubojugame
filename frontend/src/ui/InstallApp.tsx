"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

let deferred: BeforeInstallPromptEvent | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e as BeforeInstallPromptEvent; });
}

const standalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches || window.matchMedia("(display-mode: fullscreen)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);

/** "Install app" button: native prompt on Android/Chrome, Share-sheet steps on iPhone. */
export default function InstallApp({ className = "" }: { className?: string }) {
  const [installed, setInstalled] = useState(true);
  const [ios, setIos] = useState(false);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    setInstalled(standalone());
    setIos(/iPhone|iPad|iPod/i.test(navigator.userAgent));
    const done = () => setInstalled(true);
    window.addEventListener("appinstalled", done);
    return () => window.removeEventListener("appinstalled", done);
  }, []);
  if (installed) return null;
  const install = async () => {
    if (deferred) {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
      deferred = null;
      return;
    }
    setHelp(true);
  };
  return (
    <div className={className}>
      <button type="button" className="btn btn-ghost w-full" onClick={install}>📲 Install Boju Boju app</button>
      {help && (
        <p className="anim-rise mt-2 rounded-xl bg-white/5 p-3 text-xs leading-relaxed">
          {ios
            ? <>On iPhone: tap the <b>Share</b> button <span aria-hidden>⬆️</span> in Safari, then <b>Add to Home Screen</b>. Boju Boju opens full-screen like an app.</>
            : <>Open your browser menu <b>⋮</b> and tap <b>Install app</b> (or <b>Add to Home screen</b>).</>}
        </p>
      )}
    </div>
  );
}
