import { requireScope } from "@/lib/scope";
import { departmentsOf, daysBefore } from "@/lib/schedule";
import { clearance } from "@/lib/requirements-process";
import { readSearch, readDay } from "@/lib/register-query";
import { PLAN_CARD_HEIGHT, PLAN_FIRST } from "@/lib/plan-card";
import { meetsRequirement } from "@/lib/readiness";
import { ACTION_STATES, DEFAULT_RISK_DAYS, actionState, dayHasPassed } from "@/lib/action-state";
import { fmtDate } from "@/lib/utils";
import { getSet } from "@/lib/config";
import { api } from "@/lib/api/client";
import { backendDocument } from "@/lib/api/legacy";
import { legacyActions, scheduleSource, type LegacyAction } from "@/lib/api/schedule";
import { after } from "next/server";
import { warnOnceAtRisk } from "@/lib/risk-notice";
import { PlanCards } from "./plan-cards";
import { PlanPlate } from "./plan-plate";
import { PlanTimeline } from "./plan-timeline";
import { movedPhrase } from "./moved";
import { PlanRegister, type PlanTableRow } from "./plan-register";

export const dynamic = "force-dynamic";
export const metadata = { title: "Schedule & actions" };

type Readiness = PlanTableRow["readiness"];

/** What became of the work, as against whether its documents arrived. */
type Happened = "POSTPONED" | "CARRIED" | "DONE" | "AHEAD";

type Search = {
  view?: string; all?: string; q?: string; state?: string; happened?: string; nodate?: string; untagged?: string; discipline?: string; docType?: string; supplier?: string;
  code?: string; on?: string; from?: string; to?: string;
  sort?: string; dir?: string; page?: string; per?: string; show?: string; step?: string;
};

const PAGE_SIZES = [25, 50, 100, 200];

/** The only date an action has, so the window asks about it without asking which. */
const DATE_FIELDS = [{ code: "date", label: "Action date" }];

/** Ordered by a column, ascending; an action with no date comes last. */
const byCode = (a: LegacyAction, b: LegacyAction) => a.code.localeCompare(b.code);
const SORTS: Record<string, (a: LegacyAction, b: LegacyAction) => number> = {
  code: byCode,
  name: (a, b) => a.name.localeCompare(b.name),
  date: (a, b) => (a.scheduledDate?.getTime() ?? Infinity) - (b.scheduledDate?.getTime() ?? Infinity) || byCode(a, b),
  documents: (a, b) => a.entries.length - b.entries.length || byCode(a, b),
};

/** The states, said once for the schedule and the action's own page alike. */
const STATES = ACTION_STATES;

/**
 * What became of the work, as against whether its documents arrived.
 *
 * The day passes and the work is taken to have happened — that is what a
 * schedule is — unless Document Control wrote down that it was postponed. So
 * this asks the question the state cannot: which activities went ahead short of
 * what they needed, and of those, which were owned and which were never
 * written down at all.
 */
const HAPPENED = [
  { code: "WITH", label: "With documents" },
  { code: "WITHOUT", label: "Missing documents" },
  { code: "STOPPED", label: "Postponed" },
];

/** How many days either side of today the plan shows when nobody says otherwise. */
const PLAN_WINDOW_DAYS = 30;

/** How many more the plan draws at a time — the reader's choice, like rows. */
const PLAN_STEPS = [5, 10, 25, 50, 100];
/** How many more the plan draws at a press, unless the reader chose another step. */
const DEFAULT_STEP = 25;

