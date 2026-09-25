import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { notFound } from "next/navigation";
import { isController, isAdmin } from "@/lib/auth";
import { PageHeader, Card, Chip, Banner, Field, inputCls, DataTable, Th, Td } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { ACCEPTANCE_CONDITIONS, REASON_LABEL, type ReasonForIssue } from "@/lib/standard";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { issueTransmittalAction, acceptanceCheckAction } from "@/lib/actions/transmittals";
import { preflight } from "@/lib/rules/preflight";
import { PreflightPanel, Guarded } from "@/components/preflight";
import { ReceiptTracker } from "./receipt-tracker";
import { Timeline } from "@/components/timeline";
import { Action } from "../../documents/[id]/workflow-panel";
import { SendForReview } from "@/components/send-for-review-panel";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function TransmittalDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ issueError?: string }> }) {
  const { user, db } = await requireScope();
  const { id } = await params;
  const sp = await searchParams;
  const t = await db.transmittal.findUnique({
    where: { id },
    include: {
      items: { include: { revision: { include: { document: true } } } },
      recipients: { orderBy: { name: "asc" } },
      cycles: { include: { revision: { include: { document: true } } } },
    },
  });
  if (!t) notFound();

  const controller = isController(user) || isAdmin(user);
  const currentRecipient = t.recipients.find((recipient) => recipient.userId === user.id);
  const conditions: { key: string; pass: boolean }[] = t.conditionsResult ? JSON.parse(t.conditionsResult) : [];
  const readyToRoute = t.items.filter((i) => i.revision.state === "IN_PREPARATION").map((i) => i.revisionId);
  const statusColors: Record<string, string> = {
    DRAFT: "bg-slate-100 text-slate-600 ring-slate-300",
    ISSUED: "bg-amber-100 text-amber-800 ring-amber-300",
    ACCEPTED: "bg-emerald-100 text-emerald-800 ring-emerald-300",
    REJECTED: "bg-red-100 text-red-800 ring-red-300",
    CLOSED: "bg-slate-200 text-slate-700 ring-slate-300",
  };

  return (
    <div className="space-y-5">
      {currentRecipient && t.status !== "DRAFT" ? <ReceiptTracker transmittalId={t.id} /> : null}
      <PageHeader
        title={t.subject ? `${t.number} — ${t.subject}` : t.number}
        subtitle={[
          t.direction === "OUTGOING"
            ? `${t.createdByName} sent it to ${t.recipients.map((r) => r.name).join(", ") || "nobody yet"} at ${t.recipients.map((r) => r.organization ?? "—").filter((v, i, all) => all.indexOf(v) === i).join(", ")} on ${fmtDate(t.dateOfIssue)}`
            : `${t.issuingParty} sent it on ${fmtDate(t.dateOfIssue)}${t.receivedDate ? `, and it arrived ${fmtDate(t.receivedDate)}` : ""}`,
          `${t.direction === "OUTGOING" ? "They" : "We"} received it ${(REASON_LABEL[t.reasonForIssue as ReasonForIssue] ?? t.reasonForIssue).toLowerCase() === "information" ? "for information only" : `for ${(REASON_LABEL[t.reasonForIssue as ReasonForIssue] ?? t.reasonForIssue).toLowerCase()}`}`,
          t.responseRequired ? `An answer is due by ${fmtDate(t.responseDueDate)}` : "No answer is needed",
        ].filter(Boolean).join(". ") + "."}
        actions={<>
          <Link href="/transmittals" className="inline-flex min-h-9 items-center gap-1 rounded-xl px-3 text-xs font-semibold text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4"/> Transmittals</Link>
          <Chip className={statusColors[t.status] ?? ""}>{t.status.toLowerCase()}</Chip>
          {t.status === "DRAFT" && controller ? (
            <Guarded result={await preflight("ISSUE", { transmittalId: t.id })}>
              <ActionForm action={issueTransmittalAction} submitLabel="Issue" size="sm" hidden={{ transmittalId: t.id }} />
            </Guarded>
          ) : null}
        </>}
      />

      {t.status === "DRAFT" ? (
        <Banner tone="warn" title="Nothing has been sent yet">
          This is a draft. The recipients below have not been told, and it carries no date of issue until it is issued.
          {controller ? " Issue it with the button above." : " Document Control issues it."}
        </Banner>
      ) : null}
      {sp.issueError ? <Banner tone="warn" title="Created, but not sent">{sp.issueError} Issue it above once that is settled.</Banner> : null}

      {t.message ? (
        <Card title="Message">
          <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{t.message}</p>
        </Card>
      ) : null}

      {t.direction === "INCOMING" && t.status === "ISSUED" && t.receivedDate ? (
        (() => {
          const daysLeft = 5 - Math.floor((Date.now() - new Date(t.receivedDate).getTime()) / 86400000);
          return daysLeft <= 2 ? (
            <Banner tone="warn" title="Acceptance period closing">
              The acceptance period closes {daysLeft <= 0 ? "today" : `in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`}. Complete the acceptance check before the response window expires.
            </Banner>
          ) : null;
        })()
      ) : null}

      {t.status === "REJECTED" ? (
        <Banner tone="danger" title="Transmittal rejected">
          {t.rejectionReason} — the carried items have not been accepted and no review period has started.
        </Banner>
      ) : null}


      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <Card title={`Documents · ${t.items.length}`}>
            <DataTable
              head={<tr><Th>Document</Th><Th>Rev</Th><Th>Status</Th>{t.cycles.length ? <Th>Review</Th> : null}</tr>}
            >
              {t.items.map((item) => (
                <tr key={item.id}>
                  <Td>
                    <Link href={`/documents/${item.revision.documentId}`} className="font-mono text-[13px] font-semibold text-brand-ink hover:underline">
                      {item.revision.document.docNumber}
                    </Link>
                    <span className="block max-w-64 truncate text-xs text-slate-400">{item.revision.document.title}</span>
                  </Td>
                  <Td className="font-mono text-xs">{item.revision.value}{item.markedSuperseded ? <span className="ml-2 font-sans text-violet-700">since replaced</span> : null}</Td>
                  <Td className="text-xs">{item.revision.statusCode ?? item.revision.state.replaceAll("_", " ").toLowerCase()}</Td>
                  {t.cycles.length ? (
                  <Td className="text-xs">
                    {(() => {
                      const cycle = t.cycles.find((c) => c.revisionId === item.revisionId);
                      return cycle ? <Link href={`/reviews/${cycle.id}`} className="font-semibold text-brand-ink hover:underline">{cycle.status === "OPEN" ? "in review" : "reviewed"} →</Link> : <span className="text-slate-300">—</span>;
                    })()}
                  </Td>
                  ) : null}
                </tr>
              ))}
            </DataTable>
          </Card>

          {t.direction === "INCOMING" && t.status === "ISSUED" ? (
            <Card title="Check what arrived" description="Right documents, complete, readable, correctly numbered. Accept to send it on to review; reject to return it to the sender.">
              {controller ? (
                <div className="flex flex-wrap items-start gap-2">
                  <PreflightPanel result={await preflight("ACCEPT_TRANSMITTAL", { transmittalId: t.id })} className="mb-1 w-full" />
                  <Action label="Accept">
                    <ActionForm action={acceptanceCheckAction} submitLabel="Accept" size="sm" hidden={{ transmittalId: t.id }}>
                      <ul className="space-y-2">
                        {ACCEPTANCE_CONDITIONS.map((c) => (
                          <li key={c.key} className="flex items-start gap-2 text-sm text-slate-700">
                            <input type="checkbox" name={`cond_${c.key}`} required className="mt-1" id={`cond-${c.key}`} />
                            <label htmlFor={`cond-${c.key}`}>{c.label}</label>
                          </li>
                        ))}
                      </ul>
                      <Field label="Note"><input name="notes" className={inputCls} placeholder="optional" /></Field>
                    </ActionForm>
                  </Action>
                  <Action label="Reject" secondary>
                    <ActionForm action={acceptanceCheckAction} submitLabel="Reject and return" size="sm" variant="danger" hidden={{ transmittalId: t.id }}>
                      <Field label="Reason" required hint="the sender sees this and resubmits">
                        <textarea name="notes" required rows={3} className={inputCls} placeholder="e.g. Wrong revision on the title block; native file missing" />
                      </Field>
                    </ActionForm>
                  </Action>
                </div>
              ) : (
                <p className="text-xs leading-5 text-slate-500">Document Control checks what arrives.</p>
              )}
            </Card>
          ) : null}

          {t.direction === "INCOMING" && ["ACCEPTED", "CLOSED"].includes(t.status) && controller && readyToRoute.length ? (
            <Card title="Send for review" description={`${readyToRoute.length} accepted document${readyToRoute.length === 1 ? "" : "s"} waiting to be routed.`}>
              <Action label="Send for review / approval">
                <SendForReview revisionIds={readyToRoute} />
              </Action>
            </Card>
          ) : null}

          {t.direction === "OUTGOING" ? (
            <details className="rounded-2xl border border-slate-200 bg-surface px-5 py-3 shadow-sm">
              <summary className="cursor-pointer list-none text-sm font-semibold text-slate-800">What the receiver will check when it arrives</summary>
              <ul className="mt-2 space-y-1 text-xs text-slate-600">
                {ACCEPTANCE_CONDITIONS.map((c) => <li key={c.key} className="flex gap-2"><span className="text-slate-300">·</span>{c.label}</li>)}
              </ul>
              <p className="mt-2 text-[11px] text-slate-500">Their document control runs the same check we run on what arrives here. Anything failing comes back with a reason.</p>
            </details>
          ) : null}

          {conditions.length ? (
            <details className="rounded-2xl border border-slate-200 bg-surface px-5 py-3 shadow-sm">
              <summary className="cursor-pointer list-none text-sm text-slate-700">
                Checked by <strong>{t.checkedByName}</strong>, {fmtDate(t.acceptanceCheckedAt)} — {conditions.filter((c) => c.pass).length} of {conditions.length} checks passed
              </summary>
              <ul className="mt-2 space-y-1 text-xs">
                {ACCEPTANCE_CONDITIONS.map((c) => {
                  const r = conditions.find((x) => x.key === c.key);
                  return <li key={c.key} className="flex gap-2"><span className={r?.pass ? "text-emerald-600" : "text-red-600"}>{r?.pass ? "✓" : "✗"}</span><span className="text-slate-600">{c.label}</span></li>;
                })}
              </ul>
            </details>
          ) : null}
        </div>

        <div className="space-y-4">

          <Card title="Progress">
            <Timeline
              points={t.direction === "OUTGOING" ? [
                { label: "Raised", at: t.createdAt, holder: t.createdByName },
                { label: "Issued — the recipients were told", at: t.status === "DRAFT" ? null : t.dateOfIssue, holder: t.status === "DRAFT" ? "nothing has been sent yet" : t.createdByName },
                {
                  label: "Seen", at: t.recipients.map((r) => r.openedAt).filter(Boolean).sort((x, y) => x!.getTime() - y!.getTime())[0] ?? null,
                  holder: `${t.recipients.filter((r) => r.openedAt).length} of ${t.recipients.length}`,
                },
                ...(t.responseRequired ? [{ label: "A reply is due", at: null, holder: t.responseDueDate ? fmtDate(t.responseDueDate) : "no date" }] : []),
              ] : [
                { label: "They sent it", at: t.dateOfIssue, holder: t.issuingParty },
                { label: "It arrived", at: t.receivedDate, holder: t.receivedByParty ?? null },
                { label: "Checked on arrival", at: t.acceptanceCheckedAt, holder: t.checkedByName ?? null, detail: t.status === "REJECTED" ? t.rejectionReason : null },
                { label: "Sent for review", at: t.cycles[0]?.submittedAt ?? null, holder: t.cycles.length ? `${t.cycles.length} review${t.cycles.length === 1 ? "" : "s"}` : null, skipped: ["CLOSED"].includes(t.status) && !t.cycles.length },
                { label: "Closed", at: t.status === "CLOSED" ? t.acceptanceCheckedAt : null },
              ]}
            />
          </Card>

          <Card title={`Recipients · ${t.recipients.length}`} description="Everyone named here can open this transmittal and the documents it carries. Opening it while signed in is recorded as receipt — there is nothing for them to confirm.">
            <ul className="divide-y divide-slate-100">
              {t.recipients.map((r) => (
                <li key={r.id} className="py-2.5 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-slate-700">{r.name}{r.organization ? <span className="font-normal text-slate-400"> · {r.organization}</span> : null}</span>
                    {r.openedAt ? (
                      <Chip className="bg-emerald-100 text-emerald-800 ring-emerald-300">seen</Chip>
                    ) : r.notifiedAt ? (
                      <Chip className="bg-amber-100 text-amber-800 ring-amber-300">told</Chip>
                    ) : (
                      <Chip className="bg-slate-100 text-slate-500 ring-slate-200">not sent yet</Chip>
                    )}
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-slate-400">
                    <span>
                      {r.openedAt
                        ? `Opened it ${fmtDateTime(r.openedAt)}${r.viewCount > 1 ? `, ${r.viewCount} times since` : ""}`
                        : r.notifiedAt
                          ? `Told ${fmtDateTime(r.notifiedAt)} — not opened yet`
                          : "Waiting to be issued"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

        </div>
      </div>
    </div>
  );
}

