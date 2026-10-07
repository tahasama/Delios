import { NextResponse, type NextRequest } from "next/server";
import { isMigrated } from "@/lib/migrated";

/**
 * Before every page: no session cookie, off to sign in; a screen not yet on the
 * new backend, back home. Whether the session is still valid is the backend's
 * answer, checked by each page.
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const signedIn = request.cookies.has("delios_session");
  if (!signedIn && pathname !== "/login") {
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
  }
  if (!isMigrated(pathname)) return NextResponse.redirect(new URL("/", request.url));
  return NextResponse.next();
}

export const config = {
  // Pages only: not Next's own files, images or the app's icons.
  matcher: ["/((?!_next/|favicon|icon|apple-icon|.*\\.(?:png|jpg|svg|ico|css|js|woff2?)$).*)"],
};
