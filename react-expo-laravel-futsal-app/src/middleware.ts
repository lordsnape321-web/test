import { NextResponse, type NextRequest } from "next/server";

/**
 * CORS shim for the API during the Expo migration.
 *
 * The Expo app on web runs on a different origin (e.g. localhost:8081) than this
 * API (localhost:3000). Without CORS headers the browser blocks every request,
 * so the native app works but the web preview cannot reach the backend. This
 * adds the headers the browser needs.
 *
 * Scope and safety:
 *   - Only /api/* is matched (see config below); pages are untouched.
 *   - The request Origin is reflected rather than echoing "*", so a specific
 *     origin is allowed. Credentials are NOT enabled — the Expo app authenticates
 *     with values in the request body/AsyncStorage, not cookies — so there is no
 *     credentialed-wildcard exposure.
 *   - Preflight OPTIONS requests are answered here and never reach a route.
 *
 * This is an interim affordance for the migration. Once the Laravel backend is
 * in place it owns CORS (Laravel ships a cors config), and this file goes away
 * with the rest of the Next.js API.
 *
 * To restrict origins, set CORS_ORIGINS to a comma-separated allow-list
 * (e.g. "http://localhost:8081,https://app.example.com"). When unset, any origin
 * is reflected, which is what local development wants.
 */

const ALLOWED_METHODS = "GET,POST,PATCH,PUT,DELETE,OPTIONS";
const ALLOWED_HEADERS = "Content-Type, Authorization";

function allowList(): string[] | null {
  const raw = process.env.CORS_ORIGINS;
  if (!raw || !raw.trim()) return null;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The Access-Control-* headers for this request, or null if the origin isn't allowed. */
function corsHeaders(req: NextRequest): Headers | null {
  const origin = req.headers.get("origin");
  // No Origin header (same-origin, curl, server-to-server) — nothing to add.
  if (!origin) return null;

  const allowed = allowList();
  if (allowed && !allowed.includes(origin)) return null;

  return new Headers({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Max-Age": "86400",
    // Tell caches the response varies by Origin, since we reflect it.
    Vary: "Origin",
  });
}

export function middleware(req: NextRequest) {
  // Preflight: answer immediately, don't hit the route.
  if (req.method === "OPTIONS") {
    const headers = corsHeaders(req);
    return new NextResponse(null, { status: 204, headers: headers ?? undefined });
  }

  const res = NextResponse.next();
  const headers = corsHeaders(req);
  if (headers) {
    headers.forEach((value, key) => res.headers.set(key, value));
  }
  return res;
}

export const config = {
  // Only the API. Adjust if the API ever moves out from under /api.
  matcher: "/api/:path*",
};
