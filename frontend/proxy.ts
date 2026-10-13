import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Registering an organization, and getting a new password, must be reachable
// without a session. Everything else needs one.
// The pop-up notifications script is fetched by the browser on its own, sometimes without the page.
const PUBLIC = ["/login", "/signup", "/forgot-password", "/reset-password", "/_next", "/favicon", "/icon", "/robots.txt", "/sw.js"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  // The session is the backend's: a page that finds it no longer valid sends
  // the person to sign in. Here, only whether there is one at all.
  const token = req.cookies.get("edms_session")?.value;
  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/auth).*)"],
};
