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
    // Said in plain words, never as data (the person followed a link): nothing to download for this list yet.
    if (e instanceof ApiProblem) return said(e.status === 404 ? "There is no file to download for this list yet: it was not read from a file." : e.message, e.status);
    throw e;
  }
  if (read.fileId) return NextResponse.redirect(new URL(`/api/files/${read.fileId}?dl=1`, req.url));
  const stored = await apiFetch(projectPath(scope, `/schedule/lists/${encodeURIComponent(kind)}/source/file`));
  if (!stored.ok || !stored.body) return said("The file it was read from could not be found.", stored.status || 404);
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

const said = (words: string, status: number) =>
  new NextResponse(words, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
