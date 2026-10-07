import { NextResponse } from "next/server";
import { apiFetch } from "@/lib/api/client";
import { getSession, projectPath } from "@/lib/session";

/**
 * The register's Export button: the backend writes the file (the same filters,
 * the same order, or only the rows selected); this passes it to the browser.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  params.delete("cols");
  if (!params.has("format")) params.set("format", "csv");
  const response = await apiFetch(`${projectPath(session, "/register/export")}?${params}`);
  return new NextResponse(response.body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "text/csv",
      "content-disposition": response.headers.get("content-disposition") ?? "attachment",
    },
  });
}

/** A selection too long for an address arrives as a body instead. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { ids?: string[]; search?: Record<string, string> };
  const params = new URLSearchParams(body.search ?? {});
  if (body.ids?.length) params.set("ids", body.ids.join(","));
  return GET(new Request(`${new URL(request.url).origin}/api/register/export?${params}`, { headers: request.headers }));
}
