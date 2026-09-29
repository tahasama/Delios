import type { Prisma } from "@prisma/client";
import { requireScope } from "@/lib/scope";
import { departmentsOf, daysBefore } from "@/lib/schedule";
import { clearance } from "@/lib/requirements-process";
import { readSearch, readDay } from "@/lib/register-query";
import { readyReading, countingRevision, meetsRequirement } from "@/lib/readiness";
import { fmtDate } from "@/lib/utils";
import { after } from "next/server";
import { warnOnceAtRisk } from "@/lib/risk-notice";
import { PlanCards } from "./plan-cards";
import { PlanPlate } from "./plan-plate";
import { PlanTimeline } from "./plan-timeline";
import { PlanRegister, type PlanTableRow } from "./plan-register";

export const dynamic = "force-dynamic";
export const metadata = { title: "Schedule & actions" };

type Readiness = PlanTableRow["readiness"];

type Search = {
  view?: string; all?: string; q?: string; state?: string; discipline?: string; docType?: string; supplier?: string;
  code?: string; on?: string; from?: string; to?: string;
  sort?: string; dir?: string; page?: string; per?: string; show?: string; step?: string;
};

const PAGE_SIZES = [25, 50, 100, 200];

/** The only date an action has, so the window asks about it without asking which. */
const DATE_FIELDS = [{ code: "date", label: "Action date" }];

/** Ordered by a column, in SQL — nothing is sorted on a page of a longer list. */
const SORTS: Record<string, Prisma.ActionOrderByWithRelationInput[]> = {
  code: [{ code: "asc" }],
  name: [{ name: "asc" }],
  date: [{ scheduledDate: "asc" }, { code: "asc" }],
  documents: [{ entries: { _count: "asc" } }, { code: "asc" }],
};

/**
 * The five states, said in the database rather than in memory.
 *
 * Each is a shape of what the action already carries — how many documents it
 * needs, how many are met, and the day the next missing one is owed — so the
 * schedule filters, counts and pages on them without loading itself.
 */
const STATES = [
  { code: "DONE", label: "Done" },
  { code: "READY", label: "Ready" },
  { code: "UPCOMING", label: "Still ahead" },
  { code: "AT_RISK", label: "At risk" },
  { code: "NOT_READY", label: "Overdue" },
  { code: "UNKNOWN", label: "Nothing listed" },
];

/** How many days either side of today the plan shows when nobody says otherwise. */
const PLAN_WINDOW_DAYS = 30;

/**
 * A document owed within this many days — or already owed — puts its action at
 * risk. Further out than that, the work is simply still ahead.
 */
const RISK_DAYS = 7;

/**
 * How many bars the plan draws before asking. Twelve leaves the footer — and
 * the way to draw more — where the page ends rather than below it, now that the
 * footer carries two rows.
 */
const PLAN_FIRST = 12;

/** One bar and the gap under it, in pixels: what a row of the plan takes. */
const PLAN_ROW = 30;

/**
 * What the plan spends on everything that is not a bar: the band carrying the
 * dates, the padding under the last bar, and the footer. Only a fallback — the
 * table matches the plan's card as measured, and uses this until it has been.
 */
const CARD_CHROME = 6 + 20 + 16 + 45;

/** How many more the plan draws at a time — the reader's choice, like rows. */
const PLAN_STEPS = [5, 10, 25, 50, 100];

