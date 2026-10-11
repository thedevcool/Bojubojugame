import type { Metadata, Viewport } from "next";
import "./globals.css";
import SwRegister from "./sw-register";

const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: "Boju Boju — Lagos hide & seek",
  description: "Live 3D multiplayer Boju Boju with your friends in Lagos. In-game naira only — not real money.",
  manifest: "/manifest.webmanifest",
  openGraph: { title: "Boju Boju", description: "Hide and seek, Lagos style. Play with your friends!", type: "website" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#1d1a16",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
