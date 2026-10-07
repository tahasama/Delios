import { api } from "@/lib/api/client";
import type { ListValue, RegisterPage } from "@/lib/api/types";
import { requireSession, projectPath } from "@/lib/session";
import { isMigrated } from "@/lib/migrated";
import { DOCUMENT_STATES, REVISION_STATES } from "@/lib/states";
import { Banner } from "@/components/ui";
import { RegisterPlate } from "./register-plate";
import { DocumentRegister } from "./document-register";

export const dynamic = "force-dynamic";
export const metadata = { title: "Documents" };

/** The dates the register can be filtered on, and what each is called. */
const DATE_FIELDS = [
  { code: "created", label: "Created" },
  { code: "revStarted", label: "Revision started" },
  { code: "fileAdded", label: "File added" },
  { code: "planned", label: "Planned submission" },
  { code: "issued", label: "Issued" },
  { code: "released", label: "Released" },
  { code: "updated", label: "Changed" },
];

/** The address's filters that the backend reads, passed on as they are. */
const PASSED = ["q", "state", "rev", "status", "verdict", "supplier", "discipline", "docType", "criticality", "confidentiality", "deliverable", "action", "on", "from", "to", "view", "sort", "dir", "page", "per"] as const;
type Search = Partial<Record<(typeof PASSED)[number] | "sent" | "sendError" | "po" | "phase", string>>;

/**
 * The document register: every controlled document on the project, one row
 * each, with the revision in hand now. The backend filters, sorts and pages;
 * this page turns its answer into the register's rows and hover notes.
 */
