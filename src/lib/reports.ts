import { api, projectPath } from "./api/client";

/**
 * The reports a project team reads. Each one answers one question with:
 *   - a few headline figures,
 *   - one simple chart (horizontal bars, stacked by state),
 *   - the detailed list behind it — the actual documents, reviews,
 *     transmittals or activities — which is what the CSV exports.
 * Every figure is counted by the backend from the register when the report
 * is opened (backend/src/Delios.Host/Reports); this turns its answer into the
 * page's shapes.
 */
export type Figure = { label: string; value: string | number; tone?: "good" | "warn" | "bad" };
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
  /**
   * Where the same rows live as a working list. A report that would only
   * repeat the register, the reviews or the transmittals sends the reader
   * there instead of printing them twice.
   */
  seeAlso?: { label: string; href: string };
};
export type ReportId = "register" | "deliveries" | "reviews" | "transmittals" | "readiness";

export const REPORT_IDS: ReportId[] = ["register", "deliveries", "reviews", "transmittals", "readiness"];

export function cellText(c: Cell): string {
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

/**
 * Where the same rows live as a working list. A report that would only repeat
 * the register, the reviews or the transmittals sends the reader there instead
 * of printing them twice.
 */
const SEE_ALSO: Partial<Record<ReportId, { label: string; href: string }>> = {
  register: { label: "Open the register, where the same documents can be filtered and exported", href: "/documents?view=all" },
  reviews: { label: "Open the reviews list, where every review ever made is kept", href: "/reviews?status=OPEN" },
  transmittals: { label: "Open transmittals", href: "/transmittals?view=all" },
  readiness: { label: "Open Schedule & actions, where the same activities are worked on", href: "/actions" },
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

export async function buildReport(t: { projectId: string }, id: ReportId): Promise<Report> {
  const report = await api<BackendReport>(projectPath(t, `/reports/${id}`));
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
    seeAlso: SEE_ALSO[id],
  };
}

/** Keep the rows where any cell contains the text, ignoring case. */
export function filterRows(rows: Cell[][], q: string): Cell[][] {
  const needle = q.trim().toLowerCase();
  return needle ? rows.filter((r) => r.some((c) => cellText(c).toLowerCase().includes(needle))) : rows;
}
