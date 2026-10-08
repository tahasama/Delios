import { NextResponse } from "next/server";
import { apiFetch } from "@/lib/api/client";
import { getSession, projectPath } from "@/lib/session";

/** Which backend export each list's Export button asks for. Lists join as they move to the backend. */
const EXPORTS: Record<string, string> = {
  reviews: "/reviews/export",
  transmittals: "/transmittals/log/export",
};

/**
 * A list's Export button: the backend writes the file (the same filters, or
 * only the rows selected); this passes it to the browser.
 */
export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const path = EXPORTS[(await params).kind];
  if (!path) return NextResponse.json({ error: "No such export." }, { status: 404 });
  const query = new URL(request.url).searchParams;
  query.delete("cols");
  if (!query.has("format")) query.set("format", "csv");
  const response = await apiFetch(`${projectPath(session, path)}?${query}`);
  return new NextResponse(response.body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "text/csv",
      "content-disposition": response.headers.get("content-disposition") ?? "attachment",
    },
  });
}
