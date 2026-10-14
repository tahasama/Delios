import { ActionNotes, type WentAhead } from "./lateness";
import { NeededTable, type NeededRow } from "./needed-table";
import { latenessOf } from "@/lib/actions/action-lateness";
import { carrierRefusal, actIsOff } from "@/lib/settings/control-activities";
import Link from "next/link";
import { requireScope } from "@/lib/core/scope";
import { notFound } from "next/navigation";
import { Card, Chip, Banner, Field, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { confirmReadinessAction, revokeReadinessAction } from "@/lib/actions/forms-readiness";
import { departmentsOf, DEFAULT_LEAD_DAYS } from "@/lib/actions/schedule";
import { Timeline } from "@/components/timeline";
import { fmtDate } from "@/lib/core/utils";
import { ArrowLeft } from "lucide-react";
import { getActiveSet } from "@/lib/settings/config";
import { api } from "@/lib/client";
import { holders } from "@/lib/settings/api";
import { planActionByCode, planVersion, noticesAbout, noticeHistory } from "@/lib/actions/api";
import { movedPhrase } from "../moved";
import { stateLabel, isPostponed, type ActionState } from "@/lib/actions/action-state";
import { mayUploadLists } from "@/lib/core/permissions";
import { NotifyPanel } from "@/components/notify-panel";
import { LinksCard, proposalText, type Ask } from "./links-card";
import { activityRequests } from "@/lib/actions/api";
import { confirmActionRequestAction, refuseActionRequestAction, addOwnDisciplineAction } from "@/lib/actions/forms-links";
import { addressees } from "@/lib/transmittals/api";
import { registerByNumber } from "@/lib/documents/api-register";

export const dynamic = "force-dynamic";

/**
 * One scheduled activity and everything it needs. Departments are tagged by
 * the project manager; the documents come from the approved requirements list.
 */
export default async function ActionDetailPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ dept?: string }> }) {
  const ctx = await requireScope();
  const { code } = await params;
  const { dept } = await searchParams;
  const [action, version] = await Promise.all([planActionByCode(ctx, code), planVersion(ctx)]);
  if (!action) notFound();

  const [disciplines, parties] = await Promise.all([
    getActiveSet("DISCIPLINES").then((rows) => [...rows].sort((a, b) => a.label.localeCompare(b.label))),
    // Suppliers are the organizations the project deals with.
    api<{ code: string; name: string }[]>("/api/parties").then((rows) => rows.map((one) => ({ code: one.code, label: one.name }))).catch(() => []),
  ]);
  const deptLabel = (c: string | null) => (c ? disciplines.find((d) => d.code === c)?.label ?? c : "—");
  const partyLabel = (c: string | null) => (c ? parties.find((p) => p.code === c)?.label ?? c : "Us");

  const depts = departmentsOf(action);
  const control = ctx.can("CONTROL");
  // Another organization's people read the same page, narrowed by the backend to their own documents; the
  // disciplines, confirmations and notes about the action are ours.
  const inside = ctx.user.isInternal;
  // Only administrators read the audit trail, so only they are sent to it.
  const me = { department: ctx.user.department ?? null };
  const entries = dept ? action.needs.filter((e) => e.department === dept) : action.needs;
  // Which of the three moments slipped, for each document, and who writes the
  // note about what was decided.
  const lateness = await latenessOf(ctx, action.id);
  // Left out by the organization: the notes already written are still read.
  const mayNote = inside && !(await actIsOff(ctx, "ACTION_NOTE")) && !(await carrierRefusal(ctx, "ACTION_NOTE", { control, standing: true }));
  // The latest schedule read moved its dates: said once, under the date.
  const moved = movedPhrase(action.moved, action.start, action.finish);
  const readyCount = action.needs.filter((e) => e.state === "MET").length;
  // The earliest date a document is owed: where the activity's own clock starts.
  const firstDue = action.needs.map((e) => e.neededBy).filter(Boolean).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  // The same states the schedule uses, by the same rule, so the two pages never
  // disagree about one action.
  const everything = action.needs.length > 0 && readyCount === action.needs.length;
  const readiness = action.state;
  // A department is a discipline: the people whose membership names one of them.
  const people = inside ? await holders(ctx.projectId, "READ").catch(() => []) : [];
  // Manual notices: Document Control, or whoever plans the project. Each discipline's panel counts every notice
  // sent about this action to that discipline, the automatic ones included.
  const mayNotify = inside && mayUploadLists(ctx.user.verbs);
  const notices = inside ? await noticesAbout(ctx, `activity:${action.id}:`) : [];
  const pickPeople = people.map((one) => ({ id: one.id, name: one.name, detail: one.department ? deptLabel(one.department) : one.functionName }));
  // A document a supplier owes: that supplier's people are recommended for the notice, and chosen.
  const book = await addressees(ctx);
  const suppliersOf = (missing: (typeof action.needs)[number][]) => book.parties
    .filter((p) => missing.some((e) => e.document.originator === p.code))
    .map((p) => ({
      party: p,
      docs: missing.filter((e) => e.document.originator === p.code),
      people: book.people.filter((one) => one.organization === p.name),
    }));
  // Asking for a document the list missed: a transmittal to Document Control, the file attached there.
  const controllers = inside ? await holders(ctx.projectId, "CONTROL").catch(() => []) : [];
  const requestHref = (department: string) => `/transmittals/new?${new URLSearchParams({
    reason: "INFORMATION",
    activity: action.id,
    ask: "DOCUMENT",
    users: controllers.map((one) => one.id).join(","),
    subject: `Add a document to ${action.code} (${deptLabel(department)})`,
    message: [
      `Please add the attached document to ${action.code}, ${action.name}, on ${fmtDate(action.start)}, for ${deptLabel(department)}.`,
      "It was not on the requirements list.",
    ].join("\n\n"),
  })}`;

  // Who adds documents and disciplines to an action here: Document Control (asked by everyone else), or, without it,
  // the people of each discipline for their own.
  const { controlDoes } = await import("@/lib/settings/control-activities");
  const selfLinks = !(await controlDoes(ctx, "ACTION_LINKS"));

  // A discipline the action should concern and does not: anyone on the project may ask Document Control to add it.
  const disciplineRequestHref = `/transmittals/new?${new URLSearchParams({
    reason: "INFORMATION",
    activity: action.id,
    ask: "DISCIPLINE",
    users: controllers.map((one) => one.id).join(","),
    subject: `Add a discipline to ${action.code}`,
    message: `Please add the discipline … to ${action.code}, ${action.name}, on ${fmtDate(action.start)}.\n\nWhy it concerns us: …`,
  })}`;

  // The requests about this action not yet answered: Document Control sees them all; whoever is asked to
  // confirm one sees that one, at the top of the page.
  const requests = inside ? await activityRequests(ctx, action.id) : [];
  const asks: Ask[] = control ? requests : [];
  const mine = requests.filter((one) => one.checkedAt && one.confirmerId === ctx.user.id);
  // Who may be asked to confirm: everyone on the project, those holding Manage first and marked so.
  const managers = new Set((inside ? await holders(ctx.projectId, "MANAGE").catch(() => []) : []).map((one) => one.id));
  const confirmers = book.people
    .map((one) => ({ id: one.id, name: one.name, detail: [managers.has(one.id) ? "Manage · recommended" : null, one.organization, one.function].filter(Boolean).join(" · ") }))
    .sort((a, b) => Number(managers.has(b.id)) - Number(managers.has(a.id)) || a.name.localeCompare(b.name));
  // The register, read once: document numbers for what a checked request will add, and Document Control's pick list.
  const register = mine.length || control ? [...(await registerByNumber(ctx)).values()] : [];
  const numberOf = new Map(register.map((d) => [d.id, d.number] as const));
  const pickDocuments = control ? register.map((d) => ({ id: d.id, name: d.number, detail: d.title })) : [];

  // Which disciplines stand confirmed, by the card's own rule: a confirmation by hand (or frozen by the
  // system on the day), or, before the day, every one of its documents released at its status.
  const confirmedDepts = depts.filter((d) => {
    const own = action.needs.filter((e) => e.department === d || !e.department);
    const ready = own.length > 0 && own.every((e) => e.state === "MET");
    return action.confirmations.some((x) => x.department === d && !x.revokedAt) || (!action.passed && ready);
  });
  const confirmedAt = action.confirmations.filter((x) => !x.revokedAt).map((x) => x.confirmedAt).filter((x): x is Date => !!x)
    .sort((x, y) => y.getTime() - x.getTime())[0] ?? action.lastMetAt ?? null;

  // The work is taken to have happened once its day has passed — that is what
  // a schedule is — unless a postponement was written down and not taken back.
  // Which decisions mean "postponed" is the organization's list: those that do not proceed.
  const postponeCodes = (await getActiveSet("ACTIVITY_DECISIONS")).filter((one) => one.props.proceeds !== true).map((one) => one.code);
  const postponed = isPostponed(action, postponeCodes)
    ? action.decisions.find((note) => postponeCodes.includes(note.decision) && !note.reversedAt) ?? null
    : null;
  const happened = !postponed && action.passed;
  // Went ahead? Not yet before the day; after it, read from the documents unless postponed.
  const missingCount = action.needs.length - readyCount;
  const wentAhead: WentAhead = postponed ? "POSTPONED" : !action.passed ? "NOT_YET" : missingCount > 0 ? "MISSING_DOCUMENTS" : "WITH_DOCUMENTS";

  // One row per required document: what it is, whether it is there, and the
  // step where its time went. Dates are written here so the table stays a
  // client component without carrying Date objects across.
  const delayOf = new Map(lateness.rows.map((row) => [row.docNumber, row]));
  // Where each needed document stands, in the organization's own words for its states: it is listed whatever its
  // state, so people know it exists even before it is ready.
  const { policy } = await import("@/lib/settings/control-activities");
  const { stateNames, stateName } = await import("@/lib/core/state-names");
  const [names, together] = await Promise.all([stateNames(ctx), policy(ctx, "POLICY_RELEASE").then((one) => one === "TOGETHER")]);
  const standing = (e: (typeof entries)[number]) => {
    const latest = e.document.latest;
    if (!latest) return e.document.isPlaceholder ? "placeholder · not started" : "no revision yet";
    const name = stateName(names, latest.state, { together, held: latest.held });
    return `rev ${latest.value}${latest.statusCode ? ` · ${latest.statusCode}` : ""} · ${name.toLowerCase()}`;
  };
  const needed: NeededRow[] = entries.map((e) => {
    const ready = e.state === "MET";
    const slip = delayOf.get(e.document.number) ?? null;
    return {
      id: e.id,
      documentId: e.documentId,
      docNumber: e.document.number,
      title: e.document.title,
      discipline: deptLabel(e.department),
      from: partyLabel(e.document.originator),
      // The requirements list's approver is not kept by the backend.
      approvedBy: "—",
      requiredStatus: e.requiredStatus,
      submitBy: fmtDate(e.neededBy),
      submitBySort: e.neededBy.getTime(),
      submitNote: e.manualDate ? "fixed date" : `${e.leadDays ?? DEFAULT_LEAD_DAYS} days before`,
      has: standing(e),
      ready,
      late: !ready && e.neededBy < new Date(),
      outstanding: !!slip?.outstanding,
      source: slip?.cause?.name ?? null,
      sourceAt: slip?.cause?.at ? fmtDate(slip.cause.at) : null,
      sourceAtSort: slip?.cause?.at ? slip.cause.at.getTime() : null,
      deadline: slip?.cause?.deadline ?? null,
      due: slip?.cause?.due ? fmtDate(slip.cause.due) : null,
      dueSort: slip?.cause?.due ? slip.cause.due.getTime() : null,
      owedBy: slip?.cause?.owedBy ?? slip?.checkpoints.at(-1)?.owedBy ?? null,
      chain: (slip?.checkpoints ?? []).map((point) => ({
        name: point.name,
        deadline: point.deadline,
        at: point.at ? fmtDate(point.at) : null,
        atSort: point.at ? point.at.getTime() : null,
        due: point.due ? fmtDate(point.due) : null,
        late: point.late,
        owedBy: point.owedBy,
      })),
    };
  });

  return (
    <div className="space-y-4">
      {/* The name of the activity, what it is asking of the reader, and the
          narrowing — one sheet, because they are read in that order and then
          answered in the table under them. */}
      <NeededTable
        rows={needed}
        together={together}
        exportHref={`/api/export/baseline?ids=${action.id}`}
        empty={depts.length || !inside ? undefined : "Tag the disciplines first, under Disciplines and documents."}
        chips={depts.length > 1 ? (
          <>
            <Link href={`/actions/${action.code}`} className={`facet ${!dept ? "font-semibold text-brand-ink" : ""}`}>All</Link>
            {depts.map((d) => (
              <Link key={d} href={`/actions/${action.code}?dept=${d}`} className={`facet ${dept === d ? "font-semibold text-brand-ink" : ""}`}>
                <span className="font-medium">{deptLabel(d)}</span>
                <span className="font-mono tabular-nums">{action.needs.filter((e) => e.department === d).length}</span>
              </Link>
            ))}
          </>
        ) : undefined}
        plate={
          <div className="flex flex-col-reverse gap-3 border-b border-line px-5 pt-6 pb-3 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[12.5px] font-semibold tracking-tight text-slate-500">
                {action.code}
                {action.externalId && action.externalId !== action.code ? <span className="ml-2 font-sans text-xs font-normal">planner&rsquo;s ID {action.externalId}</span> : null}
              </p>
              <h1 className="plate-name mt-1 min-w-0">{action.name}</h1>
              <p className="plate-meta mt-2">
                activity {fmtDate(action.start)} &middot; {readyCount} of {action.needs.length} documents ready
                {version ? ` \u00b7 schedule ${version}` : ""}
              </p>
              {moved ? (
                <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-amber-800">
                  <span className="stamp text-amber-700">moved</span> {moved}
                </p>
              ) : null}
              <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
                Check your documents in the table below, and confirm your discipline&rsquo;s documents are available at the bottom of this page.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Link href="/actions" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /> Schedule</Link>
              <ReadinessChip readiness={readiness} />
            </div>
          </div>
        }
      />

      {/* A request checked by Document Control, waiting on this person's confirmation. */}
      {mine.length ? (
        <section id="your-confirmation" className="register register-sheet register-sheet-open scroll-mt-24">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
            <span className="stencil mr-1 text-slate-500">Your confirmation</span>
            <span className="text-[11px] text-slate-500">confirmed, it is applied by itself; refused, nothing changes</span>
          </div>
          <ul className="divide-y divide-line">
            {mine.map((one) => (
              <li key={one.id} className="space-y-3 px-5 py-3.5 sm:px-6">
                <div className="space-y-1 text-xs leading-5">
                  <p className="font-semibold text-slate-800">
                    {one.from} asks for {one.kind === "DISCIPLINE" ? "a missing discipline" : "a document"} to be added
                    <span className="ml-1.5 font-normal text-slate-500">· <Link href={`/transmittals/${one.id}`} className="text-link hover:underline">{one.number}</Link>, {fmtDate(one.at)}</span>
                  </p>
                  <p className="whitespace-pre-line text-slate-600">{one.message ?? one.subject}</p>
                  <p className="text-slate-700">
                    Checked by {one.checkedBy}, {fmtDate(one.checkedAt)}. {proposalText(one.proposal, one.kind, (id) => numberOf.get(id) ?? "a document", deptLabel)}
                  </p>
                </div>
                <div className="flex flex-wrap items-start gap-3">
                  <ActionForm action={confirmActionRequestAction} submitLabel="Confirm" size="sm" hidden={{ transmittalId: one.id, code: action.code }} className="space-y-0" />
                  <details className="min-w-0 flex-1 text-xs">
                    <summary className="cursor-pointer font-semibold text-link">Refuse</summary>
                    <ActionForm action={refuseActionRequestAction} submitLabel="Refuse" variant="secondary" size="sm" hidden={{ transmittalId: one.id, code: action.code }} className="mt-2 space-y-3">
                      <Field label="Why" required hint={`${one.from} and Document Control are told`}>
                        <textarea name="note" required rows={2} className={inputCls} />
                      </Field>
                    </ActionForm>
                  </details>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Who is concerned and what was decided, with the progress beside them. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-4">
        {inside ? (
        <section id="confirm" className="register register-sheet register-sheet-open">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
            <span className="stencil mr-1 text-slate-500">Disciplines concerned</span>
            {depts.length ? (
              <span className="text-[11px] text-slate-500">
                each confirms its documents; released at their status, it is confirmed automatically
              </span>
            ) : null}
          </div>
          {depts.length ? (
            <ul className="divide-y divide-line">
              {depts.map((d) => {
                const of = (e: (typeof action.needs)[number]) => e.department === d || !e.department;
                // Requirements listed before departments existed count against every one.
                const deptEntries = action.needs.filter(of);
                const missing = deptEntries.filter((e) => e.state !== "MET");
                const c = action.confirmations.find((x) => x.department === d && !x.revokedAt) ?? null;
                const taken = c ? null : action.confirmations.find((x) => x.department === d && x.revokedAt) ?? null;
                const opens = action.disciplineRiskFrom[d] ?? null;
                const passed = action.passed;
                // Before the day, every document released at its status: confirmed by the documents themselves.
                const automatic = !c && !passed && deptEntries.length > 0 && missing.length === 0;
                const open = missing.length > 0 && (passed || (!!opens && opens.getTime() <= Date.now()));
                const mine = me?.department === d || control;
                const late = !!c && !c.automatic && !!action.start && c.confirmedAt !== null && c.confirmedAt.getTime() >= action.start.getTime() + 86_400_000;
                const members = people.filter((one) => one.department === d);
                const sent = notices.filter((one) => one.subject.endsWith(`:${d}`));
                const owing = suppliersOf(missing);
                const owingPeople = owing.flatMap((s) => s.people.map((one) => ({ id: one.id, name: one.name, detail: `${s.party.name} · recommended` })));
                const owedDocs = owing.flatMap((s) => s.docs);
                // Where it stands, in one short chip: the line under it says how and by whom.
                const chip = c
                  ? c.available ? { word: c.automatic ? "Confirmed automatically" : "Confirmed", tone: "bg-emerald-50/40 text-emerald-800 ring-emerald-300" }
                    : { word: "Not going ahead", tone: "bg-red-50/40 text-red-800 ring-red-300" }
                  : automatic ? { word: "Confirmed automatically", tone: "bg-emerald-50/40 text-emerald-800 ring-emerald-300" }
                  : missing.length && !open && opens ? { word: `Opens ${fmtDate(opens)}`, tone: "bg-slate-50/40 text-slate-600 ring-slate-300" }
                  : { word: "Not confirmed", tone: "bg-amber-50/40 text-amber-900 ring-amber-300" };
                const them = missing.length === 1 ? "it" : "them";
                return (
                  <li key={d} className="space-y-3 px-5 py-4 sm:px-6">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <p className="text-sm font-semibold text-slate-800">
                        {deptLabel(d)}
                        <span className="ml-1.5 text-xs font-normal text-slate-500">· {deptEntries.length - missing.length} of {deptEntries.length} ready</span>
                      </p>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${chip.tone}`}>{chip.word}</span>
                    </div>

                    {/* How it was confirmed, by whom and why; or a confirmation taken back. */}
                    {c ? (
                      <p className="whitespace-pre-line text-xs leading-5 text-slate-600">
                        {c.automatic ? "On the day, every document was released at its status." : <>{c.available ? (missing.length ? "Going ahead without them" : "Available") : "Not going ahead without them"} — {c.confirmedByName}, {fmtDate(c.confirmedAt)}</>}
                        {late ? <span className="ml-1.5 rounded-sm bg-amber-50 px-1 font-semibold text-amber-800 ring-1 ring-amber-200">after the day</span> : null}
                        {c.note ? <span className="block">{c.note}</span> : null}
                      </p>
                    ) : automatic ? (
                      <p className="text-xs text-slate-600">All {deptEntries.length} released at their status.</p>
                    ) : null}
                    {taken ? (
                      <p className="whitespace-pre-line text-[11px] text-slate-500">
                        {taken.confirmedByName}&rsquo;s confirmation was taken back by {taken.revokedByName}, {fmtDate(taken.revokedAt)}: {taken.revokedReason}
                      </p>
                    ) : null}

                    {/* What is not ready, and the question the discipline answers about it. */}
                    {missing.length && !c ? (
                      <div className="rounded-md bg-tint-soft px-3 py-2.5 text-xs leading-5 ring-1 ring-line">
                        <p className="font-semibold text-slate-800">{missing.length === 1 ? "1 document is not ready" : `${missing.length} documents are not ready`}</p>
                        <ul className="mt-1 space-y-0.5">
                          {missing.map((e) => (
                            <li key={e.id} className="flex flex-wrap gap-x-2">
                              <Link href={`/documents/${e.documentId}`} className="font-mono font-semibold text-brand-ink hover:underline">{e.document.number}</Link>
                              <span className="text-slate-600">{e.document.title}</span>
                              <span className="text-slate-500">· {standing(e)}{e.requiredStatus ? `, needed at ${e.requiredStatus}` : ""}</span>
                            </li>
                          ))}
                        </ul>
                        <p className="mt-2 text-slate-700">
                          {open
                            ? passed
                              ? `The day has passed. Did ${deptLabel(d)} go ahead with the action without ${them}? Confirm, and say why.`
                              : `Does ${deptLabel(d)} confirm going ahead with the action without ${them}? Confirm, and say why.`
                            : opens ? `If ${them === "it" ? "it is" : "they are"} still not ready, ${deptLabel(d)} confirms from ${fmtDate(opens)} whether it goes ahead without ${them}.` : null}
                        </p>
                      </div>
                    ) : null}

                    {/* What can be done, on one row: an opened form takes the whole width under it. */}
                    <div className="flex flex-wrap items-start gap-2">
                      {mine && open && !c ? (
                        <details className="group text-xs open:basis-full">
                          <summary className="ask cursor-pointer list-none [&::-webkit-details-marker]:hidden">Confirm</summary>
                          <ActionForm action={confirmReadinessAction} submitLabel="Record" hidden={{ actionId: action.id, department: d }} className="mt-3 space-y-3">
                            <fieldset className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-medium text-slate-700">
                              <legend className="sr-only">Does {deptLabel(d)} go ahead?</legend>
                              <label className="flex items-center gap-1.5"><input type="radio" name="available" value="yes" required /> Going ahead without {them}</label>
                              <label className="flex items-center gap-1.5"><input type="radio" name="available" value="no" required /> Not without {them}</label>
                            </fieldset>
                            <Field label={passed ? `Why it went ahead without ${them}, and whether ${them === "it" ? "it" : "they"} came after the day` : `Why it can go ahead without ${them}, or why not`} required>
                              <textarea name="note" required rows={3} className={inputCls} />
                            </Field>
                          </ActionForm>
                        </details>
                      ) : null}
                      {mayNotify && missing.length ? (
                        <div className="has-[details[open]]:basis-full">
                          <NotifyPanel
                            subject={`activity:${action.id}:manual:${d}`}
                            title={`${action.code} on ${fmtDate(action.start)}: ${deptLabel(d)} has ${missing.length} of ${deptEntries.length} documents missing`}
                            body={[
                              `${action.name} is planned for ${fmtDate(action.start)}.`,
                              `Still missing: ${missing.map((e) => e.document.number).join(", ")}.`,
                              passed ? "Confirm on the action's page and say why it went ahead without them." : "Send the documents, or confirm on the action's page and say why it can go ahead without them.",
                              ...owing.map((s) => `${s.party.name}: please send ${s.docs.map((e) => e.document.number).join(", ")} on a transmittal${s.docs.some((e) => e.neededBy) ? `, by ${fmtDate(s.docs.map((e) => e.neededBy).sort((a, b) => a.getTime() - b.getTime())[0])}` : ""}.`),
                            ].join("\n\n")}
                            link={`/actions/${action.code}`}
                            outsideLink={owedDocs.length === 1 ? `/documents/${owedDocs[0].documentId}` : owedDocs.length ? "/documents" : undefined}
                            people={[...owingPeople, ...pickPeople.filter((one) => !owingPeople.some((o) => o.id === one.id))]}
                            chosen={[...members.map((one) => one.id), ...owingPeople.map((one) => one.id)]}
                            history={noticeHistory(sent)}
                          />
                        </div>
                      ) : null}
                      {/* Without Document Control, the discipline chooses its own documents; otherwise it asks. */}
                      {selfLinks && me.department === d ? (
                        <Link href={`/documents?pick=${encodeURIComponent(action.code)}`} className="ask">Add or take off documents</Link>
                      ) : !selfLinks && mine ? (
                        <Link href={requestHref(d)} className="ask">Request a document</Link>
                      ) : null}
                      {c && !c.automatic && control ? (
                        <details className="text-xs open:basis-full">
                          <summary className="ask cursor-pointer list-none [&::-webkit-details-marker]:hidden">Take this confirmation back</summary>
                          <ActionForm action={revokeReadinessAction} submitLabel="Take it back" hidden={{ actionId: action.id, department: d }} className="mt-3 space-y-3">
                            <Field label="Why" required hint="kept with it; the discipline confirms again">
                              <textarea name="reason" required rows={2} className={inputCls} />
                            </Field>
                          </ActionForm>
                        </details>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-5 py-3.5 sm:px-6">
              <Banner tone="warn" title="Needs disciplines">No discipline is tagged on this action yet, so its documents cannot be asked for. Document Control tags them, by hand or with the disciplines-per-action list.</Banner>
            </div>
          )}
          {/* A discipline the action should concern: asked of Document Control, or, without it, added by its own people. */}
          {selfLinks && me.department && !depts.includes(me.department) ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-5 py-2.5 text-xs text-slate-500 sm:px-6">
              Is your discipline, {deptLabel(me.department)}, missing from this action?
              <ActionForm action={addOwnDisciplineAction} submitLabel="Add it" size="sm" variant="secondary" hidden={{ actionId: action.id, code: action.code }} className="space-y-0" />
            </div>
          ) : !selfLinks && ctx.user.isInternal ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line px-5 py-2.5 text-xs text-slate-500 sm:px-6">
              Is a discipline missing from this action?
              <Link href={disciplineRequestHref} className="font-semibold text-link hover:underline">Request it</Link>
            </p>
          ) : null}
        </section>
        ) : null}

          {control ? (
            <LinksCard
              actionId={action.id}
              code={action.code}
              departments={depts}
              disciplines={disciplines.map((d) => ({ code: d.code, label: d.label }))}
              documents={pickDocuments}
              asks={asks}
              count={action.needs.length}
              confirmers={confirmers}
            />
          ) : null}

          {/* Went ahead, and the notes about it, are ours; Progress says whether the work happened or was postponed. */}
          {inside ? (
          <ActionNotes
            notes={action.decisions}
            actionId={action.id}
            mayNote={mayNote}
            mayPlan={(ctx.user.verbs ?? []).includes("PLAN")}
            mayControl={control}
            answer={wentAhead}
            missing={missingCount}
            total={action.needs.length}
            day={action.start ? fmtDate(action.start) : null}
            postponeCodes={postponeCodes}
            people={(await addressees(ctx)).people.map((one) => ({ id: one.id, name: one.name, detail: [one.organization, one.function].filter(Boolean).join(" · ") }))}
          />
          ) : null}
        </div>

        <aside>
        <Card title="Progress">
          <Timeline
            points={[
              ...(inside ? [{ label: "Disciplines tagged", done: depts.length > 0, at: null, holder: depts.length ? depts.map(deptLabel).join(", ") : "nobody yet" }] : []),
              { label: "Documents listed", done: action.needs.length > 0, at: null, holder: action.needs.length ? `${action.needs.length} document${action.needs.length === 1 ? "" : "s"}` : "none listed" },
              // Ready, or when the first one is due: the due date is not a step of its own,
              // so a point never shows open between two that are done.
              everything
                ? { label: "Every document ready", at: action.lastMetAt ?? null, done: true, holder: `${readyCount} of ${action.needs.length} ready` }
                : { label: "Every document ready", at: firstDue, planned: !!firstDue && firstDue > new Date(),
                    holder: `${readyCount} of ${action.needs.length} ready${firstDue && firstDue < new Date() ? ` · the first was due ${fmtDate(firstDue)}` : ""}` },
              // Confirmed as the card says: by hand, or automatically when every document is released at its status.
              ...(inside ? [{ label: "Disciplines confirmed", done: depts.length > 0 && confirmedDepts.length === depts.length,
                at: depts.length > 0 && confirmedDepts.length === depts.length ? confirmedAt : null,
                holder: `${confirmedDepts.length} of ${depts.length}` }] : []),
              // A schedule's date passing is the work happening. Only Document
              // Control saying otherwise — a note that the work was postponed —
              // takes that back.
              {
                label: postponed ? "The work was postponed" : happened ? "The work happened" : "The work happens",
                at: action.start,
                planned: !happened && !postponed,
                holder: postponed && inside ? `${postponed.responsibleName}: ${postponed.reason}` : null,
              },
            ]}
          />
        </Card>
        </aside>
      </div>
    </div>
  );
}

/** The schedule's own chip colours, so a state reads the same on both pages. */
const TONE: Record<ActionState, string> = {
  DONE: "bg-emerald-600/10 text-emerald-900 ring-emerald-300",
  LATE_RECEIPT: "bg-violet-100 text-violet-800 ring-violet-300",
  READY: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  UPCOMING: "bg-sky-100 text-sky-800 ring-sky-200",
  AT_RISK: "bg-amber-100 text-amber-800 ring-amber-200",
  NOT_READY: "bg-red-100 text-red-800 ring-red-200",
  UNKNOWN: "bg-slate-50/40 text-slate-600 ring-slate-300",
};

function ReadinessChip({ readiness }: { readiness: ActionState }) {
  return <Chip className={TONE[readiness]}>{stateLabel(readiness)}</Chip>;
}
