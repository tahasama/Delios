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
    const actions = await db.action.findMany({ orderBy: { code: "asc" }, include: { entries: { include: { document: true } } } });
    rows = [["Action code", "Action", "Scheduled date", "Owner", "Schedule ref", "Document number", "Required status", "Required by"]];
    for (const a of actions) {
      if (!a.entries.length) rows.push([a.code, a.name, a.scheduledDate?.toISOString().slice(0, 10) ?? "", a.ownerName ?? "", a.scheduleRef ?? "", "", "", ""]);
      for (const e of a.entries) rows.push([a.code, a.name, a.scheduledDate?.toISOString().slice(0, 10) ?? "", a.ownerName ?? "", a.scheduleRef ?? "", e.document.docNumber, e.requiredStatus, e.requiredBy.toISOString().slice(0, 10)]);
    }
    name = "actions-baseline";
  } else if (kind === "packages") {
    const pkgs = await db.package.findMany({ orderBy: { identifier: "asc" }, include: { members: { include: { document: true } } } });
    rows = [["Package", "Type", "Purpose", "Recipient", "Completion date", "Required status", "Composition owner", "Acceptance authority", "Closed at", "Member document", "Member required status", "Member current status"]];
    for (const p of pkgs) {
      if (!p.members.length) rows.push([p.identifier, p.type, p.purpose, p.recipientName, p.completionDate.toISOString().slice(0, 10), p.requiredStatus, p.compositionOwnerName, p.acceptanceAuthorityName, p.closedAt?.toISOString().slice(0, 10) ?? "", "", "", ""]);
      for (const m of p.members) {
        const cur = await db.revision.findFirst({ where: { documentId: m.documentId, state: "RELEASED" } });
        rows.push([p.identifier, p.type, p.purpose, p.recipientName, p.completionDate.toISOString().slice(0, 10), p.requiredStatus, p.compositionOwnerName, p.acceptanceAuthorityName, p.closedAt?.toISOString().slice(0, 10) ?? "", m.document.docNumber, m.requiredStatus, cur?.statusCode ?? "not released"]);
      }
    }
  } else if (kind === "transmittals") {
    const list = await db.transmittal.findMany({ orderBy: { number: "asc" }, include: { items: { include: { revision: { include: { document: true } } } }, recipients: true } });
    rows = [["Number", "Direction", "Reason", "Date of issue", "Issuing party", "Status", "Response due", "Received date", "Items", "Recipients"]];
    for (const t of list) {
      const items = t.items.map((i) => `${i.revision.document.docNumber} rev ${i.revision.value}`).join("; ");
      const recips = t.recipients.map((r) => r.name).join("; ");
      rows.push([t.number, t.direction, t.reasonForIssue, t.dateOfIssue.toISOString().slice(0, 10), t.issuingParty, t.status, t.responseDueDate?.toISOString().slice(0, 10) ?? "", t.receivedDate?.toISOString().slice(0, 10) ?? "", items, recips]);
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
      ["Feed pump P-103 GA drawing", "ENG", "DSW", "ME", "Q6637021", "74", "", "", "QUALITY", "INTERNAL", "ASSET_LIFE", "P-101", ""],
      ["Blower BL-301 datasheet (vendor)", "VND", "DAS", "ME", "Q6637021", "73", "MAD", "JESA593P22", "QUALITY", "INTERNAL", "ASSET_LIFE", "BL-301", "2026-09-01"],
    ];
    name = "template-deliverable-list";
  } else if (kind === "template-baseline") {
    rows = [
      ["Action Code", "Action Name", "Action Date", "Document Number", "Required Status", "Required By"],
      ["A0042", "Foundation concrete pour - area 71", "2026-10-01", "Q6637021-71-ST-DSW-00001", "IFC", "2026-09-24"],
      ["A0042", "Foundation concrete pour - area 71", "2026-10-01", "Q6637021-71-CI-REP-00001", "IFC", "2026-09-24"],
    ];
    name = "template-baseline";
  } else if (kind === "template-schedule") {
    rows = [
      ["Activity ID", "Action Code", "Activity Name", "Baseline Date", "Forecast Date", "Responsible Party"],
      ["SCH-1001", "A0042", "Foundation concrete pour - area 71", "2026-10-01", "2026-10-05", "Construction"],
      ["SCH-1015", "A0048", "Mechanical completion - unit 73", "2026-10-18", "2026-10-18", "Commissioning"],
    ];
    name = "template-schedule-version";
  } else if (kind === "template-metadata") {
    rows = [
      ["Document Number", "Title", "DocType", "Discipline", "Criticality", "Confidentiality", "RetentionClass", "SubProject", "ContractRef"],
      ["Q6637021-74-CI-DSW-00001", "Corrected title", "", "", "QUALITY", "", "", "75", ""],
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
