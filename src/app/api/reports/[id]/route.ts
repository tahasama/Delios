import { NextResponse } from "next/server";
import { getScope } from "@/lib/scope";
import { toCsv } from "@/lib/csv";
import { buildReport, filterRows, cellText, REPORT_IDS, type ReportId } from "@/lib/reports";

/** A report from the Reports page, as CSV, stamped with when it was counted. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getScope();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!REPORT_IDS.includes(id as ReportId)) return NextResponse.json({ error: "Unknown report" }, { status: 404 });
  const report = await buildReport(ctx, id as ReportId);
  const stamp = new Date().toISOString();
  const rows = filterRows(report.rows, new URL(req.url).searchParams.get("rq") ?? "").map((r) => r.map(cellText));
  const csv = toCsv([[`${report.title} — ${ctx.project.code} — counted ${stamp}`], report.columns, ...rows]);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${ctx.project.code}-${id}-${stamp.slice(0, 10)}.csv"`,
    },
  });
}
