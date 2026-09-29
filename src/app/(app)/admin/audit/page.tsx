import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { isAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { DateWindow } from "@/components/date-window";

export const dynamic = "force-dynamic";
export const metadata = { title: "The log" };

/**
 * The log: what was done, to what, by whom, on the day it happened.
 *
 * An audit trail is correspondence rather than data — somebody did something
 * to something, and a reader arrives asking what happened, not asking to sort
 * a column. So it is filed the way the dispatch log is filed: the day is a
 * rule across the page, each act is a slip of paper with a coloured edge
 * saying what kind of act it was, and the families of act stand in a list
 * beside it rather than as a row of pills above it.
 */

/** What kind of act this was, and how it is drawn. */
type Family = { id: string; label: string; edge: string; actions: string[] };

const FAMILIES: Family[] = [
  {
    id: "review",
    label: "Reviews and decisions",
    edge: "edge-move",
    actions: ["WORKFLOW_STARTED", "STEP_DISPATCHED", "REVIEW_OUTCOME", "APPROVAL", "WORKFLOW_COMPLETED", "REVIEW_COMMENT", "COMMENT_RECLASSIFIED", "CONDITION_SETTLED", "DELEGATION_REQUESTED", "DELEGATION_GRANTED", "DELEGATION_REFUSED", "DELEGATION_WITHDRAWN"],
  },
  {
    id: "release",
    label: "Releases",
    edge: "edge-settle",
    actions: ["RELEASE", "REGISTER_ENTRY", "REVISION_ESTABLISHED", "STATE_TRANSITION"],
  },
  {
    id: "return",
    label: "Returns and rewinds",
    edge: "edge-back",
    actions: ["WORKFLOW_RETURNED", "ROUTE_REWOUND", "SHORTFALL_ISSUED", "REQUIREMENTS_REMINDER"],
  },
  {
    id: "transmittal",
    label: "Transmittals and issues",
    edge: "edge-send",
    actions: ["TRANSMITTAL_RAISED", "TRANSMITTAL_OPENED", "CUSTODY", "ISSUE", "ISSUED", "ISSUE_REQUESTED", "ISSUE_REQUEST_CANCELLED", "SHORTFALL_ACCEPTED", "REQUIREMENTS_ISSUED"],
  },
  {
    id: "keeping",
    label: "Record keeping",
    edge: "edge-keep",
    actions: ["METADATA_CHANGE", "FILE_UPLOADED", "CHECK_RUN", "PACKAGE_CREATED", "RELATIONSHIP", "TEMPLATE_SAVED", "TEMPLATE_REMOVED", "CONFIG_VALUE_RETIRED", "PERMISSION_RULE_PUBLISHED", "SCOPE_UPDATED", "CONTROL_SETTING_CHANGED", "PROJECT_OPENED", "USER_CREATED", "USER_UPDATED", "VISITOR_CREATED"],
  },
  { id: "access", label: "Who read what", edge: "edge-keep", actions: ["DOWNLOAD", "LOGIN", "ACCESS_GRANTED", "ACCESS_WITHDRAWN"] },
];

const familyOf = (action: string) => FAMILIES.find((f) => f.actions.includes(action));

/**
 * A date from the address, as the day it names. The end of a window is the end
 * of that day, so asking for the 3rd to the 3rd returns the 3rd.
 */
function day(said: string | undefined, end = false): Date | null {
  if (!said) return null;
  const at = new Date(said);
  if (Number.isNaN(at.getTime())) return null;
  at.setHours(end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
  return at;
}

/** The act, in the words a person would use for it. */
function said(action: string): string {
  return action.replaceAll("_", " ").toLowerCase();
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string; family?: string; from?: string; to?: string }> }) {
  const { user, db } = await requireScope();
  if (!isAdmin(user)) {
    return <PageHeader title="The log" subtitle="Administrators only. The evidence for a single act is shown on the thing it happened to — a document, an activity, a transmittal." />;
  }
  const sp = await searchParams;
  const family = FAMILIES.find((f) => f.id === sp.family);
  // A date names a whole day: "from the 3rd" means from midnight, "to the 3rd"
  // means until the end of it, which is what a reader asking for one day
  // expects to get back.
  const from = day(sp.from);
  const to = day(sp.to, true);

  const [events, counts] = await Promise.all([
    db.auditEvent.findMany({
      where: {
        AND: [
          sp.q ? { OR: [{ entityLabel: { contains: sp.q } }, { actorName: { contains: sp.q } }, { detail: { contains: sp.q } }] } : {},
          family ? { action: { in: family.actions } } : {},
          from ? { ts: { gte: from } } : {},
          to ? { ts: { lte: to } } : {},
        ],
      },
      orderBy: { ts: "desc" },
      take: 200,
    }),
    db.auditEvent.groupBy({ by: ["action"], _count: true }),
  ]);

  const countOf = (f: Family) => counts.filter((c) => f.actions.includes(c.action)).reduce((n, c) => n + c._count, 0);
  const total = counts.reduce((n, c) => n + c._count, 0);

  // Filed by the day it happened: correspondence is remembered by its day, and
  // a day with nothing in it is not a heading.
  const days: { day: string; when: Date; acts: typeof events }[] = [];
  for (const e of events) {
    const day = e.ts.toDateString();
    const last = days[days.length - 1];
    if (last?.day === day) last.acts.push(e);
    else days.push({ day, when: e.ts, acts: [e] });
  }

  return (
    <div className="dispatch logbook space-y-5">
      <header className="dispatch-head px-6 py-5">
        <h1 className="dispatch-title">The log</h1>
        <p className="dispatch-lede mt-1.5 max-w-2xl">
          Every controlled act, in the order it happened: who did it, what it was done to, and what changed.
          The evidence for one document is on the document; this is the project's whole memory.
        </p>
        {from || to ? (
          <p className="slip-note mt-2.5">
            Reading {from ? fmtDate(from) : "the beginning"} to {to ? fmtDate(to) : "now"}
            {family ? ` · ${family.label.toLowerCase()}` : ""}
            {sp.q ? ` · “${sp.q}”` : ""}
          </p>
        ) : null}
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[212px_minmax(0,1fr)] lg:items-start">
        <aside className="lg:sticky lg:top-[88px]">
          <nav aria-label="Kinds of act">
            {FAMILIES.map((f) => (
              <Link
                key={f.id}
                href={sp.family === f.id ? "/admin/audit" : `/admin/audit?family=${f.id}`}
                aria-current={sp.family === f.id ? "page" : undefined}
                className={`flex items-baseline gap-3 rounded px-3 py-2 text-[13px] ${
                  sp.family === f.id ? "bg-canvas-deep font-semibold text-slate-900" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <span className="min-w-0 truncate">{f.label}</span>
                <span className="ml-auto font-mono text-[11.5px] text-slate-400">{countOf(f)}</span>
              </Link>
            ))}
            <Link
              href="/admin/audit"
              aria-current={!sp.family ? "page" : undefined}
              className={`mt-1 flex items-baseline gap-3 rounded border-t border-line px-3 py-2 text-[13px] ${
                !sp.family ? "bg-canvas-deep font-semibold text-slate-900" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <span>The whole log</span>
              <span className="ml-auto font-mono text-[11.5px] text-slate-400">{total}</span>
            </Link>
          </nav>

          <form className="mt-5 px-3">
            <p className="slip-label">Find</p>
            <input
              name="q"
              defaultValue={sp.q ?? ""}
              placeholder="number, person, detail"
              className="mt-2 w-full rounded border border-line bg-surface px-2.5 py-1.5 text-[13px] text-slate-800 placeholder:text-slate-400"
            />

            <p className="slip-label mt-4">When</p>
            <span className="register mt-2 block">
              <DateWindow fields={[{ code: "ts", label: "The day it happened" }]} on={sp.from ? "ts" : ""} from={sp.from ?? ""} to={sp.to ?? ""} />
            </span>

            {sp.family ? <input type="hidden" name="family" value={sp.family} /> : null}
            <div className="mt-2.5 flex items-center gap-3">
              <button className="rounded border border-line-strong px-2.5 py-1 text-[12.5px] font-semibold text-brand-ink hover:bg-tint">
                Show
              </button>
              {sp.q || sp.from || sp.to ? (
                <Link href={sp.family ? `/admin/audit?family=${sp.family}` : "/admin/audit"} className="text-[12px] font-semibold text-link hover:underline">
                  Clear
                </Link>
              ) : null}
            </div>
          </form>
        </aside>

        <main className="min-w-0 space-y-5">
          {days.map(({ day, when, acts }) => (
            <section key={day}>
              <div className="day-rule mb-2.5">
                <span className="font-mono text-[12.5px]">{when.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}</span>
                <span className="day-name">{when.toLocaleDateString("en-GB", { weekday: "long" })}</span>
              </div>

              <ul className="space-y-2">
                {acts.map((e) => {
                  const kind = familyOf(e.action);
                  return (
                    <li key={e.id} className={`slip ${kind?.edge ?? "edge-keep"}`}>
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="slip-number">{e.entityLabel ?? e.entityType ?? "—"}</span>
                        <span className="postmark">{said(e.action)}</span>
                        <span className="slip-note ml-auto whitespace-nowrap">{fmtDateTime(e.ts)}</span>
                      </div>

                      {e.field ? (
                        <p className="slip-subject mt-1.5">
                          {e.field}
                          <span className="text-[15px] text-[color:var(--ink-faint)]"> — </span>
                          <span className="font-mono text-[14px] line-through opacity-70">{e.oldValue ?? "—"}</span>
                          <span className="text-[color:var(--ink-faint)]"> to </span>
                          <span className="font-mono text-[14px]">{e.newValue ?? "—"}</span>
                        </p>
                      ) : e.detail ? (
                        <p className="slip-subject mt-1.5">{e.detail}</p>
                      ) : null}

                      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="route">
                          <span className="route-party">{e.actorName}</span>
                          <span className="route-line" aria-hidden="true" />
                          <span className="min-w-0 truncate">{e.entityType ?? "the project"}</span>
                        </span>
                        {kind ? <span className="slip-note ml-auto">{kind.label}</span> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {!days.length ? (
            <p className="slip px-4 py-6 text-[13px] text-[color:var(--ink-soft)]">
              Nothing in the log answers that. {sp.q ? "Try another number or name." : "Acts appear here as they happen."}
            </p>
          ) : null}

          {events.length === 200 ? (
            <p className="slip-note px-1">The last 200 acts. Narrow it with a search or a kind to see further back.</p>
          ) : null}
        </main>
      </div>
    </div>
  );
}
