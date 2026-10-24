import { NextResponse } from "next/server";
import { getScope } from "@/lib/core/scope";
import { api, ApiProblem, projectPath } from "@/lib/client";

// A plain text file read for the screen by the backend (which decides who may open it): shown as text, never run.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getScope();
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const text = await api<unknown>(projectPath(scope, `/files/${id}/text`));
    return NextResponse.json(text, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof ApiProblem) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
