/**
 * Boju Boju's own map of Nigeria (no third-party tiles).
 *
 * Shapes are simplified, hand-placed approximations of public geography
 * ([lng, lat] pairs). They're meant to look right at game scale, not to be
 * survey-accurate. Add roads and places here and the map grows with the game.
 */
export type LngLat = [number, number];

export const NIGERIA: LngLat[] = [
  [2.70, 6.37], [3.00, 6.39], [3.40, 6.41], [3.70, 6.43], [4.00, 6.38], [4.40, 6.25], [4.80, 6.05], [5.10, 5.80],
  [5.35, 5.45], [5.55, 5.10], [5.85, 4.80], [6.10, 4.35], [6.50, 4.30], [7.00, 4.40], [7.55, 4.48], [8.10, 4.55],
  [8.45, 4.70], [8.60, 4.90], [8.85, 5.15], [8.95, 5.75], [9.40, 6.35], [9.75, 6.80], [10.25, 7.00], [10.65, 7.05],
  [11.10, 6.55], [11.45, 6.85], [11.80, 7.25], [12.05, 7.65], [12.25, 8.30], [12.80, 8.80], [13.20, 9.55],
  [13.35, 10.15], [13.60, 10.60], [14.10, 11.20], [14.60, 11.55], [14.65, 12.25], [14.10, 12.95], [13.60, 13.70],
  [13.00, 13.60], [12.30, 13.10], [11.40, 13.40], [10.60, 13.30], [9.60, 12.80], [8.50, 13.10], [7.80, 13.35],
  [6.90, 13.60], [6.30, 13.70], [5.40, 13.90], [4.60, 13.70], [4.10, 13.50], [3.65, 12.60], [3.60, 11.70],
  [3.50, 11.20], [3.75, 10.45], [3.60, 9.95], [3.10, 9.40], [2.75, 9.05], [2.75, 8.10], [2.72, 7.10],
];

/** Sea: everything south of the coast. */
export const OCEAN: LngLat[] = [[0.5, 6.30], [2.70, 6.37], ...NIGERIA.slice(1, 19), [8.85, 4.40], [10.5, 3.6], [10.5, 1.5], [0.5, 1.5]];

export const LAKE_CHAD: LngLat[] = [[13.85, 13.15], [14.20, 13.40], [14.55, 13.30], [14.65, 12.90], [14.30, 12.75], [13.95, 12.85]];

export const RIVERS: { name: string; pts: LngLat[] }[] = [
  { name: "River Niger", pts: [[3.55, 11.75], [4.05, 11.20], [4.45, 10.40], [4.62, 9.70], [4.80, 9.10], [5.50, 8.85], [6.10, 8.60], [6.55, 8.15], [6.75, 7.80], [6.78, 7.20], [6.77, 6.40], [6.70, 6.05], [6.55, 5.50], [6.30, 5.05], [6.10, 4.55]] },
  { name: "River Benue", pts: [[13.40, 9.30], [12.45, 9.20], [11.30, 9.05], [10.10, 8.55], [9.20, 8.05], [8.52, 7.73], [7.65, 7.80], [6.75, 7.80]] },
  { name: "Ogun River", pts: [[3.35, 7.60], [3.40, 7.20], [3.43, 6.90], [3.42, 6.62]] },
];

/** Lagos lagoon and Lekki lagoon (drawn as water on land), plus the islands sitting in them. */
export const LAGOONS: LngLat[][] = [
  // Lagos Lagoon: Ebute-Metta / Yaba shore on the west, Ikorodu / Ajah shores on the north and south
  [[3.390, 6.468], [3.394, 6.500], [3.399, 6.530], [3.405, 6.556], [3.440, 6.575], [3.500, 6.585], [3.560, 6.565],
    [3.640, 6.535], [3.760, 6.525], [3.880, 6.565], [3.990, 6.560], [4.000, 6.515], [3.880, 6.505], [3.700, 6.485],
    [3.580, 6.476], [3.500, 6.468], [3.462, 6.462], [3.430, 6.466], [3.410, 6.468]],
  // harbour and channels around Lagos Island, Apapa and Victoria Island
  [[3.372, 6.455], [3.392, 6.468], [3.405, 6.468], [3.430, 6.466], [3.462, 6.462], [3.468, 6.440], [3.440, 6.418],
    [3.400, 6.418], [3.372, 6.430], [3.355, 6.440]],
  [[4.05, 6.50], [4.20, 6.55], [4.33, 6.52], [4.20, 6.46], [4.08, 6.46]],
];
export const ISLANDS: { name: string; pts: LngLat[] }[] = [
  { name: "Lagos Island", pts: [[3.385, 6.452], [3.398, 6.444], [3.418, 6.446], [3.424, 6.456], [3.414, 6.464], [3.396, 6.466]] },
  { name: "Ikoyi", pts: [[3.424, 6.446], [3.450, 6.440], [3.462, 6.452], [3.450, 6.462], [3.428, 6.460]] },
  { name: "Victoria Island", pts: [[3.400, 6.432], [3.430, 6.426], [3.462, 6.432], [3.470, 6.425], [3.440, 6.418], [3.405, 6.420]] },
];

