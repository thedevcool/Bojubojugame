"use client";

import { useEffect, useRef, useState } from "react";
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
  const look = useRef<{ id: number; x: number; y: number } | null>(null);

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
      setKnob(null);
    };
    const globalUp = (e: PointerEvent) => {
      if (joy.current?.id === e.pointerId) endJoy();
      if (look.current?.id === e.pointerId) look.current = null;
    };
    const visibility = () => document.hidden && resetAll();
    const focusIn = (e: FocusEvent) => typing(e.target) && input.keys.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", resetAll);
    window.addEventListener("pointerup", globalUp, true);
    window.addEventListener("pointercancel", globalUp, true);
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("focusin", focusIn);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", resetAll);
      window.removeEventListener("pointerup", globalUp, true);
      window.removeEventListener("pointercancel", globalUp, true);
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("focusin", focusIn);
      resetAll();
    };
  }, []);

  useEffect(() => { if (disabled) { releaseAllInput(); setKnob(null); joy.current = null; } }, [disabled]);

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const leftSide = e.clientX < window.innerWidth * 0.45 && e.pointerType !== "mouse" && !cam.aerial.on;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    if (leftSide && !joy.current) {
      joy.current = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
      setKnob({ x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY });
    } else if (!look.current) {
      look.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
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
    const l = look.current;
    if (l && e.pointerId === l.id) {
      const dx = e.clientX - l.x, dy = e.clientY - l.y;
      l.x = e.clientX;
      l.y = e.clientY;
      if (cam.aerial.on) {
        // aerial: drag the map like a real map app
        const s = cam.aerial.h / 420;
        cam.aerial.x -= dx * s;
        cam.aerial.z -= dy * s;
        return;
      }
      cam.yaw -= dx * 0.008;
      cam.pitch = Math.min(1.2, Math.max(0.05, cam.pitch + dy * 0.005));
    }
  };

  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (joy.current?.id === e.pointerId) endJoy();
    if (look.current?.id === e.pointerId) look.current = null;
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
        if (cam.aerial.on) cam.aerial.h = Math.min(110, Math.max(25, cam.aerial.h + Math.sign(e.deltaY) * 6));
        else cam.dist = Math.min(12, Math.max(3, cam.dist + Math.sign(e.deltaY) * 0.6));
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
