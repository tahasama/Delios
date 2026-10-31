import { api, projectPath } from "@/lib/client";

/**
 * The reports a project team reads. Each one answers one question with a few headline figures, one chart (drawn as
 * fits the question: bars, columns per period, a timeline) and the list behind it, which is what the download carries. Everything is counted by the
 * backend when the report is opened (backend/app/Reports); this turns its answer into the page's shapes.
 */
type Tone = "good" | "warn" | "bad";
/** A headline number; `change` says how it moved since last week, coloured by `changeTone`. */
export type Figure = { label: string; value: string | number; tone?: Tone; change?: string; changeTone?: "good" | "bad" };
export type Segment = { key: string; label: string; tone: "good" | "info" | "warn" | "bad" | "muted" };
/** One bar; on a timeline it spans `from` to `to` (yyyy-MM-dd). */
export type Bar = { label: string; values: Record<string, number>; from?: string | null; to?: string | null };
/**
 * How the chart is drawn, the way that fits its question: horizontal bars per name, upright columns per period (in time
 * order), or a timeline (each bar placed on the calendar). `unit` "days": a bar's length is days waited, not a count.
 */
export type Chart = { title: string; segments: Segment[]; bars: Bar[]; kind: "bars" | "columns" | "timeline"; unit?: "days" | null; from?: string | null; to?: string | null };
export type Cell = string | number | { text: string; href?: string; tone?: "good" | "warn" | "bad" | "info" };
export type Report = {
  id: ReportId;
  title: string;
  question: string;
  /** Who this is usually sent to, and why. */
  audience: string;
  figures: Figure[];
  chart: Chart;
  columns: string[];
  rows: Cell[][];
  empty: string;
  countedAt: string;
  /** Who counted it last: a report stays as it was counted, for everyone, until someone counts it again. */
  countedBy: string | null;
  /** Where the same rows are worked on, as a list with its own filters. */
  workedOn?: { label: string; href: string };
};
export type ReportId = "register" | "deliveries" | "reviews" | "transmittals" | "readiness" | "progress" | "exchange" | "asof";

export const REPORT_IDS: ReportId[] = ["register", "deliveries", "reviews", "transmittals", "readiness", "progress", "exchange", "asof"];
/** What another organization's people read: their own deliveries against plan, and who owes what (the backend narrows both). */
export const OUTSIDE_REPORT_IDS: ReportId[] = ["deliveries", "exchange"];

/** The tab of each report: the report's own title, as the backend names it. */
export const REPORT_TITLES: Record<ReportId, string> = {
  register: "Register status",
  deliveries: "Deliveries against plan",
  reviews: "Reviews waiting",
  transmittals: "Transmittal log",
  readiness: "Activity readiness",
  progress: "Progress by week",
  exchange: "Who owes what",
  asof: "Register on a date",
};

/** The window a reader may change on a report, with the choices offered (the backend's defaults first). */
export const WINDOWS: Partial<Record<ReportId, { param: string; label: string; choices: { value: string; label: string }[] }>> = {
  readiness: { param: "horizonDays", label: "Next", choices: [["30", "30 days"], ["7", "7 days"], ["14", "14 days"], ["60", "60 days"], ["90", "90 days"]].map(([value, label]) => ({ value, label })) },
  transmittals: { param: "months", label: "Last", choices: [["6", "6 months"], ["1", "1 month"], ["3", "3 months"], ["12", "12 months"]].map(([value, label]) => ({ value, label })) },
  reviews: { param: "turnaroundDays", label: "Turnaround over the last", choices: [["90", "90 days"], ["30", "30 days"], ["180", "180 days"], ["365", "a year"]].map(([value, label]) => ({ value, label })) },
  progress: { param: "weeks", label: "Last", choices: [["12", "12 weeks"], ["8", "8 weeks"], ["26", "26 weeks"], ["52", "52 weeks"]].map(([value, label]) => ({ value, label })) },
};

/** What narrows a report: words, a bar chosen on the chart, a window, a day. */
export type ReportQuery = { rq?: string; bar?: string; on?: string; window?: string; by?: string };

/**
 * How a report's chart may be cut, the backend's first choice first (`by`): Deliveries per sender (each organization,
 * and us as one) or per discipline; Reviews the longest waits or per reviewer; Progress what the weeks show.
 */
