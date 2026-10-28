import Link from "next/link";
import { requireScope } from "@/lib/core/scope";
import { notFound } from "next/navigation";
import { Timeline } from "@/components/timeline";
import { Card, Info, ToneChip, type TONE, Field, inputCls, Banner, btn } from "@/components/ui";
import { DeliveryLines } from "./delivery-lines";
import { ActionForm } from "@/components/form";
import { setPackageRuleAction, assessPackageAction, issueShortfallAction, closePackageAction, acceptShortfallAction, acceptPackageAction } from "@/lib/packages/forms";
import { ruleFilter, ruleWords, statusList, reasonsOf, shortfallOf } from "@/lib/packages/package-rule";
import { packageByNumber, ourPeople, packageParties, packageLines } from "@/lib/packages/api";
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
import { Branches, MovePackage, PackagePath, moveTargets } from "../arborescence";
import { packagesOf } from "@/lib/packages/api";

export const dynamic = "force-dynamic";

/**
 * A package of ours: our documents filed together, each at a status, by a date. Composed, checked, then delivered on a
 * transmittal to whom whoever delivers it chooses then (owner) — which fixes it. What is missing on the day goes to the
 * acceptance authority first. Read by an organization it was delivered to as we read it, with nothing to change; a
 * supplier's package delivered to them reads the same way.
 */
