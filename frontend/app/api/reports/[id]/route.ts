import { NextResponse } from "next/server";
import { getScope } from "@/lib/core/scope";
import { projectPath } from "@/lib/client";
import { passOnFile } from "@/lib/conformance/api";
import { OUTSIDE_REPORT_IDS, REPORT_IDS, reportQuery, type ReportId } from "@/lib/conformance/reports";

/**
 * A report from the Reports page as a file (CSV or Excel), narrowed as the page was (words, a bar, a window, a day),
 * stamped with when it was counted. The backend writes the file.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getScope();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!REPORT_IDS.includes(id as ReportId)) return NextResponse.json({ error: "Unknown report" }, { status: 404 });
  if (!ctx.user.isInternal && !OUTSIDE_REPORT_IDS.includes(id as ReportId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const format = sp.get("format") === "xlsx" ? "xlsx" : "csv";
  const query = reportQuery(id as ReportId, { rq: sp.get("rq") ?? undefined, bar: sp.get("bar") ?? undefined, on: sp.get("on") ?? undefined, window: sp.get("window") ?? undefined, by: sp.get("by") ?? undefined });
  return passOnFile(projectPath(ctx, `/reports/${id}/export`), { format, ...query });
}
