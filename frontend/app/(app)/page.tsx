import Link from "next/link";
import { btn } from "@/components/ui";
import { api, projectPath } from "@/lib/client";
import { actionWork } from "@/lib/actions/api";
import type { ActivityRow, ActivitySummary, Work } from "@/lib/types";
import { requireScope } from "@/lib/core/scope";
import { isAdmin } from "@/lib/core/auth";
import { organizationLinks } from "@/lib/organization/api";
import { emailReplies } from "@/lib/transmittals/api";
import { fmtDate, fmtDateTime } from "@/lib/core/utils";
import { DateWindow } from "@/components/date-window";
import { Search } from "lucide-react";
import { CheckCheck, FileStack, Inbox, ListChecks, MessageSquare, PenLine, Plus, Send, Share2, Undo2, Upload } from "lucide-react";


export const dynamic = "force-dynamic";

/**
 * Home greets the reader and says where they stand.
 *
 * The band answers "how am I doing" in four figures before anything is read.
 * Under it the work is set in rows of fixed places — number, tag, age, verb —
 * so the eye lands rather than reads, and beside it the project itself: what
 * moved since the reader was last here, what the schedule still needs, how
 * clean the register is. The page used to be a column of cards that listed the
 * reader's chores and never told them the news.
 */
import { type Row, type Aspect, ACTIVITY, NEWS, KINDS, ALIAS, startOfDay, LOG_EDGE, read, daysOf, lastWorkingDay, dayed, weekday, when, greeting, Fig, Card, Queue } from "./home-parts";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ view?: string; kind?: string; from?: string; to?: string; q?: string }> }) {
  const sp = await searchParams;
  // Everything this page shows comes from the backend; what it shows, and how, is unchanged.
  const ctx = await requireScope();
  const session = ctx;
  const { user } = ctx;
  const controller = ctx.can("CONTROL") || ctx.can("CONFIGURE");
  // Another organization invites ours to work on its projects: its administrators answer.
  const invitations = isAdmin(ctx.user) ? (await organizationLinks()).filter((one) => one.side === "GUEST" && one.state === "INVITED") : [];
  // Replies by email from organizations not on DELIOS, waiting for the control function to record them.
  const repliesByEmail = ctx.can("CONTROL") ? await emailReplies(ctx) : [];
  // The whole log is the control function's and the administrator's: they answer
  // for what the record says. Anybody else asking for it gets their own page.
  const view = sp.view === "log" && !controller ? undefined : sp.view;
  const at = (iso: string | null | undefined) => (iso ? new Date(iso) : null);
  const acts = (rows: ActivityRow[]) => rows.map((e) => ({ id: e.id, ts: new Date(e.at), action: ALIAS[e.action] ?? e.action, actorName: e.actorName, entityType: e.entityType, entityLabel: e.entityLabel, detail: e.detail }));
  // The backend's names for the acts each kind of the journal covers.
  const backendNames = (kinds: string[]) => Object.keys(ALIAS).filter((name) => kinds.includes(ALIAS[name])).concat(kinds).join(",");

  const [work, checks, criticalDefects, activities, neverSent, scheduleWork] = await Promise.all([
    api<Work>(projectPath(session, "/work")),
    controller ? api<{ lastRun: { integrity: number } | null }>(projectPath(session, "/checks")).catch(() => ({ lastRun: null })) : Promise.resolve({ lastRun: null }),
    controller ? api<unknown[]>(projectPath(session, "/defects"), { query: { severity: "CRITICAL" } }).then((d) => d.length).catch(() => 0) : Promise.resolve(0),
    user.isInternal ? api<ActivitySummary[]>(projectPath(session, "/activities")).catch(() => [] as ActivitySummary[]) : Promise.resolve([] as ActivitySummary[]),
    // Released, and nobody was ever told. Not a decision anybody owes: whoever
    // needed it sent did not ask, and this is where that stops being invisible.
    controller
      ? api<{ documentId: string; documentNumber: string; title: string; revisionId: string; revision: string; status: string | null; releasedAt: string | null }[]>(projectPath(session, "/not-issued")).catch(() => [])
      : Promise.resolve([]),
    // What on the schedule waits for this person: their discipline's confirmations, a postponement to confirm, upkeep.
    user.isInternal
      ? actionWork(session)
      : Promise.resolve([]),
  ]);
  const lastRun = checks.lastRun;

  // What moved while the reader was away: the last working day's worth of the
  // events that are news to somebody, not bookkeeping.
  //
  // Project-wide, for everybody. A release, a rejection or a transmittal is a
  // fact about the project, not about the person reading it; scoping the
  // record by department is how people stop trusting it, because each of them
  // ends up looking at a different project. What a reader may not see is
  // already settled by the backend, not by this page.
  const since = lastWorkingDay();
  const news = acts(await api<ActivityRow[]>(projectPath(session, "/activity"), { query: { actions: backendNames(NEWS), since: since.toISOString(), take: 4 } }));
  // A quiet day should not leave the panel empty or showing one lonely line:
  // when the last working day produced almost nothing, the journal reaches
  // further back and says so instead.
  const older = news.length < 4
    ? acts(await api<ActivityRow[]>(projectPath(session, "/activity"), { query: { actions: backendNames(NEWS), before: since.toISOString(), take: 4 - news.length } }))
    : [];
  const journal = [...news, ...older];
  // The whole log, when the reader asks for it. It carries the same kinds of
  // act as the journal beside the board — what the project did — and none of
  // what only an administrator should see: who signed in, who downloaded what,
  // who was given which permission. That page exists, and it is theirs.
  // A log is read with a question in mind: one kind of act, or a fortnight, or
  // a number somebody mentioned. A date names the whole day, so asking for the
  // 3rd to the 3rd returns the 3rd.
  const kind = KINDS.find((one) => one === sp.kind);
  const from = startOfDay(sp.from);
  const to = startOfDay(sp.to, true);
  const asked = !!(kind || from || to || sp.q);
  const log = view === "log"
    ? acts(await api<ActivityRow[]>(projectPath(session, "/activity"), {
        query: {
          actions: backendNames(kind ? NEWS.filter((one) => ACTIVITY[one].kind === kind) : NEWS),
          from: sp.from || undefined, to: sp.to || undefined, q: sp.q || undefined, take: 60,
        },
      }))
    : [];
  // An audit label reads "P1001-60-CI-SPC-00001 rev B — route name", and a
  // supplier's number runs half as long again. The panel measures its own
  // entries: the widest number sets the column the revisions line up in, and
  // when that number is long the kind is dropped rather than squeezed.
  const widest = Math.max(20, ...journal.map((e) => read(e.entityLabel)?.number.length ?? 0));
  const room = widest <= 26;

  // One list per kind of ask: advice on a route's earlier step, or the
  // binding verdict — the one decision, which is also the release approval.
  const answering = work.steps.filter((w) => w.kind === "ANSWER_STEP");
  const verdicts = answering.filter((w) => w.deciding);
  const advice = answering.filter((w) => !w.deciding);

  // Schedule activities whose documents will not be ready in time, for the
  // people engaged in them. The control function and the planners are engaged in
  // all of them, because chasing the schedule is their work.
  const wholeSchedule = controller || session.can("PLAN");
  const atRisk = activities
    .map((a) => {
      const total = a.needs;
      const ready = a.met + a.waived;
      const scheduledDate = at(a.start);
      const late = scheduledDate ? scheduledDate.getTime() < Date.now() : false;
      // Engaged in it: the action concerns the discipline this person answers for.
      const mine = !!user.department && a.departments.includes(user.department);
      return { id: a.id, code: a.code, name: a.name, scheduledDate, total, ready, short: total - ready, late, mine };
    })
    .filter((a) => a.total > 0 && a.short > 0 && a.scheduledDate)
    .filter((a) => wholeSchedule || a.mine)
    // Newest first, deliberately. Sorted by how late they are, one activity
    // nobody intends to fix would sit at the top for months and hide every
    // risk that appeared after it; sorted by date, what has just gone wrong is
    // what the panel shows, and the standing failures are the schedule page's.
    .sort((a, b) => (b.scheduledDate?.getTime() ?? 0) - (a.scheduledDate?.getTime() ?? 0));

  const revisionsOf = (kinds: string[]) => work.revisions.filter((w) => kinds.includes(w.kind));
  const issuesOf = (kinds: string[]) => work.issues.filter((w) => kinds.includes(w.kind));

  // ── The rows, by queue ────────────────────────────────────────────────────
  const rows: Record<string, Row[]> = {
    verdict: verdicts.map<Row>((w) => ({
      href: `/reviews/${w.reviewId}`, code: w.documentNumber, rev: w.revisionValue, title: w.title,
      tag: "binding", tone: "sky", at: at(w.since), cta: "Decide",
    })),
    release: [
      ...work.gate.filter((w) => w.kind === "SEND_BACK").map<Row>((w) => ({
        href: `/reviews/${w.reviewId}`, code: w.documentNumber, rev: w.revisionValue, title: w.title,
        tag: w.verdict ?? "changes asked", tone: "amber", at: at(w.since), cta: "Send back",
      })),
      ...work.gate.filter((w) => w.kind === "READY_TO_RELEASE").map<Row>((w) => ({
        href: `/reviews/${w.reviewId}`, code: w.documentNumber, rev: w.revisionValue, title: w.title,
        tag: w.status ?? "decided", tone: "emerald", at: at(w.since), cta: "Release",
      })),
    ],
    returned: [
      ...revisionsOf(["RETURNED_BY_REVIEW"]),
      ...(user.isInternal ? revisionsOf(["CORRECT_AND_RESUBMIT"]) : []),
      // A supplier's document released with comments: theirs to take in and send again as the next revision.
      ...revisionsOf(["NEXT_REVISION_DUE"]),
    ].map<Row>((w) => ({
      href: `/documents/${w.documentId}`, code: w.documentNumber, rev: w.revision, title: w.title,
      tag: w.kind === "CORRECT_AND_RESUBMIT" ? "to correct" : w.kind === "NEXT_REVISION_DUE" ? "next revision due" : "reviewed",
      tone: "amber", at: at(w.since), cta: "See comments",
    })),
    unsent: [
      ...neverSent.map<Row>((r) => ({
        href: `/documents/${r.documentId}`, code: r.documentNumber, rev: r.revision, title: r.title,
        tag: r.status ?? "released", tone: "violet", at: at(r.releasedAt), cta: "Ask to send",
      })),
      // Asked for, released: the control function sends it.
      ...issuesOf(["CARRY_OUT_REQUEST"]).map<Row>((w) => ({
        href: w.documentId ? `/documents/${w.documentId}#step-send-out` : "/transmittals", code: w.label.split(" ")[0], rev: w.label.split(" rev ")[1], title: `asked by ${w.who ?? "someone"}`,
        tag: w.reason.toLowerCase(), tone: "violet", at: at(w.since), cta: "Send",
      })),
      // Left to this person to say who receives it.
      ...issuesOf(["SAY_WHO_RECEIVES"]).map<Row>((w) => ({
        href: w.documentId ? `/documents/${w.documentId}#step-send-out` : "/documents", code: w.label.split(" ")[0], rev: w.label.split(" rev ")[1], title: "who receives it was left to you",
        tag: "say who", tone: "amber", at: at(w.since), cta: "Say who",
      })),
      // Sent to an organization outside the system: its dispatch is recorded here.
      ...issuesOf(["DISPATCH_TRANSMITTAL"]).map<Row>((w) => ({
        href: `/transmittals/${w.transmittalId}`, code: w.label, title: `to ${w.who ?? "an outside party"}`,
        tag: "to dispatch", tone: "violet", at: at(w.since), cta: "Dispatch",
      })),
    ],
    owed: [
      ...issuesOf(["SEND_PLACEHOLDER"]).map<Row>((w) => ({
        href: `/transmittals/send?docs=${w.documentId}`, code: w.label.split(" ")[0], title: w.label.split(" ").slice(1).join(" "),
        tag: "not sent", tone: w.dueDate && new Date(w.dueDate).getTime() < Date.now() ? "amber" : "plain", cta: "Upload",
      })),
      ...(user.isInternal ? [] : revisionsOf(["CORRECT_AND_RESUBMIT"])).map<Row>((w) => ({
        href: `/transmittals/send?docs=${w.documentId}`, code: w.documentNumber, rev: w.revision, title: w.title,
        tag: w.resent ? "sent again" : "returned", tone: "amber", at: at(w.since), cta: "Upload",
      })),
    ],
    review: advice.map<Row>((w) => ({
      href: `/reviews/${w.reviewId}`, code: w.documentNumber, rev: w.revisionValue, title: w.title,
      tag: "advice", tone: "sky", at: at(w.since), cta: "Review",
    })),
    incoming: [
      ...invitations.map<Row>((one) => ({
        href: "/organization", code: one.partyCode, title: `${one.organization} invites us to work on its projects, with our own accounts`,
        tag: "invitation", tone: "sky", at: at(one.invitedAt), cta: "Answer",
      })),
      ...repliesByEmail.map<Row>((one) => ({
        href: `/transmittals/${one.transmittalId}#email-replies`, code: one.transmittalNumber, title: `${one.organization} replied by email: ${one.subject || "no subject"}`,
        tag: "reply by email", tone: "sky", at: at(one.receivedAt), cta: "Record",
      })),
      ...revisionsOf(["ACCEPT_SUBMISSION"]).map<Row>((w) => ({
        href: `/documents/${w.documentId}`, code: w.documentNumber, rev: w.revision, title: w.title,
        tag: "received", tone: "sky", at: at(w.since), cta: "Check",
      })),
      ...issuesOf(["ACKNOWLEDGE_TRANSMITTAL"]).map<Row>((w) => ({
        href: `/transmittals/${w.transmittalId}`, code: w.label, title: `from ${w.who ?? "another organization"}`,
        tag: w.dueDate && new Date(w.dueDate).getTime() < Date.now() ? "overdue" : "to acknowledge", tone: w.dueDate && new Date(w.dueDate).getTime() < Date.now() ? "amber" : "sky", at: at(w.since), cta: "Acknowledge",
      })),
      ...issuesOf(["REGISTER_UNPLANNED"]).map<Row>((w) => ({
        href: `/transmittals/${w.transmittalId}`, code: w.reason, title: `from ${w.who ?? "another organization"} · ${w.label}`,
        tag: "unplanned", tone: "sky", at: at(w.since), cta: "Check",
      })),
      // The other side asks for a supplier's document back to update it: its holder answers (us, or the supplier).
      ...issuesOf(["ANSWER_HAND_BACK"]).map<Row>((w) => ({
        href: `/documents/${w.documentId}#step-asked-back`, code: w.label.split(" ")[0], title: `${w.label.split(" ").slice(1).join(" ")} · asked back by ${w.who ?? "the other side"}: ${w.reason}`,
        tag: "asked back", tone: "amber", at: at(w.since), cta: "Answer",
      })),
    ],
    route: revisionsOf(["TO_ROUTE"]).map<Row>((w) => ({
      href: `/documents/${w.documentId}`, code: w.documentNumber, rev: w.revision, title: w.title,
      tag: "accepted", tone: "emerald", at: at(w.since), cta: "Send for review",
    })),
    // The schedule: confirming a discipline's documents, a postponement, and the schedule's upkeep.
    requirements: scheduleWork.map<Row>((w) => w.kind === "CONFIRM_DOCUMENTS"
      ? { href: `/actions/${w.code}#confirm`, code: w.code ?? "", title: `${w.name} · ${w.department}: ${w.count} document${w.count === 1 ? "" : "s"} missing`, tag: w.day && new Date(w.day).getTime() < Date.now() ? "day passed" : "confirm", tone: w.day && new Date(w.day).getTime() < Date.now() ? "amber" : "sky", at: at(w.since), cta: "Confirm" }
      : w.kind === "CONFIRM_POSTPONEMENT"
        ? { href: `/actions/${w.code}#note`, code: w.code ?? "", title: `${w.name}: postponed, waiting for you to confirm`, tag: "postponed", tone: "amber", at: at(w.since), cta: "Confirm" }
        : w.kind === "CONFIRM_PERSON"
        ? { href: "/people/confirm", code: `${w.count}`, title: `${w.count === 1 ? "person waits" : "people wait"} for you to confirm them on the project`, tag: "to confirm", tone: "amber", at: at(w.since), cta: "Confirm" }
        : w.kind === "CONFIRM_ACTION_REQUEST"
        ? { href: `/actions/${w.code}#your-confirmation`, code: w.code ?? "", title: `${w.name}: ${w.ask === "DISCIPLINE" ? "a discipline" : "a document"} to add, checked by ${w.from ?? "the control function"} (${w.number})`, tag: "to confirm", tone: "amber", at: at(w.since), cta: "Confirm" }
        : w.kind === "ADD_TO_ACTION"
        ? { href: `/actions/${w.code}#asked`, code: w.code ?? "", title: `${w.name}: ${w.from ?? "someone"} asks for ${w.ask === "DISCIPLINE" ? "a missing discipline" : "a document"} to be added (${w.number})`, tag: "asked", tone: "sky", at: at(w.since), cta: "Answer" }
        : w.kind === "UNTAGGED"
          ? { href: "/actions?view=table&untagged=1", code: `${w.count}`, title: `action${w.count === 1 ? "" : "s"} with no discipline tagged`, tag: "untagged", tone: "amber", at: null, cta: "Tag them" }
          : { href: "/actions", code: w.code ?? "", title: `the schedule could not be read${w.name ? `: ${w.name}` : ""}`, tag: "read failed", tone: "amber", at: at(w.since), cta: "Upload" }),
    drafts: revisionsOf(["DRAFT"]).map<Row>((w) => ({
      href: `/documents/${w.documentId}#workflow`, code: w.documentNumber, rev: w.revision, title: w.title,
      tag: w.note === "READY" ? "file attached" : w.note === "REJECTED" ? "file refused" : "file scanning", tone: "plain", at: at(w.since), cta: "Continue",
    })),
  };

  // Every kind of work is an aspect, and every aspect is the same size on the
  // page: a card saying how many there are and what state they are in, and one
  // way in. Nothing on a card competes for attention by being bigger; which
  // document matters is the reader's call, made in the list the card opens.
  const ASPECTS: Aspect[] = [
    { id: "verdict", tab: "Decide", title: "Decide", icon: <CheckCheck />, accent: "brand",
      asks: "Documents waiting on your verdict to move on.",
      then: "Their route is stopped at your step until you answer.", call: "Give the verdicts" },
    { id: "review", tab: "Advice", title: "Advice on a review", icon: <MessageSquare />, accent: "indigo",
      asks: "Reviews asking what you think before the verdict.",
      then: "The decider is waiting on you to close the step.", call: "Give your advice" },
    { id: "incoming", tab: "Received", title: "Received, to check", icon: <Inbox />, accent: "sky",
      asks: "Transmittals that arrived and were never checked.",
      then: "Nothing inside them enters the register until you accept.", call: "Check them" },
    { id: "release", tab: "Release", title: "Release or send back", icon: <FileStack />, accent: "teal",
      asks: "The reviewers decided; they are not released yet.",
      then: "Nobody may build from them, and no revision can start.", call: "Settle them" },
    { id: "unsent", tab: "To send", title: "To send out", icon: <Send />, accent: "violet",
      asks: "Released documents waiting to go out: asked for, left to you to say who, or to dispatch.",
      then: "Whoever needs them is working from an older issue.", call: "Send them" },
    { id: "requirements", tab: "Schedule", title: "On the schedule", icon: <ListChecks />, accent: "steel",
      asks: "Your discipline's documents to confirm, postponements to confirm, and the schedule's upkeep.",
      then: "An action's day comes whether or not anyone answered.", call: "Answer them" },
    { id: "returned", tab: "Returned", title: "Came back to you", icon: <Undo2 />, accent: "blue",
      asks: "Your documents came back with the reviewers' comments.",
      then: "Each one is finished: the next revision starts fresh.", call: "Read the comments" },
    { id: "route", tab: "To send out", title: "Send for review", icon: <Share2 />, accent: "cyan",
      asks: "Accepted by us, and still not sent out for review.",
      then: "The reviewers cannot start, and the clock is running.", call: "Send them out" },
    { id: "owed", tab: "To upload", title: "To send us", icon: <Upload />, accent: "ocean",
      asks: "Documents your package still owes, and we await.",
      then: "The package cannot close until every one arrives.", call: "Upload them" },
    { id: "drafts", tab: "Drafts", title: "Your drafts", icon: <PenLine />, accent: "slate",
      asks: "Documents you started and have not submitted.",
      then: "Nobody knows they exist until you send them for review.", call: "Carry on writing" },
  ];

  const all = Object.values(rows).flat();
  const today = ["verdict", "release", "returned", "unsent", "owed", "requirements"].flatMap((id) => rows[id]);
  const longest = Math.max(0, ...all.map((one) => daysOf(one.at) ?? 0));
  // Asked for one kind, the page becomes that one kind, in full.
  const opened = view ? ASPECTS.find((one) => one.id === view) : null;

  // The panels arrive in reading order, once. See `.home-rise` in globals.css.
  let place = -1;
  const rise = () => {
    place += 1;
    return { "--d": `${260 + place * 90}ms` } as React.CSSProperties;
  };

  return (
    <div className="@container min-w-0 overflow-x-clip">
      <header className="home-band home-rise px-6 py-5" style={{ "--d": "0ms" } as React.CSSProperties}>
        <span className="home-sheen" aria-hidden="true" />
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <p className="home-faint mb-2 font-mono text-[11px] font-medium tracking-[0.14em] uppercase">{fmtDate(new Date())}</p>
            <h1 className="text-[27px] leading-tight font-semibold tracking-tight">{greeting()}, {user.name.split(" ")[0]}.</h1>
            <p className="home-soft mt-1.5 text-[13.5px]">
              {ctx.project.name}
              <span className="mx-1.5 opacity-45">·</span>
              {user.functionName ?? (controller ? "The control function" : user.isInternal ? "Project team" : user.partyName ?? "Partner")}
            </p>
          </div>
          {user.isInternal ? (
            <Link href="/documents/new" className={`${btn("secondary")} mt-0.5 whitespace-nowrap`}>
              <Plus className="h-4 w-4" /> Create document
            </Link>

          ) : null}
        </div>

        <div className="home-rule mt-4 grid grid-cols-2 gap-4 border-t pt-3.5 md:grid-cols-4">
          <Fig value={today.length} label={today.length === 1 ? "needs you today" : "need you today"} index={0} />
          <Fig value={all.length} label="waiting on you in all" index={1} />
          <Fig value={longest} unit="d" label={longest ? "the longest has waited" : "nothing has been left"} index={2} />
          {controller ? (
            <Fig
              href="/conformance"
              value={lastRun ? Math.round(lastRun.integrity) : 0}
              unit="%"
              label={lastRun ? `register clean${criticalDefects ? ` · ${criticalDefects} critical` : ""}` : "register not checked yet"}
              index={3}
            />
          ) : (
            <Fig href="/actions" value={atRisk.length} label="activities short of documents" index={3} />
          )}
        </div>

      </header>

      <nav aria-label="What is waiting" className="seg mt-4">
        {/* Navigation keeps the reader where they were: switching aspect is a
            filter, not a new page, so the scroll position is left alone. */}
        <Link href="/" scroll={false} aria-current={!view ? "page" : undefined} className="segment">
          All <span className="segment-n">{all.length}</span>
        </Link>
        {ASPECTS.filter((one) => rows[one.id].length).map((one) => {
          const stale = rows[one.id].some((row) => (daysOf(row.at) ?? 0) >= 7);
          return (
            <Link
              key={one.id}
              href={`/?view=${one.id}`}
              scroll={false}
              aria-current={view === one.id ? "page" : undefined}
              className="segment"
            >
              {one.tab}
              <span className={`segment-n ${stale ? "segment-late" : ""}`}>{rows[one.id].length}</span>
            </Link>
          );
        })}
        {/* The log is not work waiting on anybody, so it sits apart at the end
            and carries no count: a number here would join a total that means
            "what is owed by you". */}
        {controller ? (
          <Link
            href="/?view=log"
            scroll={false}
            aria-current={view === "log" ? "page" : undefined}
            className="segment ml-auto"
          >
            The log
          </Link>
        ) : null}
      </nav>

      <div className="mt-3 grid grid-cols-1 gap-3.5 xl:grid-cols-[minmax(0,1fr)_296px] xl:items-start">
        <main className="@container min-w-0">
          {view === "log" ? (
            <section className="dispatch logbook home-rise min-w-0" style={rise()}>
              {/* The bar keeps its place while the log runs past it. The strip
                  it sits on is the page's own canvas, so an act passing under it
                  disappears behind the bar rather than showing through its
                  corners, and there is air above and below. */}
              <div className="sticky top-18 z-10 bg-canvas pt-2 pb-3">
              <form className="register register-sheet register-sheet-open px-4 py-2.5">
                <input type="hidden" name="view" value="log" />
                <div className="flex flex-wrap items-end gap-x-4 gap-y-2.5 lg:flex-nowrap">
                  <label className="relative min-w-48 flex-1">
                    <span className="sr-only">Search the log</span>
                    <Search className="absolute top-1/2 left-0 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      name="q"
                      defaultValue={sp.q ?? ""}
                      placeholder="A number, a person, a detail"
                      className="plain w-full pl-6!"
                    />
                  </label>
                  <label className="shrink-0">
                    <span className="sr-only">Kind of act</span>
                    <select name="kind" defaultValue={kind ?? ""} className="plain">
                      <option value="">Every kind</option>
                      {KINDS.map((one) => <option key={one} value={one}>{one}</option>)}
                    </select>
                  </label>
                  <span className="shrink-0">
                    <DateWindow fields={[{ code: "ts", label: "The day it happened" }]} on={sp.from ? "ts" : ""} from={sp.from ?? ""} to={sp.to ?? ""} />
                  </span>
                  <button className="ask" data-on={asked ? "true" : "false"}>Apply</button>
                  {asked ? (
                    <Link href="/?view=log" scroll={false} className="stencil pb-1.5 text-brand-ink hover:underline">Clear</Link>
                  ) : null}
                </div>
              </form>
              </div>

              {asked ? (
                <p className="slip-note mb-3">
                  {log.length === 60 ? "The last 60 acts" : `${log.length} act${log.length === 1 ? "" : "s"}`}
                  {kind ? ` of the kind ${kind.toLowerCase()}` : ""}
                  {from || to ? ` between ${from ? fmtDate(from) : "the beginning"} and ${to ? fmtDate(to) : "now"}` : ""}
                  {sp.q ? ` matching “${sp.q}”` : ""}.
                </p>
              ) : null}

              {dayed(log).map(({ day, when: on, acts }) => (
                <div key={day} className="mb-5">
                  <div className="day-rule mb-2.5">
                    <span className="font-mono text-[12.5px]">{fmtDate(on)}</span>
                    <span className="day-name">{weekday(on)}</span>
                  </div>
                  <ul className="space-y-2">
                    {acts.map((e) => {
                      const kind = ACTIVITY[e.action];
                      const shape = read(e.entityLabel);
                      if (!kind || !shape) return null;
                      return (
                        <li key={e.id} className={`slip ${LOG_EDGE[kind.kind] ?? "edge-keep"}`}>
                          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                            <span className="slip-number">{shape.number}</span>
                            {shape.rev ? <span className="slip-note font-mono">rev {shape.rev}</span> : null}
                            <span className="postmark">{kind.kind}</span>
                            <span className="slip-note ml-auto whitespace-nowrap">{fmtDateTime(e.ts)}</span>
                          </div>
                          <p className="slip-subject mt-1.5">{kind.said}</p>
                          {e.detail ? <p className="slip-note mt-1 line-clamp-2">{e.detail}</p> : null}
                          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3">
                            <span className="route">
                              <span className="route-party">{e.actorName}</span>
                              <span className="route-line" aria-hidden="true" />
                              <span className="min-w-0 truncate">{e.entityType ?? "the project"}</span>
                            </span>
                            <span className="slip-note ml-auto">{when(e.ts)}</span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
              {!log.length ? (
                <p className="slip px-4 py-6 text-[13px] text-(--ink-soft)">
                  {asked ? "Nothing in the log answers that." : "Nothing has happened yet."}
                </p>
              ) : null}
            </section>
          ) : opened ? (
            <Queue aspect={opened} rows={rows[opened.id]} style={rise()} />
          ) : all.length ? (
            <div className="grid grid-cols-1 gap-3.5 @[38rem]:grid-cols-2">
              {ASPECTS.filter((one) => rows[one.id].length).map((one) => (
                <Card key={one.id} aspect={one} rows={rows[one.id]} style={rise()} />
              ))}
            </div>
          ) : (
            <section className="home-rise register register-sheet register-sheet-open px-5 py-8 text-sm text-slate-500" style={rise()}>
              You are clear. Reviews to answer, verdicts to give and work sent back to you appear here.
            </section>
          )}
        </main>

        <aside className="grid min-w-0 gap-3 xl:sticky xl:top-22">
          {journal.length && view !== "log" ? (
            <section className="home-rise register register-sheet register-sheet-open px-4 py-3" style={rise()}>
              <h2 className="mb-2.5 text-[11px] font-semibold tracking-[0.09em] text-slate-400 uppercase">{older.length ? "Lately" : `Since ${weekday(since)}`}</h2>
              <ul>
                {journal.map((e, i) => {
                  const kind = ACTIVITY[e.action];
                  const shape = read(e.entityLabel);
                  if (!kind || !shape) return null;
                  return (
                    <li key={e.id} className="relative min-w-0 pb-2.5 pl-4.5 last:pb-0">
                      <span className={`absolute top-1.25 left-0 h-1.75 w-1.75 rounded-full border-2 bg-surface ${kind.mark}`} />
                      {i < journal.length - 1 ? <span className="absolute top-3.5 -bottom-px left-0.75 w-px bg-line" /> : null}
                      {/* The lines are held to the width of the longest number in
                          the panel, so every revision lands in the same column
                          instead of drifting out to the panel's edge. */}
                      <span className="block min-w-0" style={{ maxWidth: `${widest}ch` }}>
                        <span className="flex items-baseline gap-2">
                          <span className="min-w-0 truncate font-mono text-[12.5px] font-semibold text-link">{shape.number}</span>
                          {room ? <span className="ml-auto shrink-0 text-[11px] text-slate-400">{kind.kind}</span> : null}
                        </span>
                        <span className="flex items-baseline gap-2 text-[12.5px] text-slate-600">
                          <span className="min-w-0 truncate">{kind.said}</span>
                          {shape.rev ? <span className="ml-auto shrink-0 font-mono text-[11.5px] text-slate-400">rev {shape.rev}</span> : null}
                        </span>
                        <span className="block truncate text-[11px] text-slate-400">{e.actorName} · {when(e.ts)}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
                            {controller ? <Link href="/?view=log" scroll={false} className="mt-2.5 inline-block text-xs font-semibold text-link hover:underline">Everything that happened →</Link> : null}
            </section>
          ) : null}

          {user.isInternal && atRisk.length ? (
            <section className="home-rise register register-sheet register-sheet-open px-4 py-3" style={rise()}>
              <h2 className="mb-1 text-[11px] font-semibold tracking-[0.09em] text-slate-400 uppercase">Schedule</h2>
              {atRisk.slice(0, 3).map((a) => {
                // An activity's name carries where it is after a dash — "Foundation
                // concrete pour — clarifier TK-201, area 20" — and the place is
                // what tells a reader whether it is theirs, so it gets its own line.
                const [what, ...place] = a.name.split(" — ");
                const off = Math.abs(Math.round(((a.scheduledDate?.getTime() ?? 0) - Date.now()) / 86_400_000));
                return (
                  <Link key={a.id} href={`/actions/${a.code}`} className="block min-w-0 border-t border-line py-2.5 first:border-t-0">
                    <span className="flex items-baseline gap-2">
                      <span className="font-mono text-[12.5px] font-semibold text-link">{a.code}</span>
                      {wholeSchedule && a.mine ? <span className="rounded bg-tint px-1.5 text-[10px] font-semibold tracking-wide text-brand-ink uppercase">yours</span> : null}
                      <span className={`ml-auto font-mono text-[11.5px] whitespace-nowrap ${a.late ? "font-semibold text-amber-700" : "text-slate-400"}`}>
                        {a.late ? "overdue" : fmtDate(a.scheduledDate)}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[12.5px] text-slate-700">{what}</span>
                    {place.length ? <span className="block truncate text-[11.5px] text-slate-500">{place.join(" — ")}</span> : null}
                    <span className="mt-1 flex items-baseline gap-2 text-[11px] text-slate-400">
                      <span className="truncate"><b className="font-mono font-semibold text-slate-600">{a.ready}/{a.total}</b> documents ready</span>
                      <span className={`ml-auto whitespace-nowrap ${a.late ? "font-semibold text-amber-700" : ""}`}>
                        {a.late ? `${off} day${off === 1 ? "" : "s"} late` : `in ${off} day${off === 1 ? "" : "s"}`}
                      </span>
                    </span>
                  </Link>
                );
              })}
                            <Link href="/actions" className="mt-2.5 inline-block text-xs font-semibold text-link hover:underline">The whole schedule{atRisk.length > 3 ? ` · ${atRisk.length} at risk` : ""} →</Link>
            </section>
          ) : null}

        </aside>
      </div>
    </div>
  );
}
