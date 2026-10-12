"use client";

import { useEffect, useRef, useState } from "react";
import { useGame } from "@/lib/store";
import { cam, input } from "./state";

/**
 * Left half (touch): floating joystick. Right half / mouse: drag to look.
 * Every way a press can get "stuck" is covered: pointerup outside the zone,
 * pointercancel (system gestures), lost capture, window blur, tab hidden,
 * focus moving into a text box, and a global pointerup safety net.
 */
const R = 55;
const DEAD = 0.12;

export function releaseAllInput(): void {
  input.joyX = 0;
  input.joyY = 0;
  input.joyRun = false;
  input.runHeld = false;
  input.keys.clear();
}

export default function Controls({ disabled }: { disabled?: boolean }) {
  const [knob, setKnob] = useState<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const joy = useRef<{ id: number; ox: number; oy: number } | null>(null);
  const look = useRef<{ id: number; x: number; y: number; sx: number; sy: number; t0: number; moved: number; lt: number } | null>(null);
  /** every finger on the look layer (for two-finger pinch zoom) */
  const fingers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; mx: number; my: number } | null>(null);
  const mode = useGame((s) => s.controlMode);

  const endJoy = () => {
    joy.current = null;
    input.joyX = 0;
    input.joyY = 0;
    input.joyRun = false;
    setKnob(null);
  };

  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
    const down = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey && e.code !== "ControlLeft") return;
      input.keys.add(e.code);
      if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault(); // never scroll the page
    };
    const up = (e: KeyboardEvent) => input.keys.delete(e.code);
    const resetAll = () => {
      releaseAllInput();
      joy.current = null;
      look.current = null;
      fingers.current.clear();
      pinch.current = null;
      cam.aerial.drag = false;
      setKnob(null);
    };
    const globalUp = (e: PointerEvent) => {
      if (joy.current?.id === e.pointerId) endJoy();
      if (look.current?.id === e.pointerId) { look.current = null; cam.aerial.drag = false; }
      fingers.current.delete(e.pointerId);
      if (fingers.current.size < 2) pinch.current = null;
    };
    const visibility = () => document.hidden && resetAll();
    // iOS Safari sometimes never delivers pointerup/pointercancel (e.g. when its
    // edge-swipe "back" gesture grabs the touch). TouchEvent.touches is the
    // authoritative list of fingers on the glass, so reconcile against it.
    const reconcile = (e: TouchEvent) => {
      const fingers = Array.from(e.touches);
      const j = joy.current;
      if (j && !fingers.some((t) => Math.hypot(t.clientX - j.ox, t.clientY - j.oy) < R * 3.5)) {
        joy.current = null;
        input.joyX = 0;
        input.joyY = 0;
        input.joyRun = false;
        setKnob(null);
      }
      if (fingers.length === 0) {
        look.current = null;
        cam.aerial.drag = false;
        pinchReset();
      }
      if (fingers.length === 0) input.runHeld = false;
    };
    const pinchReset = () => { pinch.current = null; };
    const focusIn = (e: FocusEvent) => typing(e.target) && input.keys.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", resetAll);
    // bubble phase: runs after the layer's own handlers (so taps/flicks are seen first) and still
    // catches releases that happen anywhere else on the page
    window.addEventListener("pointerup", globalUp);
    window.addEventListener("pointercancel", globalUp);
    for (const t of ["touchend", "touchcancel", "touchstart"] as const) window.addEventListener(t, reconcile, { capture: true, passive: true });
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("focusin", focusIn);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", resetAll);
      window.removeEventListener("pointerup", globalUp);
      window.removeEventListener("pointercancel", globalUp);
      for (const t of ["touchend", "touchcancel", "touchstart"] as const) window.removeEventListener(t, reconcile, { capture: true });
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("focusin", focusIn);
      resetAll();
    };
  }, []);

  useEffect(() => { if (disabled) { releaseAllInput(); setKnob(null); joy.current = null; } }, [disabled]);

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const leftSide = mode === "joystick" && e.clientX < window.innerWidth * 0.45 && e.pointerType !== "mouse" && !cam.aerial.on;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    if (!(leftSide && !joy.current)) {
      fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (fingers.current.size === 2) {
        // second finger down: switch from drag to pinch
        const [a, b] = [...fingers.current.values()];
        pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
        look.current = null;
        cam.aerial.vx = cam.aerial.vz = 0;
        return;
      }
    }
    if (leftSide && !joy.current) {
      // keep the base fully on screen (and off the iOS back-swipe edge)
      const ox = Math.max(R + 12, e.clientX), oy = Math.min(window.innerHeight - R - 12, e.clientY);
      joy.current = { id: e.pointerId, ox, oy };
      setKnob({ x: ox, y: oy, ox, oy });
    } else if (!look.current) {
      look.current = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t0: performance.now(), moved: 0, lt: performance.now() };
      if (cam.aerial.on) {
        cam.aerial.drag = true;
        cam.aerial.vx = cam.aerial.vz = 0;
      }
    }
  };

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    // A mouse moving with no button held means we missed the release: let go.
    if (e.pointerType === "mouse" && e.buttons === 0) {
      if (look.current?.id === e.pointerId) look.current = null;
      return;
    }
    const j = joy.current;
    if (j && e.pointerId === j.id) {
      let dx = e.clientX - j.ox, dy = e.clientY - j.oy;
      const m = Math.hypot(dx, dy);
      if (m > R) { dx = (dx / m) * R; dy = (dy / m) * R; }
      const mag = Math.min(1, m / R);
      const k = mag < DEAD ? 0 : (mag - DEAD) / (1 - DEAD) / Math.max(mag, 1e-6);
      input.joyX = (dx / R) * k * (m > 0 ? 1 : 0);
      input.joyY = (-dy / R) * k;
      input.joyRun = mag > 0.95; // push the stick all the way to run
      setKnob({ ox: j.ox, oy: j.oy, x: j.ox + dx, y: j.oy + dy });
      return;
    }
    if (fingers.current.has(e.pointerId)) fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = pinch.current;
    if (p && fingers.current.size >= 2) {
      const [a, b] = [...fingers.current.values()];
      const d = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const k = p.d / d; // fingers apart => zoom in
      if (cam.aerial.on) {
        const ar = cam.aerial;
        ar.th = Math.min(120, Math.max(16, ar.th * k));
        const s = (1.155 * ar.th) / window.innerHeight;
        ar.tx -= (mx - p.mx) * s; // two-finger pan while pinching
        ar.tz -= (my - p.my) * s;
      } else cam.dist = Math.min(12, Math.max(2.5, cam.dist * k));
      pinch.current = { d, mx, my };
      return;
    }
    const l = look.current;
    if (l && e.pointerId === l.id) {
      const dx = e.clientX - l.x, dy = e.clientY - l.y;
      const now = performance.now();
      const dtS = Math.max(0.008, (now - l.lt) / 1000);
      l.x = e.clientX;
      l.y = e.clientY;
      l.lt = now;
      l.moved = Math.max(l.moved, Math.hypot(e.clientX - l.sx, e.clientY - l.sy));
      if (cam.aerial.on) {
        // aerial: the ground sticks to your finger like a real map; a flick keeps it gliding
        const ar = cam.aerial;
        const s = (1.155 * ar.th) / window.innerHeight;
        ar.tx -= dx * s;
        ar.tz -= dy * s;
        ar.vx = ar.vx * 0.6 + (-dx * s / dtS) * 0.4;
        ar.vz = ar.vz * 0.6 + (-dy * s / dtS) * 0.4;
        return;
      }
      cam.yaw -= dx * 0.008;
      input.lookedAt = performance.now();
      cam.pitch = Math.min(1.2, Math.max(0.05, cam.pitch + dy * 0.005));
    }
  };

  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (joy.current?.id === e.pointerId) endJoy();
    const l = look.current;
    if (l?.id === e.pointerId) {
      look.current = null;
      if (cam.aerial.on) {
        cam.aerial.drag = false;
        if (performance.now() - l.lt > 80) cam.aerial.vx = cam.aerial.vz = 0; // finger rested before lifting: no flick
      } else if (e.type === "pointerup" && l.moved < 10 && performance.now() - l.t0 < 350) {
        // a quick tap: open a player's card if you tapped a person, else (tap-to-go) walk there
        // a mouse has no joystick: a click always walks you there
        input.tap = { x: e.clientX, y: e.clientY, walk: mode === "tap" || e.pointerType === "mouse" };
      }
    }
    fingers.current.delete(e.pointerId);
    if (fingers.current.size < 2) pinch.current = null;
  };

  return (
    <div
      className="absolute inset-0 z-0"
      style={{ touchAction: "none" }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onLostPointerCapture={onUp}
      onContextMenu={(e) => e.preventDefault()}
      onWheel={(e) => {
        const k = Math.exp(Math.max(-1, Math.min(1, e.deltaY / 300)));
        if (cam.aerial.on) cam.aerial.th = Math.min(120, Math.max(16, cam.aerial.th * k));
        else cam.dist = Math.min(12, Math.max(2.5, cam.dist * k));
      }}
    >
      {knob && (
        <>
          <div className="pointer-events-none absolute rounded-full border-2 border-white/40 bg-white/10" style={{ left: knob.ox - R, top: knob.oy - R, width: R * 2, height: R * 2 }} />
          <div className="pointer-events-none absolute rounded-full bg-white/80 shadow" style={{ left: knob.x - 24, top: knob.y - 24, width: 48, height: 48 }} />
        </>
      )}
    </div>
  );
}
