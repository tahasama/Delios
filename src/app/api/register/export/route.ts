import { NextResponse } from "next/server";
import { getScope } from "@/lib/scope";
import { getSessionUser } from "@/lib/auth";
import { registerWhere, documentsForAssets, readSearch, type RegisterSearch } from "@/lib/register-query";

// §16.6 — a view: generated at time of use, carries generation date/time,
// never edited. The flat document list is a view of the register (§16.1).
/** A selection too long for an address arrives as a body instead. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { ids?: string[]; search?: Record<string, string> };
  const params = new URLSearchParams(body.search ?? {});
  if (body.ids?.length) params.set("ids", body.ids.join(","));
  return GET(new Request(`${new URL(request.url).origin}/api/register/export?${params}`, { headers: request.headers }));
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ctx = await getScope();
  if (!ctx) return NextResponse.json({ error: "No active project" }, { status: 403 });
  const { db } = ctx;

  const params = new URL(request.url).searchParams;
  // A selection is a list of ids; everything else is the question the register
  // was asked, answered here the same way the screen answers it. The export
  // used to honour four of the eleven filters, so "export what these filters
  // match" quietly meant something else than what the reader was looking at.
  const ids = (params.get("ids") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const sp = Object.fromEntries(params.entries()) as RegisterSearch;
  const assetDocIds = await documentsForAssets(ctx, readSearch((sp.q ?? "").trim()).flatMap((search) => search.words));

  const docs = await db.document.findMany({
    where: ids.length ? { id: { in: ids } } : registerWhere(sp, assetDocIds),
    orderBy: { docNumber: "asc" },
    include: {
      revisions: { orderBy: { createdAt: "desc" }, include: { workflowRuns: { orderBy: { updatedAt: "desc" }, take: 1 }, approvals: { where: { withdrawnAt: null }, orderBy: { decidedAt: "desc" }, take: 1 } } },
      _count: { select: { baselineEntries: true, packageMembers: true } },
    },
  });

  const stamp = new Date();

  /**
   * Every column the export can write, in the order the register shows them,
   * each named the way the register's own column menu names it. A reader who
   * has hidden half the register did so for a reason, and a spreadsheet that
   * ignores that is a second register nobody asked for.
   */
  type Doc = (typeof docs)[number];
  const COLUMNS: { label: string; read: (doc: Doc) => string }[] = [
    { label: "Document number", read: (d) => d.docNumber },
    { label: "Title", read: (d) => d.title },
    { label: "Produced by", read: (d) => d.deliverableType },
    { label: "Type", read: (d) => d.docType },
    { label: "Discipline", read: (d) => d.discipline },
    { label: "Originator", read: (d) => d.originator ?? "" },
    { label: "Sub-project", read: (d) => d.subProject ?? "" },
    { label: "Contract", read: (d) => d.contractRef ?? "" },
    { label: "Criticality", read: (d) => d.criticality ?? "" },
    { label: "Confidentiality", read: (d) => d.confidentiality ?? "" },
    { label: "Kept for", read: (d) => d.retentionClass ?? "" },
    { label: "Document state", read: (d) => d.state },
    { label: "Placeholder", read: (d) => (d.isPlaceholder ? "yes" : "no") },
    { label: "Previous identifier", read: (d) => d.previousId ?? "" },
    { label: "Legacy scheme", read: (d) => d.legacyScheme ?? "" },
    { label: "Created", read: (d) => d.createdDate.toISOString() },
    { label: "Received", read: (d) => d.receivedDate?.toISOString() ?? "" },
    { label: "Authoring application", read: (d) => d.appVersion ?? "" },
    { label: "Revision", read: (d) => d.revisions[0]?.value ?? "" },
    { label: "Revision state", read: (d) => d.revisions[0]?.state ?? "" },
    { label: "Released revision", read: (d) => d.revisions.find((r) => r.state === "RELEASED")?.value ?? "" },
    { label: "Released for", read: (d) => d.revisions.find((r) => r.state === "RELEASED")?.statusCode ?? "" },
    { label: "Review verdict", read: (d) => d.latestVerdict ?? "" },
    { label: "Planned submission", read: (d) => d.revisions[0]?.plannedSubmissionDate?.toISOString() ?? "" },
    { label: "Issued", read: (d) => d.revisions.find((r) => r.state === "RELEASED")?.issueDate?.toISOString() ?? "" },
    { label: "Released", read: (d) => d.revisions.find((r) => r.state === "RELEASED")?.releasedAt?.toISOString() ?? "" },
    { label: "Decided by", read: (d) => d.revisions[0]?.approvals[0]?.approverName ?? "" },
    { label: "Review route", read: (d) => routeOf(d)?.templateName ?? "" },
    { label: "Route state", read: (d) => routeOf(d)?.status ?? "" },
    { label: "Revision started", read: (d) => d.revisions[0]?.createdAt.toISOString() ?? "" },
    { label: "In schedule", read: (d) => String(d._count.baselineEntries) },
    { label: "In packages", read: (d) => String(d._count.packageMembers) },
    { label: "Changed", read: (d) => d.updatedAt.toISOString() },
  ];

  function routeOf(d: Doc) {
    const runs = d.revisions.flatMap((revision) => revision.workflowRuns);
    return runs.find((workflow) => workflow.status === "ACTIVE") ?? d.revisions[0]?.workflowRuns[0];
  }

  // The reader's own choice of columns, by name. Asking for none means all of
  // them: an export from a link rather than the register is still complete.
  const asked = (params.get("cols") ?? "").split("|").map((one) => one.trim()).filter(Boolean);
  const always = new Set(["Document number", "Title"]);
  const columns = asked.length ? COLUMNS.filter((column) => always.has(column.label) || asked.includes(column.label)) : COLUMNS;

  const rows: string[][] = [
    ["Generated at", stamp.toISOString()],
    ["Generated by", user.email],
    ["Scope", ids.length ? `${ids.length} selected document${ids.length === 1 ? "" : "s"}` : "The documents these filters match"],
    ["Columns", asked.length ? "As shown in the register" : "All"],
    [],
    columns.map((column) => column.label),
  ];
  for (const d of docs) rows.push(columns.map((column) => column.read(d)));

  const csv = rows.map((r) => r.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="register-view-${stamp.toISOString().slice(0, 16).replaceAll(":", "")}.csv"`,
    },
  });
}
