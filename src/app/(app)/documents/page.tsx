import { requireScope } from "@/lib/scope";
import { api, projectPath } from "@/lib/api/client";
import { getMe } from "@/lib/api/me";
import type { ActivitySummary, RegisterPage } from "@/lib/api/types";
import { RegisterPlate } from "./register-plate";
import { OUTCOME_CONSEQUENCES, DOC_STATES, DOC_STATE_LABEL, DOC_MEANING, REV_STATES, REV_MEANING, type DocState, type RevState } from "@/lib/standard";
import { getSet } from "@/lib/config";
import { DocumentRegister } from "./document-register";
import { hasVerb } from "@/lib/auth";
import { Banner } from "@/components/ui";
import { REGISTER_SORTS, readSearch } from "@/lib/register-query";
import { isReadOnly } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Documents" };

/** How many rows a page holds. 50 is the default: a screen and a half. */
const PAGE_SIZES = [25, 50, 100, 250];

/**
 * The function whose authority released a revision, as the register prints it.
 * An approval records the function; records written before functions were named
 * carry a bare role word instead, and those fall back to whatever the approver
 * was called, with any role in brackets dropped — the bracket says nothing the
 * column does not already say.
 */
function decidingFunction(role: string | null | undefined, person: string | null | undefined): string | null {
  const clean = (value: string) => value.replace(/\s*\((?:by delegation|approver|reviewer|controller|admin[a-z]*)\)\s*/gi, "").trim();
  const named = role && !/^[A-Z_]+$/.test(role) ? clean(role) : "";
  if (named) return named;
  const fallback = person ? clean(person) : "";
  return fallback || null;
}

/**
 * The dates the register holds about a document, and the one question people
 * ask of them: what happened lately. A document carries more dates than a row
 * can show, so the filter names the date rather than assuming one.
 */
