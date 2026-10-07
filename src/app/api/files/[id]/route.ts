import { NextResponse } from "next/server";
import { api, ApiProblem } from "@/lib/api/client";
import { getSession, projectPath } from "@/lib/session";

/**
 * A file link: the backend checks the person may read the file (and records
 * the download), then gives a link valid for a few minutes straight to
 * storage; the browser is sent there. The file never passes through here.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const { id } = await params;
  try {
    const ticket = await api<{ url: string }>(projectPath(session, `/files/${id}/download`));
    return NextResponse.redirect(ticket.url);
  } catch (e) {
    if (e instanceof ApiProblem) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    throw e;
  }
}
