import { NextResponse } from "next/server";
import { getScope } from "@/lib/core/scope";
import { api, ApiProblem, projectPath } from "@/lib/client";

// A Primavera P6 export (.xer) read for the screen by the backend (which decides who may open it): its projects, WBS and activities.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getScope();
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const outline = await api<unknown>(projectPath(scope, `/files/${id}/schedule`));
    return NextResponse.json(outline, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof ApiProblem) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
