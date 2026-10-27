import Link from "next/link";
import { requireScope } from "@/lib/core/scope";
import { isController, isAdmin, hasVerb, standsInForControl } from "@/lib/core/auth";
import { DataTable, Th, Td, Field, inputCls, ToneChip, Chip, btn } from "@/components/ui";
import { FileTally } from "./file-tally";
import { setPackageRuleAction, sharePackageAction, deletePackageAction, fillPackageAction } from "@/lib/packages/forms";
import { PackageLines, type PackageLine } from "./package-lines";
import { ruleFilter, ruleWords } from "@/lib/packages/package-rule";
import { RuleFields } from "../rule-fields";
import { manageItems } from "../manage-items";
import { ActionForm } from "@/components/form";
import { submitSupplierPackageAction, sendAsReceivedAction } from "@/lib/packages/forms-supplier";
import { AsReceivedWarning } from "@/components/as-received-warning";
import { supplierRows, supplierFigures, packageStage, packageCounts, lineStage, WITH_SUPPLIER, type SupplierRow } from "@/lib/packages/supplier";
import { fmtDate } from "@/lib/core/utils";
import { plannedState } from "@/lib/actions/planned-state";
import { ArrowLeft, Download, Filter, FolderInput, PackageCheck, Pencil, Send, Share2, Trash2 } from "lucide-react";
import { getMe } from "@/lib/account/api";
import type { PackageView } from "@/lib/types";
import { Branches, MovePackage, PackagePath, moveTargets } from "../arborescence";
import { packagesOf } from "@/lib/packages/api";

/** What the planned date says today, as on every planned date: ready, submitted, overdue, at risk, days left. */
function SubmitBy({ row }: { row: SupplierRow }) {
  const said = plannedState(row.due, row.state === "APPROVED" ? "released" : ["AWAITING_CHECK", "TO_ROUTE", "IN_REVIEW"].includes(row.state) ? "submitted" : "none");
  return (
    <>
      {fmtDate(row.due)}
      {said ? <span className={`block text-[11px] ${said.tone}`}>{said.word}</span> : null}
      {row.revision?.submittedAt ? <span className={`block text-[11px] ${row.arrivedOnTime ? "text-slate-500" : "text-red-700"}`}>sent {fmtDate(row.revision.submittedAt)}{row.arrivedOnTime ? "" : " — late"}</span> : null}
    </>
  );
}

function Comments({ row }: { row: SupplierRow }) {
  return row.comments.length ? (
    <ul className="space-y-1">
      {row.comments.map((one, i) => (
        <li key={i} className={one.blocking && !one.settled ? "text-red-700" : undefined}>
          <span className="font-mono text-slate-400">rev {one.rev} · </span><span className="font-semibold">{one.by}</span>{one.blocking ? <span className="text-[10px] uppercase tracking-wide"> · blocking</span> : null}: {one.text}
        </li>
      ))}
    </ul>
  ) : <span className="text-slate-300">·</span>;
}

/** One act of the package's row of buttons: a link, or a form that opens across the sheet under the row. */
function Act({ icon: Icon, label, href, primary, children }: { icon: typeof Send; label: string; href?: string; primary?: boolean; children?: React.ReactNode }) {
  if (href) return <Link href={href} className="ask inline-flex items-center gap-1.5"><Icon className="h-3.5 w-3.5" /> {label}</Link>;
  return (
    <details className="text-xs open:basis-full">
      <summary className="ask inline-flex w-fit cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden" data-on={primary ? "true" : undefined}>
        <Icon className="h-3.5 w-3.5" /> {label}
      </summary>
      <div className="mt-3 rounded-md bg-tint-soft px-3 py-3 ring-1 ring-line">{children}</div>
    </details>
  );
}

/**
 * One supplier's package. Two readers, two pages:
 *  - ours (the control function and above): whether it is shared, what is sent to the supplier, where each document
 *    stands and who holds it, and the acts on the package; nothing is uploaded here, the supplier sends its files;
 *  - the supplier's: only what was asked of it, in its own words, and a file field beside each document it holds.
 */
