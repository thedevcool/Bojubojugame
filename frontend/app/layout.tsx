import type { Metadata, Viewport } from "next";
import "./globals.css";
import { BUILD_SITE_URL } from "@/lib/env";
import SwRegister from "./sw-register";

export const metadata: Metadata = {
  metadataBase: new URL(BUILD_SITE_URL),
  title: "🙈 Boju Boju — Lagos hide & seek",
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
  themeColor: "#0a1324",
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
