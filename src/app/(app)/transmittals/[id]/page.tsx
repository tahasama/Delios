import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { api, ApiProblem } from "@/lib/api/client";
import type { ListValue, TransmittalView, Work } from "@/lib/api/types";
import { requireSession, projectPath } from "@/lib/session";
import { LISTS } from "@/lib/lists";
import { Card, KeyValue, PageHeader } from "@/components/ui";
import { Acknowledge, Dispatch } from "./forms";

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
    api<Record<string, ListValue[]>>("/api/values", { query: { sets: `${LISTS.reasonsForIssue},${LISTS.statuses}` } }),
    api<Work>(projectPath(session, "/work")),
  ]);
  const label = (set: string, code: string | null) => (code ? lists[set]?.find((v) => v.code === code)?.label ?? code : "");
  // Whether it waits on the signed-in person's acknowledgement: the backend's own work list says so.
  const toAcknowledge = work.issues.some((w) => w.kind === "ACKNOWLEDGE_TRANSMITTAL" && w.transmittalId === t.id);
  const canDispatch = session.can("CONTROL") || session.can("TRANSMIT");

  return (
    <div className="space-y-4">
      <Link href="/transmittals" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800"><ArrowLeft className="h-3.5 w-3.5" /> Transmittals</Link>
      <PageHeader eyebrow={t.number} title={t.subject} subtitle={`To ${t.to} · ${label(LISTS.reasonsForIssue, t.reason)} · issued ${day(t.issuedAt)} by ${t.issuedBy}`} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card title="What it carried" description="Each revision as it stood when it went">
            <ul className="divide-y divide-line text-sm">
              {t.items.map((i) => (
                <li key={i.revisionId} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <span><Link href={`/documents/${i.documentId}`} className="font-semibold text-link hover:underline">{i.documentNumber}</Link> rev {i.revision} · {i.title}</span>
                  <span className="text-xs text-slate-500" title={label(LISTS.statuses, i.status)}>{i.status}</span>
                </li>
              ))}
            </ul>
          </Card>
          {t.message ? <Card title="Message"><p className="whitespace-pre-wrap text-sm text-slate-800">{t.message}</p></Card> : null}
          <Card title="Who has it">
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
          </Card>
        </div>
        <div className="space-y-4">
          {toAcknowledge ? <Card title="For you"><Acknowledge transmittalId={t.id} /></Card> : null}
          <Card title="About it">
            <KeyValue items={[
              { label: "Reason", value: label(LISTS.reasonsForIssue, t.reason) },
              { label: "Answer", value: t.responseRequired ? `expected${t.responseDue ? ` by ${day(t.responseDue)}` : ""}` : "not expected" },
              { label: "Issued by", value: t.issuedBy },
              { label: "Raised from", value: t.reviewStepId ? "a review step" : t.issueRequestId ? "an issue request" : "composed directly" },
            ]} />
          </Card>
        </div>
      </div>
    </div>
  );
}
