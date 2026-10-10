import { isReadOnly } from "@/lib/auth";
import { after } from "next/server";
import { requireScope } from "@/lib/scope";
import { dueState } from "@/lib/workflow";
import { warnLateReviews } from "@/lib/review-risk";
import { getSet } from "@/lib/config";
import { reviewsPage, valuesInUse, waitingOn, dueDay, workingDaysBetween } from "@/lib/api/reviews";
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
  // One automatic warning per review that is about to miss its date. After that
  // it is Document Control's call, and their chase is a transmittal.
  after(() => warnLateReviews(ctx).catch(() => {}));
  const sp = await searchParams;
  const status = VIEWS.some((v) => v.id === sp.status) ? sp.status! : "ALL";
  const q = (sp.q ?? "").trim();
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
  // A day the backend cannot read is no window at all, as it was before.
  const from = dateOn && readDay(sp.from, false) ? sp.from! : "";
  const to = dateOn && readDay(sp.to, true) ? sp.to! : "";

  // The backend sorts by these. A review's number is given in the order reviews
  // open, so it sorts as the day it opened; so does the document, for now.
  const SORTS: Record<string, string> = {
    number: "opened", document: "opened", rev: "rev", kind: "kind", verdict: "verdict", due: "due",
    opened: "opened", closed: "closed", discipline: "discipline", docType: "docType",
  };
  const sort = sp.sort && SORTS[sp.sort] ? sp.sort : "";
  const perPage = PAGE_SIZES.includes(Number(sp.per)) ? Number(sp.per) : 50;
  const asked = Math.max(1, Number(sp.page) || 1);

  const [found, verdicts, adviceValues, disciplines, types, suppliers, pos, deliverables, inUse] = await Promise.all([
    // Every review is a whole route that ends in its decision: none is advice alone.
    kind === "ADVICE"
      ? Promise.resolve({ total: 0, page: 1, pages: 1, per: perPage, sizes: PAGE_SIZES, rows: [] })
      : reviewsPage(ctx, {
          status: status === "ALL" ? "" : status, q, verdict, due, discipline, docType, supplier, deliverable,
          on: from || to ? dateOn : "", from, to,
          // Newest first unless a column is asked for, as the list always read.
          sort: sort ? SORTS[sort] : "", dir: sort ? dir : "desc", page: asked, per: perPage,
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
    valuesInUse(ctx),
  ]);
  const matching = found.total;
  const pages = Math.max(1, found.pages);
  const page = Math.min(found.page, pages);
  const cycles = found.rows;
  // Whoever a late review still waits on, so a reminder can be addressed to them.
  const lateOnes = cycles.filter((c) => c.open && c.dueDate && dueState(dueDay(c.dueDate), false) !== "on time");
  const waiting = new Map(await Promise.all(lateOnes.map(async (c) => [c.id, await waitingOn(ctx, c.id)] as const)));

  const disciplineLabel = new Map(disciplines.map((one) => [one.code, one.label]));
  const typeLabel = new Map(types.map((one) => [one.code, one.label]));
  const deliverableLabel = new Map(deliverables.map((one) => [one.code, one.label]));
  const usedDisciplines = new Set(inUse.disciplines);
  const usedTypes = new Set(inUse.docTypes);
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
    const dueAt = dueDay(c.dueDate);
    const routeDueAt = dueDay(c.routeDueDate);
    const state = dueState(dueAt, !c.open);
    const routeState = dueState(routeDueAt, !c.open);
    const late = c.open && state !== "on time" && dueAt;
    const waitingOnStep = waiting.get(c.id);
    return {
      id: c.id,
      number: c.number,
      documentId: c.documentId,
      docNumber: c.documentNumber,
      title: c.title,
      revision: c.revision,
      // Every review is a route that ends in its decision.
      kind: "decision",
      verdict: c.verdict,
      verdictLabel: c.verdict ? verdictLabel.get(c.verdict) ?? c.verdict : null,
      verdictProceeds: c.verdict ? proceeds.get(c.verdict) ?? null : null,
      decidedBy: c.decidedBy,
      open: c.open,
      withdrawn: c.state === "WITHDRAWN" ? c.note ?? "withdrawn" : null,
      reviewers: c.reviewers,
      doneCount: c.reviewers.filter((a) => a.done).length,
      dueAt: dueAt ? fmtDate(dueAt) : null,
      routeName: c.routeName,
      routeDays: routeDueAt ? workingDaysBetween(new Date(c.startedAt), routeDueAt) : null,
      routeDueAt: routeDueAt ? fmtDate(routeDueAt) : null,
      routeDueState: routeState,
      dueState: state,
      notifyHref: late && waitingOnStep
        ? `/transmittals/new?revisions=${waitingOnStep.revisionId}&users=${waitingOnStep.userIds.join(",")}&reason=REVIEW&subject=${encodeURIComponent(`${c.documentNumber} rev ${c.revision} — review still open`)}&message=${encodeURIComponent(`This review was due on ${fmtDate(dueAt!)}. Please answer it.`)}`
        : null,
      // When the people on the open step were warned it falls due the next working day.
      warnedAt: c.warnedAt ? fmtDate(c.warnedAt) : null,
      openedAt: fmtDate(c.startedAt),
      openedBy: c.startedBy,
      discipline: disciplineLabel.get(c.discipline) ?? c.discipline,
      docType: typeLabel.get(c.docType) ?? c.docType,
      producedBy: deliverableLabel.get(c.deliverableType) ?? c.deliverableType,
      from: c.originator,
      contract: c.contractRef,
      // The day the document reached us: an outside one carries the day its
      // submission arrived; ours are written here.
      receivedAt: c.receivedAt ? fmtDate(c.receivedAt) : null,
      receivedFrom: c.originator,
      closedAt: c.closedAt ? fmtDate(c.closedAt) : null,
      comments: c.comments.map((one) => ({ by: one.by, text: one.text, blocking: one.blocking, settled: one.settled, review: c.number })),
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