export default async function PackageDetailPage({ params, searchParams }: { params: Promise<{ identifier: string }>; searchParams: Promise<{ added?: string }> }) {
  const ctx = await requireScope();
  const { user } = ctx;
  const { identifier } = await params;
  const sp = await searchParams;
  // A package with a rule takes in what has come to match it since last seen: the backend does so on reading it.
  const pkg = await packageByNumber(ctx, identifier);
  if (!pkg) notFound();
  const theirs = !!pkg.deliveredToUs;
  if (pkg.kind === "SUPPLY" && !theirs) return <SupplierPackage pkg={pkg} />;
  // With no control function, those putting it together do everything on it (backend StandIns).
  const staff = isController(user) || isAdmin(user) || (!!user.noControl && user.isInternal && pkg.ownerIds.includes(user.id));
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
  // Every line read at once (it was document by document: three calls or more each).
  const latestComments = new Map((await packageLines(ctx, pkg.id).catch(() => []))
    .filter((one) => one.revision)
    .map((one) => [one.documentId, { rev: one.revision!, comments: one.comments.map((c) => ({ by: c.by, text: c.text, blocking: c.blocking, settled: c.settled })) }] as const));
  const shortfall = shortfallOf(pkg);
  const isAcceptor = pkg.acceptorIds.includes(user.id);
  const rule = await ruleWords(pkg);
  const overdue = !!pkg.completionDate && new Date(pkg.completionDate) < new Date() && !pkg.closedAt;
  const total = pkg.members.length;
  const readyCount = pkg.members.filter((member) => member.ready).length;
  const needs = pkg.requiredStatuses;
  const statusName = new Map(statuses.map((x) => [x.code, x.label]));
  const statusMeaning = new Map(statuses.map((x) => [x.code, typeof x.props.may === "string" ? `${x.label}: ${x.props.may}` : x.label]));
  const spell = (codes: string) => statusList(codes).map((code) => `${code}${statusName.get(code) ? ` (${statusName.get(code)!.toLowerCase()})` : ""}`).join(" or ");
  const purpose = reasonsOf(pkg).map((code) => reasons.find((one) => one.code === code)?.label ?? code.toLowerCase()).join(", ");
  // Those putting it together add and take out its documents; the control function (and above) does everything else.
  const open = user.isInternal && !isReadOnly(user) && !pkg.closedAt;
  const mayCompose = open && (staff || pkg.ownerIds.includes(user.id));
  const canAct = open && staff;
  const branchCount = pkg.place?.whole.packages ?? 0;
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
    ? <>{delivery.length ? "Delivered" : "Closed"} {fmtDate(pkg.names.deliveredAt ?? pkg.closedAt!)}{sentOn}, accepted by <strong className="text-slate-800">{pkg.acceptedBy}</strong> {fmtDate(pkg.acceptedAt)}{pkg.acceptNote ? <>: <span className="whitespace-pre-line">{pkg.acceptNote}</span></> : "."}</>
    : pkg.closedAt
    ? <>{delivery.length ? <>Delivered to {pkg.names.to}</> : "Closed"} {fmtDate(pkg.names.deliveredAt ?? pkg.closedAt)}{sentOn}. Waiting for <strong className="text-slate-800">{pkg.names.acceptors}</strong> to accept it.</>
    : waitingAcceptance ? <>{count}. Waiting for <strong className="text-slate-800">{pkg.names.acceptors}</strong> to say it may go without what is missing{asked}.</>
    : shortfall && !pkg.shortfallIssuedAt ? <>{count}. Ask <strong className="text-slate-800">{pkg.names.acceptors}</strong> whether it may go without what is missing.</>
    : mayDeliver ? <>{count}. Deliver it on a transmittal, to whom you choose.</>
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
      <ActionForm action={acceptShortfallAction} submitLabel="Confirm — it may go as it stands" size="sm" hidden={{ packageId: pkg.id }}
        confirmText={`It may go with ${shortfall?.length ?? 0} document(s) not at the status asked, on your responsibility. Go ahead?`}>
        <Banner tone="warn" title="On your responsibility">
          It may then be delivered: what is ready, and the {shortfall?.length ?? 0} not ready as they stand (their released revision, else their newest; one with no revision yet cannot go). The delivery transmittal says so, with your name.
        </Banner>
        <Field label="Why it may go" hint="optional — it goes on your confirmation"><input name="note" className={inputCls} /></Field>
      </ActionForm>
    ),
  });
  if (canAct) {
    // "Deliver the package" is always there while it is open (owner: "there is no deliver button"): ready, it opens the
    // delivery transmittal (its documents fixed there, whom it goes to chosen there: owner, "recorded as transmittal so
    // we can decide at the end to whom"); not yet, it holds the step it waits on.
    items.push({
      key: "deliver",
      primary: true,
      open: mayDeliver,
      label: "Deliver the package",
      body: mayDeliver ? (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">
            {`A data transmittal carries what is ready (${readyCount})${branchCount ? `, and what the ${branchCount} package${branchCount === 1 ? "" : "s"} in it hold` : ""}, ${purpose.toLowerCase()}, as it stands: nothing added or taken out. You choose who receives it there. Sent, the package is delivered and its contents fixed${pkg.rule ? ": nothing more joins by its rule" : ""}; they read it as you do and change nothing; then ${pkg.names.acceptors} accepts it.`}
          </p>
          <Link href={`/transmittals/new?${new URLSearchParams({ package: pkg.number })}`} className={btn("primary", "sm")}>Write the transmittal</Link>
        </div>
      ) : !pkg.assessedAt ? (
        <ActionForm action={assessPackageAction} submitLabel="Check readiness now" size="sm" hidden={{ packageId: pkg.id }}>
          <p className="text-xs text-slate-500">First, its readiness is checked: which documents are released at the status it needs ({spell(pkg.requiredStatuses.join(",")) || "any status"}), and what is missing. Once all is ready (or what is missing let go), you deliver it from here.</p>
        </ActionForm>
      ) : shortfall && !pkg.shortfallIssuedAt ? (
        <ActionForm action={issueShortfallAction} submitLabel={`Ask ${pkg.names.acceptors}`} size="sm" hidden={{ packageId: pkg.id }}>
          <p className="text-xs text-slate-500">{shortfall.length} document{shortfall.length === 1 ? " is" : "s are"} not ready. A transmittal asks {pkg.names.acceptors} whether it may go without them, listing each one and where it stands; those putting it together are copied in. Or wait until they are released, and check readiness again.</p>
        </ActionForm>
      ) : (
        <p className="text-xs text-slate-500">Waiting for {pkg.names.acceptors} to say it may go without what is missing{asked}.</p>
      ),
    });
    if (mayDeliver) items.push({
      key: "close",
      label: "Close it, handed over outside the system",
      body: (
        <ActionForm action={closePackageAction} submitLabel="Close package" size="sm" hidden={{ packageId: pkg.id }}>
          <p className="text-xs text-slate-500">Nothing is sent: closing records that it was handed over another way, and fixes its contents.</p>
          {pkg.rule ? <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" name="ruleCeased" /> No more documents will be added</label> : null}
          <Field label="Note" hint="optional"><input name="closureNote" className={inputCls} /></Field>
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
  // Delivered, it may go again, as it stands, to someone else (owner: "we reserve the right to deliver to whom we want").
  if (staff && user.isInternal && !isReadOnly(user) && delivery.length) items.push({
    key: "again",
    label: "Deliver it to someone else",
    body: (
      <div className="space-y-2">
        <p className="text-xs text-slate-500">The same documents, at the same revisions, on a new transmittal to whom you choose.</p>
        <Link href={`/transmittals/new?${new URLSearchParams({ package: pkg.number })}`} className="ask">Write the transmittal</Link>
      </div>
    ),
  });
  if (mayCompose) {
    // Only an empty package that never went out is deleted: it holds no content.
    // Any package never delivered to anyone (owner: "even if it is filled, with a warning"): its documents stay in the
    // register, or go back up into the package it sat in.
    items.push(...manageItems(pkg, { mayEdit: false, mayDelete: !pkg.transmittals.some((one) => one.items > 0),
      back: pkg.place?.path.at(-1)?.number }));
  }

  // The arborescence: a package in it is opened here by whoever may put packages together; moved by the control function.
  const newInside = open && !pkg.closedAt ? `/packages?category=DELIVERY&parent=${encodeURIComponent(pkg.number)}#new` : null;
  const targets = canAct ? moveTargets(pkg, await packagesOf(ctx, "DELIVERY")) : null;

  return (
    <div className="space-y-4">
      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-col-reverse gap-3 px-5 pt-6 pb-3 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <PackagePath pkg={pkg} />
            <h1 className="plate-name mt-1 min-w-0">{pkg.title ?? `Delivery to ${pkg.names.to}`}</h1>
            <p className="plate-meta mt-2">
              {theirs ? <>From {pkg.kind === "SUPPLY" ? `our package with ${pkg.supplier ?? "a supplier"}` : "us"}</> : delivery.length ? <>To {pkg.names.to}</> : "Not delivered yet"} &middot; {total} document{total === 1 ? "" : "s"}{needs.length ? " at " : ""}{needs.map((code, i) => <span key={code}>{i ? " or " : ""}<span className="font-mono font-semibold text-slate-700">{code}</span></span>)}{needs.length ? <Info>{needs.map((code) => `${code} — ${statusMeaning.get(code) ?? code}`).join("\n")}</Info> : null}{pkg.completionDate ? <> by {fmtDate(pkg.completionDate)}</> : null} &middot; {purpose}
            </p>
            {pkg.description ? <p className="mt-1.5 max-w-3xl text-[13px] leading-5 text-slate-600">{pkg.description}</p> : null}
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
              Put together by {pkg.names.owners}{pkg.names.acceptors ? ` · accepted by ${pkg.names.acceptors}` : ""}
              {rule ? ` · fills itself with ${rule}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 lg:justify-end">
            <Link href="/packages?category=DELIVERY" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /> Packages</Link>
            <ToneChip tone={stateTone[state] ?? "idle"}>{state}</ToneChip>
          </div>
        </div>
      </section>

      {overdue && !theirs ? <Banner tone="danger" title="Past its date">It was due on {fmtDate(pkg.completionDate)}.</Banner> : null}

      {/* Delivered to them: read as we read it, nothing to change; they ask by words alone (owner). */}
      {theirs ? (
        <section className="register register-sheet register-sheet-open">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
            <span className="stencil mr-1 text-slate-500">Delivered to you</span>
            <span className="text-[11px] text-slate-500">read only: the package, its tree and its lines as its sender reads them</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
            <p className="text-xs leading-5 text-slate-600">
              {delivery.length ? <>Sent{sentOn}. </> : null}Nothing in it is changed or returned from here: ask what you need on an information transmittal.
            </p>
            {delivery[0] ? <Link href={`/transmittals/new?${new URLSearchParams({ follows: delivery[0].id })}`} className="ask">Ask about it</Link> : null}
          </div>
        </section>
      ) : null}

      {/* Its next step: where a request transmittal's decision lands (`#decide-shortfall`, Asks). */}
      {theirs ? null : <section id="decide-shortfall" className="register register-sheet register-sheet-open scroll-mt-24">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil mr-1 text-slate-500">{pkg.acceptedAt ? "Accepted" : pkg.closedAt ? "Delivered — to accept" : "Next step"}</span>
        </div>
        <NextStepBody
          items={items}
          status={<StagePath stages={["Compose", "Check", "Deliver", "Accept"]} at={pkg.acceptedAt ? 4 : pkg.closedAt ? 3 : pkg.assessedAt ? 2 : total ? 1 : 0} note={note} />}
        />
      </section>}

      <Branches pkg={pkg} newHref={newInside} manage={canAct} />
      {targets ? <MovePackage pkg={pkg} targets={targets} /> : null}

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
            points={theirs ? [
              { label: "Package opened", at: pkg.names.createdAt, holder: pkg.names.owners },
              { label: "Delivered to you", at: pkg.transmittals.find((one) => one.items > 0)?.issuedAt ?? null, holder: delivery.map((one) => one.number).join(", ") || null },
            ] : [
              { label: "Package opened", at: pkg.names.createdAt, holder: pkg.names.owners },
              { label: "Readiness checked", at: pkg.assessedAt, holder: pkg.assessedAt ? `${readyCount} of ${total} ready` : null },
              { label: "Acceptor asked about what is missing", at: pkg.shortfallIssuedAt, holder: letters[0]?.number ?? pkg.names.acceptors, skipped: !!pkg.assessedAt && !shortfall },
              { label: "Goes without it, on their responsibility", at: pkg.shortfallAcceptedAt ?? null, holder: pkg.shortfallAcceptedBy ?? null, skipped: !!pkg.assessedAt && !shortfall },
              { label: delivery.length ? `Delivered to ${pkg.names.to}` : pkg.closedAt ? "Closed" : "Delivered", at: pkg.closedAt, holder: delivery.map((one) => one.number).join(", ") || (pkg.closedAt ? fmtDateTime(pkg.closedAt) : null) },
              { label: "Accepted", at: pkg.acceptedAt, holder: pkg.acceptedBy ?? pkg.names.acceptors },
            ]}
          />
        </Card>
        </aside>
      </div>
    </div>
  );
}
