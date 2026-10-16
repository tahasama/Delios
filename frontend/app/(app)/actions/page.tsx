import { requireScope } from "@/lib/core/scope";
import { departmentsOf, daysBefore } from "@/lib/actions/schedule";
import { getActiveSet } from "@/lib/settings/config";
import { mayUploadLists } from "@/lib/core/permissions";
import { clearance } from "@/lib/actions/requirements-process";
import { readSearch, readDay } from "@/lib/documents/register-query";
import { PLAN_CARD_HEIGHT, PLAN_FIRST } from "@/lib/actions/plan-card";
import { ACTION_STATES, isPostponed } from "@/lib/actions/action-state";
import { fmtDate } from "@/lib/core/utils";
import { getSet } from "@/lib/settings/config";
import { api } from "@/lib/client";
import { backendDocument } from "@/lib/documents/api";
import { planActions, scheduleSource, type PlanAction } from "@/lib/actions/api";
import { PlanCards } from "./plan-cards";
import { PlanPlate } from "./plan-plate";
import { PlanTimeline } from "./plan-timeline";
import { movedPhrase } from "./moved";
import { PlanRegister, type PlanTableRow } from "./plan-register";

export const dynamic = "force-dynamic";
export const metadata = { title: "Schedule" };

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
const byCode = (a: PlanAction, b: PlanAction) => a.code.localeCompare(b.code);
const SORTS: Record<string, (a: PlanAction, b: PlanAction) => number> = {
  code: byCode,
  name: (a, b) => a.name.localeCompare(b.name),
  date: (a, b) => (a.start?.getTime() ?? Infinity) - (b.start?.getTime() ?? Infinity) || byCode(a, b),
  documents: (a, b) => a.needs.length - b.needs.length || byCode(a, b),
};

/** The states, said once for the schedule and the action's own page alike. */
const STATES = ACTION_STATES;

