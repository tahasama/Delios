"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, Plus, Send, Undo2, X } from "lucide-react";
import { DataTable, Th, Td, ToneChip, type TONE } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { setPackageMembersAction } from "@/lib/packages/forms";

export type PackageLine = {
  id: string; number: string; title: string; rev: string | null;
  stage: { word: string; tone: keyof typeof TONE; holder: string; rail: string; pill: string };
  reason: string | null;
  /** Sent to the supplier on a transmittal: it stays in the package for good. */
  sent: string | null;
  /** When the supplier last sent it back. */
  returned: string | null; returnedLate: boolean;
  /** When it was released and issued. */
  issued: string | null;
  planned: string | null; plannedWord: string | null; plannedTone: string | null;
  /** The supplier holds it now: it can be asked back for an update. */
  withThem: boolean;
  /** Past its planned date and not in yet. */
  overdue: boolean;
  next: { label: string; href?: string; tone?: string };
  comments: { by: string; text: string; blocking: boolean; settled: boolean; rev: string }[];
};

/**
 * The documents of a supplier's package, ours to work on: tick lines, and the bar under the list sends them to the
 * supplier, asks them back for an update (each on a transmittal), or takes them out. "Add or take out" opens the
 * register for the package, as for an action: its documents ticked, tick to add, untick to take out.
 */
