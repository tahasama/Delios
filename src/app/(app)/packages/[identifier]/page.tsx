import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { notFound } from "next/navigation";
import { Timeline } from "@/components/timeline";
import { PageHeader, Card, Chip, Info, DataTable, Th, Td, Field, inputCls, Banner } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { addPackageMemberAction, assessPackageAction, issueShortfallAction, closePackageAction, acceptShortfallAction } from "@/lib/actions/planning";
import { getActiveSet } from "@/lib/config";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";
import { SupplierPackage } from "./supplier-package";
import { isReadOnly } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function PackageDetailPage({ params }: { params: Promise<{ identifier: string }> }) {
  const { user, db } = await requireScope();
  const { identifier } = await params;
  const pkg = await db.package.findFirst({
    where: { identifier },
    include: { members: { include: { document: { include: { revisions: { where: { state: "RELEASED" }, orderBy: { releasedAt: "desc" }, take: 1 } } } } } },
  });
  if (!pkg) notFound();
  if (pkg.category === "SUPPLIER") return <SupplierPackage pkg={pkg} />;
  const [statuses, docs] = await Promise.all([
    getActiveSet("STATUSES"),
    db.document.findMany({ where: { state: { in: ["PLANNED", "ACTIVE"] } }, orderBy: { docNumber: "asc" }, select: { id: true, docNumber: true, title: true } }),
  ]);
  const shortfall: { docNumber: string; requiredStatus: string; currentStatus: string; reason: string; expectedDate: string | null }[] | null = pkg.shortfall ? JSON.parse(pkg.shortfall) : null;
  const isAcceptor = user.id === pkg.acceptanceAuthorityId;
  const overdue = pkg.completionDate < new Date() && !pkg.assessedAt;
  const readyCount = pkg.members.filter((member) => member.document.revisions[0]?.statusCode === member.requiredStatus).length;
  const readinessPercent = pkg.members.length ? Math.round(readyCount / pkg.members.length * 100) : 0;
  const nextAction = pkg.closedAt ? "Closed. Nothing more to do." : shortfall && pkg.shortfallIssuedAt && !pkg.shortfallAcceptedBy ? `Waiting for ${pkg.acceptanceAuthorityName} to accept what is missing.` : shortfall && !pkg.shortfallIssuedAt ? `Some documents are not ready. Send the shortfall to ${pkg.acceptanceAuthorityName}.` : pkg.assessedAt && !shortfall ? "Everything is ready. Close the package when it is delivered." : "Get every document to its required status, then check readiness.";

  const shortfallFor = new Map((shortfall ?? []).map((s) => [s.docNumber, s]));
  // A code says nothing on its own: AB is as-built, IFC is for construction.
  const statusName = new Map(statuses.map((x) => [x.code, x.label]));
  const statusMeaning = new Map(statuses.map((x) => [x.code, typeof x.props.may === "string" ? `${x.label}: ${x.props.may}` : x.label]));
  const spell = (code: string) => `${code}${statusName.get(code) ? ` (${statusName.get(code)!.toLowerCase()})` : ""}`;
  const canAct = !isReadOnly(user) && !pkg.closedAt;

  return (
    <div className="space-y-5">
      <PageHeader
        title={pkg.identifier}
        subtitle={`${pkg.recipientName} · ${pkg.purpose.toLowerCase()} · every document released at ${spell(pkg.requiredStatus)} by ${fmtDate(pkg.completionDate)} · accepted by ${pkg.acceptanceAuthorityName}`}
        actions={
          <><Link href="/packages" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4"/> Packages</Link>{pkg.closedAt ? <Chip className="bg-slate-100 text-slate-600 ring-slate-300">closed</Chip>
          : pkg.shortfall ? <Chip className="bg-amber-100 text-amber-800 ring-amber-300">shortfall</Chip>
          : pkg.assessedAt ? <Chip className="bg-emerald-100 text-emerald-800 ring-emerald-300">complete</Chip>
          : <Chip>open</Chip>}</>
        }
      />

      {overdue ? <Banner tone="danger" title="Past its completion date">This package should have been checked on {fmtDate(pkg.completionDate)}.</Banner> : null}

      <section className="rounded-2xl border border-slate-200 bg-surface p-5 shadow-sm">
        <p className="text-sm font-semibold text-slate-900">{nextAction}</p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${readinessPercent === 100 && pkg.members.length ? "bg-emerald-500" : "bg-[#d9a441]"}`} style={{ width: `${readinessPercent}%` }}/></div>
        <p className="mt-1.5 text-xs text-slate-500">{readyCount} of {pkg.members.length} documents ready</p>
        {canAct ? (
          <div className="mt-4 flex flex-wrap items-start gap-3">
            {!pkg.assessedAt ? <ActionForm action={assessPackageAction} submitLabel="Check readiness now" size="sm" hidden={{ packageId: pkg.id }} /> : null}
            {shortfall && !pkg.shortfallIssuedAt ? <ActionForm action={issueShortfallAction} submitLabel={`Send shortfall to ${pkg.acceptanceAuthorityName}`} size="sm" hidden={{ packageId: pkg.id }} /> : null}
            {shortfall && pkg.shortfallIssuedAt && !pkg.shortfallAcceptedBy && isAcceptor ? <ActionForm action={acceptShortfallAction} submitLabel="Accept the shortfall" size="sm" hidden={{ packageId: pkg.id }} /> : null}
            {pkg.assessedAt ? (
              <details className="min-w-64">
                <summary className="cursor-pointer text-xs font-semibold text-link">Close the package…</summary>
                <div className="mt-2">
                  <ActionForm action={closePackageAction} submitLabel="Close package" size="sm" variant="secondary" hidden={{ packageId: pkg.id }}>
                    {pkg.type === "ACCUMULATED" ? <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" name="ruleCeased" /> No more documents will be added</label> : null}
                    <input name="closureNote" className={inputCls} placeholder="Note (optional)" />
                  </ActionForm>
                </div>
              </details>
            ) : null}
          </div>
        ) : null}
        {pkg.shortfallAcceptedBy ? <p className="mt-3 text-xs text-slate-500">Shortfall accepted by {pkg.shortfallAcceptedBy}.</p> : null}
        {pkg.closedAt ? <p className="mt-3 text-xs text-slate-500">Closed {fmtDateTime(pkg.closedAt)}.</p> : null}
      </section>

      <Card title="Progress">
        <Timeline
          points={[
            { label: "Package opened", at: pkg.createdAt, holder: pkg.compositionOwnerName ?? null },
            { label: `Every document released at ${spell(pkg.requiredStatus)}`, at: readyCount === pkg.members.length && pkg.members.length ? pkg.assessedAt ?? pkg.completionDate : null, holder: `${readyCount} of ${pkg.members.length} ready` },
            { label: "Readiness checked", at: pkg.assessedAt, holder: pkg.compositionOwnerName },
            { label: "What is missing sent to the acceptor", at: pkg.shortfallIssuedAt, holder: pkg.acceptanceAuthorityName, skipped: !!pkg.assessedAt && !shortfall },
            { label: "Missing documents accepted", at: pkg.shortfallAcceptedBy ? pkg.shortfallIssuedAt : null, holder: pkg.shortfallAcceptedBy ?? null, skipped: !!pkg.assessedAt && !shortfall },
            { label: "Delivered and closed", at: pkg.closedAt, holder: pkg.acceptanceAuthorityName },
          ]}
        />
      </Card>

      <Card title={`Documents · ${pkg.members.length}`}>
        {pkg.members.length ? (
          <DataTable head={<tr><Th>Document</Th><Th>Needs</Th><Th>Has</Th><Th>Ready <Info>Ready: the current released revision carries the status this package asks for. Not ready means never released, released at another status, or replaced by a newer revision.</Info></Th>{shortfall ? <Th>Why not</Th> : null}</tr>}>
            {pkg.members.map((m) => {
              const cur = m.document.revisions[0];
              const ok = cur?.statusCode === m.requiredStatus;
              return (
                <tr key={m.id}>
                  <Td><Link href={`/documents/${m.documentId}`} className="font-mono text-[13px] font-semibold text-brand-ink hover:underline">{m.document.docNumber}</Link><span className="block max-w-72 truncate text-xs text-slate-400">{m.document.title}</span></Td>
                  <Td className="text-xs" title={statusMeaning.get(m.requiredStatus) ?? undefined}>{spell(m.requiredStatus)}</Td>
                  <Td className="text-xs">{cur ? `rev ${cur.value} · ${cur.statusCode}` : "not released"}</Td>
                  <Td>{ok ? <Chip className="bg-emerald-100 text-emerald-800 ring-emerald-300">yes</Chip> : <Chip className="bg-amber-100 text-amber-800 ring-amber-300">no</Chip>}</Td>
                  {shortfall ? <Td className="text-xs text-slate-500">{shortfallFor.get(m.document.docNumber)?.reason ?? ""}</Td> : null}
                </tr>
              );
            })}
          </DataTable>
        ) : (
          <p className="text-xs text-slate-400">No documents yet.</p>
        )}
        {canAct ? (
          <details className="mt-4 border-t border-slate-100 pt-3">
            <summary className="cursor-pointer text-xs font-semibold text-link">+ Add documents</summary>
            <div className="mt-3">
              <ActionForm action={addPackageMemberAction} submitLabel="Add" size="sm" hidden={{ packageId: pkg.id }}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_160px]">
                  <Field label="Documents" required hint="Ctrl/Cmd-click for several">
                    <select name="documentId" multiple required className={`${inputCls} h-40`} defaultValue={[]}>
                      {docs.filter((d) => !pkg.members.some((m) => m.documentId === d.id)).map((d) => <option key={d.id} value={d.id}>{d.docNumber} — {d.title.slice(0, 50)}</option>)}
                    </select>
                  </Field>
                  <Field label="Needed at" required>
                    <select name="requiredStatus" required className={inputCls} defaultValue={pkg.requiredStatus}>
                      {statuses.map((s) => <option key={s.code} value={s.code}>{s.code} — {s.label}</option>)}
                    </select>
                  </Field>
                </div>
              </ActionForm>
            </div>
          </details>
        ) : null}
        <p className="mt-4 text-[11px] text-slate-400">Put together by {pkg.compositionOwnerName}{pkg.membershipRule ? ` · includes: ${pkg.membershipRule}` : ""}</p>
      </Card>
    </div>
  );
}
