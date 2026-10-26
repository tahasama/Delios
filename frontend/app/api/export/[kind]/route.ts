import { isAdmin } from "@/lib/core/auth";
import { NextResponse } from "next/server";
import { getScope } from "@/lib/core/scope";
import { getSessionUser } from "@/lib/core/auth";
import { toCsv } from "@/lib/core/csv";
import { buildSheet, sheetToRows } from "@/lib/settings/matrix-sheet";
import { buildDeliverableWorkbook } from "@/lib/documents/deliverable-workbook";
import { buildSetsWorkbook } from "@/lib/settings/sets-workbook";
import { roleLabel } from "@/lib/settings/profiles/roles";
import { getSet, getSets } from "@/lib/settings/config";
import { api, ApiProblem, projectPath } from "@/lib/client";
import { adminAudit, adminParties, adminUsers } from "@/lib/settings/api-admin";
import { packagesOf } from "@/lib/packages/api";
import { reasonsOf } from "@/lib/packages/package-rule";
import { activityLateness, planActions } from "@/lib/actions/api";
import { passOn, registerRows } from "@/lib/documents/api-register";

// §16.6 — views are generated at time of use, carry a generation timestamp and
// are never edited. Every register view can be extracted (CSV opens in Excel).
// What the backend refuses comes back with its status and message.
export async function GET(req: Request, context: { params: Promise<{ kind: string }> }) {
  try {
    return await extract(req, context);
  } catch (e) {
    if (e instanceof ApiProblem) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

async function extract(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ctx = await getScope();
  if (!ctx) return NextResponse.json({ error: "No active project" }, { status: 403 });
  const { kind } = await params;
  // Another organization extracts only the registers it can read — never
  // settings, templates, people or the audit log.
  if (!ctx.user.isInternal && !["documents", "reviews", "transmittals", "packages"].includes(kind)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const stamp = new Date();

  let rows: (string | number | null)[][] = [];
  let name = kind;

  if (kind === "documents") {
    // The master register, every state, as the backend writes it.
    return passOn(projectPath(ctx, "/register/export"), { view: "all", sort: "docNumber", dir: "asc", format: "csv" });
  } else if (kind === "reviews") {
    // The reviews page exports what it is showing: a selection when rows are
    // ticked, otherwise every review the filters match.
    return passOn(projectPath(ctx, "/reviews/export"), { ...Object.fromEntries(new URL(req.url).searchParams), format: "csv" });
  } else if (kind === "baseline") {
    // The actions somebody ticked, or all of them.
    const query = new URL(req.url).searchParams;
    const ticked = (query.get("ids") ?? "").split(",").map((one) => one.trim()).filter(Boolean);
    // An action's own sheet can tick documents rather than actions, and then the
    // file holds those documents of that action.
    const onlyDocs = new Set((query.get("docs") ?? "").split(",").map((one) => one.trim()).filter(Boolean));
    const actions = (await planActions(ctx))
      .filter((a) => !ticked.length || ticked.includes(a.id))
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((a) => ({ ...a, entries: a.needs.filter((e) => !onlyDocs.size || onlyDocs.has(e.document.number)), notes: [...a.decisions].reverse() }));
    const now = Date.now();
    /** The same six words the schedule uses, so a file and a screen agree. */
    const state = (a: (typeof actions)[number]) => {
      if (!a.entries.length) return "Nothing listed";
      const met = a.entries.every((e) => e.state === "MET") && a.needCount > 0;
      const past = !!a.start && a.start.getTime() < now;
      if (met) {
        if (!past) return "Ready";
        return a.lastMetAt && a.start && a.lastMetAt > a.start ? "Late receipt" : "Done";
      }
      if (past) return "Overdue";
      const nextNeededAt = a.entries.filter((e) => e.state === "MISSING").map((e) => e.neededBy).sort((x, y) => x.getTime() - y.getTime())[0];
      return nextNeededAt && nextNeededAt.getTime() - now <= 7 * 86_400_000 ? "At risk" : "Still ahead";
    };
    // Where each document's time went travels with it. The screen names the
    // step that slipped; the file carries every checkpoint, because an audit
    // asks what the other two were due and who owed them.
    const at = (iso: string | null | undefined) => (iso ? new Date(iso) : null);
    const lateness = new Map<string, { docNumber: string; checkpoints: { name: string; at: Date | null; due: Date | null; owedBy: string; deadline: string }[]; cause: { name: string; at: Date | null; due: Date | null; owedBy: string; deadline: string } | null; outstanding: boolean }[]>();
    for (const a of actions) {
      lateness.set(a.id, (await activityLateness(ctx, a.id)).map((need) => {
        const point = (one: (typeof need.checkpoints)[number]) => ({ name: one.name, at: at(one.at), due: at(one.due), owedBy: one.owedBy, deadline: one.deadline });
        return { docNumber: need.documentNumber, checkpoints: need.checkpoints.map(point), cause: need.cause ? point(need.cause) : null, outstanding: need.state !== "MET" };
      }));
    }

    rows = [[
      "Action code", "Action", "Description", "Scheduled date", "Departments", "State",
      "Last document issued", "Decision", "Decision stood at", "Carried by", "Reason", "Delay owed by", "Delay reason",
      "Document number", "Required status", "Required by",
      "Delay source", "Delay source happened", "Delay source deadline", "Delay source due", "Delay source owed by",
      "Sent for review at", "Submission due", "Sending for review owed by",
      "Route steps",
      "Released & issued at", "Day of the activity", "Release owed by",
      "Still outstanding",
    ]];
    for (const a of actions) {
      // What was decided about an action that went ahead without its documents
      // travels with it: a row that says "late receipt" and nothing else is only
      // half the record.
      const note = a.notes[a.notes.length - 1] ?? null;
      const head = [
        a.code, a.name, "", a.start?.toISOString().slice(0, 10) ?? "",
        a.departments.join(","), state(a), a.lastMetAt?.toISOString().slice(0, 10) ?? "",
        note ? (note.decision === "CARRIED" ? "Went ahead with missing documents" : "Postponed") : "",
        note?.plannedStart?.toISOString().slice(0, 10) ?? "",
        note?.responsibleName ?? "", note?.reason ?? "", note?.delayOwedBy ?? "", note?.delayReason ?? "",
      ];
      const day = (at: Date | null | undefined) => at?.toISOString().slice(0, 10) ?? "";
      const chain = lateness.get(a.id) ?? [];
      if (!a.entries.length) rows.push([...head, ...Array(16).fill("")]);
      for (const e of a.entries) {
        const row = chain.find((one) => one.docNumber === e.document.number) ?? null;
        const points = row?.checkpoints ?? [];
        const first = points[0] ?? null;
        const last = points.length > 1 ? points[points.length - 1] : null;
        // Every step of the route in one cell, in order, because a column per
        // step would change shape with every route.
        const steps = points
          .slice(1, -1)
          .map((point) => `${point.name}: ${day(point.at) || "not yet"} (due ${day(point.due) || "no date"}, ${point.owedBy})`)
          .join(" | ");
        rows.push([
          ...head, e.document.number, e.requiredStatus, e.neededBy.toISOString().slice(0, 10),
          row?.cause?.name ?? "", day(row?.cause?.at), row?.cause?.deadline ?? "", day(row?.cause?.due), row?.cause?.owedBy ?? "",
          day(first?.at), day(first?.due), first?.owedBy ?? "",
          steps,
          day(last?.at), day(last?.due), last?.owedBy ?? "",
          row?.outstanding ? "yes" : "no",
        ]);
      }
    }
    name = "actions-baseline";
  } else if (kind === "packages") {
    // One package at a time: the one ticked in the list.
    const wanted = new URL(req.url).searchParams.get("number");
    if (!wanted) return NextResponse.json({ error: "Tick the package to export." }, { status: 400 });
    const pkgs = [...(await packagesOf(ctx, "DELIVERY")), ...(await packagesOf(ctx, "SUPPLY"))].filter((p) => p.number === wanted);
    if (!pkgs.length) return NextResponse.json({ error: "No such package." }, { status: 404 });
    name = `package-${wanted}`;
    rows = [["Package", "Title", "Type", "Purpose", "Recipient", "Completion date", "Required status", "Composition owner", "Acceptance authority", "Closed at", "Member document", "Member required status", "Member current status"]];
    for (const p of pkgs) {
      const head = [p.number, p.title ?? "", p.rule ? "ACCUMULATED" : "DEFINED", reasonsOf(p).join(","), p.names.to, p.completionDate ?? "",
        p.requiredStatuses.join(","), p.names.owners, p.names.acceptors, p.closedAt ? new Date(p.closedAt).toISOString().slice(0, 10) : ""];
      if (!p.members.length) rows.push([...head, "", "", ""]);
      for (const m of p.members) rows.push([...head, m.documentNumber, m.required.join(","), m.status ?? "not released"]);
    }
  } else if (kind === "transmittals") {
    // The transmittal log as the backend writes it: the ticked ones, or every one the filters match.
    return passOn(projectPath(ctx, "/transmittals/log/export"), { ...Object.fromEntries(new URL(req.url).searchParams), format: "csv" });
  } else if (kind === "defects") {
    // Open and accepted findings, then the closed ones: the backend lists them apart.
    type Defect = { checkId: string; severity: string; owner: string; status: string; label: string; description: string; firstSeenAt: string; lastSeenAt: string; acceptedReason: string | null; acceptedBy: string | null };
    const [open, closed] = await Promise.all([
      api<Defect[]>(projectPath(ctx, "/defects")),
      api<Defect[]>(projectPath(ctx, "/defects"), { query: { status: "CLOSED" } }),
    ]);
    rows = [["Check", "Severity", "Owner", "Status", "Entity", "Description", "First seen", "Last seen", "Accepted by", "Accepted reason", "Review date"]];
    for (const d of [...open, ...closed]) {
      rows.push([d.checkId, d.severity, d.owner, d.status, d.label, d.description, d.firstSeenAt, d.lastSeenAt, d.acceptedBy ?? "", d.acceptedReason ?? "", ""]);
    }
  } else if (kind === "audit") {
    // The organization's audit trail, this project's part of it, newest first.
    const events: Awaited<ReturnType<typeof adminAudit>>["rows"] = [];
    for (let page = 1; events.length < 5000; page++) {
      const answer = await adminAudit({ projectId: ctx.projectId, page, per: 200 });
      events.push(...answer.rows);
      if (page >= answer.pages) break;
    }
    rows = [["Timestamp", "Actor", "Action", "Entity type", "Entity", "Field", "Old value", "New value", "Detail"]];
    for (const e of events.slice(0, 5000)) rows.push([e.at, e.actorName, e.action, e.entityType ?? "", e.entityLabel ?? "", "", "", "", e.detail ?? ""]);
  } else if (kind === "checks") {
    const { lastRun: run } = await api<{ lastRun: { requestedBy: string; finishedAt: string | null; results: { checkId: string; result: string; failing: number }[] } | null }>(projectPath(ctx, "/checks"));
    rows = [["Check", "Result", "Failing items", "Run at", "Ran by"]];
    for (const i of run?.results ?? []) rows.push([i.checkId, i.result, i.failing, run!.finishedAt ?? "", run?.requestedBy ?? ""]);
    name = "latest-check-results";
  } else if (kind === "config-set") {
    const setKey = new URL(req.url).searchParams.get("set") ?? "";
    // A list is known by its values, or by the name an administrator gave it before it had any.
    const values = await getSet(setKey);
    const set = values.length ? { key: setKey } : (await getSets()).find((one) => one.key === setKey);
    if (!set) return NextResponse.json({ error: "Unknown value set" }, { status: 404 });
    rows = [["Code", "Label", "Status", "Sort", "Properties"]];
    // The backend gives the values in their published order; that place is the sort.
    for (const [sort, value] of values.entries()) rows.push([value.code, value.label, value.status, sort, Object.keys(value.props).length ? JSON.stringify(value.props) : ""]);
    name = `value-set-${set.key.toLowerCase()}`;
  } else if (kind === "template-sets") {
    // Every published list, a tab each, so one download covers the lot.
    const blank = new URL(req.url).searchParams.get("blank") === "1";
    // The organization's own lists (its Types & sets card): an administrator's only.
    const organization = new URL(req.url).searchParams.get("level") === "organization";
    if (organization && !isAdmin(ctx.user)) return NextResponse.json({ error: "An administrator downloads the organization's lists." }, { status: 403 });
    const book = await buildSetsWorkbook(ctx, { blank, organization });
    return new NextResponse(new Uint8Array(book), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${organization ? "organization-" : ""}${blank ? "settings-lists-template" : "settings-lists"}-${stamp.toISOString().slice(0, 10)}.xlsx"`,
      },
    });
  } else if (kind === "template-deliverables") {
    // A workbook, not a flat file: a sheet per deliverable type, each carrying
    // only the columns that type has, with the published lists as dropdowns.
    // As the register stands (`filled`), every document on its type's sheet with its number, or empty to start from.
    const filled = new URL(req.url).searchParams.get("filled") === "1";
    const book = await buildDeliverableWorkbook(ctx, { filled });
    return new NextResponse(new Uint8Array(book), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filled ? "deliverable-list" : "deliverable-list-template"}-${stamp.toISOString().slice(0, 10)}.xlsx"`,
      },
    });
  } else if (kind === "people") {
    // The team on this project as it stands, in the Team list's own columns.
    const [users, parties] = await Promise.all([adminUsers(), adminParties()]);
    const party = new Map(parties.map((one) => [one.id, one.code] as const));
    rows = [["Name", "Email", "Company", "Function", "Department"]];
    for (const u of users) {
      const place = u.memberships.find((m) => m.projectId === ctx.projectId && m.active);
      if (place) rows.push([u.name, u.email, u.partyId ? party.get(u.partyId) ?? "" : "", place.functionName, place.department ?? ""]);
    }
    name = `team-${ctx.project?.code ?? "project"}`;
  } else if (kind === "template-people") {
    rows = [
      ["Name", "Email", "Company", "Function", "Department"],
      ["A. Benali", "a.benali@example.com", "", "Reviewer", "ME"],
      ["J. Doe", "j.doe@acmepumps.example", "ACME", "Supplier contact", ""],
    ];
    name = "template-people";
  } else if (kind === "matrix") {
    // The distribution matrix, pre-filled. Nobody should start from an empty
    // template: a blank grid invites invented codes, and the file people edit
    // has to be the matrix as it actually stands today.
    const project = ctx.project;
    // The file is taken at the same view the page is showing, and every row
    // carries it, so a file filled in for vendor documents cannot be read back
    // as though it were about ours.
    const view = new URL(req.url).searchParams;
    const sheet = await buildSheet(ctx, {
      allDisciplines: view.get("all") === "1",
      deliverableType: view.get("producer"),
      docType: view.get("type"),
    });
    // An empty grid to start from: an empty cell says nothing, so only the letters filled in change the matrix.
    if (view.get("blank") === "1") for (const row of sheet.rows) row.cells = row.cells.map(() => "");
    rows = sheetToRows(sheet, {
      projectCode: project?.code ?? "",
      projectName: project?.name ?? "",
      roleLabel: roleLabel(project?.role),
      generatedAt: stamp,
    });
    name = `distribution-matrix${view.get("blank") === "1" ? "-template" : ""}-${project?.code ?? "project"}`;
  } else {
    return NextResponse.json({ error: "Unknown export kind" }, { status: 400 });
  }

  const csv = toCsv(rows);
  return new NextResponse("\uFEFF" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}-${stamp.toISOString().slice(0, 16).replaceAll(":", "")}.csv"`,
    },
  });
}