const DATE_FIELDS = [
  { key: "created", label: "Created" },
  { key: "revStarted", label: "Revision started" },
  { key: "fileAdded", label: "File added" },
  { key: "planned", label: "Planned submission" },
  { key: "issued", label: "Issued" },
  { key: "released", label: "Released" },
  { key: "updated", label: "Changed" },
] as const;
type Search = {
  phase?: string;
  action?: string;
  sent?: string;
  sendError?: string;
  on?: string;
  from?: string;
  to?: string;
  criticality?: string;
  confidentiality?: string;
  deliverable?: string;
  sort?: string;
  dir?: string;
  page?: string;
  per?: string; q?: string; state?: string; rev?: string; status?: string; verdict?: string; supplier?: string; po?: string; discipline?: string; docType?: string; view?: string };

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const scope = await requireScope();
  const { user, project } = scope;
  // Released and issued as one act, or as two in order: the project's answer.
  const { policy } = await import("@/lib/control-activities");
  const together = (await policy(scope, "POLICY_RELEASE")) === "TOGETHER";
  // What this organization calls each state; the states themselves are fixed.
  const { stateNames, stateName } = await import("@/lib/state-names");
  const names = await stateNames(scope);
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const searches = readSearch(q);
  const terms = searches.map((search) => search.text);
  const state = sp.state ?? "";
  const discipline = sp.discipline ?? "";
  const docType = sp.docType ?? "";
  const revState = sp.rev ?? "";
  const statusCode = sp.status ?? "";
  const verdictCode = sp.verdict ?? "";
  const supplier = sp.supplier ?? "";
  const po = sp.po ?? "";
  const view = sp.view === "all" ? "all" : "current";
  // How serious it is and who may see it are properties of the document, so the
  // register both shows them and narrows by them. What is waiting on whom is
  // not: a queue belongs on Home, and the comments holding a review up belong
  // on the review.
  const criticality = sp.criticality ?? "";
  const confidentiality = sp.confidentiality ?? "";
  // Who produced it — internal engineering, a contractor, a vendor, the client.
  // It decides the numbering scheme, so the register both shows it and narrows
  // by it.
  const deliverable = sp.deliverable ?? "";
  // Which date, and between which two days. Every date the register already
  // knows — nothing new is stored to make this work. Either end may be left
  // open: "released, from 1 March" is a question people actually ask.
  const dateOn = DATE_FIELDS.some((field) => field.key === sp.on) ? sp.on! : "";

  const sort = sp.sort && REGISTER_SORTS[sp.sort] ? sp.sort : "";
  const dir = sp.dir === "asc" ? "asc" : "desc";

  const perPage = PAGE_SIZES.includes(Number(sp.per)) ? Number(sp.per) : 50;
  const page = Math.max(1, Number(sp.page) || 1);

  // The register itself, filtered, sorted and cut into pages by the backend.
  const [register, disciplines, types, statuses, verdictSet, supplierCodes, poCodes, criticalities, confidentialities, retentions, deliverableTypes, phases, activities, views] =
    await Promise.all([
      api<RegisterPage>(projectPath(scope, "/register"), {
        query: {
          q, state, rev: revState, status: statusCode, verdict: verdictCode, supplier, po, discipline, docType, criticality, confidentiality,
          deliverable, action: sp.action ?? "", on: dateOn, from: sp.from ?? "", to: sp.to ?? "", view, sort, dir, page, per: perPage,
        },
      }),
      getSet("DISCIPLINES"), getSet("DOCUMENT_TYPES"), getSet("STATUSES"), getSet("REVIEW_OUTCOMES"), getSet("SUPPLIER_CODES"), getSet("PURCHASE_ORDERS"),
      getSet("CRITICALITY"), getSet("CONFIDENTIALITY"), getSet("RETENTION_CLASSES"), getSet("DELIVERABLE_TYPES"), getSet("PHASES"),
      // Only the activities that actually owe something: an action nobody has
      // listed a document against would filter to an empty register.
      api<ActivitySummary[]>(projectPath(scope, "/activities")).catch(() => [] as ActivitySummary[]),
      // The questions this reader keeps, oldest first so the list stays put.
      api<{ id: string; name: string; query: string; createdAt: string }[]>(projectPath(scope, "/register/views")).catch(() => []),
    ]);
  const actionCodes = activities.filter((a) => a.needs > 0).sort((a, b) => a.code.localeCompare(b.code)).map((a) => ({ code: a.code, name: a.name }));
  const matchCount = register.total;
  const pages = Math.max(1, register.pages);
  const current = Math.min(register.page, pages);

  // Filters offer what the register holds, not every value the organisation publishes.
  const usedDisciplines = new Set(register.lists.usedDisciplines);
  const usedTypes = new Set(register.lists.usedDocTypes);
  const disciplineLabel = new Map(disciplines.map((d) => [d.code, d.label]));
  const typeLabel = new Map(types.map((t) => [t.code, t.label]));
  const retentionLabel = new Map(retentions.map((item) => [item.code, item.label]));
  const deliverableLabel = new Map(deliverableTypes.map((item) => [item.code, item.label]));
  const statusLabel = new Map(statuses.map((item) => [item.code, item.label]));
  const publishedVerdicts = new Set(verdictSet.map((item) => item.code));
  const verdictLabel = new Map<string, string>([...Object.entries(OUTCOME_CONSEQUENCES).map(([k, v]) => [k, v.label] as [string, string]), ...verdictSet.map((item) => [item.code, item.label] as [string, string])]);
  const statusUse = new Map(statuses.map((item) => [item.code, [item.props.may ? `May: ${item.props.may}` : "", item.props.mayNot ? `May not: ${item.props.mayNot}` : ""].filter(Boolean).join("\n")]));

  // The register shows the revision being worked on — the latest one — and
  // the four facts about it, each decided by someone different:
  //   document state · revision state · review verdict · released for (status).
  // Older revisions and their history live on the document page; who is holding
  // a review up, and the comments on it, live on the review.
  const supplierView = !user.isInternal && !!user.partyCode;
  const hostName = supplierView ? (await getMe())?.tenant.name ?? "Our client" : null;
  const all = register.rows.map((doc) => {
    // A revision whose review is decided and not yet released reads as not released.
    const latestState = doc.revisionState === "IN_REVIEW" && doc.verdict ? "NOT_RELEASED" : doc.revisionState;
    const released = doc.revisionState === "RELEASED";
    return {
      id: doc.id, docNumber: doc.number, title: doc.title, deliverableType: doc.deliverableType,
      docType: doc.docType, discipline: doc.discipline,
      phase: null as string | null,
      phaseLabel: null as string | null,
      actions: doc.activities.map((entry) => ({ code: entry.code, name: entry.name })),
      deliverableLabel: deliverableLabel.get(doc.deliverableType) ?? pretty(doc.deliverableType), docTypeLabel: typeLabel.get(doc.docType) ?? doc.docType, disciplineLabel: disciplineLabel.get(doc.discipline) ?? doc.discipline, originator: doc.originator, subProject: doc.subproject,
      contractRef: doc.contractRef, criticality: doc.criticality, confidentiality: doc.confidentiality,
      retentionClass: doc.retentionClass,
      retentionLabel: doc.retentionClass ? retentionLabel.get(doc.retentionClass) ?? pretty(doc.retentionClass) : null,
      placeholder: doc.isPlaceholder,
      docState: doc.state, docStateLabel: DOC_STATE_LABEL[doc.state as DocState] ?? doc.state,
      revision: doc.revision,
      revState: latestState,
      revStateLabel: latestState
        ? stateName(names, latestState, { together, held: false })
        : "No revision yet",
      onHold: null as string | null,
      // A code is printed only when the organization publishes it. Records made
      // before the list existed carry the Standard's own consequence names,
      // which are sentences, not codes: those show their meaning alone.
      verdict: doc.verdict && publishedVerdicts.has(doc.verdict) ? doc.verdict : null,
      verdictLabel: doc.verdict ? verdictLabel.get(doc.verdict) ?? doc.verdict : null,
      releasedFor: released ? doc.releasedStatus : null,
      // The status an unreleased revision carries. It is real, and it is not in
      // force: the state column says so.
      proposedFor: !released ? doc.proposedStatus : null, releasedForLabel: released && doc.releasedStatus ? statusLabel.get(doc.releasedStatus) ?? doc.releasedStatus : null,
      releasedForUse: released && doc.releasedStatus ? statusUse.get(doc.releasedStatus) ?? null : null,
      createdDate: doc.createdAt, updatedAt: doc.updatedAt,
      plannedSubmissionDate: doc.plannedDate,
      issueDate: released ? doc.issuedAt : null, releasedAt: released ? doc.releasedAt : null,
      // The function that decided, not the person.
      decidedBy: doc.decidedBy ? decidingFunction(doc.decidedBy, null) : null,
      decidedByDelegated: false,
      packageCount: doc.packages,
      // When the file on the current revision arrived, and when that revision started.
      fileAdded: doc.fileAddedAt,
      revStarted: doc.revisionStartedAt,
      // for actions on a selection, not for display
      hasReleased: !!doc.releasedRevisionId, reviewRevisionId: doc.revisionState === "IN_PREPARATION" ? doc.latestRevisionId : null,
      // An outside organization sees who asked it of them. What it sends goes on
      // a transmittal of its own, so nothing is sent from the register.
      receivedFrom: supplierView && doc.originator === user.partyCode ? hostName : null,
      sendRevisionId: null as string | null,
    };
  });
  const rows = all;

  // What each code means, for the hover note on the code itself. Built once,
  // from the organization's own published lists — nothing is hard-coded here.
  const codes: Record<string, string> = {};
  for (const item of statuses) {
    const may = typeof item.props.may === "string" ? `\nMay be used for: ${item.props.may}` : "";
    const mayNot = typeof item.props.mayNot === "string" && item.props.mayNot !== "—" ? `\nMay not: ${item.props.mayNot}` : "";
    codes[`STATUS|${item.code}`] = `${item.code} — ${item.label}${may}${mayNot}`;
  }
  for (const item of verdictSet) codes[`VERDICT|${item.code}`] = `${item.code} — ${item.label}`;
  for (const item of criticalities) {
    codes[`CRITICALITY|${item.code}`] = `${item.label}${typeof item.props.approval === "string" ? `\nApproved by: ${String(item.props.approval).toLowerCase()}` : ""}${typeof item.props.retention === "string" ? `\nKept for: ${String(item.props.retention).replaceAll("_", " ").toLowerCase()}` : ""}`;
    codes[`CRITICALITY_SHORT|${item.code}`] = item.label.replace(/-critical$/i, "").toLowerCase();
  }
  for (const item of confidentialities) {
    codes[`CONFIDENTIALITY|${item.code}`] = item.label;
    codes[`CONFIDENTIALITY_SHORT|${item.code}`] = item.label.split(" — ")[0].toLowerCase();
  }
  for (const code of DOC_STATES) codes[`DOC_STATE|${code}`] = `${DOC_STATE_LABEL[code]} — ${DOC_MEANING[code].means}`;
  for (const code of REV_STATES) codes[`REV_STATE|${code}`] = `${stateName(names, code)} — ${REV_MEANING[code].means}`;

  const query = new URLSearchParams();
  if (q) query.set("q", q); if (state) query.set("state", state); if (discipline) query.set("discipline", discipline); if (docType) query.set("docType", docType); if (revState) query.set("rev", revState); if (statusCode) query.set("status", statusCode); if (verdictCode) query.set("verdict", verdictCode); if (supplier) query.set("supplier", supplier); if (po) query.set("po", po); if (view === "all") query.set("view", "all"); if (criticality) query.set("criticality", criticality); if (confidentiality) query.set("confidentiality", confidentiality); if (deliverable) query.set("deliverable", deliverable);
  if (dateOn) query.set("on", dateOn); if (sp.from) query.set("from", sp.from); if (sp.to) query.set("to", sp.to);
  if (sort) { query.set("sort", sort); query.set("dir", dir); }


  return <div className="space-y-4">
    {sp.sent ? <Banner tone="good" title="Sent">{sp.sent}</Banner> : null}
    {sp.sendError ? <Banner tone="warn" title="Not sent">{sp.sendError}</Banner> : null}
    <DocumentRegister
      supplier={supplierView && (hasVerb(user, "CREATE") || hasVerb(user, "REVISE")) ? { to: hostName ?? "them" } : supplierView ? { to: hostName ?? "them", readOnly: true } : null}
      plate={<RegisterPlate project={{ code: project.code, name: project.name }} canCreate={!isReadOnly(user)} />}
      rows={rows}
      total={matchCount}
      views={views}
      paging={{ page: current, pages, perPage, sizes: PAGE_SIZES, from: matchCount ? (current - 1) * perPage + 1 : 0, to: Math.min(current * perPage, matchCount), query: query.toString() }}
      codes={codes}
      sort={{ key: sort, dir }}
      userCanAct={!isReadOnly(user)} filters={{ q, terms, state, rev: revState, status: statusCode, verdict: verdictCode, supplier, po, discipline, docType, view, criticality, confidentiality, deliverable, phase: sp.phase ?? "", action: sp.action ?? "", on: dateOn, from: sp.from ?? "", to: sp.to ?? "" }} filterOptions={{ states: DOC_STATES.map((code) => ({ code, label: DOC_STATE_LABEL[code] ?? code })), revStates: [
      { code: "NONE", label: "No revision yet" },
      { code: "IN_PREPARATION", label: names.IN_PREPARATION },
      { code: "IN_REVIEW", label: names.IN_REVIEW },
      { code: "NOT_RELEASED", label: names.NOT_RELEASED },
      { code: "FOR_RELEASE", label: "Reviewed" },
      { code: "RELEASED", label: together ? names.RELEASED_ISSUED : names.RELEASED },
      { code: "SUPERSEDED", label: names.SUPERSEDED },
      { code: "VOID", label: names.VOID },
    ], statuses: statuses.map((item) => ({ code: item.code, label: `${item.code} — ${item.label}` })), verdicts: verdictSet.map((item) => ({ code: item.code, label: `${item.code} — ${item.label}` })), suppliers: supplierCodes.map((item) => ({ code: item.code, label: item.label })), pos: poCodes.map((item) => ({ code: item.code, label: item.label })), disciplines: disciplines.filter((item) => usedDisciplines.has(item.code)).map((item) => ({ code: item.code, label: item.status === "RETIRED" ? `${item.label} (retired)` : item.label })), types: types.filter((item) => usedTypes.has(item.code)).map((item) => ({ code: item.code, label: item.status === "RETIRED" ? `${item.label} (retired)` : item.label })), criticalities: criticalities.map((item) => ({ code: item.code, label: item.label })), deliverables: deliverableTypes.map((item) => ({ code: item.code, label: item.label })), confidentialities: confidentialities.map((item) => ({ code: item.code, label: item.label.split(" — ")[0] })), phases: phases.map((item) => ({ code: item.code, label: item.label })), actions: actionCodes.map((item) => ({ code: item.code, label: `${item.code} — ${item.name}` })), dateFields: DATE_FIELDS.map((field) => ({ code: field.key, label: field.label })) }} exportHref={`/api/register/export${query.size ? `?${query.toString()}` : ""}`} />
  </div>;
}

function pretty(value: string) { return value.replaceAll("_", " ").toLowerCase(); }
