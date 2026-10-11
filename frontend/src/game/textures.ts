import * as THREE from "three";

/**
 * Procedural textures drawn on canvases at runtime: zero bytes to download,
 * which matters on Nigerian mobile data. Cached per key.
 */
const cache = new Map<string, THREE.CanvasTexture>();

function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function make(key: string, size: number, draw: (ctx: CanvasRenderingContext2D, r: () => number) => void, repeat = 1): THREE.CanvasTexture {
  const k = `${key}|${repeat}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const base = cache.get(`${key}|base`);
  let tex: THREE.CanvasTexture;
  if (base) {
    tex = base.clone();
  } else {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d")!;
    draw(ctx, rand(key.length * 7919 + size));
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    cache.set(`${key}|base`, tex);
  }
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.needsUpdate = true;
  cache.set(k, tex);
  return tex;
}

function speckle(ctx: CanvasRenderingContext2D, r: () => number, size: number, base: string, dots: [string, number][], n: number) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < n; i++) {
    const [color, maxR] = dots[Math.floor(r() * dots.length)];
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.15 + r() * 0.35;
    ctx.beginPath();
    ctx.arc(r() * size, r() * size, 0.5 + r() * maxR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Light grey grain multiplied with a material colour (walls, plaster, concrete). */
export const plaster = (repeat = 1) =>
  make("plaster", 128, (ctx, r) => speckle(ctx, r, 128, "#f2f2f2", [["#c9c9c9", 2], ["#ffffff", 2], ["#b5b5b5", 1]], 900), repeat);

export const asphalt = (repeat = 1) =>
  make("asphalt", 256, (ctx, r) => {
    speckle(ctx, r, 256, "#46474a", [["#2e2f31", 2], ["#5b5c60", 1.5], ["#6d6e72", 1]], 4000);
    ctx.strokeStyle = "rgba(20,20,20,.35)";
    for (let i = 0; i < 6; i++) {
      ctx.lineWidth = 0.5 + r();
      ctx.beginPath();
      let x = r() * 256, y = r() * 256;
      ctx.moveTo(x, y);
      for (let j = 0; j < 5; j++) { x += (r() - 0.5) * 40; y += (r() - 0.5) * 40; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  }, repeat);

export const laterite = (repeat = 1) =>
  make("laterite", 256, (ctx, r) => speckle(ctx, r, 256, "#a8734a", [["#8b5a36", 3], ["#c18a5c", 2], ["#6f8a3e", 2.5], ["#93633d", 4]], 5000), repeat);

export const grass = (repeat = 1) =>
  make("grass", 256, (ctx, r) => {
    speckle(ctx, r, 256, "#6f9e4c", [["#5a8a3a", 3], ["#86b45c", 2], ["#9a8a55", 2], ["#4c7a33", 1.5]], 6000);
  }, repeat);

export const sand = (repeat = 1) =>
  make("sand", 256, (ctx, r) => speckle(ctx, r, 256, "#c9a66b", [["#b08e55", 2], ["#dcc08a", 2], ["#9c7a45", 1]], 4000), repeat);

export const concrete = (repeat = 1) =>
  make("concrete", 128, (ctx, r) => {
    speckle(ctx, r, 128, "#b8b4ab", [["#9d9990", 1.5], ["#cdc9c0", 1.5]], 1200);
    ctx.strokeStyle = "rgba(80,80,80,.5)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(0, 0, 128, 128);
  }, repeat);

export const tiles = (repeat = 1) =>
  make("tiles", 128, (ctx) => {
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        ctx.fillStyle = (i + j) % 2 ? "#d9d2c3" : "#cfc6b4";
        ctx.fillRect(i * 32, j * 32, 32, 32);
      }
    ctx.strokeStyle = "#a89f8c";
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo(i * 32, 0); ctx.lineTo(i * 32, 128); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * 32); ctx.lineTo(128, i * 32); ctx.stroke();
    }
  }, repeat);

export const zinc = (repeat = 1) =>
  make("zinc", 128, (ctx, r) => {
    for (let x = 0; x < 128; x += 8) {
      const g = ctx.createLinearGradient(x, 0, x + 8, 0);
      g.addColorStop(0, "#9aa0a6"); g.addColorStop(0.5, "#d5d9dc"); g.addColorStop(1, "#8a9096");
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 8, 128);
    }
    for (let i = 0; i < 25; i++) {
      ctx.fillStyle = `rgba(140,70,30,${0.15 + r() * 0.3})`;
      ctx.beginPath(); ctx.arc(r() * 128, r() * 128, 2 + r() * 8, 0, Math.PI * 2); ctx.fill();
    }
  }, repeat);

const ANKARA_BG = ["#d94f3d", "#2f9e57", "#3d7fd9", "#f7c500", "#8e44ad", "#e67e22", "#16a085", "#ecf0f1"];
const ANKARA_FG = ["#f7c500", "#1d1a16", "#f2e6c9", "#2f6db5", "#f7c500", "#2c3e50", "#f2e6c9", "#d94f3d"];

/** Wax-print style pattern for shirts/kaftans (one per palette index). */
export const ankara = (i: number) =>
  make(`ankara${i % 8}`, 128, (ctx, r) => {
    const bg = ANKARA_BG[i % 8], fg = ANKARA_FG[i % 8];
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = fg;
    ctx.strokeStyle = fg;
    ctx.lineWidth = 3;
    const style = i % 4;
    for (let x = 0; x < 128; x += 32)
      for (let y = 0; y < 128; y += 32) {
        const cx = x + 16, cy = y + 16;
        if (style === 0) { ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill(); }
        else if (style === 1) { ctx.beginPath(); ctx.moveTo(cx, cy - 11); ctx.lineTo(cx + 11, cy); ctx.lineTo(cx, cy + 11); ctx.lineTo(cx - 11, cy); ctx.closePath(); ctx.stroke(); }
        else if (style === 2) { for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.ellipse(cx, cy, 11, 4, (k * Math.PI) / 4, 0, Math.PI * 2); ctx.stroke(); } }
        else { ctx.fillRect(cx - 9, cy - 3, 18, 6); ctx.fillRect(cx - 3, cy - 9, 6, 18); }
      }
    for (let k = 0; k < 40; k++) { ctx.globalAlpha = 0.25; ctx.fillRect(r() * 128, r() * 128, 2, 2); }
    ctx.globalAlpha = 1;
  }, 2);
