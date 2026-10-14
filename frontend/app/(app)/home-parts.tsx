import Link from "next/link";
import { Count } from "./tally";
import { fmtDate } from "@/lib/core/utils";
import { btn } from "@/components/ui";
import { ArrowRight } from "lucide-react";

/** One row of a queue: a thing, a tag, how long it waited, the verb. */
export type Row = {
  href: string;
  /** Document or transmittal number — or, for a requirements ask, its sentence. */
  code: string;
  /** True when the code is prose, not a number, so it is not set in mono. */
  plain?: boolean;
  rev?: string | null;
  title: string;
  tag: string;
  tone: "amber" | "sky" | "emerald" | "violet" | "plain";
  at?: Date | null;
  cta: string;
};

/**
 * What the project did, and what to call it.
 *
 * The journal used to follow documents — released, decided, returned — which
 * is the register's job and says nothing about the transmittal that went out
 * or the requirements that were asked for. A project is run by its activities,
 * so every kind of activity is here: what came in and went out, what was
 * reviewed and decided, what was asked for, and what the register itself was
 * checked against. Each carries the word for what kind of thing it was, so a
 * reader can tell a transmittal from a verdict without reading the sentence. Each act its own colour; close acts close colours.
 */
export const ACTIVITY: Record<string, { kind: string; said: string; mark: string }> = {
  TRANSMITTAL_RAISED: { kind: "Transmittal", said: "was issued", mark: "border-violet-600" },
  TRANSMITTAL_OPENED: { kind: "Transmittal", said: "was received", mark: "border-cyan-500" },
  TRANSMITTAL_RECEIVED: { kind: "Transmittal", said: "was received", mark: "border-cyan-500" },
  TRANSMITTAL_ACCEPTED: { kind: "Transmittal", said: "was accepted on arrival", mark: "border-green-500" },
  TRANSMITTAL_REJECTED: { kind: "Transmittal", said: "was returned to its sender", mark: "border-orange-500" },
  TRANSMITTAL_FILES_ATTACHED: { kind: "Transmittal", said: "had what came with it kept", mark: "border-line-strong" },
  TRANSMITTAL_FILE_REGISTERED: { kind: "Transmittal", said: "had a file it brought made a register document", mark: "border-teal-500" },
  TRANSMITTAL_CHASED: { kind: "Transmittal", said: "was notified again to whoever had not opened it", mark: "border-yellow-500" },
  TRANSMITTAL_SENT_ON: { kind: "Transmittal", said: "was sent on to an organization outside the system", mark: "border-indigo-400" },
  TRANSMITTAL_CLOSED: { kind: "Transmittal", said: "was closed", mark: "border-slate-400" },
  ACTION_CARRIED: { kind: "Schedule", said: "went ahead without all of its documents", mark: "border-amber-500" },
  ACTION_STOPPED: { kind: "Schedule", said: "was postponed", mark: "border-stone-400" },
  CUSTODY: { kind: "Transmittal", said: "was handed over", mark: "border-violet-400" },
  ISSUE_REQUESTED: { kind: "Issue", said: "was requested for issue", mark: "border-purple-300" },
  ISSUE: { kind: "Issue", said: "was issued", mark: "border-violet-600" },
  ISSUED: { kind: "Issue", said: "was issued", mark: "border-violet-600" },
  ISSUE_REQUEST_CANCELLED: { kind: "Issue", said: "issue request cancelled", mark: "border-line-strong" },
  RELEASE: { kind: "Release", said: "was released", mark: "border-emerald-500" },
  WORKFLOW_STARTED: { kind: "Review", said: "was sent for review", mark: "border-sky-500" },
  STEP_DISPATCHED: { kind: "Review", said: "moved to the next step", mark: "border-sky-300" },
  REVIEW_OUTCOME: { kind: "Decision", said: "was decided", mark: "border-blue-600" },
  APPROVAL: { kind: "Decision", said: "was approved", mark: "border-green-600" },
  WORKFLOW_COMPLETED: { kind: "Decision", said: "completed its review", mark: "border-emerald-600" },
  WORKFLOW_RETURNED: { kind: "Return", said: "was returned to its author", mark: "border-orange-400" },
  RELEASE_REFUSED: { kind: "Return", said: "was sent back by Document Control", mark: "border-orange-600" },
  OUTSIDE_APPROVED: { kind: "Release", said: "was approved by the outside party — with Document Control", mark: "border-lime-500" },
  OUTSIDE_REFUSED: { kind: "Return", said: "was not approved by the outside party — with Document Control", mark: "border-red-500" },
  REVISION_HELD: { kind: "Return", said: "was put on hold, not for use", mark: "border-red-600" },
  REVISION_HOLD_LIFTED: { kind: "Release", said: "had its hold lifted and is in use again", mark: "border-emerald-400" },
  REVISION_ESTABLISHED: { kind: "Revision", said: "was opened", mark: "border-line-strong" },
  REGISTER_ENTRY: { kind: "Register", said: "was added to the register", mark: "border-line-strong" },
  REQUIREMENTS_ISSUED: { kind: "Requirements", said: "were issued", mark: "border-line-strong" },
  REQUIREMENTS_REMINDER: { kind: "Requirements", said: "were reminded", mark: "border-amber-600" },
  SHORTFALL_ISSUED: { kind: "Schedule", said: "was reported short", mark: "border-amber-600" },
  SHORTFALL_ACCEPTED: { kind: "Schedule", said: "shortfall was accepted", mark: "border-line-strong" },
  DELEGATION_REQUESTED: { kind: "Review", said: "was asked to be handed over", mark: "border-amber-600" },
  DELEGATION_GRANTED: { kind: "Review", said: "was handed to somebody else", mark: "border-brand-line" },
  DELEGATION_REFUSED: { kind: "Review", said: "stayed with its reviewer", mark: "border-line-strong" },
  DELEGATION_WITHDRAWN: { kind: "Review", said: "came back to its reviewer", mark: "border-line-strong" },
  CHECK_RUN: { kind: "Register", said: "was checked", mark: "border-line-strong" },
};

