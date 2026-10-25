import { requireScope } from "@/lib/core/scope";
import { shownFilters as keptFilters } from "@/lib/core/filter-choice";
import { setGrouping } from "@/lib/settings/in-sets";
import { departmentsOf, daysBefore } from "@/lib/actions/schedule";
import { getActiveSet } from "@/lib/settings/config";
import { mayUploadLists } from "@/lib/core/permissions";
import { clearance } from "@/lib/actions/requirements-process";
import { readDay } from "@/lib/documents/register-query";
import { PLAN_CARD_HEIGHT, PLAN_FIRST } from "@/lib/actions/plan-card";
import { ACTION_STATES, isPostponed } from "@/lib/actions/action-state";
import { fmtDate } from "@/lib/core/utils";
import { getSet } from "@/lib/settings/config";
import { api } from "@/lib/client";
import { backendDocument } from "@/lib/documents/api";
import { planPage, scheduleSource, type PlanAction } from "@/lib/actions/api";
import { PlanCards } from "@/app/(app)/actions/plan-cards";
import { PlanPlate } from "@/app/(app)/actions/plan-plate";
import { PlanTimeline } from "@/app/(app)/actions/plan-timeline";
import { movedPhrase } from "@/app/(app)/actions/moved";
import { PlanRegister, type PlanTableRow } from "@/app/(app)/actions/plan-register";
import { cookies } from "next/headers";
import { PREF, calendarDay } from "@/lib/core/preferences";
import { MonthsCalendar } from "@/components/calendar";
import { projectCalendar } from "@/lib/settings/calendar";
import { knownBetween } from "@/lib/settings/national-holidays";
import Link from "next/link";
import { SETUP_PAGES, maySetup } from "@/app/(app)/settings/setup-pages";

export const dynamic = "force-dynamic";
export const metadata = { title: "Schedule" };

type Readiness = PlanTableRow["readiness"];

/** What became of the work, as against whether its documents arrived. */
type Happened = "POSTPONED" | "CARRIED" | "DONE" | "NONE" | "AHEAD";

type Search = {
  view?: string; all?: string; q?: string; state?: string; happened?: string; nodate?: string; untagged?: string; discipline?: string; docType?: string; supplier?: string;
  code?: string; on?: string; from?: string; to?: string;
  sort?: string; dir?: string; page?: string; per?: string; show?: string; step?: string;
};

const PAGE_SIZES = [25, 50, 100, 200];

/** The only date an action has, so the window asks about it without asking which. */
const DATE_FIELDS = [{ code: "date", label: "Action date" }];