export const CUTS: Partial<Record<ReportId, { value: string; label: string }[]>> = {
  deliveries: [{ value: "sender", label: "By who sends it" }, { value: "discipline", label: "By discipline" }],
  reviews: [{ value: "wait", label: "Longest waits" }, { value: "reviewer", label: "By reviewer" }],
  progress: [
    { value: "released", label: "Released" }, { value: "delivered", label: "Delivered" }, { value: "overdue", label: "Overdue" },
    { value: "reviews", label: "Reviews open" }, { value: "transmittals", label: "Sent & received" },
  ],
};

function cellText(c: Cell): string {
  return typeof c === "object" ? c.text : String(c);
}

/** The backend's report (Report.cs): its cells say what they open by kind and id. */
type BackendCell = { text: string; tone: "good" | "warn" | "bad" | null; kind: "document" | "review" | "transmittal" | "activity" | null; id: string | null };
type BackendReport = {
  id: ReportId; title: string; question: string; audience: string;
  figures: { label: string; value: string; tone: Tone | null; change: string | null; changeTone: "good" | "bad" | null }[];
  chart: Chart;
  columns: string[]; rows: BackendCell[][]; empty: string; countedAt: string; countedBy?: string | null;
};

/** Where the same rows are worked on, with their own filters. */
const WORKED_ON: Partial<Record<ReportId, { label: string; href: string }>> = {
  register: { label: "Work on them in the register", href: "/documents?view=all" },
  reviews: { label: "Open the reviews still open", href: "/reviews?status=OPEN" },
  transmittals: { label: "Open the transmittals", href: "/transmittals?view=all" },
  readiness: { label: "Open the Schedule", href: "/schedule" },
  asof: { label: "Open the register as it is now", href: "/documents?view=all" },
  exchange: { label: "Open the packages", href: "/packages" },
};

/** Where a cell opens, on these screens. */
function hrefOf(cell: BackendCell): string | undefined {
  switch (cell.kind) {
    case "document": return cell.id ? `/documents/${cell.id}` : undefined;
    case "review": return cell.id ? `/reviews/${cell.id}` : undefined;
    case "transmittal": return cell.id ? `/transmittals/${cell.id}` : undefined;
    case "activity": return `/actions/${encodeURIComponent(cell.text)}`;
    default: return undefined;
  }
}

function cellOf(cell: BackendCell): Cell {
  const href = hrefOf(cell);
  if (!href && !cell.tone) return cell.text;
  return { text: cell.text, ...(href ? { href } : {}), ...(cell.tone ? { tone: cell.tone } : {}) };
}

/** The query the backend takes for a report: the narrowing and the window, by their own names. */
export function reportQuery(id: ReportId, q: ReportQuery): Record<string, string> {
  const query: Record<string, string> = {};
  if (q.rq) query.q = q.rq;
  if (q.bar) query.bar = q.bar;
  if (id === "asof" && q.on) query.on = q.on;
  if (q.by && CUTS[id]?.some((c) => c.value === q.by)) query.by = q.by;
  const window = WINDOWS[id];
  if (window && q.window && window.choices.some((c) => c.value === q.window)) query[window.param] = q.window;
  return query;
}

/** One report, counted now and narrowed as asked (the backend narrows the rows; the chart stays whole). */
export async function buildReport(t: { projectId: string }, id: ReportId, q: ReportQuery = {}): Promise<Report> {
  const report = await api<BackendReport>(projectPath(t, `/reports/${id}`), { keep: { areas: ["docs", "reviews", "transmittals", "packages", "plan", "checks"] }, query: reportQuery(id, q) });
  return {
    id: report.id,
    title: report.title,
    question: report.question,
    audience: report.audience,
    figures: report.figures.map((f) => ({
      label: f.label, value: f.value, ...(f.tone ? { tone: f.tone } : {}), ...(f.change ? { change: f.change } : {}), ...(f.changeTone ? { changeTone: f.changeTone } : {}),
    })),
    chart: report.chart,
    columns: report.columns,
    rows: report.rows.map((row) => row.map(cellOf)),
    empty: report.empty,
    countedAt: report.countedAt,
    countedBy: report.countedBy ?? null,
    workedOn: WORKED_ON[id],
  };
}

export { cellText };
