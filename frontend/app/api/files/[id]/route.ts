import { NextResponse } from "next/server";
import { getScope } from "@/lib/core/scope";
import { apiFetch, problemOf, projectPath } from "@/lib/client";

// Controlled file access. The backend decides whether this person may open the
// file (the project, their clearance, and for another party only what is
// theirs or was issued to them), logs the download, and passes on its bytes,
// opened from their seal (files are kept encrypted: no link to the store is ever given).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getScope();
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const stored = await apiFetch(projectPath(scope, `/files/${id}/download`));
  if (!stored.ok || !stored.body) {
    const problem = await problemOf(stored);
    return NextResponse.json({ error: problem.message }, { status: stored.status || 502 });
  }
  const url = new URL(req.url);
  const type = stored.headers.get("content-type") || "application/octet-stream";
  // Only what a browser shows without running anything opens in the page: a PDF or a plain image. Anything else
  // (HTML, SVG, scripts) is a download, so a file somebody uploaded never runs as the person opening it.
  const viewable = /^(application\/pdf|image\/(png|jpeg|gif|webp|avif|bmp))\b/i.test(type);
  const disposition = url.searchParams.get("dl") === "1" || !viewable ? "attachment" : "inline";
  const given = stored.headers.get("content-disposition") ?? "";
  // The UTF-8 name first (the plain one may have lost its accents).
  const raw = /filename\*=UTF-8''([^;]+)/i.exec(given)?.[1] ?? /filename="?([^";]+)"?/i.exec(given)?.[1] ?? id;
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { /* the name as it came */ }
  const plain = decoded.replace(/[\r\n"\\]/g, "_").replace(/[^\x20-\x7e]/g, "_");
  return new NextResponse(stored.body, {
    headers: {
      "Content-Type": viewable ? type : "application/octet-stream",
      "Content-Disposition": `${disposition}; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(decoded)}`,
      // Its length only as it came: a body the way in compressed is passed on whole, its length then unknown.
      ...(stored.headers.get("content-length") && !stored.headers.get("content-encoding") ? { "Content-Length": stored.headers.get("content-length")! } : {}),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      // Embedded only by our own pages; a download, if a browser opens it anyway, runs nothing.
      "Content-Security-Policy": viewable ? "frame-ancestors 'self'" : "sandbox; default-src 'none'; frame-ancestors 'none'",
    },
  });
}