export const NEWS = Object.keys(ACTIVITY);

/** The kinds of act, in the order they were named, each said once. */
export const KINDS = [...new Set(Object.values(ACTIVITY).map((one) => one.kind))];

/**
 * The backend's names for acts the journal already knows, under the names the
 * journal uses. An act with no entry here is not shown.
 */
export const ALIAS: Record<string, string> = {
  RELEASED: "RELEASE",
  REVIEW_STARTED: "WORKFLOW_STARTED",
  VERDICT: "REVIEW_OUTCOME",
  REVIEW_DECIDED: "WORKFLOW_COMPLETED",
  RETURNED_TO_AUTHOR: "WORKFLOW_RETURNED",
  RETURNED_FOR_CORRECTION: "RELEASE_REFUSED",
  SUBMISSION_ACCEPTED: "TRANSMITTAL_ACCEPTED",
  TRANSMITTAL_ISSUED: "TRANSMITTAL_RAISED",
  TRANSMITTAL_DISPATCHED: "TRANSMITTAL_SENT_ON",
  UNPLANNED_REGISTERED: "TRANSMITTAL_FILE_REGISTERED",
};

/**
 * A date from the address, as the day it names. The end of a window is the end
 * of that day, so asking for the 3rd to the 3rd returns the 3rd.
 */
