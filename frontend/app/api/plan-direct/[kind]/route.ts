import { NextResponse } from "next/server";
import { getScope } from "@/lib/scope";
import { toCsv } from "@/lib/csv";
import { controlledVersions } from "@/lib/api/records";

const STORED: Record<string, string> = { SCHEDULE: "SCHEDULE", DEPARTMENTS: "ACTION_DEPARTMENTS", REQUIREMENTS: "DOCUMENT_REQUIREMENTS" };

/**
 * The list last uploaded directly, without a document, as it was read: every
 * row of the file, as a .csv. SCHEDULE · DEPARTMENTS · REQUIREMENTS
 */
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const ctx = await getScope();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.user.isInternal) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { kind } = await params;
  const stored = STORED[kind];
  if (!stored) return NextResponse.json({ error: "Unknown kind" }, { status: 404 });

  const latest = (await controlledVersions(ctx, stored))
    .filter((one) => one.state === "APPROVED" && one.versionLabel.startsWith("upload"))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!latest || !Array.isArray(latest.payload)) return NextResponse.json({ error: "Nothing was uploaded directly" }, { status: 404 });

  const rows = (latest.payload as unknown[]).map((row) => (Array.isArray(row) ? row.map((cell) => (cell == null ? "" : String(cell))) : []));
  const name = (latest.sourceName ?? `${kind.toLowerCase()}-upload`).replace(/\.(xlsx|csv)$/i, "");
  return new NextResponse(toCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name.replace(/"/g, "")}.csv"`,
    },
  });
}