export type RoadKind = "expressway" | "major" | "bridge";
export const ROADS: { name: string; kind: RoadKind; pts: LngLat[] }[] = [
  // ---- Lagos
  { name: "Third Mainland Bridge", kind: "bridge", pts: [[3.403, 6.556], [3.403, 6.530], [3.399, 6.500], [3.398, 6.466]] },
  { name: "Eko Bridge", kind: "bridge", pts: [[3.374, 6.462], [3.388, 6.455]] },
  { name: "Ikorodu Road", kind: "major", pts: [[3.378, 6.512], [3.372, 6.540], [3.388, 6.578], [3.430, 6.600], [3.507, 6.619]] },
  { name: "Herbert Macaulay Way", kind: "major", pts: [[3.384, 6.466], [3.382, 6.480], [3.378, 6.512]] },
  { name: "Western Avenue", kind: "major", pts: [[3.372, 6.462], [3.360, 6.485], [3.354, 6.500], [3.349, 6.528], [3.343, 6.555]] },
  { name: "Apapa–Oshodi Expressway", kind: "expressway", pts: [[3.360, 6.448], [3.345, 6.480], [3.335, 6.515], [3.343, 6.555], [3.330, 6.600]] },
  { name: "Ikeja Road", kind: "major", pts: [[3.343, 6.555], [3.351, 6.601], [3.321, 6.615]] },
  { name: "Badagry Expressway", kind: "expressway", pts: [[3.360, 6.448], [3.320, 6.460], [3.284, 6.466], [3.100, 6.440], [2.880, 6.420]] },
  { name: "Carter Bridge", kind: "bridge", pts: [[3.384, 6.466], [3.392, 6.460]] },
  { name: "Broad Street", kind: "major", pts: [[3.388, 6.455], [3.392, 6.460], [3.410, 6.455], [3.424, 6.452]] },
  { name: "Falomo Bridge", kind: "bridge", pts: [[3.435, 6.448], [3.428, 6.430]] },
  { name: "Ozumba Mbadiwe Avenue", kind: "major", pts: [[3.424, 6.452], [3.435, 6.448], [3.450, 6.445]] },
  { name: "Lekki–Epe Expressway", kind: "expressway", pts: [[3.428, 6.430], [3.462, 6.432], [3.473, 6.447], [3.530, 6.455], [3.585, 6.470], [3.700, 6.500], [3.850, 6.540], [3.983, 6.584]] },
  // ---- Lagos to the rest of Naija
  { name: "Lagos–Ibadan Expressway", kind: "expressway", pts: [[3.405, 6.555], [3.385, 6.620], [3.370, 6.700], [3.440, 6.830], [3.650, 6.840], [3.780, 7.100], [3.900, 7.380]] },
  { name: "Ibadan–Ilorin Road", kind: "expressway", pts: [[3.900, 7.380], [4.240, 8.130], [4.550, 8.500]] },
  { name: "Ilorin–Abuja Road", kind: "expressway", pts: [[4.550, 8.500], [4.800, 9.080], [5.050, 9.290], [6.010, 9.080], [7.000, 9.170], [7.180, 9.180], [7.490, 9.060]] },
  { name: "Abuja–Kano Road", kind: "expressway", pts: [[7.490, 9.060], [7.440, 10.520], [7.710, 11.080], [8.520, 12.000]] },
  { name: "Lagos–Benin Road", kind: "expressway", pts: [[3.650, 6.840], [4.400, 6.820], [5.200, 6.700], [5.620, 6.340]] },
  { name: "Benin–Onitsha Road", kind: "expressway", pts: [[5.620, 6.340], [6.300, 6.200], [6.780, 6.150]] },
  { name: "Onitsha–Enugu Road", kind: "expressway", pts: [[6.780, 6.150], [7.500, 6.450]] },
  { name: "East–West Road", kind: "expressway", pts: [[5.620, 6.340], [6.200, 5.200], [7.010, 4.820]] },
  { name: "Abuja–Lokoja Road", kind: "expressway", pts: [[7.490, 9.060], [7.000, 8.400], [6.740, 7.800]] },
  { name: "Abuja–Jos Road", kind: "expressway", pts: [[7.490, 9.060], [8.300, 9.300], [8.890, 9.900]] },
];

