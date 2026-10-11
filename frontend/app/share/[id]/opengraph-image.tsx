import { ImageResponse } from "next/og";
import { fetchSummary } from "@/lib/summary";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Boju Boju score card";

// The bundled OG font has no ₦ glyph or emoji; keep the card self-contained (no CDN font fetches).
const naira = (n: number) => `N${Math.round(n).toLocaleString("en-NG")}`;

export default async function OgImage({ params }: { params: Promise<{ id: string }> }) {
  const s = await fetchSummary((await params).id);
  const rows = s?.standings.slice(0, 4) ?? [];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "linear-gradient(135deg, #17305e 0%, #0a1324 70%)", color: "#f2f6ff", padding: 60, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div style={{ fontSize: 84, fontWeight: 900, color: "#66a8ff" }}>BOJU BOJU</div>
          <div style={{ fontSize: 36, opacity: 0.8 }}>Lagos hide &amp; seek</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 36, gap: 14 }}>
          {rows.map((r, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 44, background: i === 0 ? "#2f7cf6" : "rgba(160,196,255,0.14)", color: "#f2f6ff", padding: "12px 28px", borderRadius: 18 }}>
              <span>{i + 1}. {r.nick}</span>
              <span>{r.finds} finds · {r.survived} hides · {naira(r.earned)}</span>
            </div>
          ))}
          {rows.length === 0 && <div style={{ fontSize: 48 }}>Come play with your guys!</div>}
        </div>
        <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", fontSize: 26, opacity: 0.75 }}>
          <span>&ldquo;Mo ti ri e!&rdquo;</span>
          <span>In-game naira · not real money</span>
        </div>
      </div>
    ),
    size,
  );
}
