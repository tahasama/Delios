import { NextResponse } from "next/server";
import { getScope } from "@/lib/scope";
import { toCsv } from "@/lib/csv";
import { legacyActions } from "@/lib/api/schedule";
import { handlerFor } from "@/lib/controlled/registry";
import "@/lib/controlled/handlers";

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

/**
 * The sheet to fill for each of the schedule's three lists, with the headings
 * the reader looks for. Filled with what is in force where there is something
 * (the actions, their disciplines); otherwise one example line shows the shape.
 * SCHEDULE · DEPARTMENTS · REQUIREMENTS
 */
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const ctx = await getScope();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { kind } = await params;

  let rows: (string | number | null)[][];
  if (kind === "SCHEDULE") {
    const actions = await legacyActions(ctx);
    rows = [["Activity ID", "Activity Name", "Start", "Finish"],
      ...(actions.length
        ? actions.map((one) => [one.scheduleRef ?? one.code, one.name, day(one.scheduledDate), day(one.finishDate)])
        : [["1010", "Foundation concrete pour — clarifier", "2026-09-21", "2026-09-22"]])];
  } else if (kind === "DEPARTMENTS" || kind === "REQUIREMENTS") {
    const handler = handlerFor(kind === "DEPARTMENTS" ? "ACTION_DEPARTMENTS" : "DOCUMENT_REQUIREMENTS");
    if (!handler) return NextResponse.json({ error: "Unknown kind" }, { status: 404 });
    // The disciplines list is handed back as it stands, ready to adjust; requirements start from the example.
    rows = kind === "DEPARTMENTS" && handler.exportRows
      ? [handler.columns, ...(await handler.exportRows(ctx, "default"))]
      : [handler.columns, handler.sample, ...(handler.extraSamples ?? [])];
  } else {
    return NextResponse.json({ error: "Unknown kind" }, { status: 404 });
  }
  return new NextResponse(toCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${ctx.project.code}-${kind.toLowerCase()}-template.csv"`,
    },
  });
}