export function startOfDay(said: string | undefined, end = false): Date | null {
  if (!said) return null;
  const at = new Date(said);
  if (Number.isNaN(at.getTime())) return null;
  at.setHours(end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
  return at;
}

/** The edge a kind of act is filed under, as in the administrators' log. */
export const LOG_EDGE: Record<string, string> = {
  Review: "edge-move",
  Decision: "edge-settle",
  Release: "edge-settle",
  Return: "edge-back",
  Requirements: "edge-back",
  Schedule: "edge-back",
  Transmittal: "edge-send",
  Issue: "edge-send",
  Revision: "edge-keep",
  Register: "edge-keep",
};

export const TONES: Record<Row["tone"], string> = {
  amber: "bg-amber-50 text-amber-700",
  sky: "bg-sky-50 text-sky-700",
  emerald: "bg-emerald-50 text-emerald-700",
  violet: "bg-violet-50 text-violet-700",
  plain: "bg-canvas-deep text-slate-600",
};

/** The number and revision inside an audit label, if it carries them. */
export function read(label: string | null): { number: string; rev: string | null } | null {
  const said = (label ?? "").split(" — ")[0].trim();
  if (!said) return null;
  const at = said.lastIndexOf(" rev ");
  return at === -1 ? { number: said, rev: null } : { number: said.slice(0, at), rev: said.slice(at + 5) };
}

export function daysOf(at: Date | null | undefined): number | null {
  if (!at) return null;
  return Math.max(0, Math.round((Date.now() - at.getTime()) / 86_400_000));
}

/** The last working day, so on a Monday the news says "since Friday". */
export function lastWorkingDay(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  do {
    d.setDate(d.getDate() - 1);
  } while (d.getDay() === 0 || d.getDay() === 6);
  return d;
}

/** The acts of the log, filed under the day they happened. */
export function dayed<T extends { ts: Date }>(acts: T[]): { day: string; when: Date; acts: T[] }[] {
  const days: { day: string; when: Date; acts: T[] }[] = [];
  for (const act of acts) {
    const day = act.ts.toDateString();
    const last = days[days.length - 1];
    if (last?.day === day) last.acts.push(act);
    else days.push({ day, when: act.ts, acts: [act] });
  }
  return days;
}

export function weekday(d: Date): string {
  return d.toLocaleDateString("en-GB", { weekday: "long" });
}

/** How long ago, in the words a person would use. */
export function when(at: Date): string {
  const mins = Math.round((Date.now() - at.getTime()) / 60_000);
  if (mins < 60) return mins <= 1 ? "just now" : `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return fmtDate(at);
}

export function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

/** One figure in the band. It counts up once, from a value already rendered. */
export function Fig({ value, unit, label, index, href }: {
  value: number;
  unit?: string;
  label: string;
  /** Its place in the row, which is also when it starts counting. */
  index: number;
  href?: string;
}) {
  const body = (
    <>
      <Count value={value} unit={unit} delay={index * 60} />
      <span className={`home-soft mt-1.5 block text-[12.5px] ${href ? "group-hover:underline group-hover:underline-offset-[3px]" : ""}`}>{label}</span>
    </>
  );
  const frame = "home-rule block border-r pr-4 last:border-r-0 even:border-r-0 md:even:border-r md:last:border-r-0";
  return href ? <Link href={href} className={`group ${frame}`}>{body}</Link> : <div className={frame}>{body}</div>;
}

/** What a card needs to know about its aspect. */
export type Aspect = {
  id: string;
  title: string;
  icon: React.ReactNode;
  /** Its own colour, kept to the card's edge so the board stays quiet. */
  accent: "brand" | "indigo" | "blue" | "sky" | "cyan" | "teal" | "violet" | "steel" | "ocean" | "slate";
  /** Its name in the tab bar, kept to a word or two. */
  tab: string;
  /** What is being asked of the reader, in one line. */
  asks: string;
  /** What hangs on it, in one more. */
  then: string;
  call: string;
};

/**
 * The edge is the only coloured thing on a card, and it is pale on purpose.
 * Every aspect has one of its own: two cards sharing a colour look related,
 * and none of these are.
 */
export const EDGE: Record<Aspect["accent"], string> = {
  brand: "edge-brand",
  indigo: "edge-indigo",
  blue: "edge-blue",
  sky: "edge-sky",
  cyan: "edge-cyan",
  teal: "edge-teal",
  violet: "edge-violet",
  steel: "edge-steel",
  ocean: "edge-ocean",
  slate: "edge-slate",
};



/**
 * One aspect, as a card: how many, what is being asked, and how old it is.
 *
 * No document is named. Naming one would be a decision about which document
 * matters, and that decision belongs to the reader, in the list the card opens.
 * What a queue must say from across the room is its size and its age, so the
 * age is drawn — one bar, oldest first — rather than described.
 */
export function Card({ aspect, rows, style }: { aspect: Aspect; rows: Row[]; style?: React.CSSProperties }) {
  // Some queues hold things that never had a date — an ask in the requirements
  // process is not "from Tuesday", it is simply open. A card for those says so
  // rather than reporting an age it made up.
  const dated = rows.filter((one) => one.at);
  const oldest = Math.max(0, ...dated.map((one) => daysOf(one.at) ?? 0));
  const bucket = (days: number | null) => (days === null ? "week" : days >= 7 ? "old" : days >= 1 ? "week" : "new");
  const count = { old: 0, week: 0, new: 0 };
  for (const one of dated) count[bucket(daysOf(one.at))] += 1;
  // The states the queue holds, counted: three at most, so the card keeps its
  // shape whatever is in it.
  const byTag = new Map<string, number>();
  for (const one of rows) byTag.set(one.tag, (byTag.get(one.tag) ?? 0) + 1);
  const states = [...byTag.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const said = [
    count.old ? `${count.old} over a week` : null,
    count.week ? `${count.week} this week` : null,
    count.new ? `${count.new} today` : null,
  ].filter(Boolean).join(" · ");

  return (
    <Link
      href={`/?view=${aspect.id}`}
      scroll={false}
      style={style}
      className="home-rise group register register-sheet register-sheet-open relative flex min-w-0 flex-col overflow-hidden px-4 pt-3.5 pb-3 transition hover:border-line-strong"
    >
      <span className={`absolute inset-y-0 left-0 w-0.75 ${EDGE[aspect.accent]}`} aria-hidden="true" />

      <span className="flex min-w-0 items-center gap-2">
        <span className="grid h-5.5 w-5.5 shrink-0 place-items-center rounded-md bg-canvas-deep text-slate-500 [&_svg]:h-3.25 [&_svg]:w-3.25">{aspect.icon}</span>
        <h2 className="truncate text-[13px] font-semibold text-slate-800">{aspect.title}</h2>
        <b className="ml-auto font-mono text-[22px] leading-none font-semibold tracking-tight tabular-nums text-slate-900">{rows.length}</b>
      </span>

      <span className="mt-2 block truncate text-[12.5px] text-slate-600">{aspect.asks}</span>
      <span className="mt-0.5 block truncate text-[12px] text-slate-400">{aspect.then}</span>

      {states.length ? (
        <span className="mt-2.5 flex flex-wrap gap-1">
          {states.map(([tag, n]) => (
            <span key={tag} className="rounded bg-canvas-deep px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-600">
              {tag}{n > 1 ? ` ${n}` : ""}
            </span>
          ))}
        </span>
      ) : null}

      <span className="home-fill mt-3.5 flex h-1 gap-0.5 overflow-hidden rounded-full">
        {!dated.length ? <i className="block flex-1 rounded-full bg-slate-200" /> : null}
        {count.old ? <i className="block rounded-full bg-amber-500" style={{ flex: count.old }} /> : null}
        {count.week ? <i className="block rounded-full bg-brand-line" style={{ flex: count.week }} /> : null}
        {count.new ? <i className="block rounded-full bg-slate-300" style={{ flex: count.new }} /> : null}
      </span>

      <span className="mt-1.5 mb-2.5 flex items-baseline gap-2 text-[11.5px] text-slate-500">
        <span className="min-w-0 truncate">{dated.length ? said : `${rows.length} open`}</span>
        {dated.length ? (
          <span className={`ml-auto font-mono tabular-nums whitespace-nowrap ${oldest >= 7 ? "font-semibold text-amber-700" : "text-slate-400"}`}>
            {oldest === 0 ? "all today" : `oldest ${oldest}d`}
          </span>
        ) : (
          <span className="ml-auto whitespace-nowrap text-slate-400">no date</span>
        )}
      </span>

      <span className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-3 text-[12.5px] font-semibold text-link">
        {aspect.call}
        <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

/** One aspect, opened: every row in it, in the same places every time. */
export function Queue({ aspect, rows, style }: { aspect: Aspect; rows: Row[]; style?: React.CSSProperties }) {
  return (
    <section className="home-rise register register-sheet register-sheet-open mb-3.5 min-w-0 overflow-hidden" style={style}>
      <header className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <span className="grid h-5.5 w-5.5 place-items-center rounded-md bg-canvas-deep text-slate-500 [&_svg]:h-3.25 [&_svg]:w-3.25">{aspect.icon}</span>
        <h2 className="text-[13.5px] font-semibold">{aspect.title}</h2>
        <span className="ml-auto font-mono text-xs text-slate-400">{rows.length}</span>
      </header>
      {rows.map((one) => <Line key={one.href + one.code + (one.rev ?? "")} row={one} />)}
    </section>
  );
}

export function Line({ row }: { row: Row }) {
  const days = daysOf(row.at);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-line px-4 py-2.5 transition hover:bg-tint-soft sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
      <Link href={row.href} className="col-span-2 min-w-0 sm:col-span-1">
        <span className={row.plain ? "block text-[13px] font-semibold text-slate-900" : "block font-mono text-[13px] font-semibold whitespace-nowrap text-slate-900"}>
          {row.code}
          {row.rev ? <span className="ml-1.5 font-normal text-slate-400">rev {row.rev}</span> : null}
        </span>
        <span className="mt-px block truncate text-[12.5px] text-slate-500" title={row.title}>{row.title}</span>
      </Link>
      <span className={`rounded-md px-1.5 py-0.5 font-mono text-[11.5px] font-semibold whitespace-nowrap ${TONES[row.tone]}`}>{row.tag}</span>
      <span className={`min-w-12 text-right font-mono text-xs tabular-nums whitespace-nowrap ${days !== null && days >= 5 ? "font-semibold text-amber-700" : "text-slate-400"}`}>
        {days === null ? "—" : days === 0 ? "today" : `${days}d`}
      </span>
      <Link href={row.href} className={`${btn("secondary", "sm")} whitespace-nowrap text-brand-ink`}>
        {row.cta}
      </Link>
    </div>
  );
}
