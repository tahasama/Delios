import type { Tenant } from "../tenant";

/**
 * One contract for everything that changes by upload and approval.
 *
 * A handler knows four things about its kind and nothing about the workflow
 * around it: how to read a file into a payload, how to describe the change
 * against what is in force, how to apply an approved payload to the live
 * tables, and how to read the live tables back out as a payload.
 *
 * The workflow — draft, submit, approve, supersede, audit — is written once in
 * `src/lib/actions/controlled.ts` and is the same for every kind.
 */

export const CONTROLLED_KINDS = [
  "DISTRIBUTION_MATRIX",
  "SCHEDULE",
  "VALUE_SET",
  "ACTION_DEPARTMENTS",
  "DOCUMENT_REQUIREMENTS",
] as const;
export type ControlledKind = (typeof CONTROLLED_KINDS)[number];

export type ParseIssue = { line: number; message: string };

export type ParseResult =
  | { ok: true; payload: unknown; rowCount: number; notes?: string[] }
  | { ok: false; issues: ParseIssue[] };

/** One line of a human-readable change description. */
export type DiffLine = {
  change: "ADDED" | "REMOVED" | "CHANGED" | "UNCHANGED";
  subject: string;
  detail?: string;
};

export type Handler = {
  kind: ControlledKind;
  title: string;
  /** What this is, in one sentence, for the person about to change it. */
  blurb: string;
  /** The clause that makes this a controlled change. */
  clause: string;
  /** Organization-wide configuration, or one project's? */
  level: "ORG" | "PROJECT";
  /** Header row of the upload template, in order. */
  columns: string[];
  /** One example row, so the template downloads with something in it. */
  sample: string[];
  /** Further rows where one example would not be a valid file on its own. */
  extraSamples?: string[][];
  /** Which function may approve a change of this kind. */
  approverHint: string;
  /** The owner of this list uploads and approves it himself — no second person.
   *  Document Control or an administrator may then decide their own upload. */
  ownerApproves?: boolean;
  /** A verb that lets its holder upload and decide this kind besides Control and Configure — PLAN for the project manager's list. */
  ownerVerb?: "PLAN";
  /** Changed directly on its own page, without approval (value sets: agreed in the DMP). Kept here for its parser and history. */
  direct?: boolean;
  /** Rows for "In force" when the payload fields do not map one-to-one onto columns. */
  exportRows?(t: Tenant, key: string): Promise<string[][]>;

  parse(t: Tenant, rows: string[][], key: string): Promise<ParseResult>;
  /** The live state, read back in the same shape a parse produces. */
  current(t: Tenant, key: string): Promise<unknown>;
  diff(current: unknown, next: unknown): DiffLine[];
  /** `versionLabel` is the approved version's label, so anything the apply
   *  records downstream carries the same name the decision was made under. */
  apply(t: Tenant, payload: unknown, key: string, versionLabel: string): Promise<{ summary: string }>;
};

const HANDLERS = new Map<ControlledKind, Handler>();

export function register(handler: Handler) {
  HANDLERS.set(handler.kind, handler);
}

export function handlerFor(kind: string): Handler | null {
  return HANDLERS.get(kind as ControlledKind) ?? null;
}

export function allHandlers(): Handler[] {
  return CONTROLLED_KINDS.map((k) => HANDLERS.get(k)).filter((h): h is Handler => !!h);
}

// ── Shared helpers for handlers ──────────────────────────────────────────────

export function headerIndex(rows: string[][], columns: string[]): { index: Map<string, number>; missing: string[] } {
  const header = (rows[0] ?? []).map((h) => h.trim());
  const index = new Map<string, number>();
  header.forEach((h, i) => index.set(h, i));
  return { index, missing: columns.filter((c) => !index.has(c)) };
}

export function cell(row: string[], index: Map<string, number>, column: string): string {
  const i = index.get(column);
  return i === undefined ? "" : (row[i] ?? "").trim();
}

export function parseDate(raw: string): Date | null {
  if (!raw) return null;
  // One format only. A schedule that arrives in three date formats is a
  // schedule nobody can reconcile (§14.6).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Compare two keyed collections and describe the difference. Handlers supply
 * the key and a one-line rendering; the walk itself is the same every time.
 */
export function diffByKey<T>(
  current: T[],
  next: T[],
  keyOf: (item: T) => string,
  render: (item: T) => string,
): DiffLine[] {
  const before = new Map(current.map((i) => [keyOf(i), i]));
  const after = new Map(next.map((i) => [keyOf(i), i]));
  const lines: DiffLine[] = [];

  for (const [key, item] of after) {
    const was = before.get(key);
    if (!was) {
      lines.push({ change: "ADDED", subject: key, detail: render(item) });
    } else if (render(was) !== render(item)) {
      lines.push({ change: "CHANGED", subject: key, detail: `${render(was)}  →  ${render(item)}` });
    } else {
      lines.push({ change: "UNCHANGED", subject: key, detail: render(item) });
    }
  }
  for (const [key, item] of before) {
    if (!after.has(key)) lines.push({ change: "REMOVED", subject: key, detail: render(item) });
  }

  const order = { ADDED: 0, CHANGED: 1, REMOVED: 2, UNCHANGED: 3 };
  return lines.sort((a, b) => order[a.change] - order[b.change] || a.subject.localeCompare(b.subject));
}

export function summariseDiff(lines: DiffLine[]): string {
  const n = (c: DiffLine["change"]) => lines.filter((l) => l.change === c).length;
  const parts = [
    n("ADDED") ? `${n("ADDED")} added` : "",
    n("CHANGED") ? `${n("CHANGED")} changed` : "",
    n("REMOVED") ? `${n("REMOVED")} removed` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "no change";
}

// ── The state machine ────────────────────────────────────────────────────────

export type VersionState = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "SUPERSEDED";

/**
 * Whether a decision may be taken, and if not, why. Kept as a pure function so
 * the rule can be tested without standing up a request — the server action is
 * then only responsible for loading the row and recording the outcome.
 */
export function canDecide(input: {
  state: VersionState | string;
  submittedById: string | null;
  userId: string;
  mayConfigure: boolean;
  /** For a list its owner approves: Control is enough, and self-approval is allowed. */
  ownerApproves?: boolean;
  /** A verb that lets its holder upload and decide this kind besides Control and Configure — PLAN for the project manager's list. */
  ownerVerb?: "PLAN";
  mayControl?: boolean;
}): { ok: true } | { ok: false; error: string } {
  if (input.state !== "SUBMITTED") {
    return { ok: false, error: `This version is ${String(input.state).toLowerCase()} — only a submitted version can be decided.` };
  }
  if (input.ownerApproves) {
    return input.mayConfigure || input.mayControl ? { ok: true } : { ok: false, error: "Deciding this list needs Control or Configure." };
  }
  if (!input.mayConfigure) {
 return { ok: false, error: "Deciding a controlled change needs the Configure permission." };
  }
  // §8.3 — attribution: the person who proposed a change is not the person who
  // blesses it. Without this, "approval" records nothing anyone can rely on.
  if (input.submittedById && input.submittedById === input.userId) {
 return { ok: false, error: "You submitted this version. Someone else has to approve it." };
  }
  return { ok: true };
}

/** Whether a draft may still be worked on. */
export function canSubmit(input: { state: string; mayChange: boolean }): { ok: true } | { ok: false; error: string } {
  if (input.state !== "DRAFT") return { ok: false, error: `This version is ${input.state.toLowerCase()}, not a draft.` };
  if (!input.mayChange) return { ok: false, error: "Submitting a controlled change needs Configure or Control." };
  return { ok: true };
}
