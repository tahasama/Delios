import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Registering an organization is the one self-service path, so it must be
// reachable without a session. Everything else needs one.
const PUBLIC = ["/login", "/signup", "/_next", "/favicon", "/icon", "/robots.txt"];

export async function middleware(req: NextRequest) {
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
