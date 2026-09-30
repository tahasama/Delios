import { readyReading, countingRevision, meetsRequirement } from "@/lib/readiness";
import Link from "next/link";
import { Count } from "./tally";
import { requireScope } from "@/lib/scope";
import { isController, isAdmin } from "@/lib/auth";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { DateWindow } from "@/components/date-window";
import { Search } from "lucide-react";
import { supplierRows, WITH_SUPPLIER, STATE_LABEL } from "@/lib/supplier";
import { departmentsOf, daysBefore, DEFAULT_LEAD_DAYS } from "@/lib/schedule";
import { departmentRows, senderRows, isDepartmentSender } from "@/lib/requirements-process";
import { getActiveSet } from "@/lib/config";
import { ArrowRight, CheckCheck, FileStack, Inbox, ListChecks, MessageSquare, PenLine, Plus, Send, Share2, Undo2, Upload } from "lucide-react";

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
export default async function HomePage({ searchParams }: { searchParams: Promise<{ view?: string; kind?: string; from?: string; to?: string; q?: string }> }) {
  const sp = await searchParams;
  const view = sp.view;
  const ctx = await requireScope();
  const { user, db } = ctx;
  const controller = isController(user) || isAdmin(user);
  // What counts as delivered for an action is the project's answer.
  const reading = await readyReading(ctx);

  const [assigned, returned, incoming, drafts, actions, lastRun, criticalDefects, totalDocs] = await Promise.all([
    db.reviewAssignment.findMany({
      where: { userId: user.id, completedAt: null, cycle: { status: "OPEN", issuedToReviewAt: { not: null } } },
      include: { cycle: { include: { revision: { include: { document: true } } } } },
      take: 50,
    }),
    db.reviewCycle.findMany({
      where: { status: "CLOSED", outcome: { in: ["REVISE_AND_RESUBMIT", "APPROVED_WITH_COMMENTS", "REJECTED"] }, revision: { document: { createdById: user.id } }, returnedToOriginatorAt: { not: null } },
      include: { revision: { include: { document: true } }, comments: { where: { progressionPreventing: true, status: "OPEN" } } },
      orderBy: { returnedToOriginatorAt: "desc" },
      take: 20,
    }),
    controller ? db.transmittal.findMany({ where: { direction: "INCOMING", status: "ISSUED" }, orderBy: { dateOfIssue: "asc" }, take: 20 }) : Promise.resolve([]),
    db.revision.findMany({ where: { state: "IN_PREPARATION", submittedAt: null, document: { createdById: user.id } }, include: { document: true }, take: 50 }),
    db.action.findMany({
      orderBy: { scheduledDate: "asc" },
      include: { entries: { include: { document: { include: { revisions: countingRevision(reading) } } } } },
    }),
    controller ? db.checkRun.findFirst({ orderBy: { ranAt: "desc" } }) : Promise.resolve(null),
    controller ? db.defect.count({ where: { severity: "CRITICAL", status: { in: ["OPEN", "ACCEPTED"] } } }) : Promise.resolve(0),
    controller ? db.document.count() : Promise.resolve(0),
  ]);

  // A supplier's work is its package: what it still owes, and what came back.
  const supplierPkgs = !user.isInternal && user.partyCode
    ? await db.package.findMany({ where: { category: "SUPPLIER", partyCode: user.partyCode } })
    : [];
  const owed: { pkg: string; rows: Awaited<ReturnType<typeof supplierRows>> }[] = [];
  for (const p of supplierPkgs) owed.push({ pkg: p.identifier, rows: (await supplierRows(ctx, p)).filter((r) => WITH_SUPPLIER.includes(r.state)) });

  // Decided by the reviewers, not yet released — and those the decision sent
  // back. Whose desk a document is on differs by reader, so it lives here and
  // not on the register, which is a record.
  const decided = controller
    ? await db.revision.findMany({
        where: { state: "NOT_RELEASED" },
        include: {
          document: { select: { id: true, docNumber: true, title: true } },
          cycles: { select: { id: true, binding: true, outcome: true } },
        },
        orderBy: { createdAt: "asc" },
        take: 25,
      })
    : [];
  const verdictValues = controller ? await getActiveSet("REVIEW_OUTCOMES") : [];
  const lettsOut = (code: string | null | undefined) =>
    !code || verdictValues.find((one) => one.code === code)?.props.proceed === true;
  const withVerdict = decided.map((rev) => ({ ...rev, decidedAs: rev.cycles.find((c) => c.binding && c.outcome)?.outcome ?? null }));
  const toRelease = withVerdict.filter((rev) => lettsOut(rev.decidedAs));
  const held = withVerdict.filter((rev) => !lettsOut(rev.decidedAs));

  // Released, and nobody was ever told. Not a decision anybody owes: whoever
  // needed it sent did not ask, and this is where that stops being invisible.
  const neverSent = controller
    ? await db.revision.findMany({
        where: { state: "RELEASED", transmittalItems: { none: { transmittal: { direction: "OUTGOING" } } } },
        include: { document: { select: { id: true, docNumber: true, title: true } } },
        orderBy: { releasedAt: "asc" },
        take: 25,
      })
    : [];

  // Accepted submissions Document Control still has to route.
  const toRoute = controller
    ? await db.transmittal.findMany({ where: { direction: "INCOMING", status: "ACCEPTED", items: { some: { revision: { state: "IN_PREPARATION" } } } }, orderBy: { dateOfIssue: "asc" }, take: 20 })
    : [];

  // What moved while the reader was away: the last working day's worth of the
  // events that are news to somebody, not bookkeeping.
  //
  // Project-wide, for everybody. A release, a rejection or a transmittal is a
  // fact about the project, not about the person reading it; scoping the
  // record by department is how people stop trusting it, because each of them
  // ends up looking at a different project. What a reader may not see is
  // already settled by the scope, not by this page.
  const since = lastWorkingDay();
  const news = await db.auditEvent.findMany({
    where: { ts: { gte: since }, action: { in: NEWS } },
    orderBy: { ts: "desc" },
    take: 4,
  });
  // A quiet day should not leave the panel empty or showing one lonely line:
  // when the last working day produced almost nothing, the journal reaches
  // further back and says so instead.
  const older = news.length < 4
    ? await db.auditEvent.findMany({
        where: { ts: { lt: since }, action: { in: NEWS } },
        orderBy: { ts: "desc" },
        take: 4 - news.length,
      })
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
    ? await db.auditEvent.findMany({
        where: {
          AND: [
            { action: { in: kind ? NEWS.filter((one) => ACTIVITY[one].kind === kind) : NEWS } },
            from ? { ts: { gte: from } } : {},
            to ? { ts: { lte: to } } : {},
            sp.q ? { OR: [{ entityLabel: { contains: sp.q } }, { actorName: { contains: sp.q } }, { detail: { contains: sp.q } }] } : {},
          ],
        },
        orderBy: { ts: "desc" },
        take: 60,
      })
    : [];
  // An audit label reads "Q6637021-75-CI-SPC-00001 rev B — route name", and a
  // supplier's number runs half as long again. The panel measures its own
  // entries: the widest number sets the column the revisions line up in, and
  // when that number is long the kind is dropped rather than squeezed.
  const widest = Math.max(20, ...journal.map((e) => read(e.entityLabel)?.number.length ?? 0));
  const room = widest <= 26;

  // The requirements process: what is waiting on Document Control, and what
  // is waiting on the department this person answers for.
  const planning: { key: string; href: string; label: string; sub: string; cta: string; late?: boolean }[] = [];
  if (user.isInternal) {
    const me = await db.projectMembership.findFirst({ where: { projectId: ctx.projectId, userId: user.id, active: true } });
    const control = ctx.can("CONTROL");
    const untagged = actions.filter((a) => !departmentsOf(a).length).length;
    if ((control || ctx.can("PLAN")) && untagged) planning.push({ key: "tag", href: "/actions/requirements", label: `${untagged} activit${untagged === 1 ? "y" : "ies"} without departments`, sub: "The project manager's departments list", cta: "Open" });
    if (control || me?.department) {
      for (const d of await departmentRows(ctx)) {
        if (control && d.notIssued.length) planning.push({ key: `ask-${d.department}`, href: "/actions/requirements", label: `Ask ${d.department} for its documents`, sub: `${d.notIssued.length} activit${d.notIssued.length === 1 ? "y" : "ies"} not asked yet`, cta: "Issue" });
        if (control && d.state === "OVERDUE" && d.call) planning.push({ key: `late-${d.department}`, href: "/actions/requirements", label: `${d.department} list overdue`, sub: `due ${fmtDate(d.call.dueAt)}${d.call.reminders ? ` · reminded ${d.call.reminders}×` : ""}`, cta: "Chase", late: true });
        if (me?.department === d.department && d.call && !d.call.answeredAt) planning.push({ key: `fill-${d.department}`, href: `/api/requirements/sheet?dept=${d.department}`, label: `List the documents ${d.department} needs`, sub: `${d.call.actionCodes.split(",").length} activities · due ${fmtDate(d.call.dueAt)}`, cta: "Sheet", late: d.state === "OVERDUE" });
      }
    }
    if (control) {
      const toIssue = (await senderRows(ctx)).filter((r) => !r.lastIssue || r.changedSinceIssue);
      if (toIssue.length) planning.push({ key: "issue", href: "/actions/requirements", label: `Issue the requirements to ${toIssue.length} sender${toIssue.length === 1 ? "" : "s"}`, sub: toIssue.map((r) => (isDepartmentSender(r.sender) ? r.sender.slice(5) : r.sender)).join(", "), cta: "Issue" });
    }
    if (me?.department) {
      const confirmations = await db.readinessConfirmation.findMany({ where: { department: me.department }, select: { actionId: true } });
      for (const a of actions) {
        if (!a.scheduledDate || !departmentsOf(a).includes(me.department) || confirmations.some((c) => c.actionId === a.id)) continue;
        if (daysBefore(a.scheduledDate, DEFAULT_LEAD_DAYS).getTime() > Date.now()) continue;
        planning.push({ key: `confirm-${a.id}`, href: `/actions/${a.code}#confirm`, label: `Confirm ${me.department} documents for ${a.code}`, sub: `${a.name} · ${fmtDate(a.scheduledDate)}`, cta: "Confirm", late: a.scheduledDate.getTime() < Date.now() });
      }
    }
  }

  // One list per kind of ask: advice on a route's earlier step, or the
  // binding verdict — the one decision, which is also the release approval.
  const verdicts = assigned.filter((a) => a.cycle.binding);
  const advice = assigned.filter((a) => !a.cycle.binding);

  // Schedule activities whose documents will not be ready in time, for the
  // people engaged in them.
  //
  // Being engaged is not only a matter of which department an activity is
  // tagged with — plenty of people hold no department at all. Somebody is
  // engaged when the activity names their department, when they own it, or
  // when they are writing or reviewing one of the documents it waits on.
  // Document Control and the planners are engaged in all of them, because
  // chasing the schedule is their work.
  const engagedDocs = new Set<string>([
    ...assigned.map((a) => a.cycle.revision.document.docNumber),
    ...returned.map((c) => c.revision.document.docNumber),
    ...drafts.map((rev) => rev.document.docNumber),
    ...(await db.document.findMany({ where: { createdById: user.id }, select: { docNumber: true } })).map((d) => d.docNumber),
  ]);
  const wholeSchedule = controller || ctx.can("PLAN");
  const atRisk = actions
    .map((a) => {
      const short = a.entries.filter((e) => !meetsRequirement(e.document.revisions, e.requiredStatus));
      const late = a.scheduledDate ? a.scheduledDate.getTime() < Date.now() : false;
      const mine =
        (!!user.department && departmentsOf(a).includes(user.department)) ||
        (!!a.ownerName && a.ownerName === user.name) ||
        a.entries.some((e) => engagedDocs.has(e.document.docNumber));
      return { ...a, total: a.entries.length, ready: a.entries.length - short.length, short, late, mine };
    })
    .filter((a) => a.total > 0 && a.short.length && a.scheduledDate)
    .filter((a) => wholeSchedule || a.mine)
    // Newest first, deliberately. Sorted by how late they are, one activity
    // nobody intends to fix would sit at the top for months and hide every
    // risk that appeared after it; sorted by date, what has just gone wrong is
    // what the panel shows, and the standing failures are the schedule page's.
    .sort((a, b) => (b.scheduledDate?.getTime() ?? 0) - (a.scheduledDate?.getTime() ?? 0));


  // ── The rows, by queue ────────────────────────────────────────────────────
  const rows: Record<string, Row[]> = {
    verdict: verdicts.map<Row>((a) => ({
      href: `/reviews/${a.cycleId}`, code: a.cycle.revision.document.docNumber, rev: a.cycle.revision.value,
      title: a.cycle.revision.document.title,
      tag: "binding", tone: "sky",
      at: a.cycle.issuedToReviewAt ?? a.cycle.submittedAt, cta: "Decide",
    })),
    release: [
      ...held.map<Row>((rev) => ({
        href: `/documents/${rev.documentId}`, code: rev.document.docNumber, rev: rev.value, title: rev.document.title,
        tag: rev.decidedAs ?? "changes asked", tone: "amber", at: rev.statusSetAt, cta: "Send back",
      })),
      ...toRelease.map<Row>((rev) => ({
        href: `/documents/${rev.documentId}`, code: rev.document.docNumber, rev: rev.value, title: rev.document.title,
        tag: rev.statusCode ?? "decided", tone: "emerald", at: rev.statusSetAt, cta: "Release",
      })),
    ],
    returned: returned.map<Row>((c) => ({
      href: `/reviews/${c.id}`, code: c.revision.document.docNumber, rev: c.revision.value, title: c.revision.document.title,
      tag: c.outcome ?? "reviewed", tone: "amber", at: c.returnedToOriginatorAt, cta: "See comments",
    })),
    unsent: neverSent.map<Row>((rev) => ({
      href: `/documents/${rev.documentId}`, code: rev.document.docNumber, rev: rev.value, title: rev.document.title,
      tag: rev.statusCode ?? "released", tone: "violet", at: rev.releasedAt, cta: "Ask to send",
    })),
    owed: owed.flatMap<Row>((o) => o.rows.map((r) => ({
      href: `/packages/${o.pkg}`, code: r.doc.docNumber, title: r.doc.title,
      tag: STATE_LABEL[r.state], tone: r.late && r.state === "NOT_SENT" ? "amber" : "plain", cta: "Upload",
    }))),
    review: advice.map<Row>((a) => ({
      href: `/reviews/${a.cycleId}`, code: a.cycle.revision.document.docNumber, rev: a.cycle.revision.value,
      title: a.cycle.revision.document.title, tag: "advice", tone: "sky",
      at: a.cycle.issuedToReviewAt ?? a.cycle.submittedAt, cta: "Review",
    })),
    incoming: incoming.map<Row>((t) => ({
      href: `/transmittals/${t.id}`, code: t.number, title: `from ${t.issuingParty}`,
      tag: "received", tone: "sky", at: t.dateOfIssue, cta: "Check",
    })),
    route: toRoute.map<Row>((t) => ({
      href: `/transmittals/${t.id}`, code: t.number, title: `from ${t.issuingParty}`,
      tag: "accepted", tone: "emerald", at: t.dateOfIssue, cta: "Send for review",
    })),
    requirements: planning.map<Row>((p) => ({
      href: p.href, code: p.label, plain: true, title: p.sub,
      tag: p.late ? "overdue" : "asked", tone: p.late ? "amber" : "plain", cta: p.cta,
    })),
    drafts: drafts.map<Row>((rev) => ({
      href: `/documents/${rev.documentId}#workflow`, code: rev.document.docNumber, rev: rev.value, title: rev.document.title,
      tag: rev.renditionFileId ? "file attached" : "no file", tone: "plain", at: rev.createdAt, cta: "Continue",
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
    { id: "unsent", tab: "Not sent", title: "Released, never sent", icon: <Send />, accent: "violet",
      asks: "Released, but nobody outside has been told yet.",
      then: "Whoever needs them is working from an older issue.", call: "Ask for them to go out" },
    { id: "requirements", tab: "Requirements", title: "Document requirements", icon: <ListChecks />, accent: "steel",
      asks: "Asks in the requirements process, still open.",
      then: "The schedule cannot say what it needs until answered.", call: "Work the list" },
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
  const today = ["verdict", "release", "returned", "unsent", "owed"].flatMap((id) => rows[id]);
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
              {user.functionName ?? (controller ? "Document Control" : user.isInternal ? "Project team" : user.partyName ?? "Partner")}
            </p>
          </div>
          {user.isInternal ? (
            <Link href="/documents/new" className="inline-flex items-center mt-0.5 gap-2 rounded-lg bg-white px-4 py-2.5 text-[13px] font-semibold whitespace-nowrap text-brand-strong transition hover:-translate-y-px hover:shadow-lg">
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
        <Link
          href="/?view=log"
          scroll={false}
          aria-current={view === "log" ? "page" : undefined}
          className="segment ml-auto"
        >
          The log
        </Link>
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
              <form className="register rounded-xl border border-line bg-surface px-4 py-2.5">
                <input type="hidden" name="view" value="log" />
                <div className="flex flex-wrap items-end gap-x-4 gap-y-2.5 lg:flex-nowrap">
                  <label className="relative min-w-48 flex-1">
                    <span className="sr-only">Search the log</span>
                    <Search className="absolute top-1/2 left-0 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      name="q"
                      defaultValue={sp.q ?? ""}
                      placeholder="A number, a person, a detail"
                      className="plain w-full py-1.5! pl-6! text-[13px]!"
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
            <section className="home-rise rounded-xl border border-line bg-surface px-5 py-8 text-sm text-slate-500" style={rise()}>
              You are clear. Reviews to answer, verdicts to give and work sent back to you appear here.
            </section>
          )}
        </main>

        <aside className="grid min-w-0 gap-3 xl:sticky xl:top-22">
          {journal.length && view !== "log" ? (
            <section className="home-rise rounded-xl border border-line bg-surface px-4 py-3" style={rise()}>
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
                            <Link href="/?view=log" scroll={false} className="mt-2.5 inline-block text-xs font-semibold text-link hover:underline">Everything that happened →</Link>
            </section>
          ) : null}

          {user.isInternal && atRisk.length ? (
            <section className="home-rise rounded-xl border border-line bg-surface px-4 py-3" style={rise()}>
              <h2 className="mb-1 text-[11px] font-semibold tracking-[0.09em] text-slate-400 uppercase">Schedule</h2>
              {atRisk.slice(0, 3).map((a) => {
                // An activity's name carries where it is after a dash — "Foundation
                // concrete pour — clarifier TK-201, area 71" — and the place is
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

/** One row of a queue: a thing, a tag, how long it waited, the verb. */
type Row = {
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
 * reader can tell a transmittal from a verdict without reading the sentence.
 */
const ACTIVITY: Record<string, { kind: string; said: string; mark: string }> = {
  TRANSMITTAL_RAISED: { kind: "Transmittal", said: "was issued", mark: "border-violet-600" },
  TRANSMITTAL_OPENED: { kind: "Transmittal", said: "was received", mark: "border-violet-600" },
  TRANSMITTAL_RECEIVED: { kind: "Transmittal", said: "was received", mark: "border-violet-600" },
  TRANSMITTAL_ACCEPTED: { kind: "Transmittal", said: "was accepted on arrival", mark: "border-emerald-600" },
  TRANSMITTAL_REJECTED: { kind: "Transmittal", said: "was returned to its sender", mark: "border-red-600" },
  TRANSMITTAL_CHASED: { kind: "Transmittal", said: "was put in front of them again", mark: "border-amber-600" },
  TRANSMITTAL_SENT_ON: { kind: "Transmittal", said: "was sent on to an organization outside the system", mark: "border-emerald-600" },
  TRANSMITTAL_CLOSED: { kind: "Transmittal", said: "was closed", mark: "border-slate-400" },
  ACTION_CARRIED: { kind: "Schedule", said: "went ahead without all of its documents", mark: "border-amber-600" },
  ACTION_STOPPED: { kind: "Schedule", said: "was postponed", mark: "border-slate-400" },
  CUSTODY: { kind: "Transmittal", said: "was handed over", mark: "border-violet-600" },
  ISSUE_REQUESTED: { kind: "Issue", said: "was requested for issue", mark: "border-violet-600" },
  ISSUE: { kind: "Issue", said: "was issued", mark: "border-violet-600" },
  ISSUED: { kind: "Issue", said: "was issued", mark: "border-violet-600" },
  ISSUE_REQUEST_CANCELLED: { kind: "Issue", said: "issue request cancelled", mark: "border-slate-400" },
  RELEASE: { kind: "Release", said: "was released", mark: "border-emerald-600" },
  WORKFLOW_STARTED: { kind: "Review", said: "was sent for review", mark: "border-brand-line" },
  STEP_DISPATCHED: { kind: "Review", said: "moved to the next step", mark: "border-brand-line" },
  REVIEW_OUTCOME: { kind: "Decision", said: "was decided", mark: "border-amber-600" },
  APPROVAL: { kind: "Decision", said: "was approved", mark: "border-emerald-600" },
  WORKFLOW_COMPLETED: { kind: "Decision", said: "completed its review", mark: "border-emerald-600" },
  WORKFLOW_RETURNED: { kind: "Return", said: "was returned to its author", mark: "border-amber-600" },
  REVISION_ESTABLISHED: { kind: "Revision", said: "was opened", mark: "border-slate-400" },
  REGISTER_ENTRY: { kind: "Register", said: "was added to the register", mark: "border-slate-400" },
  REQUIREMENTS_ISSUED: { kind: "Requirements", said: "were issued", mark: "border-slate-400" },
  REQUIREMENTS_REMINDER: { kind: "Requirements", said: "were reminded", mark: "border-amber-600" },
  SHORTFALL_ISSUED: { kind: "Schedule", said: "was reported short", mark: "border-amber-600" },
  SHORTFALL_ACCEPTED: { kind: "Schedule", said: "shortfall was accepted", mark: "border-slate-400" },
  DELEGATION_REQUESTED: { kind: "Review", said: "was asked to be handed over", mark: "border-amber-600" },
  DELEGATION_GRANTED: { kind: "Review", said: "was handed to somebody else", mark: "border-brand-line" },
  DELEGATION_REFUSED: { kind: "Review", said: "stayed with its reviewer", mark: "border-slate-400" },
  DELEGATION_WITHDRAWN: { kind: "Review", said: "came back to its reviewer", mark: "border-slate-400" },
  CHECK_RUN: { kind: "Register", said: "was checked", mark: "border-slate-400" },
};

const NEWS = Object.keys(ACTIVITY);

/** The kinds of act, in the order they were named, each said once. */
const KINDS = [...new Set(Object.values(ACTIVITY).map((one) => one.kind))];

/**
 * A date from the address, as the day it names. The end of a window is the end
 * of that day, so asking for the 3rd to the 3rd returns the 3rd.
 */
function startOfDay(said: string | undefined, end = false): Date | null {
  if (!said) return null;
  const at = new Date(said);
  if (Number.isNaN(at.getTime())) return null;
  at.setHours(end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
  return at;
}

/** The edge a kind of act is filed under, as in the administrators' log. */
const LOG_EDGE: Record<string, string> = {
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

const TONES: Record<Row["tone"], string> = {
  amber: "bg-amber-50 text-amber-700",
  sky: "bg-sky-50 text-sky-700",
  emerald: "bg-emerald-50 text-emerald-700",
  violet: "bg-violet-50 text-violet-700",
  plain: "bg-canvas-deep text-slate-600",
};

/** The number and revision inside an audit label, if it carries them. */
function read(label: string | null): { number: string; rev: string | null } | null {
  const said = (label ?? "").split(" — ")[0].trim();
  if (!said) return null;
  const at = said.lastIndexOf(" rev ");
  return at === -1 ? { number: said, rev: null } : { number: said.slice(0, at), rev: said.slice(at + 5) };
}

function daysOf(at: Date | null | undefined): number | null {
  if (!at) return null;
  return Math.max(0, Math.round((Date.now() - at.getTime()) / 86_400_000));
}

/** The last working day, so on a Monday the news says "since Friday". */
function lastWorkingDay(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  do {
    d.setDate(d.getDate() - 1);
  } while (d.getDay() === 0 || d.getDay() === 6);
  return d;
}

/** The acts of the log, filed under the day they happened. */
function dayed<T extends { ts: Date }>(acts: T[]): { day: string; when: Date; acts: T[] }[] {
  const days: { day: string; when: Date; acts: T[] }[] = [];
  for (const act of acts) {
    const day = act.ts.toDateString();
    const last = days[days.length - 1];
    if (last?.day === day) last.acts.push(act);
    else days.push({ day, when: act.ts, acts: [act] });
  }
  return days;
}

function weekday(d: Date): string {
  return d.toLocaleDateString("en-GB", { weekday: "long" });
}

/** How long ago, in the words a person would use. */
function when(at: Date): string {
  const mins = Math.round((Date.now() - at.getTime()) / 60_000);
  if (mins < 60) return mins <= 1 ? "just now" : `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return fmtDate(at);
}

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

/** One figure in the band. It counts up once, from a value already rendered. */
function Fig({ value, unit, label, index, href }: {
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
type Aspect = {
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
const EDGE: Record<Aspect["accent"], string> = {
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
function Card({ aspect, rows, style }: { aspect: Aspect; rows: Row[]; style?: React.CSSProperties }) {
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
      className="home-rise group relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-surface px-4 pt-3.5 pb-3 transition hover:-translate-y-px hover:border-line-strong hover:shadow-md"
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
function Queue({ aspect, rows, style }: { aspect: Aspect; rows: Row[]; style?: React.CSSProperties }) {
  return (
    <section className="home-rise mb-3.5 min-w-0 overflow-hidden rounded-xl border border-line bg-surface" style={style}>
      <header className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <span className="grid h-5.5 w-5.5 place-items-center rounded-md bg-canvas-deep text-slate-500 [&_svg]:h-3.25 [&_svg]:w-3.25">{aspect.icon}</span>
        <h2 className="text-[13.5px] font-semibold">{aspect.title}</h2>
        <span className="ml-auto font-mono text-xs text-slate-400">{rows.length}</span>
      </header>
      {rows.map((one) => <Line key={one.href + one.code + (one.rev ?? "")} row={one} />)}
    </section>
  );
}

function Line({ row }: { row: Row }) {
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
      <Link href={row.href} className="inline-block rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] font-semibold whitespace-nowrap text-brand-ink transition hover:border-brand-line hover:bg-tint">
        {row.cta}
      </Link>
    </div>
  );
}