export const CITIES: { name: string; lng: number; lat: number; big?: boolean }[] = [
  { name: "Lagos", lng: 3.38, lat: 6.52, big: true }, { name: "Ibadan", lng: 3.90, lat: 7.38, big: true },
  { name: "Abuja", lng: 7.49, lat: 9.06, big: true }, { name: "Kano", lng: 8.52, lat: 12.00, big: true },
  { name: "Port Harcourt", lng: 7.01, lat: 4.82, big: true }, { name: "Benin City", lng: 5.62, lat: 6.34 },
  { name: "Enugu", lng: 7.50, lat: 6.45 }, { name: "Onitsha", lng: 6.78, lat: 6.15 }, { name: "Ilorin", lng: 4.55, lat: 8.50 },
  { name: "Kaduna", lng: 7.44, lat: 10.52 }, { name: "Jos", lng: 8.89, lat: 9.90 }, { name: "Lokoja", lng: 6.74, lat: 7.80 },
  { name: "Abeokuta", lng: 3.35, lat: 7.15 }, { name: "Maiduguri", lng: 13.16, lat: 11.83 }, { name: "Sokoto", lng: 5.24, lat: 13.06 },
  { name: "Calabar", lng: 8.33, lat: 4.96 }, { name: "Ogbomosho", lng: 4.24, lat: 8.13 },
];

/** Where our Lagos hub district sits (Ojuelegba-ish, between Yaba and Surulere). */
export const HUB_LNGLAT: LngLat = [3.3665, 6.5090];

/** Game-world metres around an anchor -> [lng, lat] (x east, z south). */
export function metresToLngLat(anchor: LngLat, x: number, z: number): LngLat {
  const lat = anchor[1] - z / 110540;
  const lng = anchor[0] + x / (111320 * Math.cos((anchor[1] * Math.PI) / 180));
  return [lng, lat];
}

// ---------------------------------------------------------------- routing over our roads
type Node = { p: LngLat; edges: { to: number; d: number }[] };
let graph: Node[] | null = null;
const dist = (a: LngLat, b: LngLat) => Math.hypot((a[0] - b[0]) * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180), a[1] - b[1]);

function buildGraph(): Node[] {
  const nodes: Node[] = [];
  const idOf = (p: LngLat): number => {
    const i = nodes.findIndex((n) => dist(n.p, p) < 0.004); // shared junctions
    if (i >= 0) return i;
    nodes.push({ p, edges: [] });
    return nodes.length - 1;
  };
  for (const r of ROADS) {
    for (let i = 1; i < r.pts.length; i++) {
      const a = idOf(r.pts[i - 1]), b = idOf(r.pts[i]);
      const d = dist(nodes[a].p, nodes[b].p);
      nodes[a].edges.push({ to: b, d });
      nodes[b].edges.push({ to: a, d });
    }
  }
  // stitch nearby road ends together so the network is one piece
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const d = dist(nodes[i].p, nodes[j].p);
      if (d < 0.03 && !nodes[i].edges.some((e) => e.to === j)) {
        nodes[i].edges.push({ to: j, d: d * 1.5 });
        nodes[j].edges.push({ to: i, d: d * 1.5 });
      }
    }
  return nodes;
}

/** Driving route from a to b along our roads (falls back to a straight line). */
export function routeBetween(a: LngLat, b: LngLat): LngLat[] {
  graph ??= buildGraph();
  const g = graph;
  const near = (p: LngLat) => g.reduce((best, n, i) => (dist(n.p, p) < dist(g[best].p, p) ? i : best), 0);
  const s = near(a), t = near(b);
  const d = new Array(g.length).fill(Infinity), prev = new Array(g.length).fill(-1), done = new Array(g.length).fill(false);
  d[s] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < g.length; i++) if (!done[i] && d[i] < Infinity && (u < 0 || d[i] < d[u])) u = i;
    if (u < 0 || u === t) break;
    done[u] = true;
    for (const e of g[u].edges) if (d[u] + e.d < d[e.to]) { d[e.to] = d[u] + e.d; prev[e.to] = u; }
  }
  if (d[t] === Infinity) return [a, b];
  const path: LngLat[] = [];
  for (let u = t; u >= 0; u = prev[u]) path.unshift(g[u].p);
  return [a, ...path, b];
}

/** Gentle arc for flights. */
export function flightPath(a: LngLat, b: LngLat): LngLat[] {
  const out: LngLat[] = [];
  const len = dist(a, b);
  for (let i = 0; i <= 32; i++) {
    const t = i / 32;
    const lift = Math.sin(t * Math.PI) * len * 0.15;
    out.push([a[0] + (b[0] - a[0]) * t - (b[1] - a[1]) * lift / (len || 1), a[1] + (b[1] - a[1]) * t + (b[0] - a[0]) * lift / (len || 1)]);
  }
  return out;
}

export const lineKm = (pts: LngLat[]) => pts.reduce((s, p, i) => (i ? s + dist(pts[i - 1], p) * 111 : 0), 0);
