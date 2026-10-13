import { NextResponse } from "next/server";
import { getScope } from "@/lib/scope";
import { toCsv } from "@/lib/csv";
import { departmentSheet, senderSheet, isDepartmentSender } from "@/lib/requirements-process";

/**
 * The sheets that travel between the steps: a department's part of the
 * requirements list to fill, and a sender's list to baseline on.
 * ?dept=EL · ?sender=MAD · ?sender=DEPT:EL
 */
export async function GET(req: Request) {
  const ctx = await getScope();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const dept = url.searchParams.get("dept");
  const sender = url.searchParams.get("sender");

  let rows: string[][];
  let name: string;
  if (dept) {
    if (!ctx.user.isInternal) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    rows = await departmentSheet(ctx, dept);
    name = `requirements-${dept}`;
  } else if (sender) {
    // A supplier only ever reads its own list.
    if (!ctx.user.isInternal && (isDepartmentSender(sender) || sender !== ctx.user.partyCode)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    rows = await senderSheet(ctx, sender);
    name = `to-deliver-${sender.replace(":", "-")}`;
  } else {
    return NextResponse.json({ error: "Say ?dept= or ?sender=" }, { status: 400 });
  }
  return new NextResponse(toCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${ctx.project.code}-${name}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
