/**
 * Validated public URLs. Empty or malformed env vars (e.g. a blank value saved
 * in the Vercel dashboard) fall back instead of crashing the build.
 */
export function cleanUrl(raw: string | undefined, fallback: string): string {
  const v = (raw ?? "").trim();
  if (!v) return fallback;
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return fallback;
  }
}

const vercelProd = process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL;

export const API_URL = cleanUrl(process.env.NEXT_PUBLIC_API_URL, "http://localhost:8000");

/** Build-time site URL (used for metadata / OG tags on the server). */
export const BUILD_SITE_URL = cleanUrl(process.env.NEXT_PUBLIC_SITE_URL, cleanUrl(vercelProd, "http://localhost:3000"));

/** Site URL for links; in the browser the real origin always wins. */
export function siteUrl(): string {
  return typeof window !== "undefined" ? window.location.origin : BUILD_SITE_URL;
}