export function PackageLines({ packageId, packageNumber, supplier, shared, lines, pickHref, counts }: {
  packageId: string;
  packageNumber: string;
  supplier: string;
  shared: boolean;
  lines: PackageLine[];
  /** The register opened for this package: its documents ticked, tick to add, untick to take out. */
  pickHref: string;
  counts: string;
}) {
  const [ticked, setTicked] = useState<string[]>([]);
  const chosen = lines.filter((one) => ticked.includes(one.id));
  const toSend = chosen.filter((one) => !one.sent);
  const toAskBack = chosen.filter((one) => one.withThem);
  const sentChosen = chosen.filter((one) => !!one.sent);
  const all = lines.length > 0 && ticked.length === lines.length;
  const overdueNotSent = lines.filter((one) => one.overdue && !one.sent);
  const overdueWithThem = lines.filter((one) => one.overdue && one.withThem);
  const tick = (id: string) => setTicked((was) => (was.includes(id) ? was.filter((one) => one !== id) : [...was, id]));
  const day = (value: string | null) => (value ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)) : null);

  return (
    <>
      <section data-dt-frame className="register register-sheet">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil mr-1 text-slate-500">Documents</span>
          <span className="text-[11px] text-slate-500">{counts}</span>
          <Link href={pickHref} className="ask ml-auto inline-flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" /> Add or take out</Link>
        </div>

        {/* What is late, and the way to ask it: the overdue documents not sent yet are ticked in one go, then sent from
            the bar (each on a transmittal, once). Those already with the supplier are waiting on them. */}
        {overdueNotSent.length || overdueWithThem.length ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-red-200 bg-red-50 px-5 py-2.5 text-[12.5px] text-red-900 sm:px-6">
            <span className="font-semibold">Overdue:</span>
            {overdueNotSent.length ? <span>{overdueNotSent.length} not sent to {supplier} yet</span> : null}
            {overdueNotSent.length && overdueWithThem.length ? <span aria-hidden>·</span> : null}
            {overdueWithThem.length ? <span>{overdueWithThem.length} with {supplier}, not back</span> : null}
            {overdueNotSent.length ? (
              <button type="button" onClick={() => setTicked(overdueNotSent.map((one) => one.id))} className="ask ml-auto">
                Tick the {overdueNotSent.length} to send
              </button>
            ) : null}
          </div>
        ) : null}

        {lines.length ? (
          <DataTable className="rounded-none border-0 shadow-none" exportName="package" id="supplier-package-lines" defaultHidden={["Comments"]}
            head={<tr>
              <Th className="rail-head w-10"><input type="checkbox" aria-label="Tick every document" checked={all} onChange={() => setTicked(all ? [] : lines.map((one) => one.id))} /></Th>
              <Th>Document</Th><Th>Where it stands</Th><Th>Sent to supplier</Th><Th>Sent back</Th><Th>Released &amp; issued</Th><Th>Planned</Th><Th>Next</Th><Th>Comments</Th>
            </tr>}>
            {lines.map((one) => {
              const on = ticked.includes(one.id);
              return (
                <tr key={one.id} className={on ? "[&>td]:bg-tint" : undefined}>
                  <Td className={`rail ${one.stage.rail}`}><input type="checkbox" aria-label={`Tick ${one.number}`} checked={on} onChange={() => tick(one.id)} /></Td>
                  <Td>
                    <Link href={`/documents/${one.id}`} className="doc-number">{one.number}</Link>
                    {one.rev ? <span className="ml-1.5 font-mono text-xs text-slate-400">rev {one.rev}</span> : null}
                    <span className="block max-w-80 truncate text-xs text-slate-500">{one.title}</span>
                  </Td>
                  <Td className="text-xs">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ring-1 ${one.stage.pill}`}>{one.stage.word}</span>
                    {one.stage.holder ? <span className="mt-1 block text-[11px] text-slate-500">{one.stage.holder}</span> : null}
                    {one.reason ? <p className="mt-1 max-w-72 text-[11px] text-slate-600">&ldquo;{one.reason}&rdquo;</p> : null}
                  </Td>
                  <Td className="whitespace-nowrap text-xs">{day(one.sent) ?? <span className="text-slate-400">not yet</span>}</Td>
                  <Td className="whitespace-nowrap text-xs">{one.returned ? <span className={one.returnedLate ? "text-red-700" : undefined}>{day(one.returned)}{one.returnedLate ? " — late" : ""}</span> : <span className="text-slate-400">not yet</span>}</Td>
                  <Td className="whitespace-nowrap text-xs">{day(one.issued) ?? <span className="text-slate-400">not yet</span>}</Td>
                  <Td className="whitespace-nowrap text-xs">
                    {day(one.planned) ?? <span className="text-red-700">on no action</span>}
                    {one.plannedWord ? <span className={`block text-[11px] ${one.plannedTone ?? ""}`}>{one.plannedWord}</span> : null}
                  </Td>
                  <Td className="text-xs">
                    {one.next.href ? <Link href={one.next.href} className="font-semibold text-link hover:underline">{one.next.label}</Link> : <span className={one.next.tone ?? "text-slate-400"}>{one.next.label}</span>}
                  </Td>
                  <Td className="min-w-64 max-w-md text-xs text-slate-600">
                    {one.comments.length ? (
                      <ul className="space-y-1">
                        {one.comments.map((c, i) => (
                          <li key={i} className={c.blocking && !c.settled ? "text-red-700" : undefined}>
                            <span className="font-mono text-slate-400">rev {c.rev} · </span><span className="font-semibold">{c.by}</span>{c.blocking ? <span className="text-[10px] uppercase tracking-wide"> · blocking</span> : null}: {c.text}
                          </li>
                        ))}
                      </ul>
                    ) : <span className="text-slate-300">·</span>}
                  </Td>
                </tr>
              );
            })}
          </DataTable>
        ) : (
          <p className="px-5 py-8 text-center text-sm text-slate-400 sm:px-6">No documents from {supplier} yet. Add them with &ldquo;Add or take out&rdquo;, or register them with {supplier} as the supplier.</p>
        )}
      </section>

      {/* What can be done with the ticked documents. */}
      {chosen.length ? (
        <div className="dock palette-light sticky bottom-4 z-30 mx-auto flex w-fit max-w-full flex-wrap items-center gap-2 rounded-sm border border-white/10 bg-brand-strong p-2.5 text-white shadow-[0_8px_30px_rgb(0_0_0/0.18)]">
          <span className="px-2 font-mono text-sm tabular-nums">{chosen.length}<span className="ml-1.5 text-[10px] uppercase tracking-[0.12em] text-white/60">ticked</span></span>
          {toSend.length ? (
            shared
              ? <Link href={`/transmittals/new?placeholders=${encodeURIComponent(toSend.map((one) => one.id).join(","))}&pkg=${encodeURIComponent(packageNumber)}`} className="inline-flex items-center gap-1.5 rounded-sm bg-[#d9a441] px-3 py-2 text-xs font-semibold text-brand-ink"><Send className="h-4 w-4" /> Send to {supplier} ({toSend.length})</Link>
              : <span className="px-2 text-xs text-white/70">Share the package before sending anything to {supplier}.</span>
          ) : null}
          {toAskBack.length ? (
            <Link href={`/transmittals/new?askBack=${encodeURIComponent(toAskBack.map((one) => one.id).join(","))}&pkg=${encodeURIComponent(packageNumber)}`} className="inline-flex items-center gap-1.5 rounded-sm bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/15"><Undo2 className="h-4 w-4" /> Ask back for an update ({toAskBack.length})</Link>
          ) : null}
          {toSend.length ? (
            <ActionForm action={setPackageMembersAction} submitLabel={`Take out (${toSend.length})`} size="sm" variant="secondary" hidden={{ packageId }} className="space-y-0">
              {toSend.map((one) => <input key={one.id} type="hidden" name="remove" value={one.id} />)}
            </ActionForm>
          ) : null}
          {sentChosen.length ? (
            <span className="inline-flex items-center gap-1.5 px-2 text-xs text-white/70"><ArrowLeftRight className="h-3.5 w-3.5" /> You can&rsquo;t take out a document sent to {supplier}: once sent, it stays in the package.</span>
          ) : null}
          <button type="button" onClick={() => setTicked([])} className="ml-auto rounded-sm p-2 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Clear the ticks"><X className="h-4 w-4" /></button>
        </div>
      ) : null}
    </>
  );
}
