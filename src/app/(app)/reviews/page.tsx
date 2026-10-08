import { isReadOnly } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { after } from "next/server";
import { requireScope } from "@/lib/scope";
import { addWorkingDays, dueState } from "@/lib/workflow";
import { warnLateReviews } from "@/lib/review-risk";
import { getSet } from "@/lib/config";
import { readSearch } from "@/lib/register-query";
import { ReviewsRegister, type ReviewRow } from "./reviews-register";
import { ReviewsPlate } from "./reviews-plate";
import { fmtDate } from "@/lib/utils";
import { ADVICE_LABEL, OUTCOME_CONSEQUENCES } from "@/lib/standard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reviews" };

/** How many reviews a page holds. */
const PAGE_SIZES = [25, 50, 100, 250];

type Search = {
  status?: string; q?: string; page?: string; per?: string;
  kind?: string; verdict?: string; due?: string; sort?: string; dir?: string;
  discipline?: string; docType?: string; supplier?: string; po?: string; deliverable?: string;
  on?: string; from?: string; to?: string;
};

/** A review is a decision or it is advice; the route says which. */
const KINDS = [
  { code: "DECISION", label: "Decision" },
  { code: "ADVICE", label: "Advice" },
];

/** How it stands against the date the route gave it. */
const DUES = [
  { code: "OVERDUE", label: "Overdue" },
  { code: "SOON", label: "Due within three days" },
  { code: "NONE", label: "No date given" },
];

/** The dates a review holds, and the column each one is kept in. */
const DATE_FIELDS = [
  { key: "opened", label: "Opened" },
  { key: "due", label: "Due" },
  { key: "closed", label: "Closed" },
] as const;
const DATE_COLUMN: Record<string, string> = { opened: "submittedAt", due: "dueAt", closed: "outcomeAt" };

/** A date from the address, as the day it names. */
function readDay(value: string | undefined, endOfDay: boolean): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const at = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(at.getTime()) ? null : at;
}

const VIEWS = [
  { id: "ALL", label: "All" },
  { id: "OPEN", label: "Open" },
  { id: "CLOSED", label: "Closed" },
] as const;

/**
 * Every review ever made, one row per review — a document appears once for
 * each time it was reviewed. The deciding review of a route carries the
 * binding verdict; earlier steps are advice to it.
 */
