import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { api, ApiProblem } from "@/lib/api/client";
import type { ListValue, TransmittalView, Work } from "@/lib/api/types";
import { requireSession, projectPath } from "@/lib/session";
import { LISTS } from "@/lib/lists";
import { btn, Card, KeyValue, PageHeader } from "@/components/ui";
import { Acknowledge, Dispatch, RegisterItem } from "./forms";

export const dynamic = "force-dynamic";

function day(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "";
}

/**
 * One transmittal: what it carried (each revision as it stood when it went),
 * who it went to and whether each has it, and what the signed-in person may
 * do: acknowledge it, or record that it went to an organization outside.
 * What it records is never changed.
 */
export default async function TransmittalPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  let t: TransmittalView;
  try {
    t = await api<TransmittalView>(projectPath(session, `/transmittals/${id}`));
  } catch (e) {
    if (e instanceof ApiProblem && e.status === 404) notFound();
    throw e;
  }
  const [lists, work] = await Promise.all([
    api<Record<string, ListValue[]>>("/api/values", { query: { sets: [LISTS.reasonsForIssue, LISTS.statuses, LISTS.deliverableTypes, LISTS.documentTypes, LISTS.disciplines, LISTS.subprojects, LISTS.purchaseOrders].join(",") } }),
    api<Work>(projectPath(session, "/work")),
  ]);
  const label = (set: string, code: string | null) => (code ? lists[set]?.find((v) => v.code === code)?.label ?? code : "");
  // Whether it waits on the signed-in person's acknowledgement: the backend's own work list says so.
  const toAcknowledge = work.issues.some((w) => w.kind === "ACKNOWLEDGE_TRANSMITTAL" && w.transmittalId === t.id);
  const canDispatch = session.can("CONTROL") || session.can("TRANSMIT");
  const incoming = t.direction === "INCOMING";
  const mayRegister = incoming && session.user.isInternal && session.can("CONTROL");
  const active = (set: string) => (lists[set] ?? []).filter((v) => v.status === "ACTIVE").map((v) => ({ code: v.code, label: v.label }));
  const registerLists = { deliverableTypes: active(LISTS.deliverableTypes), docTypes: active(LISTS.documentTypes), disciplines: active(LISTS.disciplines), subprojects: active(LISTS.subprojects), orders: active(LISTS.purchaseOrders) };
  const size = (n: number) => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
  const placeholders = t.items.some((i) => i.kind === "PLACEHOLDER");

  return (
    <div className="space-y-4">
      <Link href="/transmittals" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800"><ArrowLeft className="h-3.5 w-3.5" /> Transmittals</Link>
      <PageHeader eyebrow={incoming ? `${t.number} · received` : t.number} title={t.subject}
        subtitle={incoming
          ? `From ${t.from}${t.theirReference ? ` (their ${t.theirReference})` : ""} · ${label(LISTS.reasonsForIssue, t.reason)} · received ${day(t.issuedAt)} ${new Date(t.issuedAt).toLocaleTimeString("en-GB")} · sent by ${t.issuedBy}`
          : `To ${t.to} · ${label(LISTS.reasonsForIssue, t.reason)} · issued ${day(t.issuedAt)} by ${t.issuedBy}`}
        actions={incoming ? <a href={`/api/receipt/${t.id}`} className={btn("secondary", "sm")}>Receipt (PDF)</a> : undefined} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card title={placeholders ? "What is asked for" : incoming ? "What came" : "What it carried"}
            description={placeholders ? "Each placeholder to fill and send back on a transmittal, by its date"
              : incoming ? "Each file with its SHA-256 fingerprint, the proof of exactly what arrived" : "Each revision as it stood when it went"}>
            <ul className="divide-y divide-line text-sm">
              {t.items.map((i) => (
                <li key={i.id} className="space-y-1 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span>
                      {i.documentId ? <Link href={`/documents/${i.documentId}`} className="font-semibold text-link hover:underline">{i.kind === "UNPLANNED" && i.registeredAt ? i.title : i.documentNumber}</Link>
                        : <span className="font-semibold">{i.documentNumber || "No reference"}</span>}
                      {i.revision ? ` rev ${i.revision}` : ""} · {i.title}
                    </span>
                    <span className="text-xs text-slate-500">
                      {i.kind === "PLACEHOLDER" ? (i.dueDate ? `due ${day(i.dueDate)}` : "no date")
                        : i.kind === "SUBMISSION" ? <>sent for <span title={label(LISTS.statuses, i.status)}>{i.status}</span>{i.submission && i.submission > 1 ? `, submission ${i.submission}` : ""}</>
                        : i.kind === "UNPLANNED" ? (i.registeredAt ? `registered ${day(i.registeredAt)} by ${i.registeredBy}` : `unplanned${i.docType ? ` · ${label(LISTS.documentTypes, i.docType)}` : ""}: not in the register yet`)
                        : <span title={label(LISTS.statuses, i.status)}>{i.status}</span>}
                    </span>
                  </div>
                  {i.files.length ? (
                    <ul className="space-y-0.5 pl-3 text-xs text-slate-600">
                      {i.files.map((f) => (
                        <li key={f.id}>
                          <a href={`/api/files/${f.id}`} className="text-link hover:underline">{f.name}</a> · {size(f.size)}{f.status !== "CLEAN" ? ` · ${f.status.toLowerCase()}` : ""}
                          <span className="block break-all font-mono text-[10px] text-slate-400">SHA-256 {f.sha256}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {mayRegister && i.kind === "UNPLANNED" && !i.registeredAt ? (
                    <details className="rounded border border-line px-3 py-2">
                      <summary className="cursor-pointer text-xs font-semibold text-brand-ink">Put it in the register</summary>
                      <div className="mt-2"><RegisterItem transmittalId={t.id} itemId={i.id} title={i.title} docType={i.docType} lists={registerLists} /></div>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
          {t.message ? <Card title="Message"><p className="whitespace-pre-wrap text-sm text-slate-800">{t.message}</p></Card> : null}
          {incoming ? null : <Card title="Who has it">
            <ul className="divide-y divide-line text-sm">
              {t.recipients.map((r) => (
                <li key={r.id} className="py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold">{r.name}{r.organization && r.organization !== r.name ? <span className="font-normal text-slate-500"> · {r.organization}</span> : null}</span>
                    <span className="text-xs text-slate-500">
                      {r.person
                        ? r.acknowledgedAt ? `acknowledged ${day(r.acknowledgedAt)}` : r.openedAt ? `opened ${day(r.openedAt)}` : "not opened yet"
                        : r.dispatchedAt ? `sent ${day(r.dispatchedAt)} by ${r.dispatchChannel}${r.dispatchRef ? ` (${r.dispatchRef})` : ""}` : "to send: outside the system"}
                      {r.proofFileId ? <> · <a href={`/api/files/${r.proofFileId}`} className="font-semibold text-link hover:underline">proof</a></> : null}
                    </span>
                  </div>
                  {!r.person && !r.dispatchedAt && canDispatch ? <div className="mt-2"><Dispatch transmittalId={t.id} recipientId={r.id} name={r.name} /></div> : null}
                </li>
              ))}
            </ul>
          </Card>}
        </div>
        <div className="space-y-4">
          {toAcknowledge ? <Card title="For you"><Acknowledge transmittalId={t.id} /></Card> : null}
          <Card title="About it">
            <KeyValue items={incoming ? [
              { label: "Reason", value: label(LISTS.reasonsForIssue, t.reason) },
              { label: "From", value: t.from ?? "" },
              { label: "Their reference", value: t.theirReference ?? "—" },
              { label: "Received", value: `${day(t.issuedAt)} ${new Date(t.issuedAt).toLocaleTimeString("en-GB")}` },
              { label: "Sent by", value: t.issuedBy },
              ...(t.proofFileId ? [{ label: "Covering letter", value: <a href={`/api/files/${t.proofFileId}`} className="font-semibold text-link hover:underline">open</a> }] : []),
            ] : [
              { label: "Reason", value: label(LISTS.reasonsForIssue, t.reason) },
              { label: "Answer", value: t.responseRequired ? `expected${t.responseDue ? ` by ${day(t.responseDue)}` : ""}` : "not expected" },
              { label: "Issued by", value: t.issuedBy },
              { label: "Raised from", value: t.reviewStepId ? "a review step" : t.issueRequestId ? "an issue request" : t.packageId ? <Link href={`/packages/${t.packageId}`} className="font-semibold text-link hover:underline">a package</Link> : "composed directly" },
            ]} />
          </Card>
        </div>
      </div>
    </div>
  );
}
