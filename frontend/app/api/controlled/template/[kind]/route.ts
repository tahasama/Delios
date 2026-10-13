import { NextResponse } from "next/server";
import { getScope } from "@/lib/scope";
import { toCsv } from "@/lib/csv";
import { handlerFor } from "@/lib/controlled/registry";
import "@/lib/controlled/handlers";

/**
 * The upload template for a kind of controlled configuration, with one example
 * row so the expected shape is obvious rather than described.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const ctx = await getScope();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { kind } = await params;
  const handler = handlerFor(kind);
  if (!handler) return NextResponse.json({ error: "Unknown kind" }, { status: 404 });

  const csv = toCsv([handler.columns, handler.sample, ...(handler.extraSamples ?? [])]);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${kind.toLowerCase()}-template.csv"`,
    },
  });
}
