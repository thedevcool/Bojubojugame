import type { Metadata } from "next";
import Link from "next/link";
import { naira } from "@/lib/api";
import { fetchSummary } from "@/lib/summary";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const s = await fetchSummary((await params).id);
  const winner = s?.standings[0];
  const title = winner ? `${winner.nick} won Boju Boju with ${naira(winner.earned)}!` : "Boju Boju — Lagos hide & seek";
  return { title, openGraph: { title, description: "Hide & seek, Lagos style. Come play with your friends!" } };
}

export default async function SharePage({ params }: Props) {
  const s = await fetchSummary((await params).id);
  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center px-4 py-8">
      <h1 className="text-4xl font-black text-[var(--accent)]">Boju Boju</h1>
      {s ? (
        <div className="panel mt-4 p-4">
          <div className="mb-2 text-sm opacity-80">Final score · {s.arena}</div>
          {s.standings.map((r, i) => (
            <div key={i} className="flex justify-between border-b border-white/10 py-1.5">
              <span>{["🥇", "🥈", "🥉"][i] ?? `${i + 1}.`} {r.nick}</span>
              <span className="text-xs opacity-75">{r.finds} finds · {r.survived} hides</span>
              <span className="font-bold">{naira(r.earned)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4">This game card could not be found.</p>
      )}
      <Link href="/" className="btn btn-primary mt-6 text-center text-lg">Play Boju Boju ▶</Link>
      <p className="mt-6 text-center text-xs opacity-60">In-game naira only — not real money.</p>
    </main>
  );
}