export default async function ReviewsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireScope();
  const { db } = ctx;
  // One automatic warning per review that is about to miss its date. After that
  // it is Document Control's call, and their chase is a transmittal.
  after(() => warnLateReviews(ctx).catch(() => {}));
  const sp = await searchParams;
  const status = VIEWS.some((v) => v.id === sp.status) ? sp.status! : "ALL";
  const q = (sp.q ?? "").trim();
  const searches = readSearch(q);
  const kind = KINDS.some((one) => one.code === sp.kind) ? sp.kind! : "";
  const verdict = (sp.verdict ?? "").trim();
  const due = DUES.some((one) => one.code === sp.due) ? sp.due! : "";
  const dir = sp.dir === "desc" ? ("desc" as const) : ("asc" as const);
  // What the document is and where it came from: the register narrows by these,
  // and a reviewer asking "what is on my desk in piping" asks the same thing.
  const discipline = (sp.discipline ?? "").trim();
  const docType = (sp.docType ?? "").trim();
  const supplier = (sp.supplier ?? "").trim();
  const po = (sp.po ?? "").trim();
  const deliverable = (sp.deliverable ?? "").trim();
  const dateOn = DATE_COLUMN[sp.on ?? ""] ? sp.on! : "";
  const from = readDay(sp.from, false);
  const to = readDay(sp.to, true);
  const soon = new Date(Date.now() + 3 * 86_400_000);

  const where: Prisma.ReviewCycleWhereInput = {
    AND: [
      status === "ALL" ? {} : { status },
      ...(searches.length
        ? [{
            OR: searches.map((search) => ({
              AND: search.words.map((word) => ({
                OR: [
                  { number: { contains: word } },
                  { outcome: { contains: word } },
                  { outcomeByName: { contains: word } },
                  { assignments: { some: { userName: { contains: word } } } },
                  { revision: { value: word } },
                  { revision: { document: { docNumber: { startsWith: word } } } },
                  { revision: { document: { docNumber: { contains: word } } } },
                  { revision: { document: { title: { contains: word } } } },
                  { revision: { document: { originator: { contains: word } } } },
                  { revision: { document: { contractRef: { contains: word } } } },
                ],
              })),
            })),
          }]
        : []),
      kind ? { binding: kind === "DECISION" } : {},
      verdict ? { outcome: verdict } : {},
      // What is late, and what is about to be: both are the date the route gave
      // the step, read against today.
      discipline || docType || supplier || po || deliverable
        ? {
            revision: {
              document: {
                ...(discipline ? { discipline } : {}),
                ...(docType ? { docType } : {}),
                ...(supplier ? { originator: supplier } : {}),
                ...(po ? { contractRef: po } : {}),
                ...(deliverable ? { deliverableType: deliverable } : {}),
              },
            },
          }
        : {},
      due === "OVERDUE" ? { status: "OPEN", dueAt: { lt: new Date() } }
        : due === "SOON" ? { status: "OPEN", dueAt: { gte: new Date(), lte: soon } }
          : due === "NONE" ? { dueAt: null }
            : {},
      dateOn && (from || to)
        ? ({ [DATE_COLUMN[dateOn]]: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } as Prisma.ReviewCycleWhereInput)
        : {},
    ],
  };
  const SORTS: Record<string, Prisma.ReviewCycleOrderByWithRelationInput> = {
    number: { number: dir },
    document: { revision: { document: { docNumber: dir } } },
    rev: { revision: { value: dir } },
    kind: { binding: dir },
    verdict: { outcome: dir },
    due: { dueAt: dir },
    opened: { submittedAt: dir },
    closed: { outcomeAt: dir },
    discipline: { revision: { document: { discipline: dir } } },
    docType: { revision: { document: { docType: dir } } },
  };
  const sort = sp.sort && SORTS[sp.sort] ? sp.sort : "";
  const orderBy = sort ? SORTS[sort] : { submittedAt: "desc" as const };
  const perPage = PAGE_SIZES.includes(Number(sp.per)) ? Number(sp.per) : 50;
  const asked = Math.max(1, Number(sp.page) || 1);
  const matching = await db.reviewCycle.count({ where });
  const pages = Math.max(1, Math.ceil(matching / perPage));
  const page = Math.min(asked, pages);

  const [cycles, verdicts, adviceValues, disciplines, types, suppliers, pos, deliverables, inUse] = await Promise.all([
    db.reviewCycle.findMany({
      where,
      orderBy,
      skip: (page - 1) * perPage,
      take: perPage,
      include: {
        revision: {
          select: {
            id: true, value: true, state: true, releasedAt: true,
            // When this issue reached us, and who recorded it. A revision that
            // came from outside arrives through its package or a transmittal;
            // one of ours is simply written here.
            submittedAt: true, submittedByName: true,
            // Every comment made on this revision, whichever review it was made in.
            cycles: { select: { number: true, comments: { orderBy: { createdAt: "asc" }, select: { authorName: true, text: true, progressionPreventing: true, status: true } } } },
            document: {
              select: {
                id: true, docNumber: true, title: true, discipline: true, docType: true,
                originator: true, contractRef: true, deliverableType: true, receivedDate: true,
              },
            },
          },
        },
        assignments: { orderBy: { order: "asc" } },
      },
    }),
    getSet("REVIEW_OUTCOMES"),
    getSet("REVIEW_ADVICE"),
    getSet("DISCIPLINES"),
    getSet("DOCUMENT_TYPES"),
    getSet("SUPPLIER_CODES"),
    getSet("PURCHASE_ORDERS"),
    getSet("DELIVERABLE_TYPES"),
    // The choices offer what the reviews actually hold, not every value the
    // organization publishes.
    db.document.groupBy({ by: ["discipline", "docType"] }),
  ]);
  // What the whole route was given, as against what this step has. A route is
  // a list of steps with working days against them; the review is due when the
  // last of them is, counted from the day it went out.
  const runs = cycles.length
    ? await db.workflowRun.findMany({
        where: { revisionId: { in: [...new Set(cycles.map((c) => c.revisionId))] } },
        orderBy: { createdAt: "desc" },
        select: { revisionId: true, steps: true, createdAt: true, templateName: true },
      })
    : [];
  const routeOf = new Map<string, { days: number; dueAt: Date | null; name: string }>();
  for (const run of runs) {
    if (routeOf.has(run.revisionId)) continue; // the newest run answers for the revision
    let days = 0;
    try {
      for (const step of JSON.parse(run.steps) as { days?: number }[]) days += Number(step.days ?? 0);
    } catch {
      days = 0;
    }
    routeOf.set(run.revisionId, {
      days,
      dueAt: days ? addWorkingDays(run.createdAt, days) : null,
      name: run.templateName,
    });
  }

  const disciplineLabel = new Map(disciplines.map((one) => [one.code, one.label]));
  const typeLabel = new Map(types.map((one) => [one.code, one.label]));
  const deliverableLabel = new Map(deliverables.map((one) => [one.code, one.label]));
  const usedDisciplines = new Set(inUse.map((one) => one.discipline));
  const usedTypes = new Set(inUse.map((one) => one.docType));
  // Codes from the organization's list; older records may carry the Standard's
  // own consequence names (APPROVED, REVISE_AND_RESUBMIT…).
  const verdictLabel = new Map<string, string>([...Object.entries(OUTCOME_CONSEQUENCES).map(([k, v]) => [k, v.label] as [string, string]), ...verdicts.map((v) => [v.code, v.label] as [string, string]), ...Object.entries(ADVICE_LABEL).map(([code, label]) => [code, label] as [string, string]), ...adviceValues.map((v) => [v.code, v.label] as [string, string])]);
  /** The address without one of the filters, so a facet can drop itself. */
  const drop = (key: keyof Search) => {
    const params = new URLSearchParams();
    const held: [keyof Search, string][] = [
      ["status", status === "ALL" ? "" : status], ["q", q], ["kind", kind], ["verdict", verdict],
      ["due", due], ["discipline", discipline], ["docType", docType], ["supplier", supplier], ["po", po],
      ["deliverable", deliverable], ["on", dateOn], ["from", sp.from ?? ""], ["to", sp.to ?? ""],
    ];
    for (const [name, value] of held) {
      if (!value || name === key) continue;
      if (key === "on" && (name === "from" || name === "to")) continue;
      params.set(name, value);
    }
    return `/reviews${params.size ? `?${params}` : ""}`;
  };
  const said = (options: { code: string; label: string }[], code: string) => options.find((one) => one.code === code)?.label ?? code;
  const facets: { key: string; label: string; without: string }[] = [];
  if (q) facets.push({ key: "search", label: q, without: drop("q") });
  if (kind) facets.push({ key: "kind", label: said(KINDS, kind), without: drop("kind") });
  if (verdict) facets.push({ key: "verdict", label: verdict, without: drop("verdict") });
  if (due) facets.push({ key: "due", label: said(DUES, due), without: drop("due") });
  if (discipline) facets.push({ key: "discipline", label: disciplineLabel.get(discipline) ?? discipline, without: drop("discipline") });
  if (docType) facets.push({ key: "type", label: typeLabel.get(docType) ?? docType, without: drop("docType") });
  if (supplier) facets.push({ key: "supplier", label: supplier, without: drop("supplier") });
  if (po) facets.push({ key: "contract", label: po, without: drop("po") });
  if (deliverable) facets.push({ key: "produced by", label: deliverableLabel.get(deliverable) ?? deliverable, without: drop("deliverable") });
  if (dateOn && (sp.from || sp.to)) {
    const window = sp.to && sp.to !== sp.from ? `${sp.from ?? "the beginning"} to ${sp.to}` : sp.from ?? "";
    facets.push({ key: said(DATE_FIELDS.map((f) => ({ code: f.key, label: f.label })), dateOn).toLowerCase(), label: window, without: drop("on") });
  }

  /** The same question, another page of it. */
  const step = (to: number) => {
    const params = new URLSearchParams(drop("page" as keyof Search).split("?")[1] ?? "");
    if (perPage !== 50) params.set("per", String(perPage));
    if (to > 1) params.set("page", String(to));
    return `/reviews${params.size ? `?${params}` : ""}`;
  };
  const proceeds = new Map<string, boolean>([...Object.entries(OUTCOME_CONSEQUENCES).map(([k, v]) => [k, v.proceed] as [string, boolean]), ...verdicts.map((v) => [v.code, v.props.proceed === true] as [string, boolean])]);

  /** The same question, another page of it. */
  const query = new URLSearchParams();
  if (status !== "ALL") query.set("status", status);
  if (q) query.set("q", q);
  if (kind) query.set("kind", kind);
  if (verdict) query.set("verdict", verdict);
  if (due) query.set("due", due);
  if (discipline) query.set("discipline", discipline);
  if (docType) query.set("docType", docType);
  if (supplier) query.set("supplier", supplier);
  if (po) query.set("po", po);
  if (deliverable) query.set("deliverable", deliverable);
  if (sort) { query.set("sort", sort); query.set("dir", dir); }
  if (dateOn) query.set("on", dateOn);
  if (sp.from) query.set("from", sp.from);
  if (sp.to) query.set("to", sp.to);
  if (perPage !== 50) query.set("per", String(perPage));

  const rows: ReviewRow[] = cycles.map((c) => {
    // A review that starts after its revision was released is the recipient's,
    // not ours: their verdict never changes it, a new revision answers it.
    const postRelease = !!c.revision.releasedAt && c.submittedAt > c.revision.releasedAt;
    const state = dueState(c.dueAt, c.status !== "OPEN");
    const route = routeOf.get(c.revisionId) ?? null;
    const routeState = dueState(route?.dueAt ?? null, c.status !== "OPEN");
    const waitingOn = c.assignments.filter((a) => !a.completedAt);
    const late = c.status === "OPEN" && state !== "on time" && c.dueAt;
    return {
      id: c.id,
      number: c.number,
      documentId: c.revision.document.id,
      docNumber: c.revision.document.docNumber,
      title: c.revision.document.title,
      revision: c.revision.value,
      kind: postRelease ? "client review" : c.binding ? "decision" : "advice",
      verdict: c.binding ? c.outcome : null,
      verdictLabel: c.outcome ? verdictLabel.get(c.outcome) ?? c.outcome : null,
      verdictProceeds: c.outcome && c.binding ? proceeds.get(c.outcome) ?? null : null,
      decidedBy: c.outcomeByName,
      open: c.status === "OPEN",
      reviewers: c.assignments.map((a) => ({ name: a.userName, done: !!a.completedAt })),
      doneCount: c.assignments.filter((a) => a.completedAt).length,
      dueAt: c.dueAt ? fmtDate(c.dueAt) : null,
      routeName: route?.name ?? null,
      routeDays: route?.days ?? null,
      routeDueAt: route?.dueAt ? fmtDate(route.dueAt) : null,
      routeDueState: routeState,
      dueState: state,
      notifyHref: late
        ? `/transmittals/new?revisions=${c.revision.id}&users=${waitingOn.map((a) => a.userId).join(",")}&reason=REVIEW&subject=${encodeURIComponent(`${c.revision.document.docNumber} rev ${c.revision.value} — review still open`)}&message=${encodeURIComponent(`This review was due on ${fmtDate(c.dueAt!)}. Please answer it.${c.riskNotifiedAt ? ` An automatic warning went out on ${fmtDate(c.riskNotifiedAt)}.` : ""}`)}`
        : null,
      warnedAt: c.riskNotifiedAt ? fmtDate(c.riskNotifiedAt) : null,
      openedAt: fmtDate(c.submittedAt),
      openedBy: c.openedByName,
      discipline: disciplineLabel.get(c.revision.document.discipline) ?? c.revision.document.discipline,
      docType: typeLabel.get(c.revision.document.docType) ?? c.revision.document.docType,
      producedBy: deliverableLabel.get(c.revision.document.deliverableType) ?? c.revision.document.deliverableType,
      from: c.revision.document.originator,
      contract: c.revision.document.contractRef,
      // The day the document reached us. Ours are written when the revision is
      // opened; an outside one carries the day its submission arrived.
      receivedAt: c.revision.submittedAt
        ? fmtDate(c.revision.submittedAt)
        : c.revision.document.receivedDate ? fmtDate(c.revision.document.receivedDate) : null,
      receivedFrom: c.revision.document.originator ?? c.revision.submittedByName,
      closedAt: c.outcomeAt ? fmtDate(c.outcomeAt) : null,
      comments: c.revision.cycles.flatMap((cy) => cy.comments.map((one) => ({ by: one.authorName, text: one.text, blocking: one.progressionPreventing, settled: one.status === "CLOSED", review: cy.number }))),
    };
  });

  return (
    <ReviewsRegister
      plate={<ReviewsPlate canStart={!isReadOnly(ctx.user)} />}
      rows={rows}
      total={matching}
      filters={{ q, status: status === "ALL" ? "" : status, kind, verdict, due, discipline, docType, supplier, po, deliverable, on: dateOn, from: sp.from ?? "", to: sp.to ?? "" }}
      filterOptions={{
        statuses: VIEWS.filter((v) => v.id !== "ALL").map((v) => ({ code: v.id, label: v.label })),
        kinds: KINDS,
        verdicts: verdicts.map((one) => ({ code: one.code, label: `${one.code} — ${one.label}` })),
        dues: DUES,
        disciplines: disciplines.filter((one) => usedDisciplines.has(one.code)).map((one) => ({ code: one.code, label: one.label })),
        types: types.filter((one) => usedTypes.has(one.code)).map((one) => ({ code: one.code, label: one.label })),
        suppliers: suppliers.map((one) => ({ code: one.code, label: one.label })),
        pos: pos.map((one) => ({ code: one.code, label: one.label })),
        deliverables: deliverables.map((one) => ({ code: one.code, label: one.label })),
        dateFields: DATE_FIELDS.map((field) => ({ code: field.key, label: field.label })),
      }}
      facets={facets}
      sort={{ key: sort, dir }}
      paging={{
        page, pages, perPage, sizes: PAGE_SIZES,
        from: matching ? (page - 1) * perPage + 1 : 0,
        to: Math.min(page * perPage, matching),
        query: query.toString(),
      }}
      exportHref={`/api/export/reviews${query.size ? `?${query}` : ""}`}
    />
  );
}
