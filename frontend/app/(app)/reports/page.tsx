import Link from "next/link";
import { Download, X } from "lucide-react";
import { requireScope } from "@/lib/core/scope";
import { DataTable, Th, Td, ToneChip, inputCls, btn } from "@/components/ui";
import { when } from "@/app/(app)/home-parts";
import { FindBox } from "./find-box";
import { PrintButton } from "./print-button";
import { fromToday } from "@/lib/core/days";
import {
  buildReport, CUTS, OUTSIDE_REPORT_IDS, REPORT_IDS, REPORT_TITLES, WINDOWS,
  type Bar, type Cell, type Chart, type ReportId, type ReportQuery, type Segment,
} from "@/lib/conformance/reports";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports" };

const PER_PAGE = 50;

type Search = { r?: string; rq?: string; bar?: string; on?: string; window?: string; by?: string; page?: string };

/**
 * Reports: each one answers one question, counted when it is opened, as figures, one chart and the list behind it.
 * A bar chosen on the chart, words typed, a window or a day narrow the list and the download alike (the backend
 * narrows). Our own people read every report; another organization reads its own deliveries against plan and who owes
 * what. Each prints as shown.
 */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireScope();
  const sp = await searchParams;
  const offered = ctx.user.isInternal ? REPORT_IDS : OUTSIDE_REPORT_IDS;
  const current: ReportId = offered.includes(sp.r as ReportId) ? (sp.r as ReportId) : offered[0];
  const asked: ReportQuery = { rq: (sp.rq ?? "").trim() || undefined, bar: sp.bar || undefined, on: sp.on || undefined, window: sp.window || undefined, by: sp.by || undefined };
  const today = new Date().toISOString().slice(0, 10);
  // A day to come is refused by the backend; the page asks for one before it counts.
  const needsDay = current === "asof" && !asked.on;
  const tabs = offered.map((id) => ({ id, title: REPORT_TITLES[id] }));
  const tabClass = (on: boolean) =>
    `-mb-px shrink-0 whitespace-nowrap border-b-2 px-0.5 pb-2 text-[12px] leading-4 transition ${
      on ? "border-brand-ink font-semibold text-slate-900" : "border-transparent text-slate-500 hover:border-line-strong hover:text-slate-800"
    }`;
  const nav = (on: string) => tabs.length > 1 ? (
    <nav aria-label="Reports" className="no-print scroll-thin flex gap-x-5 overflow-x-auto border-t border-line px-5 pt-3 sm:px-6">
      {tabs.map((t) => (
        <Link key={t.id} href={`/reports?r=${t.id}`} scroll={false} aria-current={on === t.id ? "page" : undefined} className={tabClass(on === t.id)}>
          {t.title}
        </Link>
      ))}
    </nav>
  ) : null;

  let report: Awaited<ReturnType<typeof buildReport>> | null = null;
  let failure: string | null = null;
  if (!needsDay) {
    try {
      report = await buildReport(ctx, current, asked);
    } catch (e) {
      failure = e instanceof Error ? e.message : "The report could not be counted just now.";
    }
  }

  // The same narrowing everywhere: tabs keep the words, downloads and pages keep everything.
  const link = (over: Partial<Search>, keep: (keyof Search)[] = ["r", "rq", "bar", "on", "window", "by"]) => {
    const next = new URLSearchParams();
    const base: Search = { ...sp, r: current };
    for (const key of keep) if (base[key]) next.set(key, String(base[key]));
    for (const [key, value] of Object.entries(over)) value ? next.set(key, String(value)) : next.delete(key);
    return `?${next}`;
  };
  const download = (format: "xlsx") => `/api/reports/${current}${link({ format } as Partial<Search>, ["rq", "bar", "on", "window", "by"])}`;
  const narrowed = !!(asked.rq || asked.bar);

  const page = Math.max(1, Number(sp.page) || 1);
  const rows = report?.rows ?? [];
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const shown = rows.slice((Math.min(page, pages) - 1) * PER_PAGE, Math.min(page, pages) * PER_PAGE);
  const window = WINDOWS[current];
  const cuts = CUTS[current];

  return (
    <div className="report-print space-y-4">
      <section className="register register-sheet register-sheet-open">
        {/* The plate: the report's own question is the title. */}
        <div className="flex flex-col gap-3 px-5 pt-5 pb-4 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <h1 className="plate-title text-slate-950">{report?.title ?? REPORT_TITLES[current]}</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-700">{report?.question ?? "Which revision was current on a given day?"}</p>
            <p className="mt-0.5 max-w-2xl text-xs leading-5 text-slate-500">
              {report?.audience ?? "Audits, claims and “what did we build from?”: the register as it stood at the end of that day."}
              {report ? <> · counted <span className="no-print">{when(new Date(report.countedAt))}</span>
                <span className="print-only">{new Date(report.countedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span></> : null}
              {!ctx.user.isInternal ? <> · your organization&rsquo;s documents only</> : null}
            </p>
          </div>
          {report ? (
            <div className="no-print flex shrink-0 flex-wrap items-center gap-2">
              <a href={download("xlsx")} title={narrowed ? "The lines shown, in Excel" : "The lines below, in Excel"}
                className="ask inline-flex items-center gap-1.5"><Download className="h-3.5 w-3.5" aria-hidden="true" /> Excel</a>
              <PrintButton />
            </div>
          ) : null}
        </div>

        {nav(current)}

        {/* Register on a date asks its day; nothing is counted before one is chosen. */}
        {current === "asof" ? (
          <form className="no-print flex flex-wrap items-end gap-3 border-t border-line px-5 py-3 sm:px-6">
            <input type="hidden" name="r" value={current} />
            <label className="w-44">
              <span className="mb-1.5 block h-4 text-xs font-medium leading-4 text-slate-700">The day</span>
              <input type="date" name="on" max={today} defaultValue={asked.on ?? ""} required className={inputCls} />
            </label>
            <button type="submit" className={btn("primary")}>Show the register on that day</button>
          </form>
        ) : null}

        {report ? (
          <div className="grid grid-cols-2 gap-2 border-t border-line px-5 py-4 sm:grid-cols-4 sm:px-6">
            {report.figures.map((f) => (
              <div key={f.label} className="rounded-md px-3 py-2.5 ring-1 ring-line">
                <p className="text-xs text-slate-600">{f.label}</p>
                <p className={`mt-0.5 text-xl font-semibold tabular-nums ${TEXT[f.tone ?? ""] ?? "text-slate-900"}`}>{f.value}</p>
                {f.change ? <p className={`mt-0.5 text-[11px] ${f.changeTone ? TEXT[f.changeTone] : "text-slate-500"}`}>{f.change}</p> : null}
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {needsDay ? (
        <p className="rounded-md bg-tint-soft px-3 py-2.5 text-xs leading-5 text-slate-700 ring-1 ring-line">
          Choose the day above: each document that existed then, the revision that was current at the end of that day, and what is current now.
        </p>
      ) : failure ? (
        <p role="alert" className="rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-800 ring-1 ring-red-200">{failure}</p>
      ) : report ? (
        <>
          {report.chart.bars.length ? (
            <section className="register register-sheet register-sheet-open" aria-labelledby="chart-head">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
                <span id="chart-head" className="stencil text-slate-500">{report.chart.title}</span>
                <span className="no-print text-[11px] text-slate-500">
                  {current === "asof" ? "before the day, a column opens the register as it stood then; from the day, it shows only its lines below"
                    : `${report.chart.kind === "columns" ? "click a column" : "click a name"} to see only its lines below`}
                </span>
                {/* What the chart shows, chosen right here: each choice applies at once. */}
                <span className="no-print ml-auto flex flex-wrap items-center gap-3">
                  {cuts && (current !== "deliveries" || ctx.user.isInternal) ? (
                    <Choices label="" current={asked.by ?? cuts[0].value} options={cuts}
                      hrefOf={(v) => link({ by: v, bar: undefined, page: undefined })} />
                  ) : null}
                  {window ? (
                    <Choices label={window.label} current={asked.window ?? window.choices[0].value}
                      options={[...window.choices].sort((x, y) => Number(x.value) - Number(y.value))}
                      hrefOf={(v) => link({ window: v, bar: undefined, page: undefined })} />
                  ) : null}
                </span>
              </div>
              {current === "asof" && !report.chart.bars.some((b) => sinceTheDay(report.chart, b) && totalOf(report.chart.segments, b)) ? (
                <p className="border-b border-line px-5 py-2.5 text-xs leading-5 text-slate-700 sm:px-6">
                  Nothing has moved since that day: no document was registered, replaced, released for the first time or put out of use.
                </p>
              ) : null}
              <ChartView chart={report.chart} chosen={asked.bar} hrefOf={(label) => link({ bar: label === asked.bar ? undefined : label, page: undefined })}
                readOn={(day) => link({ on: day, bar: undefined, page: undefined })} />
            </section>
          ) : current === "asof" ? (
            <p className="rounded-md bg-tint-soft px-3 py-2.5 text-xs leading-5 text-slate-700 ring-1 ring-line">
              Nothing was registered by that day, and nothing has moved since.
            </p>
          ) : null}

          <section className="register register-sheet register-sheet-open" aria-labelledby="list-head">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
              <span id="list-head" className="stencil text-slate-500">The lines behind it</span>
              <span className="text-[11px] text-slate-500">{rows.length} line{rows.length === 1 ? "" : "s"}</span>
              {asked.bar ? (
                <Link href={link({ bar: undefined, page: undefined })} scroll={false} title="Show every line again"
                  className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-slate-700 ring-1 ring-line hover:ring-line-strong">
                  only {asked.bar} <X className="h-3 w-3" aria-hidden="true" />
                </Link>
              ) : null}
              <span className="no-print ml-auto">
                <FindBox value={asked.rq ?? ""} clearHref={link({ rq: undefined, page: undefined })}
                  keep={Object.fromEntries(Object.entries({ r: current, bar: asked.bar, by: asked.by, window: asked.window, on: asked.on }).filter((e): e is [string, string] => !!e[1]))} />
              </span>
            </div>
            {shown.length ? (
              <DataTable className="rounded-none border-0 shadow-none" toolbar={false} id={`report-${current}`} head={<tr>{report.columns.map((c) => <Th key={c}>{c}</Th>)}</tr>}>
                {shown.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, n) => <Td key={n} className="text-xs">{renderCell(cell)}</Td>)}
                  </tr>
                ))}
              </DataTable>
            ) : (
              <p className="px-5 py-4 text-xs text-slate-600 sm:px-6">{narrowed ? "Nothing here matches what you narrowed it to." : report.empty}</p>
            )}
            {pages > 1 ? (
              <p className="print-only border-t border-line px-5 py-2 text-xs text-slate-600">
                Lines {(Math.min(page, pages) - 1) * PER_PAGE + 1}–{Math.min(rows.length, Math.min(page, pages) * PER_PAGE)} of {rows.length}; the full list is in the Excel.
              </p>
            ) : null}
            <div className="no-print flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-2.5 text-xs text-slate-600 sm:px-6">
              <span>
                {pages > 1 ? (
                  <>
                    {page > 1 ? <Link href={link({ page: String(page - 1) })} className="font-semibold text-link hover:underline">Previous</Link> : <span className="text-slate-400">Previous</span>}
                    <span className="mx-2 tabular-nums">Page {Math.min(page, pages)} of {pages}</span>
                    {page < pages ? <Link href={link({ page: String(page + 1) })} className="font-semibold text-link hover:underline">Next</Link> : <span className="text-slate-400">Next</span>}
                  </>
                ) : null}
              </span>
              {report.workedOn && ctx.user.isInternal ? <Link href={report.workedOn.href} className="font-semibold text-link hover:underline">{report.workedOn.label}</Link> : null}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

const TEXT: Record<string, string> = { good: "text-emerald-700", warn: "text-amber-700", bad: "text-red-700" };
const FILL: Record<Segment["tone"], string> = { good: "bg-emerald-500", info: "bg-sky-500", warn: "bg-amber-400", bad: "bg-red-500", muted: "bg-slate-300" };
// The chart's colours as the chips say them: blue is under way, as everywhere (lib/core/tones.ts).
const TONE_OF = { good: "done", warn: "waiting", bad: "refused", info: "moving" } as const;

function renderCell(cell: Cell) {
  if (typeof cell !== "object") {
    // A day reads from today; the day itself on hover.
    const said = typeof cell === "string" ? fromToday(cell) : null;
    return said ? <span title={String(cell)} className="whitespace-nowrap"><span className="no-print">{said}</span><span className="print-only">{String(cell)}</span></span> : cell;
  }
  if (cell.href) return <Link href={cell.href} className="font-mono font-semibold text-link hover:underline">{cell.text}</Link>;
  if (cell.tone) return <ToneChip tone={TONE_OF[cell.tone]}>{cell.text}</ToneChip>;
  return cell.text;
}

/**
 * A chart may start before its day (`from`, Register on a date): the periods ending before it are context, each opening
 * the register as it stood at its end (`readOn`); the rest narrow the lines.
 */
type ChartProps = { chart: Chart; chosen?: string; hrefOf: (label: string) => string; readOn?: (day: string) => string };
const sinceTheDay = (chart: Chart, b: Bar) => !chart.from || !b.to || b.to >= chart.from;

/** Draws the report's chart the way that fits its question: bars per name, columns per period, or a timeline. */
function ChartView(props: ChartProps) {
  if (props.chart.kind === "columns") return <ColumnChart {...props} />;
  if (props.chart.kind === "timeline") return <Timeline {...props} />;
  return <BarChart {...props} />;
}

const totalOf = (segments: Segment[], b: Bar) => segments.reduce((n, s) => n + (b.values[s.key] ?? 0), 0);

/**
 * The legend: each state with its total. When bars are lengths (days waited), each state counts its bars instead, so a
 * number in the legend is always how many things, never days added up.
 */
function Legend({ chart, noun }: { chart: Chart; noun?: string }) {
  const sum = (s: Segment) => chart.unit === "days"
    ? chart.bars.filter((b) => b.values[s.key] !== undefined).length
    : chart.bars.reduce((n, b) => n + (b.values[s.key] ?? 0), 0);
  return (
    <figcaption className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
      {chart.segments.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5 text-xs text-slate-600">
          <span className={`h-2.5 w-2.5 rounded-sm ${FILL[s.tone]}`} aria-hidden="true" />
          {s.label} <span className="font-semibold tabular-nums text-slate-800">{sum(s)}</span>{noun ? <span className="text-slate-500">{noun}</span> : null}
        </span>
      ))}
    </figcaption>
  );
}

/** The stacked parts of one bar, each as wide as its share. */
function Stack({ segments, bar, vertical }: { segments: Segment[]; bar: Bar; vertical?: boolean }) {
  const total = totalOf(segments, bar);
  return (
    <>
      {segments.map((s) => {
        const v = bar.values[s.key] ?? 0;
        const share = `${(v / Math.max(1, total)) * 100}%`;
        return v ? <span key={s.key} title={`${s.label}: ${v}`} className={`${vertical ? "w-full" : "h-full"} ${FILL[s.tone]}`} style={vertical ? { height: share } : { width: share }} /> : null;
      })}
    </>
  );
}

/**
 * Horizontal bars, one per row, stacked by state. The numbers sit beside the bars, never on them (readable on any
 * colour); the legend gives each state's total. Each bar's name narrows the list below to it; chosen again, it lets go.
 * Bars measured in days (the longest waits) end with their days.
 */
function BarChart({ chart, chosen, hrefOf }: ChartProps) {
  const { segments, bars } = chart;
  const max = Math.max(1, ...bars.map((b) => totalOf(segments, b)));
  return (
    <figure className="px-5 py-4 sm:px-6">
      <Legend chart={chart} noun={chart.unit === "days" ? "waiting" : undefined} />
      <ul className="space-y-2 sm:space-y-1.5">
        {bars.map((b) => {
          const on = chosen === b.label;
          const total = totalOf(segments, b);
          const counts = segments.filter((s) => b.values[s.key] !== undefined).map((s) => `${s.label}: ${b.values[s.key]}`).join(", ");
          return (
            <li key={b.label} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 text-xs sm:grid-cols-[minmax(10rem,18rem)_minmax(0,1fr)_auto] ${chosen && !on ? "opacity-50" : ""}`}>
              <Link href={hrefOf(b.label)} scroll={false} aria-current={on ? "true" : undefined} title={on ? "Show every line again" : `Only ${b.label} below`}
                className={`col-span-2 truncate hover:underline sm:col-span-1 ${on ? "font-semibold text-slate-900" : "text-link"}`}>
                {b.label}
              </Link>
              <span className="flex h-4 overflow-hidden rounded-sm bg-tint-soft" role="img" aria-label={`${b.label}: ${counts}`}>
                <span className="flex h-full" style={{ width: `${(total / max) * 100}%` }}><Stack segments={segments} bar={b} /></span>
              </span>
              <span className="w-10 text-right font-semibold tabular-nums text-slate-700">{chart.unit === "days" ? `${total} d` : total}</span>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}

/**
 * Upright columns, one per period, in time order (oldest left), stacked by state; each column's count sits on top.
 * A column narrows the lines below to its period. With many periods, only some are named under the axis; each column
 * still says its own on hover.
 */
function ColumnChart({ chart, chosen, hrefOf, readOn }: ChartProps) {
  const { segments, bars } = chart;
  const max = Math.max(1, ...bars.map((b) => totalOf(segments, b)));
  // Started before its day: the legend counts from the day on, and a line marks where the day falls.
  const firstSince = bars.findIndex((b) => sinceTheDay(chart, b));
  const before = chart.from && firstSince > 0;
  // Only some periods are named under the axis: about 5 on a phone, 13 wider; the last always.
  const narrow = Math.max(1, Math.ceil(bars.length / 5));
  const wide = Math.max(1, Math.ceil(bars.length / 13));
  const named = (i: number) => i === bars.length - 1 ? "" : `${i % narrow === 0 ? "" : "invisible"} ${i % wide === 0 ? "sm:visible" : "sm:invisible"}`;
  // Many narrow columns: an empty one carries no count, and counts show from the wider screens.
  const crowded = bars.length > 13;
  return (
    <figure className="px-5 py-4 sm:px-6">
      <Legend chart={before ? { ...chart, bars: bars.slice(firstSince) } : chart} />
      {before ? (
        <p className="-mt-1 mb-3 text-[11px] text-slate-500">
          The counts above are from the day on. Left of the dashed line, what was moving before it: every change counted.
        </p>
      ) : null}
      <div className="grid items-end gap-1 sm:gap-1.5" style={{ gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))` }}>
        {bars.map((b, i) => {
          const earlier = before && i < firstSince;
          const on = !earlier && chosen === b.label;
          const total = totalOf(segments, b);
          const counts = segments.filter((s) => b.values[s.key]).map((s) => `${s.label}: ${b.values[s.key]}`).join(", ") || "nothing";
          const href = earlier && readOn ? readOn(b.to!) : hrefOf(b.label);
          return (
            <Link key={b.label} href={href} scroll={false} aria-current={on ? "true" : undefined}
              title={earlier ? `${b.label}: ${counts}. Open the register as it stood on ${b.to}` : `${b.label}: ${counts}`}
              className={`group mx-auto flex h-44 w-full max-w-16 min-w-0 flex-col items-stretch justify-end ${before && i === firstSince ? "border-l border-dashed border-line-strong pl-1" : ""} ${chosen && !on ? "opacity-50" : earlier ? "opacity-70" : ""}`}>
              <span className={`mb-1 text-center text-[11px] font-semibold tabular-nums ${total ? "text-slate-700" : "text-slate-400"} ${crowded ? (total ? "hidden sm:block" : "invisible") : ""}`}>{total}</span>
              <span className="flex flex-col-reverse overflow-hidden rounded-t-sm bg-tint-soft group-hover:ring-1 group-hover:ring-line-strong"
                style={{ height: `${Math.max(2, (total / max) * 100)}%` }} role="img" aria-label={`${b.label}: ${counts}`}>
                {/* Stacked bottom up, in the legend's order. */}
                <Stack segments={segments} bar={b} vertical />
              </span>
              <span className={`mt-1.5 self-center text-center text-[10px] leading-3 ${on ? "font-semibold text-slate-900" : "text-slate-500"} ${named(i)} whitespace-nowrap`}>
                {b.label}
              </span>
            </Link>
          );
        })}
      </div>
    </figure>
  );
}

const DAY = 86_400_000;
const dayOf = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/**
 * A timeline: each bar placed on the calendar from its first to its last day, between the chart's first and last day
 * (today and the look-ahead); stacked by the state of what it needs, its count at the end. A bar that runs on past the
 * window is cut at its edge, one that began earlier starts at today.
 */
function Timeline({ chart, chosen, hrefOf }: ChartProps) {
  const { segments, bars } = chart;
  if (!chart.from || !chart.to) return <BarChart chart={{ ...chart, kind: "bars" }} chosen={chosen} hrefOf={hrefOf} />;
  const start = dayOf(chart.from);
  const span = Math.max(1, (dayOf(chart.to) - start) / DAY + 1);
  const at = (iso: string) => Math.min(span, Math.max(0, (dayOf(iso) - start) / DAY));
  const ticks = [0, Math.round(span / 2), span - 1].map((d) => ({
    left: (d / span) * 100,
    label: d === 0 ? "Today" : `In ${d} days`,
    day: new Date(start + d * DAY).toISOString().slice(0, 10),
  }));
  return (
    <figure className="px-5 py-4 sm:px-6">
      <Legend chart={chart} />
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 text-[10px] text-slate-500 sm:grid-cols-[minmax(10rem,18rem)_minmax(0,1fr)_auto]">
        <span className="hidden sm:block" />
        <span className="relative h-4">
          {ticks.map((t, i) => (
            <span key={i} title={t.day} className={`absolute top-0 whitespace-nowrap ${i === 0 ? "" : i === ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2"}`} style={{ left: `${t.left}%` }}>{t.label}</span>
          ))}
        </span>
        <span className="w-8" />
      </div>
      <ul className="space-y-2 sm:space-y-1.5">
        {bars.map((b) => {
          const on = chosen === b.label;
          const first = at(b.from ?? chart.from!);
          const last = at(b.to ?? b.from ?? chart.from!) + 1;
          const counts = segments.filter((s) => b.values[s.key]).map((s) => `${s.label}: ${b.values[s.key]}`).join(", ");
          const dates = b.from ? `${b.from}${b.to && b.to !== b.from ? ` to ${b.to}` : ""}` : "";
          return (
            <li key={b.label} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 text-xs sm:grid-cols-[minmax(10rem,18rem)_minmax(0,1fr)_auto] ${chosen && !on ? "opacity-50" : ""}`}>
              <Link href={hrefOf(b.label)} scroll={false} aria-current={on ? "true" : undefined} title={on ? "Show every line again" : `Only ${b.label} below`}
                className={`col-span-2 truncate hover:underline sm:col-span-1 ${on ? "font-semibold text-slate-900" : "text-link"}`}>
                {b.label}
              </Link>
              <span className="relative h-4 rounded-sm bg-tint-soft" role="img" aria-label={`${b.label}, ${dates}: ${counts}`}>
                {ticks.slice(1, -1).map((t, i) => <span key={i} className="absolute inset-y-0 w-px bg-line" style={{ left: `${t.left}%` }} aria-hidden="true" />)}
                <span title={`${dates}: ${counts}`} className="absolute inset-y-0 flex min-w-1 overflow-hidden rounded-sm"
                  style={{ left: `${(first / span) * 100}%`, width: `${((last - first) / span) * 100}%` }}>
                  <Stack segments={segments} bar={b} />
                </span>
              </span>
              <span className="w-8 text-right font-semibold tabular-nums text-slate-700">{totalOf(segments, b)}</span>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}

/** A few choices side by side, the current one filled; each is a link, so it applies at once. */
function Choices({ label, current, options, hrefOf }: { label: string; current: string; options: { value: string; label: string }[]; hrefOf: (value: string) => string }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-2">
      {label ? <span className="text-[11px] text-slate-500">{label}</span> : null}
      <span className="scroll-thin inline-flex max-w-full overflow-x-auto rounded-md ring-1 ring-line" role="group" aria-label={label || "Show"}>
        {options.map((o) => (
          <Link key={o.value} href={hrefOf(o.value)} scroll={false} aria-current={current === o.value ? "true" : undefined}
            className={`shrink-0 whitespace-nowrap border-l border-line px-2.5 py-1 text-xs first:border-l-0 ${current === o.value ? "bg-brand font-semibold text-white" : "bg-surface text-slate-700 hover:bg-tint-soft"}`}>
            {o.label}
          </Link>
        ))}
      </span>
    </span>
  );
}
