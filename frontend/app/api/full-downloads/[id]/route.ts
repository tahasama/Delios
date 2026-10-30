import { NextResponse } from "next/server";
import { apiFetch, problemOf } from "@/lib/client";

// The zip itself: the backend checks it is the person's own and opens it from its seal; passed on as it streams.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const stored = await apiFetch(`/api/full-downloads/${id}/file`);
  if (!stored.ok || !stored.body) {
    const problem = await problemOf(stored);
    return NextResponse.json({ error: problem.message }, { status: stored.status || 502 });
  }
  return new NextResponse(stored.body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": stored.headers.get("content-disposition") ?? `attachment; filename="full-download.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
