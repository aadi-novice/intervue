import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Optimistic route protection (Next 16 `proxy`, formerly `middleware`).
 * Only checks cookie presence; the API remains the source of truth and the
 * client AuthGate handles expired sessions.
 */
const PUBLIC_PREFIXES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/invite",
  "/api",
  "/_next",
  "/favicon.ico",
];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }
  // refresh_token is path-scoped to /api/auth, so page requests never carry it; csrf_token (path /, same lifetime) is the long-lived session hint.
  const hasSession = ["access_token", "refresh_token", "csrf_token"].some((c) => request.cookies.has(c));
  if (hasSession) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  if (pathname !== "/") url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  // Skip static assets; everything else goes through the check above.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
