import Link from "next/link";
import { requireScope } from "@/lib/core/scope";
import { notFound } from "next/navigation";
import { Timeline } from "@/components/timeline";
import { Card, Info, ToneChip, type TONE, Field, inputCls, Banner } from "@/components/ui";
import { DeliveryLines } from "./delivery-lines";
import { ActionForm } from "@/components/form";
import { setPackageRuleAction, assessPackageAction, issueShortfallAction, closePackageAction, acceptShortfallAction, acceptPackageAction } from "@/lib/packages/forms";
import { ruleFilter, ruleWords, statusList, reasonsOf, shortfallOf } from "@/lib/packages/package-rule";
import { packageByNumber, ourPeople, packageParties } from "@/lib/packages/api";
import { documentPage } from "@/lib/documents/api";
import { isAdmin } from "@/lib/core/auth";
import { RuleFields } from "../rule-fields";
import { manageItems } from "../manage-items";
import { isController } from "@/lib/core/auth";
import { getActiveSet } from "@/lib/settings/config";
import { fmtDate, fmtDateTime, cn } from "@/lib/core/utils";
import { ArrowLeft } from "lucide-react";
import { SupplierPackage } from "./supplier-package";
import { isReadOnly } from "@/lib/core/auth";
import { NextStepBody, StagePath, type StepItem } from "@/app/(app)/documents/[id]/next-step";

export const dynamic = "force-dynamic";

/**
 * A delivery package: documents we hand to one organization, each at a status,
 * by a date. Composed, checked, then delivered on one transmittal — which closes
 * it. What is missing on the day goes to the acceptance authority first.
 */