/** The columns the backend sorts by (`ScheduleEndpoints.PlanSorts`): code, name, date, documents, the planner's WBS order. */
const SORTS = new Set(["code", "name", "date", "documents", "wbs"]);

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
  { code: "NONE", label: "Went ahead, nothing listed" },
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
  // Three views of one answer (owner): the calendar, the plan (in the middle, the one shown first) and the table.
  const view = sp.view === "table" ? "table" : sp.view === "calendar" ? "calendar" : "plan";

  const q = (sp.q ?? "").trim().slice(0, 200);
  const state = STATES.some((one) => one.code === sp.state) ? sp.state! : "";
  const happened = HAPPENED.some((one) => one.code === sp.happened) ? sp.happened! : "";
  const discipline = (sp.discipline ?? "").trim();
  const docType = (sp.docType ?? "").trim();
  const supplier = (sp.supplier ?? "").trim();
  const code = (sp.code ?? "").trim();
  const dateOn = sp.on === "date" || (!sp.on && (sp.from || sp.to)) ? "date" : "";
  const fromDay = readDay(sp.from, false);
  const toDay = readDay(sp.to ?? sp.from, true);


  const perPage = PAGE_SIZES.includes(Number(sp.per)) ? Number(sp.per) : 50;
  const page = Math.max(1, Number(sp.page) || 1);
  // Never more than asked for, and never a page that loads the whole schedule
  // because somebody typed a number into the address.
  const shown = Math.min(Math.max(Number(sp.show) || PLAN_FIRST, PLAN_FIRST), 2000);
  const step = PLAN_STEPS.includes(Number(sp.step)) ? Number(sp.step) : DEFAULT_STEP;

  // The backend answers the whole question (owner: "you do not hit the full schedule"): the plan's first actions or the
  // table's page in full, and of every other action only what is counted (the window, the schedule's span, how many
  // match, how many have no date) — kept until something on the schedule changes.
  const [plan, source, disciplineRows, typeRows, supplierRows] = await Promise.all([
    planPage(ctx, {
      view, all: sp.all ?? null, q, state, happened, nodate: sp.nodate ?? null, untagged: sp.untagged ?? null,
      discipline, docType, supplier, code, from: sp.from ?? null, to: sp.to ?? null,
      sort: sp.sort && SORTS.has(sp.sort) ? sp.sort : null, dir: sp.dir ?? null, page, per: perPage, show: shown,
    }),
    scheduleSource(ctx),
    getSet("DISCIPLINES"),
    getSet("DOCUMENT_TYPES"),
    // Suppliers are the organizations the project deals with.
    api<{ code: string; name: string }[]>("/api/parties", { keep: { areas: [] } }).then((rows) => rows.map((one) => ({ code: one.code, label: one.name }))).catch(() => []),
  ]);

  // As the planner lays it out where the schedule carries a WBS (owner: "keep the category/sub"), else by date.
  const sortKey = plan.sort;
  const dir = plan.dir;
  // Where the schedule runs: its first action's day to its last's (owner: "deduce first month and last month").
  const span = plan.spanFrom && plan.spanTo ? { from: plan.spanFrom, to: plan.spanTo } : null;
  // The plan is naturally long, so it opens on a window around today — one month either side — until somebody asks
  // for another. A schedule that is over, or not begun, opens on its own last or first days instead (owner: "if a
  // project is over instead of pointing to today, point at last month").
  const windowed = !fromDay && !toDay && view === "plan" && sp.all !== "1";
  const planFrom = plan.windowFrom;
  const planTo = plan.windowTo;

  // Postponed: a decision of the organization's that does not proceed, not taken back.
  const postponeCodes = (await getActiveSet("ACTIVITY_DECISIONS")).filter((one) => one.props.proceeds !== true).map((one) => one.code);
  const postponed = (a: PlanAction) => isPostponed(a, postponeCodes);

  const matching = plan.matching;
  // Undated actions have no place in a window of days: they are counted on their own, every time, so they never
  // quietly drop out of the plan.
  const undatedAll = plan.undated;
  const everywhere = plan.everywhere;
  // The table's page, or as many as the plan has been asked to draw: only these came in full.
  const actions = plan.actions;
  // The schedule in force: the latest read of the schedule document, in force
  // since its revision was released. Reads are not held for a decision.
  const latest = source.imports.find((one) => one.status === "DONE") ?? null;
  const releasedAt = latest && source.source
    ? (await backendDocument(ctx, source.source.documentId))?.revisions.find((one) => one.id === latest.revisionId)?.releasedAt ?? null
    : null;
  const publishedVersion = latest ? { publishedAt: releasedAt ? new Date(releasedAt) : null } : null;

  const deptLabel = new Map(disciplineRows.map((one) => [one.code, one.label]));
  const rows = actions.map((action) => {
    const total = action.needs.length;
    const missing = action.needs.filter((entry) => entry.state !== "MET");
    const ready = total - missing.length;
    const daysUntil = action.start ? Math.ceil((action.start.getTime() - Date.now()) / 86_400_000) : null;
    // The plan's lead-in (owner): from when its documents are needed, even with none listed yet (the project's lead).
    const firstNeeded = action.neededFrom
      ?? action.needs.map((one) => one.neededBy).filter(Boolean).sort((a, b) => a!.getTime() - b!.getTime())[0] ?? null;
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
        // Nothing listed: it went ahead, but nothing says it had what it needed (never "with documents").
        : action.needs.length === 0 ? "NONE" : shortOnTheDay ? "CARRIED" : "DONE";
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
      startAchieved: row.startAchieved, finishAchieved: row.finishAchieved,
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
  if (view !== "plan") query.set("view", view);
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
  if (sp.sort && SORTS.has(sp.sort)) { query.set("sort", sp.sort); query.set("dir", dir); }
  if (perPage !== 50) query.set("per", String(perPage));
  if (step !== DEFAULT_STEP) query.set("step", String(step));

  /** The address this question makes without one of its answers. */
  const drop = (key: keyof Search) => {
    const params = new URLSearchParams(query);
    params.delete(key);
    if (key === "on") { params.delete("from"); params.delete("to"); }
    if (view !== "plan") params.set("view", view);
    params.delete("page");
    return `/schedule${params.size ? `?${params}` : ""}`;
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
    return `/schedule?${params}`;
  };
  /** The same plan, drawn as it is, the next presses of "Load more" drawing this many: choosing it loads nothing. */
  const stepping = (by: number) => {
    const params = new URLSearchParams(query);
    if (shown !== PLAN_FIRST) params.set("show", String(shown));
    if (by !== DEFAULT_STEP) params.set("step", String(by));
    else params.delete("step");
    return `/schedule?${params}`;
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
        href: `/schedule?${wideParams}`,
        wide: false,
        // How many the window leaves out, said as a number rather than implied.
        elsewhere: Math.max(everywhere - matching - undatedAll, 0),
      }
    : sp.all === "1" && view === "plan" && !fromDay && !toDay
      ? { label: "every date", href: `/schedule${narrowParams.size ? `?${narrowParams}` : ""}`, wide: true, elsewhere: 0 }
      : null;

  // Every set's values under its name (owner), and the filters this person keeps shown.
  const inSets = await setGrouping(ctx);
  // The calendar draws the actions the filters leave (the backend already narrowed another organization's), on the
  // project's months, with its days off; the days off are kept in Settings → Calendar.
  const calendar = view === "calendar" ? await projectCalendar(ctx) : null;
  const jar = await cookies();
  const shownFilters = await keptFilters("schedule", ["code", "state", "happened", "discipline", "docType", "supplier", "date"]);
  return (
    <div>
      <PlanRegister
        shownFilters={shownFilters}
        plate={
          <PlanPlate
            inForce={publishedVersion ? { since: publishedVersion.publishedAt ? fmtDate(publishedVersion.publishedAt) : null } : null}
            plans={mayUploadLists(ctx.user.verbs)}
            failed={source.imports[0]?.status === "FAILED" ? { revision: source.imports[0].revisionValue, error: source.imports[0].error } : null}
            days={ctx.user.isInternal ? { lead: source.days.lead, risk: source.days.risk, own: source.days.ownLead || source.days.ownRisk } : null}
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
                steps: PLAN_STEPS.map((by) => ({ by, href: stepping(by) })),
                href: matching > rows.length ? deeper(step) : null,
                window: planWindow,
                // The schedule's own first and last months, said beside the window.
                span: span ? `${span.from.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })} → ${span.to.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })}` : null,
                undated: undatedAll,
                // Why there are no WBS bands, when there are none: no WBS read yet, or another order chosen.
                wbs: !plan.hasWbs ? { none: true }
                  : sortKey !== "wbs" ? { none: false, href: (() => { const p = new URLSearchParams(query); p.delete("sort"); p.delete("dir"); return `/schedule${p.size ? `?${p}` : ""}`; })() }
                  : null,
                undatedHref: "/schedule?view=table&nodate=1",
                // Went ahead with documents missing, across every date, opened on every date.
                noNote: { count: plan.withoutNote, href: "/schedule?happened=WITHOUT&all=1" },
              }
            : undefined
        }
        plan={
          <PlanTimeline
            rows={rows.map((row) => ({ code: row.code, name: row.name, moved: movedPhrase(row.moved, row.start, row.finish), start: row.start, finish: row.finish, firstNeeded: row.firstNeeded, readiness: row.readiness, ready: row.ready, total: row.total,
              plannerId: row.externalId && row.externalId !== row.code ? row.externalId : null, wbs: sortKey === "wbs" ? row.wbs ?? [] : [],
              startAchieved: row.startAchieved, finishAchieved: row.finishAchieved }))}
            window={planFrom && planTo ? { from: planFrom, to: planTo } : undefined}
            fit={PLAN_FIRST}
          />
        }
        calendar={calendar ? (
          <MonthsCalendar daySize={calendarDay(jar.get(PREF.calendarDay)?.value)} namesShown={jar.get(PREF.calendarNames)?.value !== "0"}
            from={calendar.from} to={calendar.to} weekend={calendar.place.weekendDays} today={calendar.today} daysOff={calendar.daysOff}
            country={calendar.place.country ?? ""} known={knownBetween(calendar.place.country, calendar.from, calendar.to)}
            actions={plan.calendar.map((a) => ({ code: a.code, name: a.name, start: a.start, finish: a.finish }))}
            aside={maySetup(ctx.user, SETUP_PAGES.find((p) => p.href === "/settings/calendar")!) ? (
              <Link href="/settings/calendar" className="text-xs font-semibold text-link hover:underline">
                {calendar.mayChange ? "Change the days off" : "The days off"} in Settings → Calendar
              </Link>
            ) : null} />
        ) : null}
        rows={tableRows}
        total={matching}
        filters={{ q, state, happened, discipline, docType, supplier, code, on: dateOn, from: sp.from ?? "", to: sp.to ?? "" }}
        filterOptions={{
          states: STATES,
          happened: HAPPENED,
          disciplines: inSets("DISCIPLINES", disciplineRows, (one) => one.label),
          types: inSets("DOCUMENT_TYPES", typeRows, (one) => one.label),
          suppliers: supplierRows.map((one) => ({ code: one.code, label: one.label })),
          codes: plan.codes.map((one) => ({ code: one.code, label: `${one.code} — ${one.name}` })),
          dateFields: DATE_FIELDS,
        }}
        facets={facets}
        paging={{
          page, pages, perPage, sizes: PAGE_SIZES,
          from: matching ? (page - 1) * perPage + 1 : 0,
          to: Math.min(page * perPage, matching),
          query: query.toString(),
        }}
        sort={sp.sort && SORTS.has(sp.sort) ? { key: sortKey, dir } : undefined}
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
