import { NextResponse } from "next/server";
import { getScope } from "@/lib/scope";
import { toCsv } from "@/lib/csv";
import { SET_PROP_FIELDS, parseProps } from "@/lib/config-props";

/**
 * Every published list in one file — set, code, label, whether it is in use,
 * and what each value does in plain words — to attach to the DMP revision
 * that records them.
 */
export async function GET() {
  const ctx = await getScope();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [sets, values] = await Promise.all([
    ctx.db.configSet.findMany({ orderBy: { title: "asc" } }),
    ctx.db.configValue.findMany({ orderBy: [{ setKey: "asc" }, { sort: "asc" }, { code: "asc" }] }),
  ]);
  const rows: string[][] = [["List", "Code", "Label", "In use", "What it does"]];
  for (const set of sets) {
    for (const v of values.filter((x) => x.setKey === set.key)) {
      const props = parseProps(v.props);
      const does = (SET_PROP_FIELDS[set.key] ?? []).map((f) => {
        if (f.type === "choice") return f.options.find((o) => o.value === f.read(props))?.label ?? "";
        if (f.type === "bool") return props[f.key] === true ? f.label : "";
        const val = props[f.key];
        return val === undefined || val === null || val === "" ? "" : `${f.label}: ${String(val)}`;
      }).filter(Boolean).join("; ");
      rows.push([set.title, v.code, v.label, v.status === "ACTIVE" ? "yes" : "retired", does]);
    }
  }
  return new NextResponse(toCsv(rows), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="dmp-lists-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