export async function SupplierPackage({ pkg }: { pkg: PackageView }) {
  const ctx = await requireScope();
  const { user } = ctx;
  const staff = isController(user) || isAdmin(user) || standsInForControl(user);
  const isSupplier = !user.isInternal && !!user.partyCode && user.partyCode === pkg.names.supplierCode;
  const rows = await supplierRows(ctx, pkg, true);
  const org = (await getMe())?.tenant.name ?? "us";
  const asked = new Set(pkg.members.filter((m) => m.requestedAt).map((m) => m.documentId));
  const listHref = `/api/packages/${encodeURIComponent(pkg.number)}/list`;
  const listLink = <a href={listHref} className="ask inline-flex items-center gap-1.5"><Download className="h-3.5 w-3.5" /> Delivery list</a>;
  // The packages it sits in, then its own number (the arborescence).
  const plateCode = <PackagePath pkg={pkg} />;

  // ── The supplier's page ──────────────────────────────────────────────────────
  if (isSupplier) {
    // Taking documents as they come: everything they sent is theirs to see; else only what was asked of them.
    const mine = pkg.asReceived ? rows : rows.filter((r) => asked.has(r.doc.id));
    const mayUpload = hasVerb(user, "CREATE") || hasVerb(user, "REVISE");
    const holds = mine.filter((r) => WITH_SUPPLIER.includes(r.state));
    const where = packageStage(pkg, rows, "theirs");
    const table = (
      <DataTable className="rounded-none border-0 shadow-none" exportName={pkg.number} id="supplier-package-theirs" head={<tr><Th>Document</Th><Th>Where it stands</Th><Th>Submit by</Th><Th>Released &amp; issued</Th><Th>Comments to take in</Th><Th>Your file</Th></tr>}>
        {mine.map((r) => {
          const stage = lineStage(r, true, "theirs");
          return (
            <tr key={r.doc.id}>
              <Td>
                <Link href={`/documents/${r.doc.id}`} className="doc-number">{r.doc.docNumber}</Link>
                {r.revision ? <span className="ml-1.5 font-mono text-xs text-slate-400">rev {r.revision.value}</span> : null}
                <span className="block max-w-80 truncate text-xs text-slate-500">{r.doc.title}</span>
              </Td>
              <Td className="text-xs">
                <Chip className={stage.pill}>{stage.word}</Chip>
                <span className="mt-1 block text-[11px] text-slate-500">{stage.holder}</span>
                {r.reason ? <p className="mt-1 max-w-72 text-[11px] text-slate-600">&ldquo;{r.reason}&rdquo;</p> : null}
              </Td>
              <Td className="whitespace-nowrap text-xs"><SubmitBy row={r} /></Td>
              <Td className="whitespace-nowrap text-xs">{r.issued ? fmtDate(r.issued) : <span className="text-slate-400">not yet</span>}</Td>
              <Td className="min-w-64 max-w-md text-xs text-slate-600"><Comments row={r} /></Td>
              <Td className="text-xs">
                {mayUpload && WITH_SUPPLIER.includes(r.state)
                  ? <input type="file" name={`file_${r.doc.id}`} className="block w-56" />
                  : <span className="text-slate-400">{stage.holder}</span>}
              </Td>
            </tr>
          );
        })}
      </DataTable>
    );
    return (
      <div className="space-y-4">
        <section className="register register-sheet register-sheet-open">
          <div className="flex flex-col-reverse gap-3 px-5 pt-6 pb-3 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              {plateCode}
              <h1 className="plate-name mt-1 min-w-0">What {org} expects from you</h1>
              <p className="plate-meta mt-2">{mine.length} document{mine.length === 1 ? "" : "s"}{pkg.completionDate ? <> &middot; everything by {fmtDate(pkg.completionDate)}</> : <> &middot; each by its own date</>}</p>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
                Attach the file next to each document you send, then press Send to {org}. {org} checks it, then accepts it for review or returns it with why.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {listLink}
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ring-1 ${where.tone}`}>{where.word}</span>
            </div>
          </div>
        </section>
        {/* The packages shared with it that sit in this one, drilled into from here. */}
        <Branches pkg={pkg} newHref={null} />
        <section data-dt-frame className="register register-sheet">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
            <span className="stencil mr-1 text-slate-500">Your documents</span>
            <span className="text-[11px] text-slate-500">{holds.length} with you · {mine.length - holds.length} with {org}</span>
          </div>
          {!mine.length ? (
            <p className="px-5 py-8 text-center text-sm text-slate-400 sm:px-6">Nothing is asked of you here yet. What {org} asks of you arrives on a transmittal and appears here.</p>
          ) : mayUpload && holds.length ? (
            <ActionForm action={submitSupplierPackageAction} hideSubmit hidden={{ packageId: pkg.id }} className="space-y-0">
              {table}
              {/* The sheet's own footer: what will go, and the one button, inside the sheet's margins. */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 sm:px-6">
                <FileTally waiting={holds.length} who="you" />
                <button type="submit" className={btn("primary", "md")}>Send to {org}</button>
              </div>
            </ActionForm>
          ) : table}
        </section>
        {pkg.asReceived && mayUpload ? (
          <section className="register register-sheet register-sheet-open">
            <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
              <span className="stencil mr-1 text-slate-500">Send a document as it is</span>
              <span className="text-[11px] text-slate-500">under your own number and revision: {org} checks it, then it is in their register as you sent it</span>
            </div>
            <ActionForm action={sendAsReceivedAction} submitLabel={`Send to ${org}`} size="sm" hidden={{ packageId: pkg.id }} className="px-5 py-4 sm:px-6">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Your number"><input name="reference" className={inputCls} /></Field>
                <Field label="Title" required><input name="title" required className={inputCls} /></Field>
                <Field label="Revision" hint="as you name it"><input name="revision" className={inputCls} /></Field>
                <Field label="Status" hint="your words, e.g. issued for approval"><input name="status" className={inputCls} /></Field>
                <Field label="Review outcome" hint="what your own review said, if any"><input name="outcome" className={inputCls} /></Field>
                <Field label="Files" required hint="the PDF and its native file"><input type="file" name="files" multiple required className="w-full" /></Field>
              </div>
            </ActionForm>
          </section>
        ) : null}
      </div>
    );
  }

  // ── Our page ─────────────────────────────────────────────────────────────────
  const f = supplierFigures(rows);

  const shared = pkg.sharedAt ? new Date(pkg.sharedAt) : null;
  const where = packageStage(pkg, rows, "ours");
  const notSent = rows.filter((r) => !asked.has(r.doc.id));
  // The same counts as the packages list: sent, received, who holds what was sent, late.
  const counts = packageCounts(pkg, rows);
  const { withThem, withUs } = counts;
  const excluded = pkg.excluded;
  // The rule a supplier package was made with only names the supplier; a narrowing rule is one with a filter behind it.
  const narrowed = await ruleWords(pkg);
  const supplierName = pkg.names.to;
  // Until it is shared, its name, number and rule may change, and it may be deleted (while none of its documents
  // was sent to the supplier). Once shared, all of that is fixed.
  const sentAny = pkg.members.some((m) => m.requestedAt) || pkg.transmittals.length > 0;
  const edit = !shared ? manageItems(pkg, { mayEdit: true, mayDelete: false }).find((one) => one.key === "edit") ?? null : null;
  // "Add or take out" opens the register, as for an action: on this supplier's documents, the package's ticked.
  const pickHref = `/documents?${new URLSearchParams({ pick: `pkg:${pkg.number}`, ...(pkg.names.supplierCode ? { supplier: pkg.names.supplierCode } : {}) })}`;
  const requestedAt = new Map(pkg.members.map((m) => [m.documentId, m.requestedAt] as const));
  const lines: PackageLine[] = rows.map((r) => {
    const isSent = asked.has(r.doc.id);
    const said = plannedState(r.due, r.state === "APPROVED" ? "released" : ["AWAITING_CHECK", "TO_ROUTE", "IN_REVIEW"].includes(r.state) ? "submitted" : "none");
    return {
      id: r.doc.id, number: r.doc.docNumber, title: r.doc.title, rev: r.revision?.value ?? null,
      stage: lineStage(r, isSent, "ours"), reason: r.reason,
      sent: requestedAt.get(r.doc.id) ?? null,
      returned: r.revision?.submittedAt ? r.revision.submittedAt.toISOString() : null, returnedLate: r.arrivedOnTime === false,
      issued: r.issued ? r.issued.toISOString() : null,
      planned: r.due ? r.due.toISOString() : null, plannedWord: said?.word ?? null, plannedTone: said?.tone ?? null,
      withThem: isSent && WITH_SUPPLIER.includes(r.state),
      overdue: !!said?.word.startsWith("overdue"),
      next: !isSent ? { label: `send it to ${supplierName}` }
        : r.state === "AWAITING_CHECK" && r.transmittal ? { label: `Check ${r.transmittal.number}`, href: `/transmittals/${r.transmittal.id}` }
        : r.state === "TO_ROUTE" ? { label: "Send for review", href: `/documents/${r.doc.id}#workflow` }
        : r.state === "APPROVED" ? { label: `released${r.revision?.statusCode ? ` at ${r.revision.statusCode}` : ""}`, tone: "text-emerald-700" }
        : WITH_SUPPLIER.includes(r.state) ? { label: `waiting on ${supplierName}` }
        : { label: "in review" },
      comments: r.comments.map((c) => ({ by: c.by, text: c.text, blocking: c.blocking, settled: c.settled, rev: c.rev })),
    };
  });

  return (
    <div className="space-y-4">
      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-col-reverse gap-3 px-5 pt-6 pb-3 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            {plateCode}
            <h1 className="plate-name mt-1 min-w-0">{pkg.title ?? `From ${supplierName}`}</h1>
            <p className="plate-meta mt-2">
              {supplierName}{pkg.purchaseOrder ? ` · order ${pkg.purchaseOrder}` : ""} &middot; {f.planned} document{f.planned === 1 ? "" : "s"} {pkg.completionDate ? <> &middot; everything by {fmtDate(pkg.completionDate)}</> : <> &middot; each by its own planned date</>}{pkg.requiredStatuses.length ? <> &middot; needed at <span className="font-mono font-semibold text-slate-700">{pkg.requiredStatuses.join(",")}</span></> : null}
            </p>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
              Every document from {supplierName}{narrowed ? ` ${narrowed.replace(/^every document /, "")}` : ""} is filed here{excluded.length ? `, less ${excluded.length} taken out` : ""}. A document reaches {supplierName} only when it is sent on a transmittal; {supplierName} sends its files back from its side of this package.
            </p>
            {pkg.description ? <p className="mt-1.5 max-w-3xl text-[13px] leading-5 text-slate-600">{pkg.description}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {staff ? <Link href="/packages" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /> Packages</Link> : null}
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ring-1 ${where.tone}`}>{where.word}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 border-t border-line sm:grid-cols-4">
          {/* Every document is in exactly one of these: they add up to the package. */}
          <Figure label="Not sent yet" value={`${counts.notSent} of ${counts.total}`} hint={counts.lateNotSent ? `${counts.lateNotSent} overdue, ours to send` : "ours to send to the supplier"} />
          <Figure label="With the supplier" value={`${counts.withThem} of ${counts.total}`} hint={counts.lateWithThem ? `${counts.lateWithThem} overdue` : "to send, correct or revise"} />
          <Figure label="With us" value={`${counts.withUs} of ${counts.total}`} hint={counts.toCheck ? `${counts.toCheck} to check, the rest in review` : "to send for review, or in review"} />
          <Figure label="Released" value={`${counts.released} of ${counts.total}`} hint={`${f.firstTime}% released first time`} />
        </div>
      </section>

      {/* The arborescence: its packages, a new one in it, and where it sits (moved until it is shared). */}
      <Branches pkg={pkg} newHref={staff ? `/packages?category=SUPPLIER&parent=${encodeURIComponent(pkg.number)}#new` : null} />
      {staff && !pkg.sharedAt ? <MovePackage pkg={pkg} targets={moveTargets(pkg, await packagesOf(ctx, "SUPPLY"))} /> : null}

      {staff ? (
        <section id="package" className="register register-sheet register-sheet-open">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
            <span className="stencil mr-1 text-slate-500">The package</span>
            <span className="text-[11px] text-slate-500">
              {shared ? `shared with ${supplierName} ${fmtDate(shared)}${pkg.sharedBy ? ` by ${pkg.sharedBy}` : ""}` : `not shared: ${supplierName} does not see it yet`}
            </span>
          </div>
          <div className="space-y-3 px-5 py-4 sm:px-6">
            {pkg.asReceived ? (
              <div className="space-y-1.5">
                <AsReceivedWarning who={supplierName} />
                <p className="text-[11px] text-slate-500">
                  This project takes other organizations&rsquo; documents as they come (the Control room), filed under{" "}
                  <span className="font-mono">{pkg.asReceived.deliverableType} / {pkg.asReceived.docType} / {pkg.asReceived.discipline}</span>.
                </p>
              </div>
            ) : null}
            {/* Who of the supplier sees it: its people on this project. Nobody there, nobody sees it, shared or not. */}
            {pkg.supplierPeople && !pkg.supplierPeople.length ? (
              <p className="rounded-md bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-900 ring-1 ring-red-200">
                <strong className="font-semibold">Nobody from {supplierName} is on this project</strong>, so nobody of theirs can see this package, shared or not. Add their people on <Link href="/settings/users" className="font-semibold underline">People &amp; access</Link>.
              </p>
            ) : pkg.supplierPeople?.length ? (
              <p className="text-xs leading-5 text-slate-600">{shared ? "Seen" : "Will be seen"} by {supplierName}&rsquo;s people on this project: {pkg.supplierPeople.join(", ")}.</p>
            ) : null}
            {!shared ? (
              <div className="space-y-1 rounded-md bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900 ring-1 ring-amber-200">
                <p>Sharing can&rsquo;t be undone: once you share this package, {supplierName} can always see it, and you can no longer rename it, change its rule or delete it.</p>
                <p>Share it before you send {supplierName} any document: this package is where they find what you ask of them.</p>
              </div>
            ) : notSent.length ? (
              <p className="text-xs leading-5 text-slate-600">
                <strong className="font-semibold text-slate-800">{notSent.length} document{notSent.length === 1 ? " is" : "s are"} not sent to {supplierName} yet.</strong> Tick them in the list below and send them from the bar: each is sent once, on a transmittal.
              </p>
            ) : null}
            <div className="flex flex-wrap items-start gap-2">
              {!shared ? (
                <Act icon={Share2} label={`Share with ${supplierName}`} primary>
                  <ActionForm action={sharePackageAction} submitLabel={`Share with ${supplierName}`} size="sm" hidden={{ packageId: pkg.id }} confirmText={`Once shared, ${supplierName} sees this package for good. Continue?`}>
                    <p className="text-xs leading-5 text-slate-600">Once shared, {supplierName} sees this package for good, with only the documents sent to them on a transmittal. You can no longer rename it, change its rule or delete it.</p>
                  </ActionForm>
                </Act>
              ) : null}
              {pkg.state === "OPEN" ? (
                <Act icon={FolderInput} label="Fill the package">
                  <ActionForm action={fillPackageAction} submitLabel="Fill the package" size="sm" hidden={{ packageId: pkg.id }}>
                    <p className="text-xs leading-5 text-slate-600">Files every document of {supplierName} that is in none of its packages yet, each where a new one would go: the package for its order first. Nothing is filed by itself until you do.</p>
                  </ActionForm>
                </Act>
              ) : null}
              {!shared ? (
                <Act icon={Filter} label={narrowed ? "Change the rule" : "Narrow by a rule"}>
                  <ActionForm action={setPackageRuleAction} submitLabel="Save the rule" size="sm" hidden={{ packageId: pkg.id }}>
                    <p className="text-xs text-slate-500">Only documents from {supplierName} that match all you choose stay in the package. New ones that match join by themselves. Clear every choice to take everything from them again. Possible until the package is shared.</p>
                    <RuleFields supplier initial={ruleFilter(pkg)} />
                  </ActionForm>
                </Act>
              ) : null}
              {edit ? <Act icon={Pencil} label={typeof edit.label === "string" ? edit.label : "Edit"}>{edit.body}</Act> : null}
              {!shared && !sentAny ? (
                <Act icon={Trash2} label="Delete the package">
                  <ActionForm action={deletePackageAction} submitLabel="Delete the package" size="sm" variant="danger" hidden={{ packageId: pkg.id }} confirmText="The package is deleted. Its documents stay in the register. Continue?">
                    <p className="text-xs leading-5 text-slate-600">
                      Its documents stay in the register{rows.length ? ` (${rows.length})` : ""} and are filed again: into another package of {supplierName} when there is one, else into one made by itself. Its number is not given out again.
                    </p>
                    <Field label="Why" required hint="goes on the record"><input name="reason" required className={inputCls} /></Field>
                  </ActionForm>
                </Act>
              ) : null}
              {listLink}
              {/* Delivered once complete, to whom we choose then (owner): a data transmittal carrying the package and every
                  package in it, each document at its released revision, nothing added or taken out. Not complete, it says so. */}
              {rows.length ? (() => {
                const whole = pkg.place?.whole ?? { documents: pkg.members.length, released: pkg.members.filter((m) => m.revision).length };
                return whole.documents > 0 && whole.released === whole.documents ? (
                  <Link href={`/transmittals/new?${new URLSearchParams({ package: pkg.number })}`}
                    className="ask inline-flex items-center gap-1.5"><PackageCheck className="h-3.5 w-3.5" /> Deliver</Link>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500" title="A supplier's package is delivered once every document in it is released">
                    <PackageCheck className="h-3.5 w-3.5" /> Deliver once complete · {whole.released} of {whole.documents} released
                  </span>
                );
              })() : null}
            </div>
            {shared ? <p className="text-[11px] text-slate-500">Shared: it can no longer be renamed, have its rule changed or be deleted.</p> : null}
          </div>
        </section>
      ) : null}

      <PackageLines
        packageId={pkg.id}
        packageNumber={pkg.number}
        supplier={supplierName}
        shared={!!shared}
        lines={lines}
        pickHref={pickHref}
        counts={`${withThem} with ${supplierName} · ${withUs} with us${notSent.length ? ` · ${notSent.length} not sent to them yet` : ""}`}
      />
    </div>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="border-line px-5 py-3 not-last:border-r sm:px-6">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
      <p className="text-[11px] text-slate-500">{hint}</p>
    </div>
  );
}
