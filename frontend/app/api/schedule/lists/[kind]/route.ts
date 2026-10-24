import { NextResponse } from "next/server";
import { getScope } from "@/lib/core/scope";
import { api, apiFetch, ApiProblem, projectPath } from "@/lib/client";

// The file a schedule list in force was read from, whichever came last: a released revision's file of the register
// document (opened as any file, through its own checks), or a file uploaded on the Schedule, downloaded as it came.
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const scope = await getScope();
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { kind } = await params;
  let read: { name: string; fileId: string | null; uploaded: boolean };
  try {
    read = await api(projectPath(scope, `/schedule/lists/${encodeURIComponent(kind)}/source`));
  } catch (e) {
    if (e instanceof ApiProblem) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  if (read.fileId) return NextResponse.redirect(new URL(`/api/files/${read.fileId}?dl=1`, req.url));
  const stored = await apiFetch(projectPath(scope, `/schedule/lists/${encodeURIComponent(kind)}/source/file`));
  if (!stored.ok || !stored.body) return NextResponse.json({ error: "The file could not be found." }, { status: stored.status });
  const plain = read.name.replace(/[\r\n"\\]/g, "_").replace(/[^\x20-\x7e]/g, "_");
  return new NextResponse(stored.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(read.name)}`,
      ...(stored.headers.get("content-length") ? { "Content-Length": stored.headers.get("content-length")! } : {}),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