/**
 * What became of the work, as against whether its documents arrived.
 *
 * The day passes and the work is taken to have happened — that is what a
 * schedule is — unless the control function wrote down that it was postponed. So
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
  // Everyone reads this page; the backend narrows another organization's to the actions needing its documents.
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
  const orderBy = (a: PlanAction, b: PlanAction) => (dir === "desc" ? -1 : 1) * SORTS[sortKey](a, b);

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
  const met = (action: PlanAction) => action.needs.filter((entry) => entry.state === "MET").length;
  const shortOfWhatItNeeds = (action: PlanAction) => met(action) !== action.needs.length;
  const afterTheDay = (action: PlanAction) => !!action.lastMetAt && !!action.start && action.lastMetAt > action.start;

  // The work happened without everything it needed: its day has passed and, on
  // that day, either something was still missing or the last of it had not yet
  // arrived. Both readings of "short on the day", in one clause.
  const shortOnTheDay = (a: PlanAction) => a.needs.length > 0 && a.passed && (shortOfWhatItNeeds(a) || afterTheDay(a));
  // Postponed: a decision of the organization's that does not proceed, not taken back.
  const postponeCodes = (await getActiveSet("ACTIVITY_DECISIONS")).filter((one) => one.props.proceeds !== true).map((one) => one.code);
  const postponed = (a: PlanAction) => isPostponed(a, postponeCodes);
  // Went ahead? Once its day has passed: with its documents, with documents
  // missing, or not at all because the control function postponed it.
  const HAPPENED_WHERE: Record<string, (action: PlanAction) => boolean> = {
    WITH: (a) => a.needs.length > 0 && a.passed && !shortOnTheDay(a) && !postponed(a),
    WITHOUT: (a) => shortOnTheDay(a) && !postponed(a),
    STOPPED: (a) => postponed(a),
  };

  const has = (text: string | null | undefined, word: string) => !!text && text.toLowerCase().includes(word.toLowerCase());
  const inWindow = (a: PlanAction) =>
    !(planFrom || planTo) || (!!a.start && (!planFrom || a.start >= planFrom) && (!planTo || a.start <= planTo));
  const outsideWindow = (a: PlanAction) =>
    (!code || a.code === code)
    && (!state || a.state === state)
    && (!happened || HAPPENED_WHERE[happened](a))
    && (sp.nodate !== "1" || !a.start)
    && (sp.untagged !== "1" || departmentsOf(a).length === 0)
    // A discipline is what an action is tagged with and what a document
    // belongs to — the same list, so the filter answers for both.
    && (!discipline || departmentsOf(a).includes(discipline) || a.needs.some((e) => e.document.discipline === discipline))
    // Type and supplier are facts about the documents an action needs, so an
    // action matches when one of its documents does.
    && (!(docType || supplier) || a.needs.some((e) => (!docType || e.document.docType === docType) && (!supplier || e.document.originator === supplier)))
    // A space narrows, a comma widens: every word of a part must be found
    // somewhere on the action, and any part may be the one that matches.
    && (!searches.length || searches.some((search) => search.words.every((word) =>
      has(a.code, word) || has(a.name, word) || has(a.externalId, word)
      || a.needs.some((e) => has(e.document.number, word) || has(e.document.title, word)))));
  const where = (a: PlanAction) => outsideWindow(a) && inWindow(a);

  // What the window holds, and what the schedule holds: a plan that says "of
  // 16" while the table says 33 is a page arguing with itself.
  const [schedule, source, disciplineRows, typeRows, supplierRows] = await Promise.all([
    planActions(ctx),
    scheduleSource(ctx),
    getSet("DISCIPLINES"),
    getSet("DOCUMENT_TYPES"),
    // Suppliers are the organizations the project deals with.
    api<{ code: string; name: string }[]>("/api/parties").then((rows) => rows.map((one) => ({ code: one.code, label: one.name }))).catch(() => []),
  ]);
  // How near a missing document's date must be to put its action at risk is the
  // project's setting, the same one the late warnings use.
  const found = schedule.filter(where).sort(orderBy);
  const matching = found.length;
  // Undated actions have no place in a window of days: they are counted on
  // their own, every time, so they never quietly drop out of the plan.
  const allMatching = schedule.filter(outsideWindow);
  const undatedAll = allMatching.filter((one) => !one.start).length;
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
    const total = action.needs.length;
    const missing = action.needs.filter((entry) => entry.state !== "MET");
    const ready = total - missing.length;
    const daysUntil = action.start ? Math.ceil((action.start.getTime() - Date.now()) / 86_400_000) : null;
    const firstNeeded = action.needs.map((one) => one.neededBy).filter(Boolean).sort((a, b) => a!.getTime() - b!.getTime())[0] ?? null;
    // The next document still owed — what a controller chases first.
    const nextNeeded = missing.map((one) => one.neededBy).filter(Boolean).sort((a, b) => a!.getTime() - b!.getTime())[0] ?? null;
    const readiness: Readiness = action.state;
    // What became of the work, which is not the same question as whether its
    // documents arrived. The day passing is the work happening; only Document
    // Control saying it was postponed takes that back.
    const passed = action.passed;
    const shortOnTheDay = missing.length > 0
      || (!!action.lastMetAt && !!action.start && action.lastMetAt > action.start);
    const happened: Happened = postponed(action)
      ? "POSTPONED"
      : !passed
        ? "AHEAD"
        : shortOnTheDay ? "CARRIED" : "DONE";
    return { ...action, total, ready, missing, daysUntil, readiness, firstNeeded, nextNeeded, happened };
  });

  const tableRows: PlanTableRow[] = rows.map((row) => {
    const clear = clearance(row);
    return {
      id: row.id,
      code: row.code,
      plannerId: row.externalId && row.externalId !== row.code ? row.externalId : null,
      moved: movedPhrase(row.moved, row.start, row.finish),
      name: row.name,
      departments: departmentsOf(row).map((one) => deptLabel.get(one) ?? one),
      date: row.start ? fmtDate(row.start) : null,
      finish: row.finish && row.start && row.finish > row.start ? fmtDate(row.finish) : null,
      // When, and how long: start and finish both count, so work on the 12th and 13th lasts two days. Said once.
      when: datePhrase(row.daysUntil, row.finish && row.start ? Math.round((row.finish.getTime() - row.start.getTime()) / 86_400_000) + 1 : null),
      late: row.daysUntil !== null && row.daysUntil < 0,
      readiness: row.readiness,
      ready: row.ready,
      total: row.total,
      nextNeeded: row.nextNeeded ? fmtDate(row.nextNeeded) : null,
      nextOverdue: !!row.nextNeeded && row.nextNeeded.getTime() < Date.now(),
      missing: row.missing.map((one) => ({ docNumber: one.document.number, status: one.requiredStatus })),
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
            plans={mayUploadLists(ctx.user.verbs)}
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
            rows={rows.map((row) => ({ code: row.code, name: row.name, moved: movedPhrase(row.moved, row.start, row.finish), start: row.start, finish: row.finish, firstNeeded: row.firstNeeded, readiness: row.readiness, ready: row.ready, total: row.total }))}
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

/**
 * When the action is, from today, and how long it lasts: "40 days ago · lasted
 * 3 days", "Today · lasts 3 days", "In 5 days · lasts 3 days". A past day is
 * not "overdue": the work is taken to have happened unless it was postponed.
 */
function datePhrase(days: number | null, lasts: number | null) {
  if (days === null) return "No date from the schedule";
  const plural = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
  const when = days === 0 ? "Today" : days < 0 ? `${plural(Math.abs(days))} ago` : `In ${plural(days)}`;
  return lasts && lasts > 1 ? `${when} · ${days < 0 ? "lasted" : "lasts"} ${plural(lasts)}` : when;
}
