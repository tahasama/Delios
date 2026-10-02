import { NextResponse } from "next/server";
import { getScope } from "@/lib/scope";
import { getSessionUser } from "@/lib/auth";
import { toCsv } from "@/lib/csv";

// §16.6 — views are generated at time of use, carry a generation timestamp and
// are never edited. Every register view can be extracted (CSV opens in Excel).
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ctx = await getScope();
  if (!ctx) return NextResponse.json({ error: "No active project" }, { status: 403 });
  const { db } = ctx;
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
    const docs = await db.document.findMany({ orderBy: { docNumber: "asc" }, include: { revisions: { orderBy: { createdAt: "desc" } } } });
    rows = [["Document number", "Title", "Producer", "Type", "Discipline", "State", "Placeholder", "Current rev", "Status", "Released at", "Retention", "Criticality", "Confidentiality"]];
    for (const d of docs) {
      const cur = d.revisions.find((r) => r.state === "RELEASED");
      rows.push([d.docNumber, d.title, d.deliverableType, d.docType, d.discipline, d.state, d.isPlaceholder ? "yes" : "no", cur?.value ?? "", cur?.statusCode ?? "", cur?.releasedAt?.toISOString().slice(0, 10) ?? "", d.retentionClass ?? "", d.criticality ?? "", d.confidentiality ?? ""]);
    }
  } else if (kind === "reviews") {
    // The reviews page exports what it is showing: a selection when rows are
    // ticked, otherwise every review the filters match.
    const url = new URL(req.url);
    const ids = (url.searchParams.get("ids") ?? "").split(",").map((one) => one.trim()).filter(Boolean);
    const status = url.searchParams.get("status") ?? "";
    const kindAsked = url.searchParams.get("kind") ?? "";
    const verdict = url.searchParams.get("verdict") ?? "";
    const q = (url.searchParams.get("q") ?? "").trim();
    const cycles = await db.reviewCycle.findMany({
      where: ids.length ? { id: { in: ids } } : {
        AND: [
          status && status !== "ALL" ? { status } : {},
          kindAsked ? { binding: kindAsked === "DECISION" } : {},
          verdict ? { outcome: verdict } : {},
          q ? { revision: { document: { OR: [{ docNumber: { contains: q } }, { title: { contains: q } }] } } } : {},
        ],
      },
      orderBy: { submittedAt: "desc" },
      include: {
        revision: { select: { value: true, document: { select: { docNumber: true, title: true } }, cycles: { select: { number: true, comments: { orderBy: { createdAt: "asc" }, select: { authorName: true, text: true, progressionPreventing: true, status: true } } } } } },
        assignments: { orderBy: { order: "asc" } },
        comments: { where: { progressionPreventing: true, status: "OPEN" }, select: { id: true } },
      },
    });
    rows = [["Review", "Document number", "Title", "Revision", "Kind", "Verdict", "Decided by", "Reviewers", "Opened", "Opened by", "Due", "Closed", "Blocking comments", "Status", "Comments"]];
    for (const c of cycles) {
      rows.push([
        c.number ?? "", c.revision.document.docNumber, c.revision.document.title, c.revision.value,
        c.binding ? "Decision" : "Advice", c.outcome ?? "", c.outcomeByName ?? "",
        c.assignments.map((a) => a.userName).join("; "),
        c.submittedAt.toISOString(), c.openedByName ?? "",
        c.dueAt?.toISOString() ?? "", c.outcomeAt?.toISOString() ?? "",
        c.comments.length, c.status,
        // Every comment on the revision, one per line, for whoever sent it.
        c.revision.cycles.flatMap((cy) => cy.comments.map((one) => `${one.authorName}${cy.number ? ` (${cy.number})` : ""}${one.progressionPreventing ? " [blocking]" : ""}: ${one.text}`)).join("\n"),
      ]);
    }
  } else if (kind === "review-matrix") {
    const documents = await db.document.findMany({ orderBy: { docNumber: "asc" }, include: { revisions: { orderBy: { createdAt: "desc" }, include: { workflowRuns: { orderBy: { updatedAt: "desc" }, take: 1 }, cycles: { orderBy: { sequence: "desc" }, take: 1, include: { assignments: true, comments: { where: { status: "OPEN", progressionPreventing: true } } } }, approvals: { orderBy: { decidedAt: "desc" }, take: 1 } } } } });
    rows = [["Document number", "Title", "Discipline", "Type", "Criticality", "Revision", "Revision state", "Workflow", "Workflow state", "Review cycle", "Review status", "Reviewers", "Review outcome", "Blocking comments", "Approved by", "Approval role", "Authority matrix version", "Planned submission"]];
    for (const document of documents) {
      const revision = document.revisions[0];
      const run = revision?.workflowRuns[0];
      const cycle = revision?.cycles[0];
      const approval = revision?.approvals[0];
      rows.push([document.docNumber, document.title, document.discipline, document.docType, document.criticality ?? "", revision?.value ?? "", revision?.state ?? "", run?.templateName ?? "", run?.status ?? "", cycle?.sequence ?? "", cycle?.status ?? "", cycle?.assignments.map((item) => item.userName).join("; ") ?? "", cycle?.outcome ?? "", cycle?.comments.length ?? 0, approval?.approverName ?? "", approval?.approverRole ?? "", approval?.matrixVersion ?? "", revision?.plannedSubmissionDate?.toISOString().slice(0, 10) ?? ""]);
    }
    name = "review-approval-matrix";
  } else if (kind === "baseline") {
    // The actions somebody ticked, or all of them.
    const query = new URL(req.url).searchParams;
    const ticked = (query.get("ids") ?? "").split(",").map((one) => one.trim()).filter(Boolean);
    // An action's own sheet can tick documents rather than actions, and then the
    // file holds those documents of that action.
    const onlyDocs = new Set((query.get("docs") ?? "").split(",").map((one) => one.trim()).filter(Boolean));
    const actions = await db.action.findMany({
      where: ticked.length ? { id: { in: ticked } } : {},
      orderBy: { code: "asc" },
      include: {
        entries: { where: onlyDocs.size ? { document: { docNumber: { in: [...onlyDocs] } } } : {}, include: { document: true } },
        notes: { orderBy: { createdAt: "asc" } },
      },
    });
    const now = Date.now();
    /** The same six words the schedule uses, so a file and a screen agree. */
    const state = (a: (typeof actions)[number]) => {
      if (!a.entries.length) return "Nothing listed";
      const met = a.metIssuedCount >= a.needCount && a.needCount > 0;
      const past = !!a.scheduledDate && a.scheduledDate.getTime() < now;
      if (met) {
        if (!past) return "Ready";
        return a.lastMetAt && a.scheduledDate && a.lastMetAt > a.scheduledDate ? "Late receipt" : "Done";
      }
      if (past) return "Overdue";
      return a.nextNeededAt && a.nextNeededAt.getTime() - now <= 7 * 86_400_000 ? "At risk" : "Still ahead";
    };
    // Where each document's time went travels with it. The screen names the
    // step that slipped; the file carries every checkpoint, because an audit
    // asks what the other two were due and who owed them.
    const { latenessOf } = await import("@/lib/action-lateness");
    const lateness = new Map<string, Awaited<ReturnType<typeof latenessOf>>["rows"]>();
    for (const a of actions) lateness.set(a.id, (await latenessOf(ctx, a.id)).rows);

    rows = [[
      "Action code", "Action", "Description", "Scheduled date", "Owner", "Departments", "State",
      "Last document issued", "Decision", "Decision stood at", "Carried by", "Reason", "Delay owed by", "Delay reason",
      "Document number", "Required status", "Required by",
      "Delay source", "Delay source happened", "Delay source deadline", "Delay source due", "Delay source owed by",
      "Sent for review at", "Submission due", "Sent for review owed by",
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
        a.code, a.name, a.description ?? "", a.scheduledDate?.toISOString().slice(0, 10) ?? "",
        a.ownerName ?? "", a.departments ?? "", state(a), a.lastMetAt?.toISOString().slice(0, 10) ?? "",
        note ? (note.decision === "CARRIED" ? "Carried out without all of its documents" : "Postponed") : "",
        note?.plannedDate?.toISOString().slice(0, 10) ?? "",
        note?.responsibleName ?? "", note?.reason ?? "", note?.delayResponsible ?? "", note?.delayReason ?? "",
      ];
      const day = (at: Date | null | undefined) => at?.toISOString().slice(0, 10) ?? "";
      const chain = lateness.get(a.id) ?? [];
      if (!a.entries.length) rows.push([...head, ...Array(16).fill("")]);
      for (const e of a.entries) {
        const row = chain.find((one) => one.docNumber === e.document.docNumber) ?? null;
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
          ...head, e.document.docNumber, e.requiredStatus, e.requiredBy.toISOString().slice(0, 10),
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
    const pkgs = await db.package.findMany({ orderBy: { identifier: "asc" }, include: { members: { include: { document: true } } } });
    rows = [["Package", "Title", "Type", "Purpose", "Recipient", "Completion date", "Required status", "Composition owner", "Acceptance authority", "Closed at", "Member document", "Member required status", "Member current status"]];
    for (const p of pkgs) {
      if (!p.members.length) rows.push([p.identifier, p.title ?? "", p.type, p.purpose, p.recipientName, p.completionDate.toISOString().slice(0, 10), p.requiredStatus, p.compositionOwnerName, p.acceptanceAuthorityName, p.closedAt?.toISOString().slice(0, 10) ?? "", "", "", ""]);
      for (const m of p.members) {
        const cur = await db.revision.findFirst({ where: { documentId: m.documentId, state: "RELEASED" } });
        rows.push([p.identifier, p.title ?? "", p.type, p.purpose, p.recipientName, p.completionDate.toISOString().slice(0, 10), p.requiredStatus, p.compositionOwnerName, p.acceptanceAuthorityName, p.closedAt?.toISOString().slice(0, 10) ?? "", m.document.docNumber, m.requiredStatus, cur?.statusCode ?? "not released"]);
      }
    }
  } else if (kind === "transmittals") {
    const ticked = (new URL(req.url).searchParams.get("ids") ?? "").split(",").map((one) => one.trim()).filter(Boolean);
    const list = await db.transmittal.findMany({
      where: ticked.length ? { id: { in: ticked } } : {},
      orderBy: { number: "asc" },
      include: {
        items: { include: { revision: { include: { document: true } } } },
        recipients: true,
        inReplyTo: { select: { number: true } },
        answers: { orderBy: { dateOfIssue: "asc" }, select: { number: true, dateOfIssue: true } },
      },
    });
    // Who was asked and who was kept informed are different facts, and the
    // answer that came back is part of the record.
    rows = [["Number", "Direction", "Reason", "Date of issue", "Issuing party", "Status", "Response due", "Received date", "Items", "Sent to", "Copied in", "Seen by", "In answer to", "Answered at", "Answered by"]];
    for (const t of list) {
      const items = t.items.map((i) => `${i.revision.document.docNumber} rev ${i.revision.value}`).join("; ");
      const addressed = t.recipients.filter((r) => r.kind !== "CC");
      const answer = t.answers[0] ?? null;
      rows.push([
        t.number, t.direction, t.reasonForIssue, t.dateOfIssue.toISOString().slice(0, 10), t.issuingParty, t.status,
        t.responseDueDate?.toISOString().slice(0, 10) ?? "", t.receivedDate?.toISOString().slice(0, 10) ?? "", items,
        addressed.map((r) => r.name).join("; "),
        t.recipients.filter((r) => r.kind === "CC").map((r) => r.name).join("; "),
        `${addressed.filter((r) => r.openedAt).length} of ${addressed.length}`,
        t.inReplyTo?.number ?? "",
        answer?.dateOfIssue.toISOString().slice(0, 10) ?? "",
        t.answers.map((one) => one.number).join("; "),
      ]);
    }
  } else if (kind === "defects") {
    const defects = await db.defect.findMany({ orderBy: [{ severity: "asc" }, { lastSeenAt: "desc" }] });
    rows = [["Check", "Severity", "Owner", "Status", "Entity", "Description", "First seen", "Last seen", "Accepted by", "Accepted reason", "Review date"]];
    for (const d of defects) {
      rows.push([d.checkId, d.severity, d.ownerRole, d.status, d.entityLabel ?? d.entityKey, d.description, d.firstSeenAt.toISOString(), d.lastSeenAt.toISOString(), d.acceptedByName ?? "", d.acceptedReason ?? "", d.reviewDate?.toISOString().slice(0, 10) ?? ""]);
    }
  } else if (kind === "audit") {
    const events = await db.auditEvent.findMany({ orderBy: { ts: "desc" }, take: 5000 });
    rows = [["Timestamp", "Actor", "Action", "Entity type", "Entity", "Field", "Old value", "New value", "Detail"]];
    for (const e of events) rows.push([e.ts.toISOString(), e.actorName, e.action, e.entityType ?? "", e.entityLabel ?? "", e.field ?? "", e.oldValue ?? "", e.newValue ?? "", e.detail ?? ""]);
  } else if (kind === "checks") {
    const run = await db.checkRun.findFirst({ orderBy: { ranAt: "desc" }, include: { items: true } });
    rows = [["Check", "Result", "Failing items", "Run at", "Ran by"]];
    for (const i of run?.items ?? []) rows.push([i.checkId, i.result, i.failingCount, run!.ranAt.toISOString(), run?.ranByName ?? ""]);
    name = "latest-check-results";
  } else if (kind === "config-set") {
    const setKey = new URL(req.url).searchParams.get("set") ?? "";
    const set = await db.configSet.findFirst({ where: { key: setKey }, include: { values: { orderBy: [{ sort: "asc" }, { code: "asc" }] } } });
    if (!set) return NextResponse.json({ error: "Unknown value set" }, { status: 404 });
    rows = [["Code", "Label", "Status", "Sort", "Properties"]];
    for (const value of set.values) rows.push([value.code, value.label, value.status, value.sort, value.props ?? ""]);
    name = `value-set-${set.key.toLowerCase()}`;
  } else if (kind === "template-deliverables") {
    rows = [
      ["Title", "Producer", "Type", "Discipline", "Project", "SubProject", "Supplier", "PO", "Criticality", "Confidentiality", "RetentionClass", "AssetCode", "ReceivedDate"],
      ["Feed pump P-103 GA drawing", "ENG", "DSW", "ME", "P1001", "50", "", "", "QUALITY", "INTERNAL", "ASSET_LIFE", "P-101", ""],
      ["Blower BL-301 datasheet (vendor)", "VND", "DAS", "ME", "P1001", "40", "ACME", "PO101", "QUALITY", "INTERNAL", "ASSET_LIFE", "BL-301", "2026-09-01"],
    ];
    name = "template-deliverable-list";
  } else if (kind === "template-baseline") {
    rows = [
      ["Action Code", "Action Name", "Action Date", "Document Number", "Required Status", "Required By"],
      ["A0042", "Foundation concrete pour - area 20", "2026-10-01", "P1001-20-ST-DSW-00001", "IFC", "2026-09-24"],
      ["A0042", "Foundation concrete pour - area 20", "2026-10-01", "P1001-20-CI-REP-00001", "IFC", "2026-09-24"],
    ];
    name = "template-baseline";
  } else if (kind === "template-schedule") {
    rows = [
      ["Activity ID", "Action Code", "Activity Name", "Baseline Date", "Forecast Date", "Responsible Party"],
      ["SCH-1001", "A0042", "Foundation concrete pour - area 20", "2026-10-01", "2026-10-05", "Construction"],
      ["SCH-1015", "A0048", "Mechanical completion - unit 73", "2026-10-18", "2026-10-18", "Commissioning"],
    ];
    name = "template-schedule-version";
  } else if (kind === "template-people") {
    rows = [
      ["Name", "Email", "Company", "Function", "Department"],
      ["A. Benali", "a.benali@example.com", "", "Reviewer", "ME"],
      ["J. Doe", "j.doe@acmepumps.example", "ACME", "Supplier contact", ""],
    ];
    name = "template-people";
  } else if (kind === "template-metadata") {
    rows = [
      ["Document Number", "Title", "DocType", "Discipline", "Criticality", "Confidentiality", "RetentionClass", "SubProject", "ContractRef"],
      ["P1001-50-CI-DSW-00001", "Corrected title", "", "", "QUALITY", "", "", "60", ""],
    ];
    name = "template-metadata-update";
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
