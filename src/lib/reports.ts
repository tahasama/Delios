import type { Tenant } from "./tenant";
import { clearance } from "./requirements-process";

/**
 * The reports a project team reads. Each one answers one question with:
 *   - a few headline figures,
 *   - one simple chart (horizontal bars, stacked by state),
 *   - the detailed list behind it — the actual documents, reviews,
 *     transmittals or activities — which is what the CSV exports.
 * Every figure is counted from the register when the report is opened.
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

const DAY = 86_400_000;
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
const days = (a: Date, b: Date) => Math.floor((b.getTime() - a.getTime()) / DAY);
const docLink = (d: { id: string; docNumber: string }): Cell => ({ text: d.docNumber, href: `/documents/${d.id}` });

export function cellText(c: Cell): string {
  return typeof c === "object" ? c.text : String(c);
}

export async function buildReport(t: Tenant, id: ReportId): Promise<Report> {
  switch (id) {
    case "register": return registerStatus(t);
    case "deliveries": return deliveries(t);
    case "reviews": return reviews(t);
    case "transmittals": return transmittals(t);
    case "readiness": return readiness(t);
  }
}

// ── Register status ─────────────────────────────────────────────────────────

async function registerStatus(t: Tenant): Promise<Report> {
  const docs = await t.db.document.findMany({
    orderBy: { docNumber: "asc" },
    select: { id: true, docNumber: true, title: true, discipline: true, state: true, revisions: { select: { value: true, state: true, statusCode: true, releasedAt: true }, orderBy: { createdAt: "desc" } } },
  });
  const segments: Segment[] = [
    { key: "planned", label: "Not started", tone: "muted" },
    { key: "work", label: "In work", tone: "info" },
    { key: "review", label: "In review", tone: "warn" },
    { key: "released", label: "Released", tone: "good" },
    { key: "out", label: "Out of use", tone: "bad" },
  ];
  const label = Object.fromEntries(segments.map((s) => [s.key, s.label]));
  const stageOf = (d: (typeof docs)[number]) => {
    if (["WITHDRAWN", "CANCELLED", "ARCHIVED", "DISPOSED"].includes(d.state)) return "out";
    if (d.revisions.some((r) => r.state === "RELEASED")) return "released";
    const latest = d.revisions[0]?.state;
    if (latest === "IN_REVIEW") return "review";
    if (latest === "IN_PREPARATION") return "work";
    return "planned";
  };
  const bars = new Map<string, Bar>();
  for (const d of docs) {
    const bar = bars.get(d.discipline) ?? { label: d.discipline, values: {} };
    const s = stageOf(d);
    bar.values[s] = (bar.values[s] ?? 0) + 1;
    bars.set(d.discipline, bar);
  }
  const count = (s: string) => docs.filter((d) => stageOf(d) === s).length;
  return {
    id: "register", title: "Register status", question: "Where does every document stand?",
    seeAlso: { label: "Open the register, where the same documents can be filtered and exported", href: "/documents?view=all" },
    audience: "The master document register — for the project manager or the client, weekly.",
    figures: [
      { label: "Documents", value: docs.length },
      { label: "Released", value: `${pct(count("released"), docs.length)}%`, tone: "good" },
      { label: "In review", value: count("review") },
      { label: "Not started", value: count("planned"), tone: count("planned") ? "warn" : undefined },
    ],
    chart: { title: "Documents by discipline", segments, bars: [...bars.values()].sort((a, b) => a.label.localeCompare(b.label)) },
    columns: ["Document", "Title", "Discipline", "Stage", "Current revision", "Status", "Released"],
    rows: docs.map((d) => {
      const current = d.revisions.find((r) => r.state === "RELEASED") ?? d.revisions[0];
      const s = stageOf(d);
      return [docLink(d), d.title, d.discipline, { text: label[s], tone: s === "released" ? "good" : s === "review" ? "warn" : s === "out" ? "bad" : undefined }, current?.value ?? "—", current?.statusCode ?? "—", iso(d.revisions.find((r) => r.state === "RELEASED")?.releasedAt)];
    }),
    empty: "The register is empty.",
  };
}

// ── Deliveries against plan ─────────────────────────────────────────────────

async function deliveries(t: Tenant): Promise<Report> {
  const docs = await t.db.document.findMany({
    where: { state: { notIn: ["CANCELLED", "WITHDRAWN"] } },
    select: {
      id: true, docNumber: true, title: true, originator: true, discipline: true,
      baselineEntries: { select: { requiredBy: true }, orderBy: { requiredBy: "asc" }, take: 1 },
      revisions: { select: { plannedSubmissionDate: true, submittedAt: true, createdAt: true, state: true, cycles: { select: { submittedAt: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  const parties = new Map((await t.db.party.findMany({ select: { code: true, name: true } })).map((p) => [p.code, p.name]));
  const now = new Date();
  const segments: Segment[] = [
    { key: "onTime", label: "Delivered on time", tone: "good" },
    { key: "late", label: "Delivered late", tone: "warn" },
    { key: "overdue", label: "Overdue", tone: "bad" },
    { key: "coming", label: "Not due yet", tone: "muted" },
  ];
  const bars = new Map<string, Bar>();
  const rows: Cell[][] = [];
  const tally = { onTime: 0, late: 0, overdue: 0, coming: 0 };
  for (const d of docs) {
    const due = d.baselineEntries[0]?.requiredBy ?? d.revisions.find((r) => r.plannedSubmissionDate)?.plannedSubmissionDate ?? null;
    if (!due) continue;
    const sender = d.originator ? parties.get(d.originator) ?? d.originator : `Us — ${d.discipline}`;
    const sent = d.revisions
      .map((r) => r.submittedAt ?? r.cycles.map((c) => c.submittedAt).sort((a, b) => +a - +b)[0] ?? (r.state !== "IN_PREPARATION" ? r.createdAt : null))
      .filter((x): x is Date => !!x)
      .sort((a, b) => +a - +b)[0];
    const state: keyof typeof tally = sent ? (sent <= due ? "onTime" : "late") : due < now ? "overdue" : "coming";
    tally[state]++;
    const bar = bars.get(sender) ?? { label: sender, values: {} };
    bar.values[state] = (bar.values[state] ?? 0) + 1;
    bars.set(sender, bar);
    const lateBy = sent ? days(due, sent) : days(due, now);
    rows.push([
      docLink(d), d.title, sender, iso(due), iso(sent),
      state === "late" || state === "overdue" ? { text: `${lateBy} d`, tone: state === "overdue" ? "bad" : "warn" } : "—",
      { text: segments.find((s) => s.key === state)!.label, tone: state === "onTime" ? "good" : state === "late" ? "warn" : state === "overdue" ? "bad" : undefined },
    ]);
  }
  const order = { overdue: 0, late: 1, coming: 2, onTime: 3 } as const;
  rows.sort((a, b) => order[stateKey(a[6])] - order[stateKey(b[6])]);
  function stateKey(c: Cell): keyof typeof order {
    const text = cellText(c);
    return text === "Overdue" ? "overdue" : text === "Delivered late" ? "late" : text === "Not due yet" ? "coming" : "onTime";
  }
  const delivered = tally.onTime + tally.late;
  return {
    id: "deliveries", title: "Deliveries against plan", question: "Who is delivering on time, and what is overdue?",
    audience: "Supplier and discipline follow-up — for expediting meetings.",
    figures: [
      { label: "Planned", value: rows.length },
      { label: "Delivered", value: delivered },
      { label: "On time", value: `${pct(tally.onTime, delivered)}%`, tone: pct(tally.onTime, delivered) >= 80 ? "good" : "warn" },
      { label: "Overdue now", value: tally.overdue, tone: tally.overdue ? "bad" : "good" },
    ],
    chart: { title: "Documents by sender", segments, bars: [...bars.values()].sort((a, b) => a.label.localeCompare(b.label)) },
    columns: ["Document", "Title", "Sender", "Due", "Delivered", "Late by", "State"],
    rows,
    empty: "No document has a planned or needed-by date yet.",
  };
}

// ── Reviews ─────────────────────────────────────────────────────────────────

async function reviews(t: Tenant): Promise<Report> {
  const open = await t.db.reviewAssignment.findMany({
    where: { completedAt: null, cycle: { status: "OPEN", issuedToReviewAt: { not: null } } },
    include: { cycle: { select: { issuedToReviewAt: true, revision: { select: { value: true, document: { select: { id: true, docNumber: true, title: true } } } } } } },
  });
  const since = new Date(Date.now() - 90 * DAY);
  const returned = await t.db.reviewCycle.findMany({ where: { returnedToOriginatorAt: { gte: since } }, select: { submittedAt: true, returnedToOriginatorAt: true } });
  const now = new Date();
  const segments: Segment[] = [
    { key: "fresh", label: "Under a week", tone: "good" },
    { key: "week", label: "1–2 weeks", tone: "warn" },
    { key: "old", label: "Over 2 weeks", tone: "bad" },
  ];
  const ageKey = (n: number) => (n < 7 ? "fresh" : n <= 14 ? "week" : "old");
  const bars = new Map<string, Bar>();
  const rows = open
    .map((a) => ({ a, age: days(a.cycle.issuedToReviewAt!, now) }))
    .sort((x, y) => y.age - x.age)
    .map(({ a, age }) => {
      const bar = bars.get(a.userName) ?? { label: a.userName, values: {} };
      bar.values[ageKey(age)] = (bar.values[ageKey(age)] ?? 0) + 1;
      bars.set(a.userName, bar);
      const d = a.cycle.revision.document;
      return [docLink(d), d.title, `rev ${a.cycle.revision.value}`, a.userName, iso(a.cycle.issuedToReviewAt), { text: `${age} d`, tone: age > 14 ? "bad" : age >= 7 ? "warn" : undefined }] as Cell[];
    });
  const turnaround = returned.length ? returned.reduce((n, c) => n + (c.returnedToOriginatorAt!.getTime() - c.submittedAt.getTime()) / DAY, 0) / returned.length : 0;
  const old = open.filter((a) => days(a.cycle.issuedToReviewAt!, now) > 14).length;
  return {
    id: "reviews", title: "Reviews waiting", question: "What is with reviewers, and for how long?",
    seeAlso: { label: "Open the reviews list, where every review ever made is kept", href: "/reviews?status=OPEN" },
    audience: "Chasing reviewers — for the weekly engineering meeting.",
    figures: [
      { label: "With reviewers", value: rows.length, tone: rows.length ? "warn" : "good" },
      { label: "Over 2 weeks", value: old, tone: old ? "bad" : "good" },
      { label: "Returned (90 days)", value: returned.length },
      { label: "Average turnaround", value: `${turnaround.toFixed(1)} d` },
    ],
    chart: { title: "Open reviews by reviewer, by age", segments, bars: [...bars.values()].sort((a, b) => Object.values(b.values).reduce((n, v) => n + v, 0) - Object.values(a.values).reduce((n, v) => n + v, 0)) },
    columns: ["Document", "Title", "Revision", "Reviewer", "With them since", "Waiting"],
    rows,
    empty: "No review is waiting on anyone.",
  };
}

// ── Transmittals ────────────────────────────────────────────────────────────

async function transmittals(t: Tenant): Promise<Report> {
  const since = new Date(Date.now() - 180 * DAY);
  const now = new Date();
  const list = await t.db.transmittal.findMany({
    where: { OR: [{ dateOfIssue: { gte: since } }, { status: "ISSUED", direction: "INCOMING" }, { responseRequired: true, status: { notIn: ["CLOSED"] } }] },
    include: { recipients: { select: { name: true, acknowledgedAt: true } }, items: { select: { id: true } } },
    orderBy: { dateOfIssue: "desc" },
  });
  const segments: Segment[] = [
    { key: "out", label: "Issued", tone: "info" },
    { key: "in", label: "Received", tone: "good" },
  ];
  const months: Bar[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ label: d.toLocaleString("en-GB", { month: "short", year: "2-digit" }), values: {} });
  }
  for (const x of list) {
    const m = (now.getFullYear() - x.dateOfIssue.getFullYear()) * 12 + now.getMonth() - x.dateOfIssue.getMonth();
    if (m < 0 || m > 5) continue;
    const bar = months[5 - m];
    const k = x.direction === "INCOMING" ? "in" : "out";
    bar.values[k] = (bar.values[k] ?? 0) + 1;
  }
  const waitingOn = (x: (typeof list)[number]): Cell => {
    if (x.status === "REJECTED") return { text: "Rejected — awaiting resubmission", tone: "warn" };
    if (x.direction === "INCOMING" && x.status === "ISSUED") return { text: "Us — check and accept", tone: "warn" };
    if (x.responseRequired && x.status !== "CLOSED" && x.responseDueDate) {
      return x.responseDueDate < now ? { text: `Response overdue since ${iso(x.responseDueDate)}`, tone: "bad" } : { text: `Response due ${iso(x.responseDueDate)}` };
    }
    return "—";
  };
  const rows = list.map((x) => [
    { text: x.number, href: `/transmittals/${x.id}` }, x.direction === "INCOMING" ? "In" : "Out", iso(x.dateOfIssue),
    x.direction === "INCOMING" ? x.issuingParty : x.recipients.map((r) => r.name).filter(Boolean).join(", "),
    x.items.length, `${x.recipients.filter((r) => r.acknowledgedAt).length}/${x.recipients.length}`, waitingOn(x),
  ] as Cell[]);
  const toCheck = list.filter((x) => x.direction === "INCOMING" && x.status === "ISSUED").length;
  const overdue = list.filter((x) => x.responseRequired && x.responseDueDate && x.responseDueDate < now && x.status !== "CLOSED").length;
  return {
    id: "transmittals", title: "Transmittal log", question: "What went out and came in, and what is still waiting?",
    seeAlso: { label: "Open transmittals", href: "/transmittals?view=all" },
    audience: "The transmittal log — for the client or a supplier review.",
    figures: [
      { label: "Issued (6 months)", value: list.filter((x) => x.direction === "OUTGOING").length },
      { label: "Received (6 months)", value: list.filter((x) => x.direction === "INCOMING").length },
      { label: "To check", value: toCheck, tone: toCheck ? "warn" : "good" },
      { label: "Responses overdue", value: overdue, tone: overdue ? "bad" : "good" },
    ],
    chart: { title: "Transmittals per month", segments, bars: months },
    columns: ["Transmittal", "In / out", "Date", "From / to", "Documents", "Acknowledged", "Waiting on"],
    rows,
    empty: "No transmittal in the last six months.",
  };
}

// ── Activity readiness ──────────────────────────────────────────────────────

async function readiness(t: Tenant): Promise<Report> {
  const horizon = new Date(Date.now() + 30 * DAY);
  const actions = await t.db.action.findMany({
    where: { scheduledDate: { lte: horizon } },
    orderBy: { scheduledDate: "asc" },
    include: { confirmations: true, entries: { include: { document: { include: { revisions: { where: { state: "RELEASED" }, orderBy: { releasedAt: "desc" }, take: 1 } } } } } },
  });
  const now = new Date();
  const segments: Segment[] = [
    { key: "ready", label: "Ready", tone: "good" },
    { key: "coming", label: "Not yet, not late", tone: "warn" },
    { key: "late", label: "Missing and late", tone: "bad" },
  ];
  const bars: Bar[] = [];
  const rows: Cell[][] = [];
  for (const a of actions) {
    const bar: Bar = { label: a.code, values: {} };
    for (const e of a.entries) {
      const has = e.document.revisions[0];
      const ready = has?.statusCode === e.requiredStatus;
      const key = ready ? "ready" : e.requiredBy < now ? "late" : "coming";
      bar.values[key] = (bar.values[key] ?? 0) + 1;
      rows.push([
        { text: a.code, href: `/actions/${a.code}` }, iso(a.scheduledDate), docLink(e.document), e.department ?? "—",
        e.requiredStatus, has ? `rev ${has.value} · ${has.statusCode}` : "nothing released", iso(e.requiredBy),
        { text: ready ? "Ready" : key === "late" ? "Late" : "Not yet", tone: ready ? "good" : key === "late" ? "bad" : "warn" },
      ]);
    }
    if (a.entries.length) bars.push(bar);
  }
  const cleared = actions.filter((a) => clearance(a).cleared).length;
  const late = rows.filter((r) => cellText(r[7]) === "Late").length;
  return {
    id: "readiness", title: "Activity readiness", question: "Are the next 30 days of activities covered by their documents?",
    seeAlso: { label: "Open Schedule & actions, where the same activities are worked on", href: "/actions" },
    audience: "Look-ahead — for the site coordination or planning meeting.",
    figures: [
      { label: "Activities", value: actions.length },
      { label: "Cleared to go", value: cleared, tone: "good" },
      { label: "Documents needed", value: rows.length },
      { label: "Missing and late", value: late, tone: late ? "bad" : "good" },
    ],
    chart: { title: "Documents needed per activity", segments, bars },
    columns: ["Activity", "Date", "Document", "Department", "Needed at", "Has", "Submit by", "Ready"],
    rows,
    empty: "No activity in the next 30 days.",
  };
}


/** Keep the rows where any cell contains the text, ignoring case. */
export function filterRows(rows: Cell[][], q: string): Cell[][] {
  const needle = q.trim().toLowerCase();
  return needle ? rows.filter((r) => r.some((c) => cellText(c).toLowerCase().includes(needle))) : rows;
}
