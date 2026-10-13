import { NextResponse } from "next/server";
import { getScope } from "@/lib/scope";
import { projectPath } from "@/lib/api/client";
import { passOnFile } from "@/lib/api/conformance";
import { REPORT_IDS, type ReportId } from "@/lib/reports";

/** A report from the Reports page, as CSV, stamped with when it was counted (the backend writes the file). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getScope();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!REPORT_IDS.includes(id as ReportId)) return NextResponse.json({ error: "Unknown report" }, { status: 404 });
  const q = new URL(req.url).searchParams.get("rq") ?? undefined;
  return passOnFile(projectPath(ctx, `/reports/${id}/export`), { format: "csv", q });
}