export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const query: Record<string, string> = {};
  for (const key of PASSED) if (sp[key]) query[key] = sp[key]!;
  const [register, views] = await Promise.all([
    api<RegisterPage>(projectPath(session, "/register"), { query }),
    api<{ id: string; name: string; query: string }[]>(projectPath(session, "/register/views")),
  ]);

  const values = register.lists.values;
  const list = (set: string): ListValue[] => values[set] ?? [];
  const label = (set: string, code: string | null) => (code ? list(set).find((v) => v.code === code)?.label ?? code : null);
  const statusUse = (code: string) => {
    const props = list("STATUSES").find((v) => v.code === code)?.props;
    return props && typeof props.executes === "boolean" ? (props.executes ? "Work may proceed on it" : "Not for construction or execution") : null;
  };
  const parties = new Map(register.lists.parties.map((p) => [p.code, p.name]));
  const external = !session.user.isInternal;

  const rows = register.rows.map((r) => ({
    id: r.id, docNumber: r.number, title: r.title, deliverableType: r.deliverableType, docType: r.docType, discipline: r.discipline,
    originator: r.originator ? parties.get(r.originator) ?? r.originator : null, subProject: r.subproject,
    receivedFrom: external ? session.me.tenant.name : null, sendRevisionId: null,
    contractRef: r.contractRef, criticality: r.criticality, confidentiality: r.confidentiality,
    retentionClass: r.retentionClass, retentionLabel: label("RETENTION_CLASSES", r.retentionClass), placeholder: r.isPlaceholder,
    docTypeLabel: label("DOCUMENT_TYPES", r.docType)!, disciplineLabel: label("DISCIPLINES", r.discipline)!, deliverableLabel: label("DELIVERABLE_TYPES", r.deliverableType)!,
    phase: null, phaseLabel: null,
    actions: r.activities,
    docState: r.state, docStateLabel: DOCUMENT_STATES[r.state]?.label ?? r.state,
    revision: r.revision, revState: r.revisionState ?? "NONE", revStateLabel: REVISION_STATES[r.revisionState ?? "NONE"]?.label ?? r.revisionState ?? "",
    verdict: r.verdict, verdictLabel: label("VERDICTS", r.verdict),
    releasedFor: r.releasedStatus, releasedForLabel: label("STATUSES", r.releasedStatus), releasedForUse: r.releasedStatus ? statusUse(r.releasedStatus) : null,
    proposedFor: r.proposedStatus, onHold: null,
    createdDate: r.createdAt, updatedAt: r.updatedAt, plannedSubmissionDate: r.plannedDate, issueDate: r.issuedAt, releasedAt: r.releasedAt,
    decidedBy: r.decidedBy, decidedByDelegated: false, packageCount: r.packages,
    hasReleased: !!r.releasedStatus,
    reviewRevisionId: r.revisionState === "IN_PREPARATION" ? r.latestRevisionId : null,
    fileAdded: r.fileAddedAt, revStarted: r.revisionStartedAt,
  }));

  // What each code means, for the hover note on the code itself: from the organization's own lists.
  const codes: Record<string, string> = {};
  for (const v of list("STATUSES")) codes[`STATUS|${v.code}`] = `${v.code}: ${v.label}${statusUse(v.code) ? `\n${statusUse(v.code)}` : ""}`;
  for (const v of list("VERDICTS")) codes[`VERDICT|${v.code}`] = `${v.code}: ${v.label}`;
  for (const v of list("CRITICALITY")) {
    codes[`CRITICALITY|${v.code}`] = `${v.label}${typeof v.props?.retention === "string" ? `\nKept for: ${String(v.props.retention).replaceAll("_", " ").toLowerCase()}` : ""}`;
    codes[`CRITICALITY_SHORT|${v.code}`] = v.label.toLowerCase();
  }
  for (const v of list("CONFIDENTIALITY")) {
    codes[`CONFIDENTIALITY|${v.code}`] = v.label;
    codes[`CONFIDENTIALITY_SHORT|${v.code}`] = v.label.toLowerCase();
  }
  for (const [code, s] of Object.entries(DOCUMENT_STATES)) codes[`DOC_STATE|${code}`] = `${s.label}: ${s.means}`;
  for (const [code, s] of Object.entries(REVISION_STATES)) codes[`REV_STATE|${code}`] = `${s.label}: ${s.means}`;

  const opts = (set: string, only?: string[]) =>
    list(set).filter((v) => !only || only.includes(v.code)).map((v) => ({ code: v.code, label: v.status === "RETIRED" ? `${v.label} (retired)` : v.label }));
  const filterQuery = new URLSearchParams(Object.entries(query).filter(([k]) => k !== "page" && k !== "per"));

  return (
    <div className="space-y-4">
      {sp.sent ? <Banner tone="good" title="Sent">{sp.sent}</Banner> : null}
      {sp.sendError ? <Banner tone="warn" title="Not sent">{sp.sendError}</Banner> : null}
      <DocumentRegister
        supplier={external ? { to: session.me.tenant.name, readOnly: true } : null}
        plate={<RegisterPlate project={{ code: session.project.code, name: session.project.name }} canCreate={session.can("CREATE") && session.user.isInternal && isMigrated("/documents/new")} />}
        rows={rows}
        total={register.total}
        views={views}
        paging={{
          page: register.page, pages: register.pages, perPage: register.per, sizes: register.sizes,
          from: register.total ? (register.page - 1) * register.per + 1 : 0, to: Math.min(register.page * register.per, register.total),
          query: filterQuery.toString(),
        }}
        codes={codes}
        sort={{ key: sp.sort ?? "", dir: sp.dir === "asc" ? "asc" : "desc" }}
        userCanAct={session.can("CREATE") || session.can("REVISE")}
        filters={{
          q: sp.q ?? "", terms: (sp.q ?? "").split(",").map((t) => t.trim()).filter(Boolean),
          state: sp.state ?? "", rev: sp.rev ?? "", status: sp.status ?? "", verdict: sp.verdict ?? "", supplier: sp.supplier ?? "", po: "",
          discipline: sp.discipline ?? "", docType: sp.docType ?? "", view: sp.view === "all" ? "all" : "current",
          criticality: sp.criticality ?? "", confidentiality: sp.confidentiality ?? "", deliverable: sp.deliverable ?? "",
          phase: "", action: sp.action ?? "", on: sp.on ?? "", from: sp.from ?? "", to: sp.to ?? "",
        }}
        filterOptions={{
          states: Object.entries(DOCUMENT_STATES).map(([code, s]) => ({ code, label: s.label })),
          revStates: Object.entries(REVISION_STATES).map(([code, s]) => ({ code, label: s.label })),
          statuses: list("STATUSES").map((v) => ({ code: v.code, label: `${v.code}: ${v.label}` })),
          verdicts: list("VERDICTS").map((v) => ({ code: v.code, label: `${v.code}: ${v.label}` })),
          suppliers: register.lists.parties.map((p) => ({ code: p.code, label: p.name })),
          pos: [],
          disciplines: opts("DISCIPLINES", register.lists.usedDisciplines),
          types: opts("DOCUMENT_TYPES", register.lists.usedDocTypes),
          criticalities: opts("CRITICALITY"),
          confidentialities: opts("CONFIDENTIALITY"),
          deliverables: opts("DELIVERABLE_TYPES"),
          phases: [],
          actions: register.lists.activities.map((a) => ({ code: a.code, label: `${a.code}: ${a.name}` })),
          dateFields: DATE_FIELDS,
        }}
        exportHref={`/api/register/export${filterQuery.size ? `?${filterQuery}` : ""}`}
      />
    </div>
  );
}
