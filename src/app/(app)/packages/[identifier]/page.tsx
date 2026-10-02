import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { notFound } from "next/navigation";
import { Timeline } from "@/components/timeline";
import { Card, Chip, Info, Field, inputCls, Banner } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { addPackageMemberAction, removePackageMemberAction, setPackageRuleAction, assessPackageAction, issueShortfallAction, closePackageAction, acceptShortfallAction, acceptPackageAction } from "@/lib/actions/planning";
import { syncPackage, parseFilter, meetsStatus, statusList, recipientIds, acceptorIds } from "@/lib/package-rule";
import { SearchPick } from "@/components/search-pick";
import { isAdmin } from "@/lib/auth";
import { RuleFields } from "../rule-fields";
import { getActiveSet } from "@/lib/config";
import { fmtDate, fmtDateTime, cn } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";
import { SupplierPackage } from "./supplier-package";
import { isReadOnly } from "@/lib/auth";
import { NextStepBody, StagePath, type StepItem } from "@/app/(app)/documents/[id]/next-step";
import { RevisionChecklist } from "@/components/revision-checklist";

export const dynamic = "force-dynamic";

/**
 * A delivery package: documents we hand to one organization, each at a status,
 * by a date. Composed, checked, then delivered on one transmittal — which closes
 * it. What is missing on the day goes to the acceptance authority first.
 */