export default async function ActionsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireScope();
  const { db } = ctx;
  const sp = await searchParams;
  const view = sp.view === "table" ? "table" : "plan";

  const q = (sp.q ?? "").trim().slice(0, 200);
  const searches = readSearch(q);
  const reading = await readyReading(ctx);
  const state = STATES.some((one) => one.code === sp.state) ? sp.state! : "";
  const discipline = (sp.discipline ?? "").trim();
  const docType = (sp.docType ?? "").trim();
  const supplier = (sp.supplier ?? "").trim();
  const code = (sp.code ?? "").trim();
  const dateOn = sp.on === "date" || (!sp.on && (sp.from || sp.to)) ? "date" : "";
  const fromDay = readDay(sp.from, false);
  const toDay = readDay(sp.to ?? sp.from, true);

  const sortKey = sp.sort && SORTS[sp.sort] ? sp.sort : "date";
  const dir = sp.dir === "desc" ? "desc" : "asc";
  const orderBy = SORTS[sortKey].map((one) => {
    const [field, value] = Object.entries(one)[0];
    return { [field]: typeof value === "object" ? { _count: dir } : dir } as Prisma.ActionOrderByWithRelationInput;
  });

  const perPage = PAGE_SIZES.includes(Number(sp.per)) ? Number(sp.per) : 50;
  const page = Math.max(1, Number(sp.page) || 1);
  // Never more than asked for, and never a page that loads the whole schedule
  // because somebody typed a number into the address.
  const shown = Math.min(Math.max(Number(sp.show) || PLAN_FIRST, PLAN_FIRST), 2000);
  const step = PLAN_STEPS.includes(Number(sp.step)) ? Number(sp.step) : PLAN_STEPS[0];

  // The plan is naturally long, so it opens on a window around today — one month
  // either side, today in the middle — until somebody asks for another.
  const windowed = !fromDay && !toDay && view === "plan" && sp.all !== "1";
  const planFrom = fromDay ?? (windowed ? daysBefore(new Date(), PLAN_WINDOW_DAYS) : null);
  const planTo = toDay ?? (windowed ? daysBefore(new Date(), -PLAN_WINDOW_DAYS) : null);

  // Which count says "met" is the project's reading; the rest of the shape is
  // the same either way.
  const met: "metIssuedCount" | "metStatusCount" = reading === "STATUS" ? "metStatusCount" : "metIssuedCount";
  const now = new Date();
  const risk = new Date(now.getTime() + RISK_DAYS * 86_400_000);
  const shortOfWhatItNeeds = { NOT: { [met]: { equals: { _ref: "needCount", _container: "Action" } } } } as unknown as Prisma.ActionWhereInput;
  const hasAll: Prisma.ActionWhereInput = { [met]: { equals: { _ref: "needCount", _container: "Action" } } } as unknown as Prisma.ActionWhereInput;
  const STATE_WHERE: Record<string, Prisma.ActionWhereInput> = {
    UNKNOWN: { needCount: 0 },
    DONE: { needCount: { gt: 0 }, ...hasAll, scheduledDate: { lt: now } },
    READY: { needCount: { gt: 0 }, ...hasAll, OR: [{ scheduledDate: null }, { scheduledDate: { gte: now } }] },
    NOT_READY: { needCount: { gt: 0 }, ...shortOfWhatItNeeds, scheduledDate: { lt: now } },
    AT_RISK: { needCount: { gt: 0 }, ...shortOfWhatItNeeds, scheduledDate: { gte: now }, nextNeededAt: { lte: risk } },
    UPCOMING: {
      needCount: { gt: 0 },
      ...shortOfWhatItNeeds,
      scheduledDate: { gte: now },
      OR: [{ nextNeededAt: null }, { nextNeededAt: { gt: risk } }],
    },
  };

  const where: Prisma.ActionWhereInput = {
    AND: [
      code ? { code } : {},
      state ? STATE_WHERE[state] : {},
      // A discipline is what an action is tagged with and what a document
      // belongs to — the same list, so the filter answers for both.
      discipline
        ? { OR: [{ departments: { contains: discipline } }, { entries: { some: { document: { discipline } } } }] }
        : {},
      // Type and supplier are facts about the documents an action needs, so an
      // action matches when one of its documents does.
      docType || supplier
        ? {
            entries: {
              some: {
                document: {
                  ...(docType ? { docType } : {}),
                  ...(supplier ? { originator: supplier } : {}),
                },
              },
            },
          }
        : {},
      planFrom || planTo
        ? { scheduledDate: { ...(planFrom ? { gte: planFrom } : {}), ...(planTo ? { lte: planTo } : {}) } }
        : {},
      // A space narrows, a comma widens: every word of a part must be found
      // somewhere on the action, and any part may be the one that matches.
      ...(searches.length
        ? [{
            OR: searches.map((search) => ({
              AND: search.words.map((word) => ({
                OR: [
                  { code: { startsWith: word } },
                  { code: { contains: word } },
                  { name: { contains: word } },
                  { description: { contains: word } },
                  { ownerName: { contains: word } },
                  { scheduleRef: { contains: word } },
                  { entries: { some: { document: { docNumber: { contains: word } } } } },
                  { entries: { some: { document: { title: { contains: word } } } } },
                ],
              })),
            })),
          }]
        : []),
    ],
  };

  // What the window holds, and what the schedule holds: a plan that says "of
  // 16" while the table says 33 is a page arguing with itself.
  const outsideWindow: Prisma.ActionWhereInput = { AND: (where.AND as Prisma.ActionWhereInput[]).filter((one) => !("scheduledDate" in one)) };
  const [matching, everywhere, actions, publishedVersion, draftCount, disciplineRows, typeRows, supplierRows, inUse] = await Promise.all([
    db.action.count({ where }),
    windowed ? db.action.count({ where: outsideWindow }) : Promise.resolve(0),
    db.action.findMany({
      where,
      orderBy,
      // The table pages through them; the plan draws as many as it has been
      // asked for, and offers to draw more.
      ...(view === "table" ? { skip: (page - 1) * perPage, take: perPage } : { take: shown }),
      include: {
        confirmations: true,
        entries: { include: { document: { include: { revisions: countingRevision(reading) } } } },
      },
    }),
    db.scheduleVersion.findFirst({ where: { status: "PUBLISHED" }, orderBy: { publishedAt: "desc" } }),
    db.scheduleVersion.count({ where: { status: "DRAFT" } }),
    db.configValue.findMany({ where: { setKey: "DISCIPLINES" }, select: { code: true, label: true } }),
    db.configValue.findMany({ where: { setKey: "DOCUMENT_TYPES" }, select: { code: true, label: true } }),
    db.configValue.findMany({ where: { setKey: "SUPPLIER_CODES" }, select: { code: true, label: true } }),
    db.action.findMany({ orderBy: [{ scheduledDate: "asc" }, { code: "asc" }], select: { code: true, name: true, departments: true } }),
  ]);

  const deptLabel = new Map(disciplineRows.map((one) => [one.code, one.label]));
  const rows = actions.map((action) => {
    const total = action.entries.length;
    const missing = action.entries.filter((entry) => !meetsRequirement(entry.document.revisions, entry.requiredStatus));
    const ready = total - missing.length;
    const daysUntil = action.scheduledDate ? Math.ceil((action.scheduledDate.getTime() - Date.now()) / 86_400_000) : null;
    const firstNeeded = action.entries.map((one) => one.requiredBy).filter(Boolean).sort((a, b) => a!.getTime() - b!.getTime())[0] ?? null;
    // The next document still owed — what a controller chases first.
    const nextNeeded = missing.map((one) => one.requiredBy).filter(Boolean).sort((a, b) => a!.getTime() - b!.getTime())[0] ?? null;
    // Four states, and they are not degrees of the same thing: nothing missing,
    // the day has passed, a document is already owed or nearly owed, and the
    // ordinary case of work that is simply still ahead.
    let readiness: Readiness = "UNKNOWN";
    if (total > 0 && missing.length === 0) readiness = daysUntil !== null && daysUntil < 0 ? "DONE" : "READY";
    else if (total > 0 && daysUntil !== null && daysUntil < 0) readiness = "NOT_READY";
    else if (total > 0 && nextNeeded && nextNeeded.getTime() - Date.now() <= RISK_DAYS * 86_400_000) readiness = "AT_RISK";
    else if (total > 0) readiness = "UPCOMING";
    return { ...action, total, ready, missing, daysUntil, readiness, firstNeeded, nextNeeded };
  });

  // The first time an action shows as at risk, its disciplines are told once,
  // by the system. Done after the page is served so nothing waits on it.
  const newlyAtRisk = rows.filter((row) => (row.readiness === "AT_RISK" || row.readiness === "NOT_READY") && !row.riskNotifiedAt);
  if (newlyAtRisk.length && ctx.can("CONTROL")) after(() => warnOnceAtRisk(ctx, newlyAtRisk));

  const tableRows: PlanTableRow[] = rows.map((row) => {
    const clear = clearance(row);
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      owner: row.ownerName,
      departments: departmentsOf(row).map((one) => deptLabel.get(one) ?? one),
      date: row.scheduledDate ? fmtDate(row.scheduledDate) : null,
      when: datePhrase(row.daysUntil),
      late: row.daysUntil !== null && row.daysUntil < 0,
      readiness: row.readiness,
      ready: row.ready,
      total: row.total,
      nextNeeded: row.nextNeeded ? fmtDate(row.nextNeeded) : null,
      nextOverdue: !!row.nextNeeded && row.nextNeeded.getTime() < Date.now(),
      missing: row.missing.map((one) => ({ docNumber: one.document.docNumber, status: one.requiredStatus })),
      confirmed: !clear.depts.length
        ? "—"
        : clear.cleared
          ? "Cleared"
          : `${clear.confirmed.length} of ${clear.depts.length}${clear.short.length ? ` · ${clear.short.join(", ")} short` : ""}`,
      confirmedTone: !clear.depts.length ? "plain" : clear.cleared ? "good" : clear.short.length ? "bad" : "plain",
    };
  });

  /** The same question, another page or another order of it. */
  const query = new URLSearchParams();
  // Which view is being read is part of the question: paging, sorting and
  // changing the row count must not drop somebody back onto the plan.
  if (view === "table") query.set("view", "table");
  if (sp.all === "1" && view === "plan") query.set("all", "1");
  if (q) query.set("q", q);
  if (code) query.set("code", code);
  if (state) query.set("state", state);
  if (discipline) query.set("discipline", discipline);
  if (docType) query.set("docType", docType);
  if (supplier) query.set("supplier", supplier);
  if (dateOn) query.set("on", dateOn);
  if (sp.from) query.set("from", sp.from);
  if (sp.to) query.set("to", sp.to);
  if (sp.sort && SORTS[sp.sort]) { query.set("sort", sp.sort); query.set("dir", dir); }
  if (perPage !== 50) query.set("per", String(perPage));
  if (step !== PLAN_STEPS[0]) query.set("step", String(step));

  /** The address this question makes without one of its answers. */
  const drop = (key: keyof Search) => {
    const params = new URLSearchParams(query);
    params.delete(key);
    if (key === "on") { params.delete("from"); params.delete("to"); }
    if (view === "table") params.set("view", "table");
    params.delete("page");
    return `/actions${params.size ? `?${params}` : ""}`;
  };
  const said = (options: { code: string; label: string }[], value: string) => options.find((one) => one.code === value)?.label ?? value;

  const facets: { key: string; label: string; without: string }[] = [];
  if (q) facets.push({ key: "search", label: q, without: drop("q") });
  if (code) facets.push({ key: "action", label: code, without: drop("code") });
  if (state) facets.push({ key: "state", label: said(STATES, state), without: drop("state") });
  if (discipline) facets.push({ key: "discipline", label: said(disciplineRows, discipline), without: drop("discipline") });
  if (docType) facets.push({ key: "type", label: said(typeRows, docType), without: drop("docType") });
  if (supplier) facets.push({ key: "supplier", label: said(supplierRows, supplier), without: drop("supplier") });
  if (fromDay || toDay) {
    facets.push({
      key: "date",
      label: sp.from && sp.to && sp.from !== sp.to ? `${sp.from} → ${sp.to}` : sp.from ?? sp.to ?? "",
      without: drop("on"),
    });
  }

  const pages = Math.max(1, Math.ceil(matching / perPage));

  /** The same plan, drawn deeper — by however many the reader asked for. */
  const deeper = (by: number) => {
    const params = new URLSearchParams(query);
    params.set("show", String(shown + by));
    if (by !== PLAN_STEPS[0]) params.set("step", String(by));
    else params.delete("step");
    return `/actions?${params}`;
  };

  /**
   * The window the plan opens on. It is not a filter — Clear all must not be
   * able to remove it and then have it come straight back — so it is said in
   * the plan's own footer, with the way out of it beside it.
   */
  const wideParams = new URLSearchParams(query);
  wideParams.set("all", "1");
  const narrowParams = new URLSearchParams(query);
  narrowParams.delete("all");
  const planWindow = windowed && planFrom && planTo
    ? {
        label: `${fmtDate(planFrom)} → ${fmtDate(planTo)}`,
        href: `/actions?${wideParams}`,
        wide: false,
        // How many the window leaves out, said as a number rather than implied.
        elsewhere: Math.max(everywhere - matching, 0),
      }
    : sp.all === "1" && view === "plan" && !fromDay && !toDay
      ? { label: "every date", href: `/actions${narrowParams.size ? `?${narrowParams}` : ""}`, wide: true, elsewhere: 0 }
      : null;

  return (
    <div>
      <PlanRegister
        plate={
          <PlanPlate
            inForceSince={publishedVersion ? fmtDate(publishedVersion.publishedAt) : null}
            drafts={draftCount}
          />
        }
        uploads={<PlanCards />}
        cardHeight={PLAN_FIRST * PLAN_ROW + CARD_CHROME}
        view={view}
        more={
          view === "plan"
            ? {
                shown: rows.length,
                total: matching,
                step,
                steps: PLAN_STEPS.map((by) => ({ by, href: deeper(by) })),
                href: matching > rows.length ? deeper(step) : null,
                window: planWindow,
              }
            : undefined
        }
        plan={
          <PlanTimeline
            rows={rows.map((row) => ({ code: row.code, name: row.name, scheduledDate: row.scheduledDate, firstNeeded: row.firstNeeded, readiness: row.readiness, ready: row.ready, total: row.total }))}
            window={planFrom && planTo ? { from: planFrom, to: planTo } : undefined}
            fit={PLAN_FIRST}
          />
        }
        rows={tableRows}
        total={matching}
        filters={{ q, state, discipline, docType, supplier, code, on: dateOn, from: sp.from ?? "", to: sp.to ?? "" }}
        filterOptions={{
          states: STATES,
          disciplines: disciplineRows.map((one) => ({ code: one.code, label: one.label })),
          types: typeRows.map((one) => ({ code: one.code, label: one.label })),
          suppliers: supplierRows.map((one) => ({ code: one.code, label: one.label })),
          codes: inUse.map((one) => ({ code: one.code, label: `${one.code} — ${one.name}` })),
          dateFields: DATE_FIELDS,
        }}
        facets={facets}
        paging={{
          page, pages, perPage, sizes: PAGE_SIZES,
          from: matching ? (page - 1) * perPage + 1 : 0,
          to: Math.min(page * perPage, matching),
          query: query.toString(),
        }}
        sort={sp.sort && SORTS[sp.sort] ? { key: sortKey, dir } : undefined}
        exportHref={`/api/export/baseline${query.size ? `?${query}` : ""}`}
      />
    </div>
  );
}

function datePhrase(days: number | null) {
  if (days === null) return "No date from the schedule";
  if (days === 0) return "Today";
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
  return `${days} day${days === 1 ? "" : "s"} to go`;
}
