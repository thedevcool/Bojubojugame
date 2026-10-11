"use client";

import { useRef, useState } from "react";
import * as THREE from "three";
import { checkLayout, furn, ITEM_ICON, itemRect, toLocal } from "@/game/furniture";
import { sceneRefs } from "@/game/state";
import { sound } from "@/game/sound";
import { loadAccount, saveLayout } from "@/lib/api";
import { useGame } from "@/lib/store";
import type { Home } from "@/lib/types";
import { useMap } from "./hooks";

type Draft = NonNullable<ReturnType<typeof useGame.getState>["decor"]>;
type DItem = Draft["items"][number];

const ray = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hit = new THREE.Vector3();
const ndc = new THREE.Vector2();
const snap = (v: number) => Math.round(v * 20) / 20;

/** Screen point -> point on the floor in the house's local frame. */
function toFloor(h: Home, x: number, y: number): [number, number] | null {
  const cam = sceneRefs.camera, c = sceneRefs.canvas;
  if (!cam || !c) return null;
  const r = c.getBoundingClientRect();
  ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, cam);
  if (!ray.ray.intersectPlane(plane, hit)) return null;
  return toLocal(h, hit.x, hit.z);
}

/** Find a free spot for an item (centre of the parlour first, then a grid sweep). */
function freeSpot(h: Home, items: DItem[], it: DItem): DItem | null {
  const placed = items.filter((x) => x.placed && x.id !== it.id);
  for (let r = 0; r < 12; r++)
    for (let i = -r; i <= r; i++)
      for (const [dx, dz] of [[i, -r], [i, r], [-r, i], [r, i]])
        for (const rot of [0, 1]) {
          const cand = { ...it, placed: true, rot, lx: snap(dx * 0.5), lz: snap(1 + dz * 0.5) };
          if (!checkLayout(h, [...placed, cand])) return cand;
        }
  return null;
}

export function DecorateOverlay() {
  const decor = useGame((s) => s.decor);
  const set = useGame((s) => s.set);
  const map = useMap();
  const drag = useRef<{ id: number; ox: number; oz: number; moved: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!decor || !map?.homes) return null;
  const h = map.homes.find((x) => x.id === decor.home);
  if (!h) return null;
  const update = (items: DItem[], sel = decor.sel) => set({ decor: { ...decor, items, sel } });
  const placed = decor.items.filter((i) => i.placed);
  const store = decor.items.filter((i) => !i.placed);
  const problem = checkLayout(h, placed);
  const selected = decor.items.find((i) => i.id === decor.sel && i.placed) ?? null;
  const spec = selected ? furn.catalog[selected.item] : null;

  const onDown = (e: React.PointerEvent) => {
    const p = toFloor(h, e.clientX, e.clientY);
    if (!p) return;
    // topmost hit: solids before rugs
    const under = [...placed].sort((a, b) => Number(furn.catalog[b.item]?.solid) - Number(furn.catalog[a.item]?.solid))
      .find((it) => { const s = furn.catalog[it.item]; if (!s) return false; const r = itemRect(s, it); return p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3]; });
    if (under) {
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { id: under.id, ox: p[0] - under.lx, oz: p[1] - under.lz, moved: false };
      if (decor.sel !== under.id) { update(decor.items, under.id); sound.play("click"); }
    } else update(decor.items, null);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toFloor(h, e.clientX, e.clientY);
    if (!p) return;
    d.moved = true;
    const lim = Math.max(h.lw, h.ld) / 2;
    update(decor.items.map((it) => (it.id === d.id ? { ...it, lx: snap(Math.max(-lim, Math.min(lim, p[0] - d.ox))), lz: snap(Math.max(-lim, Math.min(lim, p[1] - d.oz))) } : it)));
  };
  const onUp = () => { drag.current = null; };
  const rotate = () => selected && update(decor.items.map((it) => (it.id === selected.id ? { ...it, rot: (it.rot + 1) % 4 } : it)));
  const stash = () => selected && update(decor.items.map((it) => (it.id === selected.id ? { ...it, placed: false } : it)), null);
  const placeFromStore = (it: DItem) => {
    const spot = freeSpot(h, decor.items, it);
    if (!spot) { useGame.getState().toast("No free space for that — move something first", "error"); return; }
    update(decor.items.map((x) => (x.id === it.id ? spot : x)), it.id);
    sound.play("pop");
  };
  const save = async () => {
    const acc = loadAccount();
    if (!acc || problem) return;
    setBusy(true);
    try {
      await saveLayout(acc, decor.items);
      set({ decor: null });
      useGame.getState().toast("🛋️ House don fine! Layout saved", "good");
      sound.play("coin");
    } catch (e) {
      useGame.getState().toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pointer-events-auto absolute inset-0 z-40">
      <div className="absolute inset-0" style={{ touchAction: "none" }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
      <div className="panel anim-banner absolute left-2 right-2 top-2 mx-auto flex max-w-md items-center gap-2 px-3 py-2">
        <span className="text-xl">🛋️</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black">Decorate · {h.name}</div>
          <div className={`truncate text-[11px] ${problem ? "text-red-300" : "opacity-70"}`}>{problem ? `⚠️ ${problem.msg}` : "Tap an item, then drag it. Rooms: " + h.rooms.map((r) => r.name).join(" · ")}</div>
        </div>
        <button className="btn btn-ghost px-3 py-1.5 text-sm" onClick={() => set({ decor: null })}>Cancel</button>
        <button className="btn btn-primary px-3 py-1.5 text-sm" disabled={busy || !!problem} onClick={save}>Save</button>
      </div>
      <div className="absolute bottom-2 left-2 right-2 mx-auto max-w-md space-y-2">
        {selected && spec && (
          <div className="panel anim-rise flex items-center gap-2 p-2">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 text-xl">{ITEM_ICON[selected.item] ?? "📦"}</span>
            <div className="min-w-0 flex-1 truncate text-sm font-bold">{spec.name}</div>
            <button className="btn btn-ghost px-3 py-1.5 text-sm" onClick={rotate}>↻ Turn</button>
            <button className="btn btn-ghost px-3 py-1.5 text-sm" onClick={stash}>📦 Store</button>
          </div>
        )}
        <div className="panel p-2">
          <div className="mb-1 flex items-center justify-between px-1 text-[11px] font-semibold opacity-75">
            <span>Store room · {store.length} item{store.length === 1 ? "" : "s"}</span>
            <span>Buy more at Ọ̀ṣọ́ Furniture</span>
          </div>
          {store.length === 0 ? (
            <div className="px-1 pb-1 text-xs opacity-60">Everything is placed. Tap 📦 Store on an item to put it away.</div>
          ) : (
            <div className="touch-scroll flex gap-2 overflow-x-auto pb-1">
              {store.map((it) => (
                <button key={it.id} className="choice flex w-20 shrink-0 flex-col items-center gap-0.5 p-2" data-on="false" onClick={() => placeFromStore(it)}>
                  <span className="text-2xl">{ITEM_ICON[it.item] ?? "📦"}</span>
                  <span className="w-full truncate text-center text-[10px] font-semibold">{furn.catalog[it.item]?.name ?? it.item}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
