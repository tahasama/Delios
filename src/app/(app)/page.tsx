import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { ButtonLink, Chip } from "@/components/ui";
import { isController, isAdmin } from "@/lib/auth";
import { fmtDate } from "@/lib/utils";
import { supplierRows, WITH_SUPPLIER, STATE_LABEL } from "@/lib/supplier";
import { parseSteps } from "@/lib/workflow";
import { departmentsOf, businessDaysBefore, DEFAULT_LEAD_BUSINESS_DAYS } from "@/lib/schedule";
import { departmentRows, senderRows, isDepartmentSender } from "@/lib/requirements-process";
import { ArrowRight, CheckCircle2, FilePlus2, ShieldCheck } from "lucide-react";
import { hasVerb } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Home is the work queue. It used to be a dashboard that summarised the queue
 * four ways and linked to a separate My work page that listed it a fifth; now
 * the items themselves are here, each with the one thing to do about it.
 */
export default async function HomePage() {
  const ctx = await requireScope();
  const { user, db } = ctx;
  const canDecide = hasVerb(user, "APPROVE") || hasVerb(user, "REVIEW");
  const controller = isController(user) || isAdmin(user);

  const [assigned, returned, incoming, drafts, actions, lastRun, criticalDefects] = await Promise.all([
    db.reviewAssignment.findMany({
      where: { userId: user.id, completedAt: null, cycle: { status: "OPEN", issuedToReviewAt: { not: null } } },
      include: { cycle: { include: { revision: { include: { document: true } }, comments: true } } },
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
      include: { entries: { include: { document: { include: { revisions: { where: { state: "RELEASED" }, orderBy: { releasedAt: "desc" }, take: 1 } } } } } },
    }),
    controller ? db.checkRun.findFirst({ orderBy: { ranAt: "desc" } }) : Promise.resolve(null),
    controller ? db.defect.count({ where: { severity: "CRITICAL", status: { in: ["OPEN", "ACCEPTED"] } } }) : Promise.resolve(0),
  ]);

  // A supplier's work is its package: what it still owes, and what came back.
  const supplierPkgs = !user.isInternal && user.partyCode
    ? await db.package.findMany({ where: { category: "SUPPLIER", partyCode: user.partyCode } })
    : [];
  const owed: { pkg: string; rows: Awaited<ReturnType<typeof supplierRows>> }[] = [];
  for (const p of supplierPkgs) owed.push({ pkg: p.identifier, rows: (await supplierRows(ctx, p)).filter((r) => WITH_SUPPLIER.includes(r.state)) });
  // Accepted submissions Document Control still has to route.
  const toRoute = controller
    ? await db.transmittal.findMany({ where: { direction: "INCOMING", status: { in: ["ACCEPTED", "CLOSED"] }, items: { some: { revision: { state: "IN_PREPARATION" } } } }, orderBy: { dateOfIssue: "asc" }, take: 20 })
    : [];

  // The requirements process: what is waiting on Document Control, and what
  // is waiting on the department this person answers for.
  const planning: { key: string; href: string; label: string; sub: string; cta: string; late?: boolean }[] = [];
  if (user.isInternal) {
    const me = await db.projectMembership.findFirst({ where: { projectId: ctx.projectId, userId: user.id, active: true } });
    const control = ctx.can("CONTROL");
    const untagged = actions.filter((a) => !departmentsOf(a).length).length;
    if ((control || ctx.can("PLAN")) && untagged) planning.push({ key: "tag", href: "/actions/requirements", label: `${untagged} activit${untagged === 1 ? "y" : "ies"} without departments`, sub: "The project manager's departments list", cta: "Open →" });
    if (control || me?.department) {
      for (const d of await departmentRows(ctx)) {
        if (control && d.notIssued.length) planning.push({ key: `ask-${d.department}`, href: "/actions/requirements", label: `Ask ${d.department} for its documents`, sub: `${d.notIssued.length} activit${d.notIssued.length === 1 ? "y" : "ies"} not asked yet`, cta: "Issue →" });
        if (control && d.state === "OVERDUE" && d.call) planning.push({ key: `late-${d.department}`, href: "/actions/requirements", label: `${d.department} list overdue`, sub: `due ${fmtDate(d.call.dueAt)}${d.call.reminders ? ` · reminded ${d.call.reminders}×` : ""}`, cta: "Chase →", late: true });
        if (me?.department === d.department && d.call && !d.call.answeredAt) planning.push({ key: `fill-${d.department}`, href: `/api/requirements/sheet?dept=${d.department}`, label: `List the documents ${d.department} needs`, sub: `${d.call.actionCodes.split(",").length} activities · due ${fmtDate(d.call.dueAt)} · return it to Document Control`, cta: "Sheet ↓", late: d.state === "OVERDUE" });
      }
    }
    if (control) {
      const toIssue = (await senderRows(ctx)).filter((r) => !r.lastIssue || r.changedSinceIssue);
      if (toIssue.length) planning.push({ key: "issue", href: "/actions/requirements", label: `Issue the requirements to ${toIssue.length} sender${toIssue.length === 1 ? "" : "s"}`, sub: toIssue.map((r) => (isDepartmentSender(r.sender) ? r.sender.slice(5) : r.sender)).join(", "), cta: "Issue →" });
    }
    if (me?.department) {
      const confirmations = await db.readinessConfirmation.findMany({ where: { department: me.department }, select: { actionId: true } });
      for (const a of actions) {
        if (!a.scheduledDate || !departmentsOf(a).includes(me.department) || confirmations.some((c) => c.actionId === a.id)) continue;
        if (businessDaysBefore(a.scheduledDate, DEFAULT_LEAD_BUSINESS_DAYS).getTime() > Date.now()) continue;
        planning.push({ key: `confirm-${a.id}`, href: `/actions/${a.code}#confirm`, label: `Confirm ${me.department} documents for ${a.code}`, sub: `${a.name} · ${fmtDate(a.scheduledDate)}`, cta: "Confirm →", late: a.scheduledDate.getTime() < Date.now() });
      }
    }
  }

  // One list per kind of ask: advice on a route's earlier step, or the
  // binding verdict — the one decision, which is also the release approval.
  const verdicts = assigned.filter((a) => a.cycle.binding);
  const reviews = assigned.filter((a) => !a.cycle.binding);

  // Schedule actions whose documents will not be ready in time.
  const atRisk = actions
    .map((a) => {
      const total = a.entries.length;
      const ready = a.entries.filter((e) => e.document.revisions[0]?.statusCode === e.requiredStatus).length;
      const late = a.scheduledDate ? a.scheduledDate.getTime() < Date.now() : false;
      return { ...a, total, ready, late };
    })
    .filter((a) => a.total > 0 && a.ready < a.total && a.scheduledDate);

  const owedCount = owed.reduce((n, o) => n + o.rows.length, 0);
  const waiting = planning.length + reviews.length + verdicts.length + returned.length + incoming.length + drafts.length + toRoute.length + owedCount;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Good day, {user.name.split(" ")[0]}.</h1>
          <p className="mt-1 text-sm text-slate-500">{waiting ? `${waiting} thing${waiting === 1 ? "" : "s"} waiting on you.` : "Nothing is waiting on you."}</p>
        </div>
        {user.isInternal ? <ButtonLink href="/documents/new"><FilePlus2 className="h-4 w-4" /> Create document</ButtonLink> : null}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {waiting === 0 ? (
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-surface px-5 py-6 shadow-sm">
              <CheckCircle2 className="h-6 w-6 text-emerald-500" />
              <p className="text-sm text-slate-600">You are clear. New reviews, verdicts to give and returned work appear here.</p>
            </div>
          ) : null}

          <Group title="Give the verdict" count={verdicts.length}>
            {verdicts.map((a) => (
              <Row key={a.id} href={`/reviews/${a.cycleId}`} doc={a.cycle.revision.document} rev={a.cycle.revision.value} cta="Decide"
                note={a.cycle.comments.some((c) => c.progressionPreventing && c.status === "OPEN") ? <Chip className="bg-red-100 text-red-700 ring-red-300">blocking comments</Chip> : null} />
            ))}
          </Group>

          <Group title="Review — your advice" count={reviews.length}>
            {reviews.map((a) => (
              <Row key={a.id} href={`/reviews/${a.cycleId}`} doc={a.cycle.revision.document} rev={a.cycle.revision.value} cta="Review"
                note={a.cycle.comments.some((c) => c.progressionPreventing && c.status === "OPEN") ? <Chip className="bg-red-100 text-red-700 ring-red-300">blocking comments</Chip> : null} />
            ))}
          </Group>

          <Group title="Returned to you" count={returned.length}>
            {returned.map((c) => (
              <Row key={c.id} href={`/reviews/${c.id}`} doc={c.revision.document} rev={c.revision.value} cta="See comments"
                note={<span className="text-xs text-slate-500">{c.outcome?.replaceAll("_", " ").toLowerCase()}{c.comments.length ? ` · ${c.comments.length} blocking` : ""}</span>} />
            ))}
          </Group>

          <Group title="Received — check and accept" count={incoming.length}>
            {incoming.map((t) => (
              <li key={t.id}>
                <Link href={`/transmittals/${t.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                  <span className="font-mono text-[13px] font-semibold text-slate-900">{t.number}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-500">from {t.issuingParty} · {fmtDate(t.dateOfIssue)}</span>
                  <span className="text-xs font-semibold text-link">Check →</span>
                </Link>
              </li>
            ))}
          </Group>

          {owed.map((o) => (
            <Group key={o.pkg} title="To send us" count={o.rows.length}>
              {o.rows.map((r) => (
                <li key={r.doc.id}>
                  <Link href={`/packages/${o.pkg}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                    <span className="min-w-0 flex-1">
                      <span className="font-mono text-[13px] font-semibold text-slate-900">{r.doc.docNumber}</span>
                      <span className="block truncate text-xs text-slate-500">{r.doc.title}</span>
                    </span>
                    <span className={`text-xs ${r.state === "NOT_SENT" ? (r.late ? "text-red-700" : "text-slate-500") : "text-orange-700"}`}>{STATE_LABEL[r.state]}{r.late && r.state === "NOT_SENT" ? " · overdue" : ""}</span>
                    <span className="shrink-0 text-xs font-semibold text-link">Upload →</span>
                  </Link>
                </li>
              ))}
            </Group>
          ))}

          <Group title="Document requirements" count={planning.length}>
            {planning.map((p) => (
              <li key={p.key}>
                <a href={p.href} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className={`text-[13px] font-semibold ${p.late ? "text-red-700" : "text-slate-900"}`}>{p.label}</span>
                    <span className="block truncate text-xs text-slate-500">{p.sub}</span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-link">{p.cta}</span>
                </a>
              </li>
            ))}
          </Group>

          <Group title="Accepted — send for review" count={toRoute.length}>
            {toRoute.map((t) => (
              <li key={t.id}>
                <Link href={`/transmittals/${t.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                  <span className="font-mono text-[13px] font-semibold text-slate-900">{t.number}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-500">from {t.issuingParty} · {fmtDate(t.dateOfIssue)}</span>
                  <span className="text-xs font-semibold text-link">Route →</span>
                </Link>
              </li>
            ))}
          </Group>

          <Group title="Your drafts" count={drafts.length}>
            {drafts.map((rev) => (
              <Row key={rev.id} href={`/documents/${rev.documentId}#workflow`} doc={rev.document} rev={rev.value} cta="Continue"
                note={<span className="text-xs text-slate-500">{rev.renditionFileId ? "file attached" : "no file yet"}</span>} />
            ))}
          </Group>
        </div>

        <aside className={user.isInternal ? "space-y-4" : "hidden"}>
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-surface shadow-sm">
            <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Schedule at risk</h2>
              <Link href="/actions" className="text-xs font-semibold text-link hover:underline">Schedule →</Link>
            </header>
            {atRisk.length ? (
              <ul className="divide-y divide-slate-100">
                {atRisk.slice(0, 6).map((a) => (
                  <li key={a.id}>
                    <Link href={`/actions/${a.code}`} className="block px-5 py-3 hover:bg-slate-50">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-bold text-link">{a.code}</span>
                        <span className={`text-[11px] font-semibold ${a.late ? "text-red-700" : "text-amber-700"}`}>{a.late ? "overdue" : fmtDate(a.scheduledDate)}</span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-700">{a.name}</p>
                      <p className="text-[11px] text-slate-400">{a.ready} of {a.total} documents ready</p>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-4 text-xs text-slate-500">{actions.length ? "Every scheduled action has its documents." : "No schedule loaded yet."}</p>
            )}
          </section>

          {controller ? (
            <Link href="/conformance" className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-surface px-5 py-4 shadow-sm hover:bg-slate-50">
              <ShieldCheck className={`h-5 w-5 ${lastRun && lastRun.integrity >= 95 && !criticalDefects ? "text-emerald-600" : "text-amber-600"}`} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-800">Register health</span>
                <span className="block text-xs text-slate-500">{lastRun ? `${lastRun.integrity.toFixed(0)}% clean · ${criticalDefects} critical issue${criticalDefects === 1 ? "" : "s"}` : "Not checked yet"}</span>
              </span>
              <ArrowRight className="h-4 w-4 text-slate-300" />
            </Link>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (!count) return null;
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-surface shadow-sm">
      <header className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <span className="rounded-full bg-slate-100 px-2 text-xs font-bold text-slate-600">{count}</span>
      </header>
      <ul className="divide-y divide-slate-100">{children}</ul>
    </section>
  );
}

function Row({ href, doc, rev, cta, note }: { href: string; doc: { docNumber: string; title: string }; rev: string; cta: string; note?: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
        <span className="min-w-0 flex-1">
          <span className="font-mono text-[13px] font-semibold text-slate-900">{doc.docNumber}</span>
          <span className="ml-1.5 font-mono text-xs text-slate-500">rev {rev}</span>
          <span className="block truncate text-xs text-slate-500">{doc.title}</span>
        </span>
        {note}
        <span className="shrink-0 text-xs font-semibold text-link">{cta} →</span>
      </Link>
    </li>
  );
}
