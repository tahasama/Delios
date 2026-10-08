import { NextResponse } from "next/server";
import { apiFetch } from "@/lib/api/client";
import { getSession, projectPath } from "@/lib/session";

/** The receipt of an incoming transmittal, as the backend draws it (a PDF), passed through. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const { id } = await params;
  const response = await apiFetch(projectPath(session, `/transmittals/${id}/receipt`));
  if (!response.ok) return NextResponse.json({ error: "No receipt for that." }, { status: response.status });
  return new NextResponse(response.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": response.headers.get("Content-Disposition") ?? `attachment; filename="receipt.pdf"`,
    },
  });
}
