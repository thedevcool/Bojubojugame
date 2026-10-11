import { API_URL } from "./api";

export interface Summary { id: string; arena: string; ended_at: string | null; standings: { nick: string; earned: number; finds: number; survived: number }[] }

export async function fetchSummary(id: string): Promise<Summary | null> {
  if (!/^[a-f0-9]{32}$/.test(id)) return null;
  try {
    const r = await fetch(`${API_URL}/api/games/${id}/summary`, { next: { revalidate: 3600 } });
    return r.ok ? ((await r.json()) as Summary) : null;
  } catch {
    return null;
  }
}
