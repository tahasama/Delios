import { api, projectPath } from "@/lib/client";

/**
 * The reports a project team reads. Each one answers one question with a few headline figures, one chart (horizontal
 * bars, stacked by state) and the list behind it, which is what the download carries. Everything is counted by the
 * backend when the report is opened (backend/app/Reports); this turns its answer into the page's shapes.
 */
type Figure = { label: string; value: string | number; tone?: "good" | "warn" | "bad" };
export type Segment = { key: string; label: string; tone: "good" | "info" | "warn" | "bad" | "muted" };
export type Bar = { label: string; values: Record<string, number> };
export type Cell = string | number | { text: string; href?: string; tone?: "good" | "warn" | "bad" };
export type Report = {
  id: ReportId;
  title: string;
  question: string;
  /** Who this is usually sent to, and why. */
  audience: string;
  figures: Figure[];
  chart: { title: string; segments: Segment[]; bars: Bar[] };
  columns: string[];
  rows: Cell[][];
  empty: string;
  countedAt: string;
  /** Where the same rows are worked on, as a list with its own filters. */
  workedOn?: { label: string; href: string };
};
export type ReportId = "register" | "deliveries" | "reviews" | "transmittals" | "readiness" | "asof";

export const REPORT_IDS: ReportId[] = ["register", "deliveries", "reviews", "transmittals", "readiness", "asof"];
/** What another organization's people read: their own deliveries against plan (the backend narrows it). */
export const OUTSIDE_REPORT_IDS: ReportId[] = ["deliveries"];

/** The tab of each report: the report's own title, as the backend names it. */
export const REPORT_TITLES: Record<ReportId, string> = {
  register: "Register status",
  deliveries: "Deliveries against plan",
  reviews: "Reviews waiting",
  transmittals: "Transmittal log",
  readiness: "Activity readiness",
  asof: "Register on a date",
};

/** The window a reader may change on a report, with the choices offered (the backend's defaults first). */
export const WINDOWS: Partial<Record<ReportId, { param: string; label: string; choices: { value: string; label: string }[] }>> = {
  readiness: { param: "horizonDays", label: "Looking ahead", choices: [["30", "30 days"], ["7", "7 days"], ["14", "14 days"], ["60", "60 days"], ["90", "90 days"]].map(([value, label]) => ({ value, label })) },
  transmittals: { param: "months", label: "Going back", choices: [["6", "6 months"], ["1", "1 month"], ["3", "3 months"], ["12", "12 months"]].map(([value, label]) => ({ value, label })) },
  reviews: { param: "turnaroundDays", label: "Turnaround over", choices: [["90", "90 days"], ["30", "30 days"], ["180", "180 days"], ["365", "a year"]].map(([value, label]) => ({ value, label })) },
};

/** What narrows a report: words, a bar chosen on the chart, a window, a day. */
export type ReportQuery = { rq?: string; bar?: string; on?: string; window?: string };

function cellText(c: Cell): string {
  return typeof c === "object" ? c.text : String(c);
}

/** The backend's report (Report.cs): its cells say what they open by kind and id. */
type BackendCell = { text: string; tone: "good" | "warn" | "bad" | null; kind: "document" | "review" | "transmittal" | "activity" | null; id: string | null };
type BackendReport = {
  id: ReportId; title: string; question: string; audience: string;
  figures: { label: string; value: string; tone: "good" | "warn" | "bad" | null }[];
  chart: { title: string; segments: Segment[]; bars: Bar[] };
  columns: string[]; rows: BackendCell[][]; empty: string; countedAt: string;
};

/** Where the same rows are worked on, with their own filters. */
const WORKED_ON: Partial<Record<ReportId, { label: string; href: string }>> = {
  register: { label: "Work on them in the register", href: "/documents?view=all" },
  reviews: { label: "Open the reviews still open", href: "/reviews?status=OPEN" },
  transmittals: { label: "Open the transmittals", href: "/transmittals?view=all" },
  readiness: { label: "Open the Schedule", href: "/actions" },
  asof: { label: "Open the register as it is now", href: "/documents?view=all" },
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
  const window = WINDOWS[id];
  if (window && q.window && window.choices.some((c) => c.value === q.window)) query[window.param] = q.window;
  return query;
}

/** One report, counted now and narrowed as asked (the backend narrows the rows; the chart stays whole). */
export async function buildReport(t: { projectId: string }, id: ReportId, q: ReportQuery = {}): Promise<Report> {
  const report = await api<BackendReport>(projectPath(t, `/reports/${id}`), { query: reportQuery(id, q) });
  return {
    id: report.id,
    title: report.title,
    question: report.question,
    audience: report.audience,
    figures: report.figures.map((f) => ({ label: f.label, value: f.value, ...(f.tone ? { tone: f.tone } : {}) })),
    chart: report.chart,
    columns: report.columns,
    rows: report.rows.map((row) => row.map(cellOf)),
    empty: report.empty,
    countedAt: report.countedAt,
    workedOn: WORKED_ON[id],
  };
}

export { cellText };
