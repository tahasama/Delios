import { NextResponse } from "next/server";
import { getScope } from "@/lib/scope";
import { toCsv } from "@/lib/csv";
import { legacyPackageByNumber } from "@/lib/api/packages";
import { supplierRows, lineStage } from "@/lib/supplier";

/**
 * A supplier's package as a list: its own documents, each with when it is due and where it stands, in the reader's
 * words. The supplier gets only the documents asked of it.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ identifier: string }> }) {
  const scope = await getScope();
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { identifier } = await params;
  const pkg = await legacyPackageByNumber(scope, decodeURIComponent(identifier)).catch(() => null);
  if (!pkg) return NextResponse.json({ error: "No such package." }, { status: 404 });
  const side = scope.user.isInternal ? "ours" : "theirs";
  const asked = new Set(pkg.view.members.filter((m) => m.requestedAt).map((m) => m.documentId));
  const rows = (await supplierRows(scope, { ...pkg, detail: false })).filter((row) => side === "ours" || asked.has(row.doc.id));
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  const lines = [
    ["Number", "Title", "Revision", "Submit by", "Where it stands"],
    ...rows.map((row) => {
      const where = lineStage(row, asked.has(row.doc.id), side);
      return [row.doc.docNumber, row.doc.title, row.revision?.value ?? "", day(row.due), [where.word, where.holder].filter(Boolean).join(" · ")];
    }),
  ];
  return new NextResponse(toCsv(lines), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${pkg.identifier}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
