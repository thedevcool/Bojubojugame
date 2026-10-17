/**
 * Places load one at a time. The start-up download has a summary of every place (names, zones, safe houses…);
 * a place's heavy part (its props) is fetched only when you go there — during the ride, which is the loader —
 * and the place you left is packed away again, so a phone only ever holds where you are (plus where you just
 * were, for a quick way back).
 */
import { API_URL } from "./api";
import { useGame } from "./store";
import type { GameMap } from "./types";

const pending = new Map<string, Promise<GameMap | null>>();
const recent: string[] = []; // full maps kept, newest last
const KEEP = 2;

export function ensureMap(id: string): Promise<GameMap | null> {
  const st = useGame.getState();
  const have = st.content?.maps[id];
  if (have && have.full !== false) { touch(id); return Promise.resolve(have); }
  let p = pending.get(id);
  if (!p) {
    p = fetch(`${API_URL}/api/maps/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? (r.json() as Promise<GameMap>) : null))
      .then((full) => {
        pending.delete(id);
        const content = useGame.getState().content;
        if (!full || !content) return null;
        touch(id);
        const maps = { ...content.maps, [id]: full };
        // pack away places nobody here needs any more (keep where you are and the one before)
        const here = useGame.getState().mapId;
        for (const [k, m] of Object.entries(maps)) {
          if (m.full !== false && !recent.includes(k) && k !== here) maps[k] = { ...m, props: [], full: false };
        }
        useGame.getState().set({ content: { ...content, maps } });
        return full;
      })
      .catch(() => { pending.delete(id); return null; });
    pending.set(id, p);
  }
  return p;
}

function touch(id: string): void {
  const i = recent.indexOf(id);
  if (i >= 0) recent.splice(i, 1);
  recent.push(id);
  while (recent.length > KEEP) recent.shift();
}

/** The place you're in, once it has fully arrived (null while it's still on its way). */
export function useFullMap(): GameMap | null {
  return useGame((s) => {
    const m = s.mapId ? s.content?.maps[s.mapId] : undefined;
    return m && m.full !== false ? m : null;
  });
}