export default async function PackageDetailPage({ params, searchParams }: { params: Promise<{ identifier: string }>; searchParams: Promise<{ added?: string }> }) {
  const ctx = await requireScope();
  const { user } = ctx;
  const { identifier } = await params;
  const sp = await searchParams;
  // A package with a rule takes in what has come to match it since last seen: the backend does so on reading it.
  const pkg = await packageByNumber(ctx, identifier);
  if (!pkg) notFound();
  if (pkg.kind === "SUPPLY") return <SupplierPackage pkg={pkg} />;
  const staff = isController(user) || isAdmin(user);
  const [statuses, reasons, people, parties] = await Promise.all([
    getActiveSet("STATUSES"),
    getActiveSet("REASONS_FOR_ISSUE"),
    ourPeople(ctx),
    packageParties(ctx),
  ]);
  // What delivered it carries documents; the words alone asked the acceptor about what was missing, and their answer.
  const delivery = pkg.transmittals.filter((one) => one.items > 0).map((one) => ({ id: one.id, number: one.number })).sort((a, b) => a.number.localeCompare(b.number));
  const letters = pkg.transmittals.filter((one) => one.items === 0);
  // Each document's latest revision and what its reviews said — the comments
  // column shows those, and nothing from older revisions.
  const latestRevs = (await Promise.all(pkg.members.map((m) => documentPage(ctx, m.documentId).catch(() => null))))
    .flatMap((doc) => (doc?.revisions[0] ? [{ documentId: doc.id, value: doc.revisions[0].value, cycles: doc.revisions[0].cycles }] : []));
  const latestComments = new Map<string, { rev: string; comments: { by: string; text: string; blocking: boolean; settled: boolean }[] }>();
  for (const one of latestRevs) {
    if (latestComments.has(one.documentId)) continue;
    latestComments.set(one.documentId, { rev: one.value, comments: one.cycles.flatMap((cy) => cy.comments.map((c) => ({ by: c.authorName, text: c.text, blocking: c.progressionPreventing, settled: c.status === "CLOSED" }))) });
  }
  const shortfall = shortfallOf(pkg);
  const isAcceptor = pkg.acceptorIds.includes(user.id);
  const rule = await ruleWords(pkg);
  const overdue = !!pkg.completionDate && new Date(pkg.completionDate) < new Date() && !pkg.closedAt;
  const total = pkg.members.length;
  const readyCount = pkg.members.filter((member) => member.ready).length;
  const sendsTo = pkg.recipientPartyIds;
  const needs = pkg.requiredStatuses;
  const statusName = new Map(statuses.map((x) => [x.code, x.label]));
  const statusMeaning = new Map(statuses.map((x) => [x.code, typeof x.props.may === "string" ? `${x.label}: ${x.props.may}` : x.label]));
  const spell = (codes: string) => statusList(codes).map((code) => `${code}${statusName.get(code) ? ` (${statusName.get(code)!.toLowerCase()})` : ""}`).join(" or ");
  const purpose = reasonsOf(pkg).map((code) => reasons.find((one) => one.code === code)?.label ?? code.toLowerCase()).join(", ");
  // Those putting it together add and take out its documents; Document Control (and above) does everything else.
  const open = user.isInternal && !isReadOnly(user) && !pkg.closedAt;
  const mayCompose = open && (staff || pkg.ownerIds.includes(user.id));
  const canAct = open && staff;
  const missing = new Set((shortfall ?? []).map((s) => s.documentId));
  const waitingAcceptance = !!shortfall && !!pkg.shortfallIssuedAt && !pkg.shortfallAcceptedBy;
  const mayDeliver = !!pkg.assessedAt && (!shortfall || !!pkg.shortfallAcceptedBy);

  const state = pkg.acceptedAt ? "accepted" : pkg.closedAt ? "delivered" : shortfall ? "shortfall" : pkg.assessedAt ? "ready" : overdue ? "overdue" : "open";
  const stateTone: Record<string, keyof typeof TONE> = { accepted: "done", delivered: "moving", ready: "done", shortfall: "waiting", overdue: "refused", open: "idle" };

  // How ready it is, in the schedule's colours: all there green, none red, anything between at risk.
  const readyTone = total && readyCount === total ? "text-emerald-700" : readyCount === 0 ? "text-red-700" : "text-amber-700";
  const count = <span className={readyTone}>{readyCount} of {total} ready</span>;
  const asked = letters.length ? <> (asked on {letters.map((one, i) => <span key={one.id}>{i ? ", " : ""}<Link href={`/transmittals/${one.id}`} className="font-mono font-semibold text-link hover:underline">{one.number}</Link></span>)})</> : null;
  const sentOn = delivery.length ? <> on {delivery.map((one, i) => <span key={one.id}>{i ? ", " : ""}<Link href={`/transmittals/${one.id}`} className="font-mono font-semibold text-link hover:underline">{one.number}</Link></span>)}</> : null;
  const note = pkg.acceptedAt
    ? <>Delivered {fmtDate(pkg.names.deliveredAt ?? pkg.closedAt!)}{sentOn}, accepted by <strong className="text-slate-800">{pkg.acceptedBy}</strong> {fmtDate(pkg.acceptedAt)}{pkg.acceptNote ? <>: <span className="whitespace-pre-line">{pkg.acceptNote}</span></> : "."}</>
    : pkg.closedAt
    ? <>Delivered {fmtDate(pkg.names.deliveredAt ?? pkg.closedAt)}{sentOn}. Waiting for <strong className="text-slate-800">{pkg.names.acceptors}</strong> to accept it.</>
    : waitingAcceptance ? <>{count}. Waiting for <strong className="text-slate-800">{pkg.names.acceptors}</strong> to say it may go without what is missing{asked}.</>
    : shortfall && !pkg.shortfallIssuedAt ? <>{count}. Ask <strong className="text-slate-800">{pkg.names.acceptors}</strong> whether it may go without what is missing.</>
    : mayDeliver ? <>{count}. Deliver it to <strong className="text-slate-800">{pkg.names.to}</strong>.</>
    : <>{count}. Get every document released at {spell(pkg.requiredStatuses.join(","))}, then check readiness.</>;

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
  if (waitingAcceptance && isAcceptor && !pkg.closedAt) items.push({
    key: "accept",
    primary: true,
    open: true,
    label: "Let it go without what is missing",
    body: (
      <ActionForm action={acceptShortfallAction} submitLabel="Confirm — deliver it as it stands" size="sm" hidden={{ packageId: pkg.id }}
        confirmText={`${pkg.names.to} receives it now, with ${shortfall?.length ?? 0} document(s) not at the status asked, on your responsibility. Go ahead?`}>
        <Banner tone="warn" title="On your responsibility">
          It is delivered at once to {pkg.names.to}: what is ready, and the {shortfall?.length ?? 0} not ready as they stand (their released revision, else their newest; one with no revision yet cannot go). The transmittal says so, with your name.
        </Banner>
        <Field label="Why it may go" hint="optional — it goes on your confirmation and the delivery"><input name="note" className={inputCls} /></Field>
      </ActionForm>
    ),
  });
  if (canAct) {
    if (!pkg.assessedAt) items.push({ key: "check", primary: total > 0, label: "Check readiness", body: <ActionForm action={assessPackageAction} submitLabel="Check readiness now" size="sm" hidden={{ packageId: pkg.id }}><p className="text-xs text-slate-500">Records which documents are released at the status the package needs, and what is missing.</p></ActionForm> });
    if (shortfall && !pkg.shortfallIssuedAt) items.push({ key: "shortfall", primary: true, label: "Send what is missing", body: <ActionForm action={issueShortfallAction} submitLabel={`Ask ${pkg.names.acceptors}`} size="sm" hidden={{ packageId: pkg.id }}><p className="text-xs text-slate-500">A transmittal asks {pkg.names.acceptors} whether the package may go without them, listing each one and where it stands; those putting it together are copied in. Their answer comes back the same way.</p></ActionForm> });
    if (mayDeliver) items.push({
      key: "deliver",
      primary: true,
      label: sendsTo.length ? `Deliver to ${pkg.names.to}` : "Close the package",
      body: (
        <ActionForm action={closePackageAction} submitLabel={sendsTo.length ? `Send ${readyCount} document${readyCount === 1 ? "" : "s"}` : "Close package"} size="sm" hidden={{ packageId: pkg.id }}>
          <p className="text-xs text-slate-500">
            {sendsTo.length
              ? `Every ready document goes out on one transmittal to each of ${pkg.names.to}, ${purpose.toLowerCase()}. Within our own organization it goes to ${pkg.names.acceptors}. Then ${pkg.names.acceptors} accepts the package.`
              : "This package names no organization, so nothing is sent: closing records that it was handed over."}
          </p>
          {pkg.rule ? <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" name="ruleCeased" /> No more documents will be added</label> : null}
          <Field label="Message" hint="optional — it goes on the transmittal"><input name="closureNote" className={inputCls} /></Field>
        </ActionForm>
      ),
    });
    items.push({
      key: "rule",
      label: rule ? "Change the rule" : "Fill it by a rule",
      body: (
        <ActionForm action={setPackageRuleAction} submitLabel={rule ? "Save the rule" : "Set the rule"} size="sm" hidden={{ packageId: pkg.id }}>
          <p className="text-xs text-slate-500">Every document matching all you choose joins, new ones too, until the package is delivered. Clear every choice to fill it by hand only.</p>
          <RuleFields initial={ruleFilter(pkg)} />
        </ActionForm>
      ),
    });
    items.push(...manageItems(pkg, { mayEdit: true, mayDelete: false, delivery: { statuses: statuses.map((one) => ({ code: one.code, label: one.label })), parties, people } }));
  }
  if (mayCompose) {
    // Only an empty package that never went out is deleted: it holds no content.
    items.push(...manageItems(pkg, { mayEdit: false, mayDelete: total === 0 && !pkg.transmittals.length }));
  }

  return (
    <div className="space-y-4">
      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-col-reverse gap-3 px-5 pt-6 pb-3 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[12.5px] font-semibold tracking-tight text-slate-500">{pkg.number}</p>
            <h1 className="plate-name mt-1 min-w-0">{pkg.title ?? `Delivery to ${pkg.names.to}`}</h1>
            <p className="plate-meta mt-2">
              To {pkg.names.to} &middot; {total} document{total === 1 ? "" : "s"} at {needs.map((code, i) => <span key={code}>{i ? " or " : ""}<span className="font-mono font-semibold text-slate-700">{code}</span></span>)}<Info>{needs.map((code) => `${code} — ${statusMeaning.get(code) ?? code}`).join("\n")}</Info> by {fmtDate(pkg.completionDate)} &middot; {purpose}
            </p>
            {pkg.description ? <p className="mt-1.5 max-w-3xl text-[13px] leading-5 text-slate-600">{pkg.description}</p> : null}
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
              Put together by {pkg.names.owners} · accepted by {pkg.names.acceptors}
              {rule ? ` · fills itself with ${rule}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 lg:justify-end">
            <Link href="/packages?category=DELIVERY" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /> Packages</Link>
            <ToneChip tone={stateTone[state] ?? "idle"}>{state}</ToneChip>
          </div>
        </div>
      </section>

      {overdue ? <Banner tone="danger" title="Past its date">It was due on {fmtDate(pkg.completionDate)}.</Banner> : null}

      <section className={cn("register register-sheet register-sheet-open relative", pkg.acceptedAt ? "rail-done" : pkg.closedAt ? "rail-delivered" : shortfall ? "rail-shortfall" : "rail-ahead")}>
        <span className="absolute inset-y-0 left-0 w-0.75 rounded-l-[0.875rem] bg-(--rail)" aria-hidden />
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil mr-1 text-slate-500">{pkg.acceptedAt ? "Accepted" : pkg.closedAt ? "Delivered — to accept" : "Next step"}</span>
        </div>
        <NextStepBody
          items={items}
          status={<StagePath stages={["Compose", "Check", "Deliver", "Accept"]} at={pkg.acceptedAt ? 4 : pkg.closedAt ? 3 : pkg.assessedAt ? 2 : total ? 1 : 0} note={note} />}
        />
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-4">
          <DeliveryLines
            packageId={pkg.id}
            packageNumber={pkg.number}
            mayTakeOut={mayCompose}
            pickHref={mayCompose ? `/documents?pick=${encodeURIComponent(`pkg:${pkg.number}`)}` : null}
            ruled={!!rule}
            counts={<><span className={readyTone}>{readyCount} of {total}</span> released at the status they need{rule && !pkg.closedAt ? ` · ${rule} joins by itself` : ""}</>}
            lines={pkg.members.map((m) => {
              const said = latestComments.get(m.documentId);
              return {
                id: m.documentId, number: m.documentNumber, title: m.title, revision: m.revision, status: m.status,
                required: m.required, requiredMeaning: statusMeaning.get(m.required.join(",")) ?? null, ready: m.ready, missing: missing.has(m.documentId),
                comments: (said?.comments ?? []).map((c) => ({ ...c, rev: said!.rev })),
              };
            })}
          />
        </div>

        <aside>
        <Card title="Progress">
          <Timeline
            points={[
              { label: "Package opened", at: pkg.names.createdAt, holder: pkg.names.owners },
              { label: "Readiness checked", at: pkg.assessedAt, holder: pkg.assessedAt ? `${readyCount} of ${total} ready` : null },
              { label: "Acceptor asked about what is missing", at: pkg.shortfallIssuedAt, holder: letters[0]?.number ?? pkg.names.acceptors, skipped: !!pkg.assessedAt && !shortfall },
              { label: "Goes without it, on their responsibility", at: pkg.shortfallAcceptedAt ?? null, holder: pkg.shortfallAcceptedBy ?? null, skipped: !!pkg.assessedAt && !shortfall },
              { label: sendsTo.length ? `Delivered to ${pkg.names.to}` : "Closed", at: pkg.closedAt, holder: delivery.map((one) => one.number).join(", ") || (pkg.closedAt ? fmtDateTime(pkg.closedAt) : null) },
              { label: "Accepted", at: pkg.acceptedAt, holder: pkg.acceptedBy ?? pkg.names.acceptors },
            ]}
          />
        </Card>
        </aside>
      </div>
    </div>
  );
}
