import Link from "next/link";
import { controlledSets } from "@/lib/api/admin";
import { requireScope } from "@/lib/scope";
import { Chip, Field, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { issueCallsAction, remindCallAction, closeCallAction, issueToSendersAction } from "@/lib/actions/requirements";
import { departmentRows, senderRows, clearance, isDepartmentSender, type CallState } from "@/lib/requirements-process";
import { businessDaysAfter, departmentsOf } from "@/lib/schedule";
import { fmtDate } from "@/lib/utils";
import { ArrowLeft, Download } from "lucide-react";
import { getSet } from "@/lib/config";
import { api } from "@/lib/api/client";
import { legacyActions } from "@/lib/api/schedule";

export const dynamic = "force-dynamic";
export const metadata = { title: "Document requirements" };

const ASKED: Record<CallState, [string, string]> = {
  NOT_ISSUED: ["Not asked yet", "bg-slate-100 text-slate-700 ring-slate-200"],
  OPEN: ["Waiting", "bg-amber-100 text-amber-800 ring-amber-200"],
  OVERDUE: ["Late", "bg-red-100 text-red-800 ring-red-200"],
  ANSWERED: ["Answered", "bg-emerald-100 text-emerald-800 ring-emerald-200"],
};

/**
 * From the schedule to work that is ready, on one sheet and in order: tag each
 * action with its disciplines, ask them what they need, tell whoever sends it,
 * and each discipline confirms before the day.
 */
export default async function RequirementsPage() {
  const ctx = await requireScope();
  const control = ctx.can("CONTROL");
  const plan = ctx.can("PLAN") || control;

  const [actions, depts, senders, disciplines, parties, pendingSets] = await Promise.all([
    legacyActions(ctx),
    departmentRows(ctx),
    senderRows(ctx),
    getSet("DISCIPLINES"),
    api<{ code: string; name: string }[]>("/api/parties").catch(() => [] as { code: string; name: string }[]),
    controlledSets(ctx),
  ]);
  const deptName = (c: string) => disciplines.find((d) => d.code === c)?.label ?? c;
  const senderName = (s: string) => (isDepartmentSender(s) ? `${deptName(s.slice(5))} (us)` : parties.find((p) => p.code === s)?.name ?? s);
  const setState = (kind: string) => {
    const versions = pendingSets.find((s) => s.kind === kind)?.versions ?? [];
    return { pending: versions.find((v) => v.state !== "APPROVED") ?? null, inForce: versions.find((v) => v.state === "APPROVED") ?? null };
  };
  const tagging = setState("ACTION_DEPARTMENTS");
  const list = setState("DOCUMENT_REQUIREMENTS");
  const myDept = ctx.user.department ?? null;

  const tagged = actions.filter((a) => departmentsOf(a).length).length;
  const untagged = actions.length - tagged;
  const toAsk = depts.filter((d) => d.notIssued.length);
  const answered = depts.filter((d) => d.state === "ANSWERED").length;
  const toTell = senders.filter((s) => !s.lastIssue || s.changedSinceIssue);
  const due = businessDaysAfter(new Date(), 5).toISOString().slice(0, 10);
  const horizon = businessDaysAfter(new Date(), 10).getTime();
  const upcoming = actions.filter((a) => a.scheduledDate && a.scheduledDate.getTime() <= horizon && departmentsOf(a).length && !clearance(a).cleared);

  const th = "stencil px-3 py-2 text-left font-normal text-slate-500 first:pl-5 sm:first:pl-6";
  const td = "px-3 py-2.5 align-top first:pl-5 sm:first:pl-6";
  /** A step's bar: its number and name, then where it stands, then what can be done. */
  const bar = (n: number, name: string, standing: React.ReactNode, tools?: React.ReactNode) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-y border-line bg-tint-soft px-5 py-2 sm:px-6">
      <span className="stencil text-slate-600"><span className="mr-1.5 font-mono text-slate-500">{n}</span>{name}</span>
      <span className="text-[11.5px] text-slate-600">{standing}</span>
      {tools ? <span className="ml-auto flex flex-wrap items-center gap-2">{tools}</span> : null}
    </div>
  );
  const waiting = (one: { state: string; versionLabel: string }) => `${one.versionLabel} is ${one.state === "DRAFT" ? "uploaded, not yet sent for approval" : "waiting for approval"}.`;

  return (
    <section className="register register-sheet register-sheet-open">
      <div className="border-b border-line px-5 pt-6 pb-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h1 className="plate-title min-w-0 text-slate-950">Document requirements</h1>
          <Link href="/actions" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /> Schedule</Link>
        </div>
        <p className="plate-meta mt-2">
          {tagged} of {actions.length} actions tagged &middot; {answered} of {depts.length} disciplines answered &middot; {senders.length - toTell.length} of {senders.length} senders told &middot; {upcoming.length} to confirm in the next two weeks
        </p>
        <p className="mt-1 max-w-2xl text-[11.5px] leading-4 text-slate-500">
          Four steps, in order: tag each action with its disciplines, ask them what they need, tell whoever sends it, and each discipline confirms before the day.
        </p>
      </div>

      {/* 1 — which disciplines each action concerns */}
      {bar(1, "Tag the disciplines",
        tagging.pending
          ? <span className="font-semibold text-amber-800">{waiting(tagging.pending)}</span>
          : untagged
            ? <span className="font-semibold text-amber-800">{untagged} action{untagged === 1 ? " has" : "s have"} no discipline, so nobody can be asked about {untagged === 1 ? "it" : "them"}.</span>
            : <>Every action is tagged{tagging.inForce ? ` (${tagging.inForce.versionLabel}, ${fmtDate(tagging.inForce.decidedAt)})` : ""}.</>,
        <>
          <a href="/api/controlled/current/ACTION_DEPARTMENTS" className="ask"><Download className="h-3.5 w-3.5" /> List</a>
          {plan ? <Link href="/settings/controlled/ACTION_DEPARTMENTS" className="ask" data-on={untagged ? "true" : "false"}>Upload</Link> : null}
        </>,
      )}
      <p className="px-5 py-3 text-[11.5px] text-slate-500 sm:px-6">Tag them all in the list and upload it back, or one at a time on the action&rsquo;s own page.</p>

      {/* 2 — ask each discipline what it needs, chase, collect */}
      {bar(2, "Ask the disciplines",
        list.pending
          ? <span className="font-semibold text-amber-800">Requirements {waiting(list.pending)}</span>
          : <>Each answers on its own sheet: the documents it needs, from whom, by when.</>,
        control ? <Link href="/settings/controlled/DOCUMENT_REQUIREMENTS" className="ask">Upload an answer by hand</Link> : undefined,
      )}
      {control && toAsk.length ? (
        <div className="border-b border-line px-5 py-3 sm:px-6">
          <ActionForm action={issueCallsAction} hideSubmit>
            <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
              <fieldset className="min-w-0">
                <legend className="stencil mb-1.5 text-slate-500">To ask</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {toAsk.map((d) => (
                    <label key={d.department} className="flex items-center gap-1.5 text-xs text-slate-700">
                      <input type="checkbox" name="department" value={d.department} defaultChecked /> {deptName(d.department)} <span className="text-slate-500">· {d.notIssued.length} new</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <Field label="Answer by" required><input type="date" name="dueAt" defaultValue={due} required className={inputCls} /></Field>
              <button className="ask" data-on="true">Ask</button>
            </div>
          </ActionForm>
        </div>
      ) : null}
      {depts.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b border-line"><tr><th className={th}>Discipline</th><th className={th}>Actions</th><th className={th}>Documents listed</th><th className={th}>Asked</th><th className={th}><span className="sr-only">Tools</span></th></tr></thead>
            <tbody className="divide-y divide-line">
              {depts.map((d) => (
                <tr key={d.department} className={myDept === d.department ? "bg-tint-soft" : "hover:bg-tint-soft"}>
                  <td className={td}>
                    <span className="font-semibold text-slate-800">{deptName(d.department)}</span>
                    {myDept === d.department ? <span className="ml-1.5 text-[11px] font-semibold text-link">yours</span> : null}
                    <span className={`block text-[11px] ${d.members ? "text-slate-500" : "font-semibold text-red-700"}`}>{d.members ? `${d.members} ${d.members === 1 ? "person" : "people"}` : "nobody in it"}</span>
                  </td>
                  <td className={`${td} text-xs`}>
                    <span className="font-mono">{d.actions.map((a) => a.code).join(", ")}</span>
                    {d.notIssued.length && d.call ? <span className="block text-[11px] text-amber-800">{d.notIssued.length} not asked yet</span> : null}
                  </td>
                  <td className={`${td} text-xs tabular-nums`}>{d.requirements}</td>
                  <td className={`${td} text-xs`}>
                    <Chip className={ASKED[d.state][1]}>{ASKED[d.state][0]}</Chip>
                    {d.call ? (
                      <span className="mt-1 block text-[11px] text-slate-500">
                        {d.call.answeredAt ? `${fmtDate(d.call.answeredAt)} · ${d.call.answerNote}` : `by ${fmtDate(d.call.dueAt)}`}
                        {!d.call.answeredAt && d.call.reminders ? ` · reminded ${d.call.reminders}×` : ""}
                      </span>
                    ) : null}
                  </td>
                  <td className={td}>
                    <div className="flex flex-wrap items-start justify-end gap-2">
                      <a href={`/api/requirements/sheet?dept=${d.department}`} className="ask"><Download className="h-3.5 w-3.5" /> Sheet</a>
                      {control && d.call && !d.call.answeredAt ? (
                        <>
                          <ActionForm action={remindCallAction} hideSubmit hidden={{ callId: d.call.id }} className="space-y-0">
                            <button className="ask" data-on={d.state === "OVERDUE" ? "true" : "false"}>{d.state === "OVERDUE" ? "Chase" : "Remind"}</button>
                          </ActionForm>
                          <details className="text-xs">
                            <summary className="ask cursor-pointer list-none [&::-webkit-details-marker]:hidden">Nothing needed</summary>
                            <div className="mt-2 w-64">
                              <ActionForm action={closeCallAction} hideSubmit hidden={{ callId: d.call.id }}>
                                <label className="block">
                                  <span className="sr-only">What the discipline answered</span>
                                  <input name="note" required className={inputCls} defaultValue="Nothing needed for these actions" />
                                </label>
                                <button className="ask" data-on="true">Record the answer</button>
                              </ActionForm>
                            </div>
                          </details>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-5 py-6 text-center text-sm text-slate-500 sm:px-6">No action is tagged yet, so there is nobody to ask. Tag the disciplines first.</p>
      )}

      {/* 3 — tell whoever sends the documents what to deliver, and by when */}
      {bar(3, "Tell the senders",
        senders.length
          ? toTell.length
            ? <span className="font-semibold text-amber-800">{toTell.length} sender{toTell.length === 1 ? " has" : "s have"} not been told the latest list.</span>
            : <>Every sender has the latest list.</>
          : <>A sender is whoever submits the document: a supplier, a contractor, or one of our disciplines.</>,
      )}
      {senders.length ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="border-b border-line"><tr><th className={th}>Sender</th><th className={th}>Documents</th><th className={th}>First due</th><th className={th}>Told</th><th className={th}><span className="sr-only">List</span></th></tr></thead>
              <tbody className="divide-y divide-line">
                {senders.map((s) => (
                  <tr key={s.sender} className="hover:bg-tint-soft">
                    <td className={td}><span className="font-semibold text-slate-800">{senderName(s.sender)}</span>{!s.recipients ? <span className="block text-[11px] font-semibold text-red-700">nobody to tell</span> : null}</td>
                    <td className={`${td} text-xs tabular-nums`}>{s.documents}</td>
                    <td className={`${td} whitespace-nowrap text-xs`}>{fmtDate(s.firstNeeded)}</td>
                    <td className={`${td} text-xs`}>
                      {s.lastIssue ? <>{fmtDate(s.lastIssue.issuedAt)} · {s.lastIssue.issuedByName}</> : <span className="font-semibold text-amber-800">not yet</span>}
                      {s.lastIssue && s.changedSinceIssue ? <span className="block text-[11px] font-semibold text-amber-800">{s.changedSinceIssue} changed since</span> : null}
                    </td>
                    <td className={`${td} text-right`}><a href={`/api/requirements/sheet?sender=${encodeURIComponent(s.sender)}`} className="ask"><Download className="h-3.5 w-3.5" /> List</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {control && toTell.length ? (
            <div className="border-t border-line px-5 py-3 sm:px-6">
              <ActionForm action={issueToSendersAction} hideSubmit>
                <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
                  <fieldset className="min-w-0">
                    <legend className="stencil mb-1.5 text-slate-500">To tell</legend>
                    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                      {toTell.map((s) => (
                        <label key={s.sender} className="flex items-center gap-1.5 text-xs text-slate-700">
                          <input type="checkbox" name="sender" value={s.sender} defaultChecked /> {senderName(s.sender)}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <button className="ask" data-on="true">Send the lists</button>
                </div>
              </ActionForm>
              <p className="mt-2 text-[11px] text-slate-500">Or download a sender&rsquo;s list and send it yourself on a transmittal.</p>
            </div>
          ) : null}
        </>
      ) : (
        <p className="px-5 py-6 text-center text-sm text-slate-500 sm:px-6">Nothing to send until the disciplines have answered.</p>
      )}

      {/* 4 — before the day */}
      {bar(4, "Confirm before the day",
        <>Each discipline confirms its own documents on the action. Nobody confirms for another.</>,
      )}
      {upcoming.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b border-line"><tr><th className={th}>Action</th><th className={th}>Day</th><th className={th}>Disciplines</th></tr></thead>
            <tbody className="divide-y divide-line">
              {upcoming.map((a) => {
                const c = clearance(a);
                const late = !!a.scheduledDate && a.scheduledDate.getTime() < Date.now();
                return (
                  <tr key={a.id} className="hover:bg-tint-soft">
                    <td className={td}><Link href={`/actions/${a.code}#confirm`} className="font-mono font-semibold text-brand-ink hover:underline">{a.code}</Link><span className="block max-w-80 truncate text-slate-800" title={a.name}>{a.name}</span></td>
                    <td className={`${td} whitespace-nowrap text-xs ${late ? "font-semibold text-red-700" : ""}`}>{fmtDate(a.scheduledDate)}</td>
                    <td className={td}>
                      <div className="flex flex-wrap gap-1">
                        {c.depts.map((d) => {
                          const yes = c.confirmed.includes(d);
                          const no = c.short.includes(d);
                          return (
                            <Chip key={d} className={yes ? "bg-emerald-100 text-emerald-800 ring-emerald-200" : no ? "bg-red-100 text-red-800 ring-red-200" : "bg-slate-100 text-slate-700 ring-slate-200"}>
                              {deptName(d)} · {yes ? "available" : no ? "not available" : "waiting"}
                            </Chip>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-5 py-6 text-center text-sm text-slate-500 sm:px-6">Nothing waiting to be confirmed in the next two weeks.</p>
      )}
    </section>
  );
}
