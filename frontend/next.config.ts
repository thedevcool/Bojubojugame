import type { NextConfig } from "next";
import { API_URL as api } from "./src/lib/env";
const wsApi = api.replace(/^http/, "ws");

// LagosLife (Vatar Games SDK) frames /lagoslife inside its Games app; everything else stays unframeable.
const LAGOSLIFE = "https://lagoslife.app https://www.lagoslife.app https://naijalife.app https://www.naijalife.app https://lagoslife.eliysites.com";

const csp = (frameAncestors: string) => [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://lagoslife.app",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${api}`, // wall-ad posters are served by the API
  `connect-src 'self' blob: ${api} ${wsApi}`,
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  `frame-ancestors ${frameAncestors}`,
].join("; ");

const baseHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "geolocation=(), camera=(), microphone=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];
const securityHeaders = [...baseHeaders, { key: "X-Frame-Options", value: "DENY" }, { key: "Content-Security-Policy", value: csp("'none'") }];
// no X-Frame-Options here: LagosLife's docs require frame-ancestors only
const lagosLifeHeaders = [...baseHeaders, { key: "Content-Security-Policy", value: csp(LAGOSLIFE) }];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/((?!lagoslife).*)", headers: securityHeaders },
      { source: "/lagoslife", headers: lagosLifeHeaders },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
    ];
  },
};

export default config;
