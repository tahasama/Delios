import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Registering an organization, and getting a new password, must be reachable
// without a session. Everything else needs one.
// The pop-up notifications script is fetched by the browser on its own, sometimes without the page.
// The backend's word that something changed carries no session: its route checks the shared secret itself.
const PUBLIC = ["/login", "/signup", "/forgot-password", "/reset-password", "/confirm-email", "/confirm-domain", "/confirm-claim", "/_next", "/favicon", "/icon", "/robots.txt", "/sw.js", "/api/screens/changed"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  // The session is the backend's: a page that finds it no longer valid sends
  // the person to sign in. Here, only whether there is one at all.
  const token = req.cookies.get("edms_session")?.value;
  // Signed in through the organization's own provider (single sign-on): the backend set its session on its own
  // cookie. The screens keep it as theirs, then open the page asked for.
  const sso = req.cookies.get("delios_session")?.value;
  if (!token && sso) {
    const again = NextResponse.redirect(req.nextUrl.clone());
    again.cookies.set("edms_session", sso, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7, secure: process.env.NODE_ENV === "production" });
    again.cookies.delete("delios_session");
    return again;
  }
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
