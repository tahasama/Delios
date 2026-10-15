import Link from "next/link";
import { Download, X } from "lucide-react";
import { requireScope } from "@/lib/core/scope";
import { DataTable, Th, Td, ToneChip, inputCls, btn } from "@/components/ui";
import { when } from "@/app/(app)/home-parts";
import { FindBox } from "./find-box";
import { fromToday } from "@/lib/core/days";
import {
  buildReport, GROUP_BY, OUTSIDE_REPORT_IDS, REPORT_IDS, REPORT_TITLES, WINDOWS,
  type Bar, type Cell, type ReportId, type ReportQuery, type Segment,
} from "@/lib/conformance/reports";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports" };

const PER_PAGE = 50;

type Search = { r?: string; rq?: string; bar?: string; on?: string; window?: string; by?: string; page?: string };

/**
 * Reports: each one answers one question, counted when it is opened, as figures, one chart and the list behind it.
 * A bar chosen on the chart, words typed, a window or a day narrow the list and the download alike (the backend
 * narrows). Our own people read every report; another organization reads its own deliveries against plan.
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
  const download = (format: "csv" | "xlsx") => `/api/reports/${current}${link({ format } as Partial<Search>, ["rq", "bar", "on", "window", "by"])}`;
  const narrowed = !!(asked.rq || asked.bar);

  const page = Math.max(1, Number(sp.page) || 1);
  const rows = report?.rows ?? [];
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const shown = rows.slice((Math.min(page, pages) - 1) * PER_PAGE, Math.min(page, pages) * PER_PAGE);
  const window = WINDOWS[current];
  const tab = (on: boolean) =>
    `-mb-px shrink-0 whitespace-nowrap border-b-2 px-0.5 pb-2 text-[12px] leading-4 transition ${
      on ? "border-brand-ink font-semibold text-slate-900" : "border-transparent text-slate-500 hover:border-line-strong hover:text-slate-800"
    }`;

  return (
    <div className="space-y-4">
      <section className="register register-sheet register-sheet-open">
        {/* The plate: the report's own question is the title. */}
        <div className="flex flex-col gap-3 px-5 pt-5 pb-4 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <h1 className="plate-title text-slate-950">{report?.title ?? REPORT_TITLES[current]}</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-700">{report?.question ?? "Which revision was current on a given day?"}</p>
            <p className="mt-0.5 max-w-2xl text-xs leading-5 text-slate-500">
              {report?.audience ?? "Audits, claims and “what did we build from?”: the register as it stood at the end of that day."}
              {report ? <> · counted {when(new Date(report.countedAt))}</> : null}
              {!ctx.user.isInternal ? <> · your organization&rsquo;s documents only</> : null}
            </p>
          </div>
          {report ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">{narrowed ? "Download the lines shown:" : "Download these lines:"}</span>
              <a href={download("csv")} className="ask inline-flex items-center gap-1.5"><Download className="h-3.5 w-3.5" aria-hidden="true" /> CSV</a>
              <a href={download("xlsx")} className="ask inline-flex items-center gap-1.5"><Download className="h-3.5 w-3.5" aria-hidden="true" /> Excel</a>
            </div>
          ) : null}
        </div>

        {offered.length > 1 ? (
          <nav aria-label="Reports" className="scroll-thin flex gap-x-5 overflow-x-auto border-t border-line px-5 pt-3 sm:px-6">
            {offered.map((id) => (
              <Link key={id} href={link({ r: id, page: undefined }, ["rq"])} scroll={false} aria-current={current === id ? "page" : undefined} className={tab(current === id)}>
                {REPORT_TITLES[id]}
              </Link>
            ))}
          </nav>
        ) : null}

        {/* Register on a date asks its day; nothing is counted before one is chosen. */}
        {current === "asof" ? (
          <form className="flex flex-wrap items-end gap-3 border-t border-line px-5 py-3 sm:px-6">
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
                <span className="text-[11px] text-slate-500">click a name to see only its lines below</span>
                {/* What the chart shows, chosen right here: each choice applies at once. */}
                <span className="ml-auto flex flex-wrap items-center gap-3">
                  {current === "deliveries" && ctx.user.isInternal ? (
                    <Choices label="" current={asked.by ?? GROUP_BY[0].value}
                      options={[{ value: "sender", label: "By who sends it" }, { value: "discipline", label: "By discipline" }]}
                      hrefOf={(v) => link({ by: v, bar: undefined, page: undefined })} />
                  ) : null}
                  {window ? (
                    <Choices label={window.label} current={asked.window ?? window.choices[0].value}
                      options={[...window.choices].sort((x, y) => Number(x.value) - Number(y.value))}
                      hrefOf={(v) => link({ window: v, bar: undefined, page: undefined })} />
                  ) : null}
                </span>
              </div>
              <BarChart segments={report.chart.segments} bars={report.chart.bars} chosen={asked.bar} hrefOf={(label) => link({ bar: label === asked.bar ? undefined : label, page: undefined })} />
            </section>
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
              <span className="ml-auto">
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
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-2.5 text-xs text-slate-600 sm:px-6">
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
const TONE_OF = { good: "done", warn: "waiting", bad: "refused" } as const;

function renderCell(cell: Cell) {
  if (typeof cell !== "object") {
    // A day reads from today; the day itself on hover.
    const said = typeof cell === "string" ? fromToday(cell) : null;
    return said ? <span title={String(cell)} className="whitespace-nowrap">{said}</span> : cell;
  }
  if (cell.href) return <Link href={cell.href} className="font-mono font-semibold text-link hover:underline">{cell.text}</Link>;
  if (cell.tone) return <ToneChip tone={TONE_OF[cell.tone]}>{cell.text}</ToneChip>;
  return cell.text;
}

/**
 * Horizontal bars, one per row, stacked by state. The numbers sit beside the bars, never on them (readable on any
 * colour); the legend gives each state's total. Each bar's name narrows the list below to it; chosen again, it lets go.
 */
function BarChart({ segments, bars, chosen, hrefOf }: { segments: Segment[]; bars: Bar[]; chosen?: string; hrefOf: (label: string) => string }) {
  const total = (b: Bar) => segments.reduce((n, s) => n + (b.values[s.key] ?? 0), 0);
  const max = Math.max(1, ...bars.map(total));
  const sums = Object.fromEntries(segments.map((s) => [s.key, bars.reduce((n, b) => n + (b.values[s.key] ?? 0), 0)]));
  return (
    <figure className="px-5 py-4 sm:px-6">
      <figcaption className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        {segments.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <span className={`h-2.5 w-2.5 rounded-sm ${FILL[s.tone]}`} aria-hidden="true" />
            {s.label} <span className="font-semibold tabular-nums text-slate-800">{sums[s.key]}</span>
          </span>
        ))}
      </figcaption>
      <ul className="space-y-2 sm:space-y-1.5">
        {bars.map((b) => {
          const on = chosen === b.label;
          const counts = segments.filter((s) => b.values[s.key]).map((s) => `${s.label}: ${b.values[s.key]}`).join(", ");
          return (
            <li key={b.label} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 text-xs sm:grid-cols-[minmax(10rem,18rem)_minmax(0,1fr)_auto] ${chosen && !on ? "opacity-50" : ""}`}>
              <Link
                href={hrefOf(b.label)}
                scroll={false}
                aria-current={on ? "true" : undefined}
                title={on ? "Show every line again" : `Only ${b.label} below`}
                className={`col-span-2 truncate hover:underline sm:col-span-1 ${on ? "font-semibold text-slate-900" : "text-link"}`}
              >
                {b.label}
              </Link>
              <span className="flex h-4 overflow-hidden rounded-sm bg-tint-soft" role="img" aria-label={`${b.label}: ${counts}`}>
                <span className="flex h-full" style={{ width: `${(total(b) / max) * 100}%` }}>
                  {segments.map((s) => {
                    const v = b.values[s.key] ?? 0;
                    return v ? <span key={s.key} title={`${s.label}: ${v}`} className={`h-full ${FILL[s.tone]}`} style={{ width: `${(v / total(b)) * 100}%` }} /> : null;
                  })}
                </span>
              </span>
              <span className="w-8 text-right font-semibold tabular-nums text-slate-700">{total(b)}</span>
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
    <span className="inline-flex items-center gap-2">
      {label ? <span className="text-[11px] text-slate-500">{label}</span> : null}
      <span className="inline-flex overflow-hidden rounded-md ring-1 ring-line" role="group" aria-label={label || "Show"}>
        {options.map((o) => (
          <Link key={o.value} href={hrefOf(o.value)} scroll={false} aria-current={current === o.value ? "true" : undefined}
            className={`border-l border-line px-2.5 py-1 text-xs first:border-l-0 ${current === o.value ? "bg-brand font-semibold text-white" : "bg-surface text-slate-700 hover:bg-tint-soft"}`}>
            {o.label}
          </Link>
        ))}
      </span>
    </span>
  );
}
