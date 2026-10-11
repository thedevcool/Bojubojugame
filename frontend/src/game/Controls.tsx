"use client";

import { useEffect, useRef, useState } from "react";
import { cam, input } from "./state";

/** Left: virtual joystick. Right: drag to look. Desktop: WASD + mouse drag. */
export default function Controls() {
  const [knob, setKnob] = useState<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const joyId = useRef<number | null>(null);
  const lookId = useRef<number | null>(null);
  const lastLook = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    const down = (e: KeyboardEvent) => { if (!typing(e)) input.keys.add(e.code); };
    const up = (e: KeyboardEvent) => input.keys.delete(e.code);
    const blur = () => input.keys.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const R = 55;
  const onDown = (e: React.PointerEvent) => {
    const leftSide = e.clientX < window.innerWidth * 0.45 && e.pointerType !== "mouse";
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (leftSide && joyId.current === null) {
      joyId.current = e.pointerId;
      setKnob({ x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY });
    } else if (lookId.current === null) {
      lookId.current = e.pointerId;
      lastLook.current = { x: e.clientX, y: e.clientY };
    }
  };
  const onMove = (e: React.PointerEvent) => {
    if (e.pointerId === joyId.current && knob) {
      let dx = e.clientX - knob.ox, dy = e.clientY - knob.oy;
      const m = Math.hypot(dx, dy);
      if (m > R) { dx = (dx / m) * R; dy = (dy / m) * R; }
      input.joyX = dx / R;
      input.joyY = -dy / R;
      setKnob({ ...knob, x: knob.ox + dx, y: knob.oy + dy });
    } else if (e.pointerId === lookId.current) {
      const dx = e.clientX - lastLook.current.x, dy = e.clientY - lastLook.current.y;
      lastLook.current = { x: e.clientX, y: e.clientY };
      cam.yaw -= dx * 0.008;
      cam.pitch = Math.min(1.2, Math.max(0.05, cam.pitch + dy * 0.005));
    }
  };
  const onUp = (e: React.PointerEvent) => {
    if (e.pointerId === joyId.current) {
      joyId.current = null;
      input.joyX = 0;
      input.joyY = 0;
      setKnob(null);
    }
    if (e.pointerId === lookId.current) lookId.current = null;
  };

  return (
    <div
      className="absolute inset-0 z-0"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onWheel={(e) => { cam.dist = Math.min(12, Math.max(3, cam.dist + e.deltaY * 0.01)); }}
    >
      {knob && (
        <>
          <div className="pointer-events-none absolute rounded-full border-2 border-white/40 bg-white/10" style={{ left: knob.ox - R, top: knob.oy - R, width: R * 2, height: R * 2 }} />
          <div className="pointer-events-none absolute rounded-full bg-white/70" style={{ left: knob.x - 24, top: knob.y - 24, width: 48, height: 48 }} />
        </>
      )}
    </div>
  );
}