export default async function ActionsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireScope();
  const sp = await searchParams;
  const view = sp.view === "table" ? "table" : "plan";

  const q = (sp.q ?? "").trim().slice(0, 200);
  const searches = readSearch(q);
  const state = STATES.some((one) => one.code === sp.state) ? sp.state! : "";
  const happened = HAPPENED.some((one) => one.code === sp.happened) ? sp.happened! : "";
  const discipline = (sp.discipline ?? "").trim();
  const docType = (sp.docType ?? "").trim();
  const supplier = (sp.supplier ?? "").trim();
  const code = (sp.code ?? "").trim();
  const dateOn = sp.on === "date" || (!sp.on && (sp.from || sp.to)) ? "date" : "";
  const fromDay = readDay(sp.from, false);
  const toDay = readDay(sp.to ?? sp.from, true);

  const sortKey = sp.sort && SORTS[sp.sort] ? sp.sort : "date";
  const dir = sp.dir === "desc" ? "desc" : "asc";
  const orderBy = (a: LegacyAction, b: LegacyAction) => (dir === "desc" ? -1 : 1) * SORTS[sortKey](a, b);

  const perPage = PAGE_SIZES.includes(Number(sp.per)) ? Number(sp.per) : 50;
  const page = Math.max(1, Number(sp.page) || 1);
  // Never more than asked for, and never a page that loads the whole schedule
  // because somebody typed a number into the address.
  const shown = Math.min(Math.max(Number(sp.show) || PLAN_FIRST, PLAN_FIRST), 2000);
  const step = PLAN_STEPS.includes(Number(sp.step)) ? Number(sp.step) : DEFAULT_STEP;

  // The plan is naturally long, so it opens on a window around today — one month
  // either side, today in the middle — until somebody asks for another.
  const windowed = !fromDay && !toDay && view === "plan" && sp.all !== "1";
  const planFrom = fromDay ?? (windowed ? daysBefore(new Date(), PLAN_WINDOW_DAYS) : null);
  const planTo = toDay ?? (windowed ? daysBefore(new Date(), -PLAN_WINDOW_DAYS) : null);

  // Where each action stands is one rule, shared with the action's own page;
  // the schedule is read whole and filtered here.
  const met = (action: LegacyAction) => action.entries.filter((entry) => meetsRequirement(entry.document.revisions, entry.requiredStatus)).length;
  const shortOfWhatItNeeds = (action: LegacyAction) => met(action) !== action.entries.length;
  const afterTheDay = (action: LegacyAction) => !!action.lastMetAt && !!action.scheduledDate && action.lastMetAt > action.scheduledDate;

  // The work happened without everything it needed: its day has passed and, on
  // that day, either something was still missing or the last of it had not yet
  // arrived. Both readings of "short on the day", in one clause.
  const shortOnTheDay = (a: LegacyAction) => a.entries.length > 0 && dayHasPassed(a) && (shortOfWhatItNeeds(a) || afterTheDay(a));
  const decided = (a: LegacyAction, decision: string) => a.notes.some((note) => note.decision === decision);
  // Went ahead? Once its day has passed: with its documents, with documents
  // missing, or not at all because Document Control postponed it.
  const HAPPENED_WHERE: Record<string, (action: LegacyAction) => boolean> = {
    WITH: (a) => a.entries.length > 0 && dayHasPassed(a) && !shortOnTheDay(a) && !decided(a, "STOPPED"),
    WITHOUT: (a) => shortOnTheDay(a) && !decided(a, "STOPPED"),
    STOPPED: (a) => decided(a, "STOPPED"),
  };

  const has = (text: string | null | undefined, word: string) => !!text && text.toLowerCase().includes(word.toLowerCase());
  const inWindow = (a: LegacyAction) =>
    !(planFrom || planTo) || (!!a.scheduledDate && (!planFrom || a.scheduledDate >= planFrom) && (!planTo || a.scheduledDate <= planTo));
  const outsideWindow = (a: LegacyAction) =>
    (!code || a.code === code)
    && (!state || actionState(a, riskDays) === state)
    && (!happened || HAPPENED_WHERE[happened](a))
    && (sp.nodate !== "1" || !a.scheduledDate)
    && (sp.untagged !== "1" || departmentsOf(a).length === 0)
    // A discipline is what an action is tagged with and what a document
    // belongs to — the same list, so the filter answers for both.
    && (!discipline || departmentsOf(a).includes(discipline) || a.entries.some((e) => e.document.discipline === discipline))
    // Type and supplier are facts about the documents an action needs, so an
    // action matches when one of its documents does.
    && (!(docType || supplier) || a.entries.some((e) => (!docType || e.document.docType === docType) && (!supplier || e.document.originator === supplier)))
    // A space narrows, a comma widens: every word of a part must be found
    // somewhere on the action, and any part may be the one that matches.
    && (!searches.length || searches.some((search) => search.words.every((word) =>
      has(a.code, word) || has(a.name, word) || has(a.description, word) || has(a.scheduleRef, word)
      || a.entries.some((e) => has(e.document.docNumber, word) || has(e.document.title, word)))));
  const where = (a: LegacyAction) => outsideWindow(a) && inWindow(a);

  // What the window holds, and what the schedule holds: a plan that says "of
  // 16" while the table says 33 is a page arguing with itself.
  const [schedule, source, disciplineRows, typeRows, supplierRows] = await Promise.all([
    legacyActions(ctx),
    scheduleSource(ctx),
    getSet("DISCIPLINES"),
    getSet("DOCUMENT_TYPES"),
    // Suppliers are the organizations the project deals with.
    api<{ code: string; name: string }[]>("/api/parties").then((rows) => rows.map((one) => ({ code: one.code, label: one.name }))).catch(() => []),
  ]);
  // How near a missing document's date must be to put its action at risk is the
  // project's setting, the same one the late warnings use.
  const riskDays = source.source?.riskWindowDays ?? DEFAULT_RISK_DAYS;
  const found = schedule.filter(where).sort(orderBy);
  const matching = found.length;
  // Undated actions have no place in a window of days: they are counted on
  // their own, every time, so they never quietly drop out of the plan.
  const allMatching = schedule.filter(outsideWindow);
  const undatedAll = allMatching.filter((one) => !one.scheduledDate).length;
  const everywhere = windowed ? allMatching.length : 0;
  // The table pages through them; the plan draws as many as it has been asked
  // for, and offers to draw more.
  const actions = view === "table" ? found.slice((page - 1) * perPage, page * perPage) : found.slice(0, shown);
  // The schedule in force: the latest read of the schedule document, in force
  // since its revision was released. Reads are not held for a decision.
  const latest = source.imports.find((one) => one.status === "DONE") ?? null;
  const releasedAt = latest && source.source
    ? (await backendDocument(ctx, source.source.documentId))?.revisions.find((one) => one.id === latest.revisionId)?.releasedAt ?? null
    : null;
  const publishedVersion = latest ? { publishedAt: releasedAt ? new Date(releasedAt) : null } : null;
  const inUse = [...schedule].sort(SORTS.date);

  const deptLabel = new Map(disciplineRows.map((one) => [one.code, one.label]));
  const rows = actions.map((action) => {
    const total = action.entries.length;
    const missing = action.entries.filter((entry) => !meetsRequirement(entry.document.revisions, entry.requiredStatus));
    const ready = total - missing.length;
    const daysUntil = action.scheduledDate ? Math.ceil((action.scheduledDate.getTime() - Date.now()) / 86_400_000) : null;
    const firstNeeded = action.entries.map((one) => one.requiredBy).filter(Boolean).sort((a, b) => a!.getTime() - b!.getTime())[0] ?? null;
    // The next document still owed — what a controller chases first.
    const nextNeeded = missing.map((one) => one.requiredBy).filter(Boolean).sort((a, b) => a!.getTime() - b!.getTime())[0] ?? null;
    const readiness: Readiness = actionState(action, riskDays);
    // What became of the work, which is not the same question as whether its
    // documents arrived. The day passing is the work happening; only Document
    // Control saying it was postponed takes that back.
    const passed = dayHasPassed(action);
    const shortOnTheDay = missing.length > 0
      || (!!action.lastMetAt && !!action.scheduledDate && action.lastMetAt > action.scheduledDate);
    const happened: Happened = action.notes.some((note) => note.decision === "STOPPED")
      ? "POSTPONED"
      : !passed
        ? "AHEAD"
        : shortOnTheDay ? "CARRIED" : "DONE";
    return { ...action, total, ready, missing, daysUntil, readiness, firstNeeded, nextNeeded, happened };
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
      plannerId: row.scheduleRef && row.scheduleRef !== row.code ? row.scheduleRef : null,
      moved: movedPhrase(row.moved, row.scheduledDate, row.finishDate),
      name: row.name,
      departments: departmentsOf(row).map((one) => deptLabel.get(one) ?? one),
      date: row.scheduledDate ? fmtDate(row.scheduledDate) : null,
      finish: row.finishDate && row.scheduledDate && row.finishDate > row.scheduledDate ? fmtDate(row.finishDate) : null,
      // Start and finish both count: work on the 12th and 13th lasts two days.
      days: row.finishDate && row.scheduledDate ? Math.round((row.finishDate.getTime() - row.scheduledDate.getTime()) / 86_400_000) + 1 : null,
      when: datePhrase(row.daysUntil),
      late: row.daysUntil !== null && row.daysUntil < 0,
      readiness: row.readiness,
      ready: row.ready,
      total: row.total,
      nextNeeded: row.nextNeeded ? fmtDate(row.nextNeeded) : null,
      nextOverdue: !!row.nextNeeded && row.nextNeeded.getTime() < Date.now(),
      missing: row.missing.map((one) => ({ docNumber: one.document.docNumber, status: one.requiredStatus })),
      happened: row.happened,
      // The stamp under the word: what the documents were on the day.
      happenedNote: !row.total
        ? "nothing listed"
        : row.happened === "POSTPONED"
          ? (row.missing.length ? `${row.missing.length} of ${row.total} missing` : "every document was there")
          : row.happened === "CARRIED"
            ? (row.missing.length ? `without ${row.missing.length} of ${row.total}` : `the last of ${row.total} arrived after the day`)
            : row.happened === "DONE"
              ? `all ${row.total} documents`
              : `${row.ready} of ${row.total} ready`,
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
  if (happened) query.set("happened", happened);
  if (sp.nodate === "1") query.set("nodate", "1");
  if (sp.untagged === "1") query.set("untagged", "1");
  if (discipline) query.set("discipline", discipline);
  if (docType) query.set("docType", docType);
  if (supplier) query.set("supplier", supplier);
  if (dateOn) query.set("on", dateOn);
  if (sp.from) query.set("from", sp.from);
  if (sp.to) query.set("to", sp.to);
  if (sp.sort && SORTS[sp.sort]) { query.set("sort", sp.sort); query.set("dir", dir); }
  if (perPage !== 50) query.set("per", String(perPage));
  if (step !== DEFAULT_STEP) query.set("step", String(step));

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
  if (happened) facets.push({ key: "went ahead?", label: said(HAPPENED, happened), without: drop("happened") });
  if (sp.nodate === "1") facets.push({ key: "date", label: "none", without: drop("nodate") });
  if (sp.untagged === "1") facets.push({ key: "disciplines", label: "not tagged", without: drop("untagged") });
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
    if (by !== DEFAULT_STEP) params.set("step", String(by));
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
        elsewhere: Math.max(everywhere - matching - undatedAll, 0),
      }
    : sp.all === "1" && view === "plan" && !fromDay && !toDay
      ? { label: "every date", href: `/actions${narrowParams.size ? `?${narrowParams}` : ""}`, wide: true, elsewhere: 0 }
      : null;

  return (
    <div>
      <PlanRegister
        plate={
          <PlanPlate
            inForce={publishedVersion ? { since: publishedVersion.publishedAt ? fmtDate(publishedVersion.publishedAt) : null } : null}
            plans={ctx.can("PLAN") || ctx.can("CONTROL") || ctx.can("CONFIGURE")}
            failed={source.imports[0]?.status === "FAILED" ? { revision: source.imports[0].revisionValue, error: source.imports[0].error } : null}
          />
        }
        uploads={<PlanCards from={dateOn === "date" ? fromDay : null} to={dateOn === "date" ? toDay : null} />}
        cardHeight={PLAN_CARD_HEIGHT}
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
                undated: undatedAll,
                undatedHref: "/actions?view=table&nodate=1",
                // Went ahead with documents missing, across every date, opened on every date.
                noNote: { count: schedule.filter(HAPPENED_WHERE.WITHOUT).length, href: "/actions?happened=WITHOUT&all=1" },
              }
            : undefined
        }
        plan={
          <PlanTimeline
            rows={rows.map((row) => ({ code: row.code, name: row.name, moved: movedPhrase(row.moved, row.scheduledDate, row.finishDate), scheduledDate: row.scheduledDate, finishDate: row.finishDate, firstNeeded: row.firstNeeded, readiness: row.readiness, ready: row.ready, total: row.total }))}
            window={planFrom && planTo ? { from: planFrom, to: planTo } : undefined}
            fit={PLAN_FIRST}
          />
        }
        rows={tableRows}
        total={matching}
        filters={{ q, state, happened, discipline, docType, supplier, code, on: dateOn, from: sp.from ?? "", to: sp.to ?? "" }}
        filterOptions={{
          states: STATES,
          happened: HAPPENED,
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
