import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { api, ApiProblem } from "@/lib/api/client";
import type { PackageView, RegisterPage } from "@/lib/api/types";
import { requireSession, projectPath } from "@/lib/session";
import { LISTS } from "@/lib/lists";
import { Card, Field, inputCls, KeyValue } from "@/components/ui";
import { SearchPick } from "@/components/search-pick";
import { packageLists } from "../lists";
import { Step } from "../forms";
import { RuleFields } from "../rule-fields";
import { day, PACKAGE_STATES } from "../states";

export const dynamic = "force-dynamic";

/**
 * One package: its documents and whether each is ready, and the next step for
 * whoever is signed in. Its owners (or Document Control) add and take out
 * documents, set its rule, check readiness, send what is missing to the
 * acceptance authority and deliver it; the acceptance authority accepts what is
 * missing, and in the end the package.
 */
export default async function PackagePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  let p: PackageView;
  try {
    p = await api<PackageView>(projectPath(session, `/packages/${id}`));
  } catch (e) {
    if (e instanceof ApiProblem && e.status === 404) notFound();
    throw e;
  }
  const me = session.user.id;
  const open = p.state === "OPEN";
  const owns = open && session.user.isInternal && (p.ownerIds.includes(me) || session.can("CONTROL"));
  const accepts = p.acceptorIds.includes(me);
  const [lists, register] = await Promise.all([
    packageLists(session),
    owns ? api<RegisterPage>(projectPath(session, "/register"), { query: { per: 250, sort: "docNumber", dir: "asc" } }) : null,
  ]);
  const person = new Map(lists.people.map((x) => [x.id, x.name]));
  const party = new Map(lists.parties.map((x) => [x.id, x.name]));
  const names = (ids: string[], from: Map<string, string>) => ids.map((x) => from.get(x) ?? "someone no longer on the project").join(", ");
  const inside = new Set(p.members.map((m) => m.documentId));
  const candidates = (register?.rows ?? []).filter((r) => !inside.has(r.id));
  const ready = p.members.filter((m) => m.ready).length;
  const missing = p.shortfall.length > 0;
  const mayDeliver = !!p.assessedAt && (!missing || !!p.shortfallAcceptedAt) && (ready > 0 || !p.recipientPartyIds.length);
  const state = PACKAGE_STATES[p.state] ?? { label: p.state.toLowerCase(), tone: "bg-slate-100 text-slate-600" };
  const box = "flex items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50";
  const rule = p.rule && (p.rule.deliverableTypes.length + p.rule.disciplines.length + p.rule.docTypes.length + p.rule.originators.length) > 0
    ? [...p.rule.deliverableTypes.map((c) => lists.label(LISTS.deliverableTypes, c)), ...p.rule.disciplines.map((c) => lists.label(LISTS.disciplines, c)),
       ...p.rule.docTypes.map((c) => lists.label(LISTS.documentTypes, c)), ...p.rule.originators].join(" · ")
    : null;

  const next = p.state === "ACCEPTED" ? `Accepted by ${p.acceptedBy} on ${day(p.acceptedAt)}.`
    : !open ? `Delivered ${day(p.closedAt)}. Waiting for ${names(p.acceptorIds, person)} to accept it.`
    : missing && !p.shortfallIssuedAt ? `${ready} of ${p.members.length} ready. Send what is missing to ${names(p.acceptorIds, person)} before delivering.`
    : missing && !p.shortfallAcceptedAt ? `${ready} of ${p.members.length} ready. Waiting for ${names(p.acceptorIds, person)} to accept what is missing.`
    : mayDeliver ? `${ready} of ${p.members.length} ready. It can be delivered.`
    : p.assessedAt && !ready ? "Nothing is ready yet, so nothing can be sent. Check readiness again once documents are released at the status they need."
    : `${ready} of ${p.members.length} ready. Check readiness when the documents are released at the status they need.`;

  return (
    <div className="space-y-4">
      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-col-reverse gap-3 px-5 pt-6 pb-4 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[12.5px] font-semibold tracking-tight text-slate-500">{p.number}</p>
            <h1 className="plate-name mt-1 min-w-0">{p.title}</h1>
            <p className="plate-meta mt-2">{lists.label(LISTS.reasonsForIssue, p.reason)} · needed at {p.requiredStatuses.join(" or ")}{p.completionDate ? ` · by ${day(p.completionDate)}` : ""}</p>
            {p.description ? <p className="mt-1.5 max-w-3xl text-[13px] leading-5 text-slate-600">{p.description}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2 lg:justify-end">
            <Link href="/packages" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /> Packages</Link>
            <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${state.tone}`}>{state.label}</span>
          </div>
        </div>
      </section>

      <Card title="Next step">
        <div className="space-y-4">
          <p className="text-sm text-slate-700">{next}</p>
          {accepts && !open && p.state !== "ACCEPTED" ? (
            <Step packageId={p.id} what="accept" label="Accept the package">
              <p className="text-xs text-slate-500">You confirm it was delivered as agreed. It is recorded with your name.</p>
              <Field label="Note" hint="optional"><input name="note" className={inputCls} /></Field>
            </Step>
          ) : null}
          {accepts && open && missing && p.shortfallIssuedAt && !p.shortfallAcceptedAt ? (
            <Step packageId={p.id} what="shortfall-accept" label="Accept what is missing">
              <p className="text-xs text-slate-500">The package may then be delivered without the documents listed as not ready.</p>
              <Field label="Note" hint="optional"><input name="note" className={inputCls} /></Field>
            </Step>
          ) : null}
          {owns ? (
            <>
              {p.members.length ? <Step packageId={p.id} what="assess" label={p.assessedAt ? "Check readiness again" : "Check readiness"} variant={p.assessedAt ? "secondary" : "primary"}>
                <p className="text-xs text-slate-500">Records which documents are released at the status they need, and what is missing.{p.assessedAt ? ` Last checked ${day(p.assessedAt)}.` : ""}</p>
              </Step> : null}
              {missing && !p.shortfallIssuedAt ? <Step packageId={p.id} what="shortfall-issue" label="Send what is missing">
                <p className="text-xs text-slate-500">{names(p.acceptorIds, person)} decide whether it may be delivered without them.</p>
              </Step> : null}
              {mayDeliver ? <Step packageId={p.id} what="deliver" label={p.recipientPartyIds.length ? `Deliver ${ready} document${ready === 1 ? "" : "s"}` : "Close the package"}>
                <p className="text-xs text-slate-500">{p.recipientPartyIds.length ? `The ready documents go on transmittals to ${names(p.recipientPartyIds, party)}.` : "It names no organization, so nothing is sent: closing records that it was handed over."}</p>
                {rule ? <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" name="ruleCeased" /> No more documents will join by the rule</label> : null}
                <Field label="Message" hint="optional — it goes on the transmittal"><input name="note" className={inputCls} /></Field>
              </Step> : null}
            </>
          ) : null}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="register register-sheet register-sheet-open">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
            <span className="stencil text-slate-600">Documents</span>
            <span className="text-[11px] text-slate-500">{ready} of {p.members.length} released at the status they need</span>
          </div>
          {p.members.length ? (
            <table className="w-full text-[13px]">
              <thead className="border-b border-line"><tr className="text-left text-slate-500"><th className="stencil px-5 py-2 font-normal">Document</th><th className="stencil px-3 py-2 font-normal">Has</th><th className="stencil px-3 py-2 font-normal">Needs</th><th className="stencil px-3 py-2 font-normal">Ready</th></tr></thead>
              <tbody className="divide-y divide-line">
                {p.members.map((m) => (
                  <tr key={m.documentId}>
                    <td className="px-5 py-2"><Link href={`/documents/${m.documentId}`} className="doc-number">{m.documentNumber}</Link><span className="block text-xs text-slate-500">{m.title}{m.byRule ? " · by the rule" : ""}</span></td>
                    <td className="px-3 py-2 text-xs text-slate-600">{m.revision ? `rev ${m.revision} · ${m.status ?? ""}` : "not released"}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{m.required.join(" or ")}</td>
                    <td className="px-3 py-2">{m.ready ? <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">ready</span> : <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">not ready</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="px-5 py-6 text-center text-xs text-slate-400 sm:px-6">No documents yet. Add them below, or tick them in the document register.</p>}
        </section>

        <Card title="About">
          <KeyValue items={[
            { label: "Put together by", value: names(p.ownerIds, person) },
            { label: "Accepted by", value: names(p.acceptorIds, person) },
            { label: "Delivered to", value: p.recipientPartyIds.length ? names(p.recipientPartyIds, party) : "nobody: closed when done" },
            { label: "Fills itself with", value: rule ?? "nothing: by hand" },
            { label: "Created by", value: p.createdBy },
            ...(p.shortfallAcceptedBy ? [{ label: "Missing accepted by", value: `${p.shortfallAcceptedBy}, ${day(p.shortfallAcceptedAt)}` }] : []),
            ...(p.closedBy ? [{ label: "Delivered by", value: `${p.closedBy}, ${day(p.closedAt)}` }] : []),
            ...(p.transmittals.length ? [{ label: "Transmittals", value: p.transmittals.join(", ") }] : []),
            ...(p.closureNote ? [{ label: "Message", value: p.closureNote }] : []),
          ]} />
        </Card>
      </div>

      {owns ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="Add documents">
            {candidates.length ? (
              <Step packageId={p.id} what="add" label="Add the ticked documents">
                <div className="max-h-72 overflow-y-auto rounded border border-line">
                  {candidates.map((d) => (
                    <label key={d.id} className={box}><input type="checkbox" name="documentId" value={d.id} className="mt-1" /><span><span className="font-semibold">{d.number}</span>{d.releasedRevision ? ` rev ${d.releasedRevision}` : ""}{d.releasedStatus ? ` · ${d.releasedStatus}` : ""}<span className="block text-xs text-slate-500">{d.title}</span></span></label>
                  ))}
                </div>
                <SearchPick browse name="requiredStatus" label="Needed at" hint="optional — empty: what the package needs" items={lists.statuses.map((s) => ({ id: s.code, name: s.code, detail: s.label }))} />
              </Step>
            ) : <p className="text-xs text-slate-500">Every document is already in this package.</p>}
          </Card>
          {p.members.length ? (
            <Card title="Take documents out">
              <Step packageId={p.id} what="remove" label="Take the ticked documents out" variant="secondary">
                <div className="max-h-72 overflow-y-auto rounded border border-line">
                  {p.members.map((m) => (
                    <label key={m.documentId} className={box}><input type="checkbox" name="documentId" value={m.documentId} className="mt-1" /><span><span className="font-semibold">{m.documentNumber}</span><span className="block text-xs text-slate-500">{m.title}</span></span></label>
                  ))}
                </div>
                {rule ? <p className="text-[11px] text-slate-500">A document the rule matches stays out until someone adds it back by hand.</p> : null}
              </Step>
            </Card>
          ) : null}
          <Card title={rule ? "Change the rule" : "Fill it by a rule"}>
            <Step packageId={p.id} what="rule" label="Save the rule" variant="secondary">
              <p className="text-xs text-slate-500">Every document matching all you choose joins, new ones too, until it is delivered. Clear every choice to fill it by hand only.</p>
              <RuleFields lists={lists.rule} initial={p.rule} />
            </Step>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
