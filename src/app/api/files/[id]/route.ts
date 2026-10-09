import { NextResponse } from "next/server";
import { getScope } from "@/lib/scope";
import { api, ApiProblem, projectPath } from "@/lib/api/client";

// Controlled file access. The backend decides whether this person may open the
// file (the project, their clearance, and for another party only what is
// theirs or was issued to them), logs the download, and gives a short-lived
// link; the bytes are passed on from there under the file's own name.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getScope();
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  let ticket: { url: string };
  try {
    ticket = await api<{ url: string }>(projectPath(scope, `/files/${id}/download`));
  } catch (e) {
    if (e instanceof ApiProblem) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const stored = await fetch(ticket.url);
  if (!stored.ok || !stored.body) return NextResponse.json({ error: "File missing from the repository." }, { status: 410 });
  const url = new URL(req.url);
  const type = stored.headers.get("content-type") || "application/octet-stream";
  // Only what a browser shows without running anything opens in the page: a PDF or a plain image. Anything else
  // (HTML, SVG, scripts) is a download, so a file somebody uploaded never runs as the person opening it.
  const viewable = /^(application\/pdf|image\/(png|jpeg|gif|webp))\b/i.test(type);
  const disposition = url.searchParams.get("dl") === "1" || !viewable ? "attachment" : "inline";
  const raw = stored.headers.get("content-disposition")?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1] ?? id;
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { /* the name as it came */ }
  const plain = decoded.replace(/[\r\n"\\]/g, "_").replace(/[^\x20-\x7e]/g, "_");
  return new NextResponse(stored.body, {
    headers: {
      "Content-Type": viewable ? type : "application/octet-stream",
      "Content-Disposition": `${disposition}; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(decoded)}`,
      ...(stored.headers.get("content-length") ? { "Content-Length": stored.headers.get("content-length")! } : {}),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      // Embedded only by our own pages; a download, if a browser opens it anyway, runs nothing.
      "Content-Security-Policy": viewable ? "frame-ancestors 'self'" : "sandbox; default-src 'none'; frame-ancestors 'none'",
    },
  });
}
