import { NextResponse } from "next/server";
import { getScope } from "@/lib/scope";
import { toCsv } from "@/lib/csv";
import { handlerFor } from "@/lib/controlled/registry";
import "@/lib/controlled/handlers";

// Column header → the field a handler's payload uses for it.
const COLUMN_FIELD: Record<string, string> = {
  Function: "functionCode",
  "Deliverable type": "deliverableType",
  "Document type": "docType",
  Discipline: "discipline",
  Criticality: "criticality",
  Confidentiality: "confidentiality",
  Verbs: "verbs",
  Note: "note",
  "Activity Code": "externalId",
  "Activity ID": "externalId",
  "Action Code": "actionCode",
  "Activity Name": "name",
  "Activity Description": "description",
  Date: "date",
  "Responsible Party": "responsibleParty",
  "Lead Time Days": "leadTimeDays",
  Code: "code",
  Label: "label",
  Status: "status",
  Sort: "sort",
  Properties: "props",
};

/**
 * What is in force right now, in the shape the upload expects — so changing
 * something means downloading it, editing it and uploading it back, rather
 * than retyping it and hoping.
 */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const ctx = await getScope();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { kind } = await params;
  const handler = handlerFor(kind);
  if (!handler) return NextResponse.json({ error: "Unknown kind" }, { status: 404 });

  const key = new URL(req.url).searchParams.get("key") ?? "default";
  const headers = {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="${kind.toLowerCase()}-${key}-in-force.csv"`,
  };
  if (handler.exportRows) return new NextResponse(toCsv([handler.columns, ...(await handler.exportRows(ctx, key))]), { headers });

  const current = (await handler.current(ctx, key)) as Record<string, unknown>[];

  const rows: (string | number | null)[][] = [handler.columns];
  for (const item of current) {
    rows.push(
      handler.columns.map((column) => {
        const value = item[COLUMN_FIELD[column] ?? ""];
        if (Array.isArray(value)) return value.join("|");
        if (value === null || value === undefined) return "";
        return value as string | number;
      }),
    );
  }

  return new NextResponse(toCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${kind.toLowerCase()}-${key}-in-force.csv"`,
    },
  });
}
