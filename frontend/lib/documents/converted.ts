import "server-only";
import { NextResponse } from "next/server";
import { getScope } from "@/lib/core/scope";
import { apiFetch, problemOf, projectPath } from "@/lib/client";

/**
 * A file turned into what the page shows (backend `Documents/Previews.cs`, which decides who may open it): an office
 * file as a PDF, a drawing as DXF. The bytes are passed on as they come; a refusal is said in its own words.
 */
export async function converted(id: string, what: "as-pdf" | "as-dxf" | "page.png", query?: Record<string, string>): Promise<Response> {
  const scope = await getScope();
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const answer = await apiFetch(projectPath(scope, `/files/${id}/${what}`), { query });
  if (!answer.ok || !answer.body) {
    const problem = await problemOf(answer);
    return NextResponse.json({ error: problem.message }, { status: answer.status || 502 });
  }
  return new NextResponse(answer.body, {
    headers: {
      "Content-Type": what === "as-pdf" ? "application/pdf" : what === "page.png" ? "image/png" : "application/octet-stream",
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      // Embedded only by our own pages.
      "Content-Security-Policy": what !== "as-dxf" ? "frame-ancestors 'self'" : "sandbox; default-src 'none'; frame-ancestors 'none'",
    },
  });
}