export default async function PackageDetailPage({ params, searchParams }: { params: Promise<{ identifier: string }>; searchParams: Promise<{ added?: string }> }) {
  const ctx = await requireScope();
  const { user, db } = ctx;
  const { identifier } = await params;
  const sp = await searchParams;
  // A package with a rule takes in what has come to match it since last seen.
  const found = await db.package.findFirst({ where: { identifier }, select: { id: true } });
  if (found) await syncPackage(ctx, found.id);
  const pkg = await db.package.findFirst({
    where: { identifier },
    include: { members: { include: { document: { include: { revisions: { where: { state: "RELEASED" }, orderBy: { releasedAt: "desc" }, take: 1 } } } } } },
  });
  if (!pkg) notFound();
  if (pkg.category === "SUPPLIER") return <SupplierPackage pkg={pkg} />;
  const [statuses, reasons, candidates, delivery] = await Promise.all([
    getActiveSet("STATUSES"),
    getActiveSet("REASONS_FOR_ISSUE"),
    db.document.findMany({
      where: { state: { in: ["PLANNED", "ACTIVE"] }, id: { notIn: pkg.members.map((m) => m.documentId) } },
      orderBy: { docNumber: "asc" },
      take: 500,
      select: { id: true, docNumber: true, title: true, revisions: { where: { state: "RELEASED" }, orderBy: { releasedAt: "desc" }, take: 1, select: { value: true, statusCode: true } } },
    }),
    db.transmittal.findMany({ where: { OR: [{ packageId: pkg.id }, ...(pkg.transmittalId ? [{ id: pkg.transmittalId }] : [])] }, orderBy: { number: "asc" }, select: { id: true, number: true } }),
  ]);
  const shortfall: { docNumber: string; requiredStatus: string; currentStatus: string; reason: string; expectedDate: string | null }[] | null = pkg.shortfall ? JSON.parse(pkg.shortfall) : null;
  const isAcceptor = acceptorIds(pkg).includes(user.id);
  const overdue = pkg.completionDate < new Date() && !pkg.closedAt;
  const total = pkg.members.length;
  const readyCount = pkg.members.filter((member) => meetsStatus(member.document.revisions[0]?.statusCode, member.requiredStatus)).length;
  const sendsTo = recipientIds(pkg);
  const needs = statusList(pkg.requiredStatus);
  const statusName = new Map(statuses.map((x) => [x.code, x.label]));
  const statusMeaning = new Map(statuses.map((x) => [x.code, typeof x.props.may === "string" ? `${x.label}: ${x.props.may}` : x.label]));
  const spell = (codes: string) => statusList(codes).map((code) => `${code}${statusName.get(code) ? ` (${statusName.get(code)!.toLowerCase()})` : ""}`).join(" or ");
  const purpose = pkg.purpose.split(",").map((code) => reasons.find((one) => one.code === code)?.label ?? code.toLowerCase()).join(", ");
  const canAct = !isReadOnly(user) && !pkg.closedAt;
  const shortfallFor = new Map((shortfall ?? []).map((s) => [s.docNumber, s]));
  const waitingAcceptance = !!shortfall && !!pkg.shortfallIssuedAt && !pkg.shortfallAcceptedBy;
  const mayDeliver = !!pkg.assessedAt && (!shortfall || !!pkg.shortfallAcceptedBy);

  const state = pkg.acceptedAt ? "accepted" : pkg.closedAt ? "delivered" : shortfall ? "shortfall" : pkg.assessedAt ? "ready" : overdue ? "overdue" : "open";
  const stateTone: Record<string, string> = {
    accepted: "bg-emerald-100 text-emerald-800 ring-emerald-300",
    delivered: "bg-sky-100 text-sky-800 ring-sky-300",
    ready: "bg-emerald-100 text-emerald-800 ring-emerald-300",
    shortfall: "bg-amber-100 text-amber-800 ring-amber-300",
    overdue: "bg-red-100 text-red-800 ring-red-300",
    open: "bg-slate-100 text-slate-600 ring-slate-300",
  };

  const sentOn = delivery.length ? <> on {delivery.map((one, i) => <span key={one.id}>{i ? ", " : ""}<Link href={`/transmittals/${one.id}`} className="font-mono font-semibold text-link hover:underline">{one.number}</Link></span>)}</> : null;
  const note = pkg.acceptedAt
    ? <>Delivered {fmtDate(pkg.deliveredAt ?? pkg.closedAt!)}{sentOn}, accepted by <strong className="text-slate-800">{pkg.acceptedByName}</strong> {fmtDate(pkg.acceptedAt)}.</>
    : pkg.closedAt
    ? <>Delivered {fmtDate(pkg.deliveredAt ?? pkg.closedAt)}{sentOn}. Waiting for <strong className="text-slate-800">{pkg.acceptanceAuthorityName}</strong> to accept it.</>
    : waitingAcceptance ? <>{readyCount} of {total} ready. Waiting for <strong className="text-slate-800">{pkg.acceptanceAuthorityName}</strong> to accept what is missing.</>
    : shortfall && !pkg.shortfallIssuedAt ? <>{readyCount} of {total} ready. Send what is missing to <strong className="text-slate-800">{pkg.acceptanceAuthorityName}</strong> before delivering.</>
    : mayDeliver ? <>{readyCount} of {total} ready. Deliver it to <strong className="text-slate-800">{pkg.recipientName}</strong>.</>
    : <>{readyCount} of {total} ready. Get every document released at {spell(pkg.requiredStatus)}, then check readiness.</>;

  const items: StepItem[] = [];
  if (pkg.closedAt && !pkg.acceptedAt && (isAcceptor || isAdmin(user))) items.push({
    key: "accept-package",
    primary: true,
    open: isAcceptor,
    label: "Accept the package",
    body: (
      <ActionForm action={acceptPackageAction} submitLabel="Accept" size="sm" hidden={{ packageId: pkg.id }}>
        <p className="text-xs text-slate-500">You confirm it was delivered as agreed. This is the last step; it is recorded with your name.</p>
        <Field label="Note" hint="optional"><input name="note" className={inputCls} /></Field>
      </ActionForm>
    ),
  });
  if (canAct) {
    if (!pkg.assessedAt) items.push({ key: "check", primary: total > 0, label: "Check readiness", body: <ActionForm action={assessPackageAction} submitLabel="Check readiness now" size="sm" hidden={{ packageId: pkg.id }}><p className="text-xs text-slate-500">Records which documents are released at the status the package needs, and what is missing.</p></ActionForm> });
    if (shortfall && !pkg.shortfallIssuedAt) items.push({ key: "shortfall", primary: true, label: "Send what is missing", body: <ActionForm action={issueShortfallAction} submitLabel={`Send to ${pkg.acceptanceAuthorityName}`} size="sm" hidden={{ packageId: pkg.id }}><p className="text-xs text-slate-500">{pkg.acceptanceAuthorityName} decides whether the package may be delivered without them.</p></ActionForm> });
    if (waitingAcceptance && isAcceptor) items.push({ key: "accept", primary: true, open: true, label: "Accept what is missing", body: <ActionForm action={acceptShortfallAction} submitLabel="Accept and allow delivery" size="sm" hidden={{ packageId: pkg.id }}><p className="text-xs text-slate-500">The package is delivered without the documents listed as missing. Your acceptance is recorded with your name.</p></ActionForm> });
    if (mayDeliver) items.push({
      key: "deliver",
      primary: true,
      label: sendsTo.length ? `Deliver to ${pkg.recipientName}` : "Close the package",
      body: (
        <ActionForm action={closePackageAction} submitLabel={sendsTo.length ? `Send ${readyCount} document${readyCount === 1 ? "" : "s"}` : "Close package"} size="sm" hidden={{ packageId: pkg.id }}>
          <p className="text-xs text-slate-500">
            {sendsTo.length
              ? `Every ready document goes out on one transmittal to each of ${pkg.recipientName}, ${purpose.toLowerCase()}. Within our own organization it goes to ${pkg.acceptanceAuthorityName}. Then ${pkg.acceptanceAuthorityName} accepts the package.`
              : "This package names no organization, so nothing is sent: closing records that it was handed over."}
          </p>
          {pkg.type === "ACCUMULATED" ? <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" name="ruleCeased" /> No more documents will be added</label> : null}
          <Field label="Message" hint="optional — it goes on the transmittal"><input name="closureNote" className={inputCls} /></Field>
        </ActionForm>
      ),
    });
    items.push({
      key: "add",
      open: !!sp.added || (!total && !pkg.assessedAt),
      label: "Add documents",
      body: candidates.length ? (
        <ActionForm action={addPackageMemberAction} submitLabel="Add the ticked documents" size="sm" hidden={{ packageId: pkg.id }}>
          <div className="-mx-5 border-y border-line sm:-mx-6">
            <RevisionChecklist name="documentId" rows={candidates.map((d) => ({ id: d.id, number: d.docNumber, rev: d.revisions[0]?.value ?? "—", status: d.revisions[0]?.statusCode ?? null, title: d.title }))} />
          </div>
          <SearchPick browse name="requiredStatus" required label="Needed at" hint="one or several — ready at any of them" initial={needs} items={statuses.map((one) => ({ id: one.code, name: one.code, detail: one.label }))} />
        </ActionForm>
      ) : <p className="text-xs text-slate-500">Every active document is already in this package.</p>,
    });
    if (total) items.push({
      key: "remove",
      label: "Take documents out",
      body: (
        <ActionForm action={removePackageMemberAction} submitLabel="Take the ticked documents out" size="sm" variant="secondary" hidden={{ packageId: pkg.id }}>
          <div className="-mx-5 border-y border-line sm:-mx-6">
            <RevisionChecklist name="documentId" rows={pkg.members.map((m) => ({ id: m.documentId, number: m.document.docNumber, rev: m.document.revisions[0]?.value ?? "—", status: m.document.revisions[0]?.statusCode ?? null, title: m.document.title }))} />
          </div>
          <Field label="Why" required hint="goes on the record"><input name="reason" required className={inputCls} /></Field>
          {pkg.membershipRule ? <p className="text-[11px] text-slate-500">A document the rule matches stays out until someone adds it back by hand.</p> : null}
        </ActionForm>
      ),
    });
    items.push({
      key: "rule",
      label: pkg.membershipRule ? "Change the rule" : "Fill it by a rule",
      body: (
        <ActionForm action={setPackageRuleAction} submitLabel={pkg.membershipRule ? "Save the rule" : "Set the rule"} size="sm" hidden={{ packageId: pkg.id }}>
          <p className="text-xs text-slate-500">Every document matching all you choose joins, new ones too, until the package is delivered. Clear every choice to fill it by hand only.</p>
          <RuleFields initial={parseFilter(pkg.membershipFilter)} />
        </ActionForm>
      ),
    });
  }

  return (
    <div className="space-y-4">
      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-col-reverse gap-3 px-5 pt-6 pb-4 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[12.5px] font-semibold tracking-tight text-slate-500">{pkg.identifier}</p>
            <h1 className="plate-name mt-1 min-w-0">{pkg.title ?? `Delivery to ${pkg.recipientName}`}</h1>
            <p className="plate-meta mt-2">
              To {pkg.recipientName} &middot; {total} document{total === 1 ? "" : "s"} at {needs.map((code, i) => <span key={code}>{i ? " or " : ""}<span className="font-mono font-semibold text-slate-700">{code}</span></span>)}<Info>{needs.map((code) => `${code} — ${statusMeaning.get(code) ?? code}`).join("\n")}</Info> by {fmtDate(pkg.completionDate)} &middot; {purpose}
            </p>
            {pkg.description ? <p className="mt-1.5 max-w-3xl text-[13px] leading-5 text-slate-600">{pkg.description}</p> : null}
            <p className="mt-1 max-w-3xl text-[11.5px] leading-4 text-slate-400">
              Put together by {pkg.compositionOwnerName} · accepted by {pkg.acceptanceAuthorityName}
              {pkg.membershipRule ? ` · fills itself with ${pkg.membershipRule}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 lg:justify-end">
            <Link href="/packages?category=DELIVERY" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /> Packages</Link>
            <Chip className={stateTone[state]}>{state}</Chip>
          </div>
        </div>
      </section>

      {overdue ? <Banner tone="danger" title="Past its date">It was due on {fmtDate(pkg.completionDate)}.</Banner> : null}

      <section className={cn("register register-sheet register-sheet-open relative", pkg.acceptedAt ? "rail-released" : pkg.closedAt ? "rail-review" : shortfall ? "rail-prep" : "rail-review")}>
        <span className="absolute inset-y-0 left-0 w-0.75 rounded-l-[0.875rem] bg-(--rail)" aria-hidden />
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil text-slate-600">{pkg.acceptedAt ? "Accepted" : pkg.closedAt ? "Delivered — to accept" : "Next step"}</span>
        </div>
        <NextStepBody
          items={items}
          status={<StagePath stages={["Compose", "Check", "Deliver", "Accept"]} at={pkg.acceptedAt ? 4 : pkg.closedAt ? 3 : pkg.assessedAt ? 2 : total ? 1 : 0} note={note} />}
        />
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="register register-sheet register-sheet-open">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
            <span className="stencil text-slate-600">Documents</span>
            <span className="text-[11px] text-slate-500">{readyCount} of {total} released at the status they need{pkg.membershipRule && !pkg.closedAt ? ` · ${pkg.membershipRule} joins by itself` : ""}</span>
          </div>
          {total ? (
            <ul className="divide-y divide-line">
              {pkg.members.map((m) => {
                const cur = m.document.revisions[0];
                const ok = meetsStatus(cur?.statusCode, m.requiredStatus);
                const why = shortfallFor.get(m.document.docNumber)?.reason;
                return (
                  <li key={m.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-5 py-2.5 sm:grid-cols-[minmax(0,19rem)_minmax(0,1fr)_8rem_auto] sm:px-6">
                    <Link href={`/documents/${m.documentId}`} className="doc-number truncate">{m.document.docNumber}</Link>
                    <span className="hidden truncate text-[12.5px] text-slate-500 sm:block">{m.document.title}{why && !ok ? <span className="block text-[11px] text-amber-700">{why}</span> : null}</span>
                    <span className="hidden text-xs text-slate-600 sm:block" title={statusMeaning.get(m.requiredStatus) ?? undefined}>{cur ? <>rev {cur.value} · {cur.statusCode}</> : "not released"} <span className="text-slate-400">/ {statusList(m.requiredStatus).join(" or ")}</span></span>
                    {ok ? <Chip className="bg-emerald-100 text-emerald-800 ring-emerald-300">ready</Chip> : <Chip className="bg-amber-100 text-amber-800 ring-amber-300">not ready</Chip>}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-5 py-6 text-center text-xs text-slate-400 sm:px-6">No documents yet. Add them from the next step above, or tick them in the document register.</p>
          )}
        </section>

        <Card title="Progress">
          <Timeline
            points={[
              { label: "Package opened", at: pkg.createdAt, holder: pkg.compositionOwnerName ?? null },
              { label: "Readiness checked", at: pkg.assessedAt, holder: pkg.assessedAt ? `${readyCount} of ${total} ready` : null },
              { label: "What is missing sent to the acceptor", at: pkg.shortfallIssuedAt, holder: pkg.acceptanceAuthorityName, skipped: !!pkg.assessedAt && !shortfall },
              { label: "What is missing accepted", at: pkg.shortfallAcceptedBy ? pkg.shortfallIssuedAt : null, holder: pkg.shortfallAcceptedBy ?? null, skipped: !!pkg.assessedAt && !shortfall },
              { label: sendsTo.length ? `Delivered to ${pkg.recipientName}` : "Closed", at: pkg.closedAt, holder: delivery.map((one) => one.number).join(", ") || (pkg.closedAt ? fmtDateTime(pkg.closedAt) : null) },
              { label: "Accepted", at: pkg.acceptedAt, holder: pkg.acceptedByName ?? pkg.acceptanceAuthorityName },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
