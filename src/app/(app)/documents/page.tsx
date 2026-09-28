import { Prisma } from "@prisma/client";
import { requireScope } from "@/lib/scope";
import { RegisterPlate } from "./register-plate";
import { OUTCOME_CONSEQUENCES, DOC_STATES, DOC_STATE_LABEL, DOC_MEANING, REV_STATES, REV_STATE_LABEL, REV_MEANING, revStateLabel, type DocState, type RevState } from "@/lib/standard";
import { getSet } from "@/lib/config";
import { DocumentRegister } from "./document-register";
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
  const { user, db, project } = await requireScope();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  // Two rules, and only two: a space narrows, a comma widens.
  //   pump ME IFC        every word must match, somewhere in the row
  //   P-101, P-102       either one is a match
  //   "feed pump" ME     a quoted phrase counts as one word
  // So a comma separates searches, and each search may itself have several words.
  const searches = q.split(",").map((part) => part.trim()).filter(Boolean).slice(0, 8)
    .map((part) => ({ text: part, words: [...part.matchAll(/"([^"]+)"|(\S+)/g)].map((m) => (m[1] ?? m[2]).trim()).filter(Boolean).slice(0, 6) }))
    .filter((search) => search.words.length);
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
  const day = (value: string | undefined, endOfDay: boolean) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const at = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
    return Number.isNaN(at.getTime()) ? null : at;
  };
  const from = day(sp.from, false);
  const to = day(sp.to, true);
  const perPage = PAGE_SIZES.includes(Number(sp.per)) ? Number(sp.per) : 50;
  const page = Math.max(1, Number(sp.page) || 1);

  let assetDocIds: string[] = [];
  const allWords = searches.flatMap((search) => search.words);
  if (allWords.length) {
    const assets = await db.assetItem.findMany({ where: { OR: allWords.flatMap((word) => [{ code: { contains: word } }, { name: { contains: word } }]) }, select: { id: true } });
    if (assets.length) {
      const rels = await db.relationship.findMany({ where: { kind: "DOC_ASSET", toId: { in: assets.map((asset) => asset.id) } }, select: { fromId: true } });
      assetDocIds = rels.map((rel) => rel.fromId);
    }
  }

  const where: Prisma.DocumentWhereInput = {
    AND: [
      ...(state || view === "all" ? [] : [{ state: { notIn: ["WITHDRAWN", "CANCELLED", "ARCHIVED"] } }]),
      // One search is its words, ANDed. Several searches are ORed together.
      ...(searches.length
        ? [{ OR: searches.map((search) => ({
            AND: search.words.map((word) => ({ OR: [
              { docNumber: { contains: word } }, { title: { contains: word } }, { originator: { contains: word } },
              { contractRef: { contains: word } }, { previousId: { contains: word } },
              { discipline: { contains: word } }, { docType: { contains: word } }, { subProject: { contains: word } },
              ...(assetDocIds.length ? [{ id: { in: assetDocIds } }] : []),
            ] })),
          })) }]
        : []),
      state ? { state } : {}, discipline ? { discipline } : {}, docType ? { docType } : {},
      supplier ? { originator: supplier } : {}, po ? { contractRef: po } : {},
      criticality ? { criticality } : {}, confidentiality ? { confidentiality } : {},
      deliverable ? { deliverableType: deliverable } : {},
    ],
  };

  // Four of the filters — revision state, released for, verdict, and the two
  // "waiting on" views — are read off the latest revision, which no column
  // holds. So the register is read twice: once thinly, to find out which
  // documents match and in what order, and once in full for the page on screen.
  // The expensive joins then touch 50 rows rather than every document.
  const [sieve, disciplines, types, statuses, verdictSet, supplierCodes, poCodes, criticalities, confidentialities, retentions, deliverableTypes, templates] = await Promise.all([
    db.document.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        docNumber: true, title: true, discipline: true, docType: true, originator: true,
        subProject: true, contractRef: true, criticality: true, confidentiality: true,
        state: true, updatedAt: true, createdDate: true, retentionClass: true, deliverableType: true,
        revisions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            value: true, state: true, statusCode: true, releasedAt: true,
            issueDate: true, plannedSubmissionDate: true,
            createdAt: true,
            files: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
            cycles: { orderBy: { sequence: "desc" }, select: { binding: true, outcome: true } },
          },
        },
      },
    }),
    getSet("DISCIPLINES"), getSet("DOCUMENT_TYPES"), getSet("STATUSES"), getSet("REVIEW_OUTCOMES"), getSet("SUPPLIER_CODES"), getSet("PURCHASE_ORDERS"),
    getSet("CRITICALITY"), getSet("CONFIDENTIALITY"), getSet("RETENTION_CLASSES"), getSet("DELIVERABLE_TYPES"),
    db.workflowTemplate.findMany({ where: { active: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
  ]);
  // Which date each choice reads. The sieve already carries all of them.
  type SieveDoc = (typeof sieve)[number];
  const DATE_READERS: Record<string, (doc: SieveDoc) => Date | null> = {
    created: (doc) => doc.createdDate,
    revStarted: (doc) => doc.revisions[0]?.createdAt ?? null,
    fileAdded: (doc) => doc.revisions[0]?.files[0]?.createdAt ?? null,
    planned: (doc) => doc.revisions[0]?.plannedSubmissionDate ?? null,
    issued: (doc) => doc.revisions[0]?.issueDate ?? null,
    released: (doc) => doc.revisions[0]?.releasedAt ?? null,
    updated: (doc) => doc.updatedAt,
  };

  // Which documents the derived filters keep, in the order they will be shown.
  const keep = sieve.filter((doc) => {
    const latest = doc.revisions[0] ?? null;
    const binding = latest?.cycles.filter((c) => c.binding) ?? [];
    const decided = binding.find((c) => c.outcome) ?? null;
    const forRelease = latest?.state === "NOT_RELEASED";
    if (revState === "NONE" && latest) return false;
    if (revState === "FOR_RELEASE" && !forRelease) return false;
    if (revState === "IN_REVIEW" && (latest?.state !== "IN_REVIEW" || forRelease)) return false;
    if (revState && !["NONE", "FOR_RELEASE", "IN_REVIEW"].includes(revState) && latest?.state !== revState) return false;
    if (statusCode && !(latest?.state === "RELEASED" && latest.statusCode === statusCode)) return false;
    if (verdictCode && decided?.outcome !== verdictCode) return false;
    if (dateOn && (from || to)) {
      const when = DATE_READERS[dateOn](doc);
      if (!when) return false;
      if (from && when < from) return false;
      if (to && when > to) return false;
    }
    return true;
  });
  // Sorting, over every match rather than over the page: the column someone
  // clicked decides the order, and the page is cut from that order afterwards.
  type Sieved = (typeof keep)[number];
  const SORTS: Record<string, (doc: Sieved) => string | number | null> = {
    fileAdded: (doc) => doc.revisions[0]?.files[0]?.createdAt.getTime() ?? 0,
    revStarted: (doc) => doc.revisions[0]?.createdAt.getTime() ?? 0,
    docNumber: (doc) => doc.docNumber,
    title: (doc) => doc.title.toLowerCase(),
    rev: (doc) => doc.revisions[0]?.value ?? "",
    revState: (doc) => REV_STATES.indexOf((doc.revisions[0]?.state ?? "") as RevState),
    docState: (doc) => DOC_STATES.indexOf(doc.state as DocState),
    releasedFor: (doc) => doc.revisions[0]?.statusCode ?? "",
    verdict: (doc) => doc.revisions[0]?.cycles.find((cycle) => cycle.binding && cycle.outcome)?.outcome ?? "",
    discipline: (doc) => doc.discipline,
    docType: (doc) => doc.docType,
    originator: (doc) => doc.originator ?? "",
    subProject: (doc) => doc.subProject ?? "",
    contract: (doc) => doc.contractRef ?? "",
    criticality: (doc) => doc.criticality ?? "",
    confidentiality: (doc) => doc.confidentiality ?? "",
    retention: (doc) => doc.retentionClass ?? "",
    deliverable: (doc) => doc.deliverableType,
    planned: (doc) => doc.revisions[0]?.plannedSubmissionDate?.getTime() ?? 0,
    issued: (doc) => doc.revisions[0]?.issueDate?.getTime() ?? 0,
    released: (doc) => doc.revisions[0]?.releasedAt?.getTime() ?? 0,
    updated: (doc) => doc.updatedAt.getTime(),
    created: (doc) => doc.createdDate.getTime(),
  };
  const sort = sp.sort && SORTS[sp.sort] ? sp.sort : "";
  const dir = sp.dir === "asc" ? "asc" : "desc";
  if (sort) {
    const read = SORTS[sort];
    keep.sort((a, b) => {
      const left = read(a) ?? "";
      const right = read(b) ?? "";
      const cmp = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
      return dir === "asc" ? cmp : -cmp;
    });
  }

  const matchCount = keep.length;
  const pages = Math.max(1, Math.ceil(matchCount / perPage));
  const current = Math.min(page, pages);
  const pageIds = keep.slice((current - 1) * perPage, current * perPage).map((doc) => doc.id);

  // The page itself, in full. Prisma returns rows unordered, so the order the
  // sieve established is restored by index.
  const order = new Map(pageIds.map((id, i) => [id, i]));
  const docs = (await db.document.findMany({
    where: { id: { in: pageIds } },
    include: {
      revisions: { orderBy: { createdAt: "desc" }, include: {
        files: { select: { createdAt: true } },
        cycles: { orderBy: { sequence: "desc" } },
        approvals: { where: { withdrawnAt: null }, orderBy: { decidedAt: "desc" }, take: 1 },
        transmittalItems: { where: { transmittal: { direction: "OUTGOING" } }, select: { id: true }, take: 1 },
      } },
      _count: { select: { baselineEntries: true, packageMembers: true } },
    },
  })).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const total = sieve.length;

  // Filters offer what the register holds, not every value the organisation publishes.
  const inUse = await db.document.findMany({ select: { discipline: true, docType: true }, distinct: ["discipline", "docType"] });
  const usedDisciplines = new Set(inUse.map((d) => d.discipline));
  const usedTypes = new Set(inUse.map((d) => d.docType));
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
  const all = docs.map((doc) => {
    const latest = doc.revisions[0] ?? null;
    const current = doc.revisions.find((revision) => revision.state === "RELEASED") ?? null;
    const working = doc.revisions.find((revision) => revision.state === "IN_PREPARATION") ?? null;
    const decided = latest?.cycles.find((c) => c.binding && c.outcome) ?? null;
    const released = latest?.state === "RELEASED" ? latest : null;
    return {
      id: doc.id, docNumber: doc.docNumber, title: doc.title, deliverableType: doc.deliverableType,
      docType: doc.docType, discipline: doc.discipline,
      deliverableLabel: deliverableLabel.get(doc.deliverableType) ?? pretty(doc.deliverableType), docTypeLabel: typeLabel.get(doc.docType) ?? doc.docType, disciplineLabel: disciplineLabel.get(doc.discipline) ?? doc.discipline, originator: doc.originator, subProject: doc.subProject,
      contractRef: doc.contractRef, criticality: doc.criticality, confidentiality: doc.confidentiality,
      retentionClass: doc.retentionClass,
      retentionLabel: doc.retentionClass ? retentionLabel.get(doc.retentionClass) ?? pretty(doc.retentionClass) : null,
      placeholder: doc.isPlaceholder,
      docState: doc.state, docStateLabel: DOC_STATE_LABEL[doc.state as DocState] ?? doc.state,
      revision: latest?.value ?? null,
      revState: latest?.state ?? null,
      revStateLabel: latest ? revStateLabel(latest.state) : "No revision yet",
      // Released and nobody asked for it to be sent: in use, and nobody told.
      notIssued: !!released && !released.transmittalItems.length,
      // A code is printed only when the organization publishes it. Records made
      // before the list existed carry the Standard's own consequence names,
      // which are sentences, not codes: those show their meaning alone.
      verdict: decided?.outcome && publishedVerdicts.has(decided.outcome) ? decided.outcome : null,
      verdictLabel: decided?.outcome ? verdictLabel.get(decided.outcome) ?? decided.outcome : null,
      releasedFor: released?.statusCode ?? null,
      // The status an unreleased revision carries. It is real, and it is not in
      // force: the state column says so.
      proposedFor: !released ? latest?.statusCode ?? null : null, releasedForLabel: released?.statusCode ? statusLabel.get(released.statusCode) ?? released.statusCode : null,
      releasedForUse: released?.statusCode ? statusUse.get(released.statusCode) ?? null : null,
      createdDate: doc.createdDate.toISOString(), updatedAt: doc.updatedAt.toISOString(),
      plannedSubmissionDate: working?.plannedSubmissionDate?.toISOString() ?? latest?.plannedSubmissionDate?.toISOString() ?? null,
      issueDate: released?.issueDate?.toISOString() ?? null, releasedAt: released?.releasedAt?.toISOString() ?? null,
      // The function that decided, not the person. A delegation is the one
      // exception worth a mark, because then the authority was borrowed.
      decidedBy: latest?.approvals[0] ? decidingFunction(latest.approvals[0].approverRole, latest.approvals[0].approverName) : null,
      decidedByDelegated: latest?.approvals[0]?.approverRole?.includes("by delegation") ?? false,
      packageCount: doc._count.packageMembers,
      // When the file on the current revision arrived, and when that revision started.
      fileAdded: latest?.files?.slice().sort((a, b) => +b.createdAt - +a.createdAt)[0]?.createdAt.toISOString() ?? null,
      revStarted: latest?.createdAt.toISOString() ?? null,
      // for actions on a selection, not for display
      hasReleased: !!current, reviewRevisionId: working?.id ?? null,
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
  for (const code of REV_STATES) codes[`REV_STATE|${code}`] = `${REV_STATE_LABEL[code]} — ${REV_MEANING[code].means}`;

  const query = new URLSearchParams();
  if (q) query.set("q", q); if (state) query.set("state", state); if (discipline) query.set("discipline", discipline); if (docType) query.set("docType", docType); if (revState) query.set("rev", revState); if (statusCode) query.set("status", statusCode); if (verdictCode) query.set("verdict", verdictCode); if (supplier) query.set("supplier", supplier); if (po) query.set("po", po); if (view === "all") query.set("view", "all"); if (criticality) query.set("criticality", criticality); if (confidentiality) query.set("confidentiality", confidentiality); if (deliverable) query.set("deliverable", deliverable);
  if (dateOn) query.set("on", dateOn); if (sp.from) query.set("from", sp.from); if (sp.to) query.set("to", sp.to);
  if (sort) { query.set("sort", sort); query.set("dir", dir); }


  return <div className="space-y-4">
    <DocumentRegister
      plate={<RegisterPlate project={{ code: project.code, name: project.name }} canCreate={!isReadOnly(user)} />}
      rows={rows}
      total={matchCount}
      paging={{ page: current, pages, perPage, sizes: PAGE_SIZES, from: matchCount ? (current - 1) * perPage + 1 : 0, to: Math.min(current * perPage, matchCount), query: query.toString() }}
      codes={codes}
      sort={{ key: sort, dir }}
      userCanAct={!isReadOnly(user)} filters={{ q, terms, state, rev: revState, status: statusCode, verdict: verdictCode, supplier, po, discipline, docType, view, criticality, confidentiality, deliverable, on: dateOn, from: sp.from ?? "", to: sp.to ?? "" }} filterOptions={{ states: DOC_STATES.map((code) => ({ code, label: DOC_STATE_LABEL[code] ?? code })), revStates: [
      { code: "NONE", label: "No revision yet" },
      { code: "IN_PREPARATION", label: REV_STATE_LABEL.IN_PREPARATION },
      { code: "IN_REVIEW", label: REV_STATE_LABEL.IN_REVIEW },
      { code: "NOT_RELEASED", label: REV_STATE_LABEL.NOT_RELEASED },
      { code: "FOR_RELEASE", label: "For release — decided, not released" },
      { code: "RELEASED", label: REV_STATE_LABEL.RELEASED },
      { code: "SUPERSEDED", label: REV_STATE_LABEL.SUPERSEDED },
      { code: "VOID", label: REV_STATE_LABEL.VOID },
    ], statuses: statuses.map((item) => ({ code: item.code, label: `${item.code} — ${item.label}` })), verdicts: verdictSet.map((item) => ({ code: item.code, label: `${item.code} — ${item.label}` })), suppliers: supplierCodes.map((item) => ({ code: item.code, label: item.label })), pos: poCodes.map((item) => ({ code: item.code, label: item.label })), disciplines: disciplines.filter((item) => usedDisciplines.has(item.code)).map((item) => ({ code: item.code, label: item.status === "RETIRED" ? `${item.label} (retired)` : item.label })), types: types.filter((item) => usedTypes.has(item.code)).map((item) => ({ code: item.code, label: item.status === "RETIRED" ? `${item.label} (retired)` : item.label })), criticalities: criticalities.map((item) => ({ code: item.code, label: item.label })), deliverables: deliverableTypes.map((item) => ({ code: item.code, label: item.label })), confidentialities: confidentialities.map((item) => ({ code: item.code, label: item.label.split(" — ")[0] })), dateFields: DATE_FIELDS.map((field) => ({ code: field.key, label: field.label })) }} exportHref={`/api/register/export${query.size ? `?${query.toString()}` : ""}`} />
  </div>;
}

function pretty(value: string) { return value.replaceAll("_", " ").toLowerCase(); }
