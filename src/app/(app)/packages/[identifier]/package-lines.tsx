"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, Minus, Plus, Search, Send, Undo2, X } from "lucide-react";
import { DataTable, Th, Td, ToneChip, type TONE } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { addPackageMemberAction, setPackageMembersAction } from "@/lib/actions/planning";

export type PackageLine = {
  id: string; number: string; title: string; rev: string | null;
  stage: { word: string; tone: keyof typeof TONE; holder: string };
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
  next: { label: string; href?: string; tone?: string };
  comments: { by: string; text: string; blocking: boolean; settled: boolean; rev: string }[];
};

export type Candidate = { id: string; number: string; title: string; where: string };

/**
 * The documents of a supplier's package, ours to work on: tick lines, and the bar under the list sends them to the
 * supplier, asks them back for an update (each on a transmittal), or takes them out. "Add documents" opens the
 * supplier's other documents here, in a short register, to tick and add.
 */
export function PackageLines({ packageId, packageNumber, supplier, shared, lines, candidates, counts }: {
  packageId: string;
  packageNumber: string;
  supplier: string;
  shared: boolean;
  lines: PackageLine[];
  candidates: Candidate[];
  counts: string;
}) {
  const [ticked, setTicked] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [find, setFind] = useState("");
  const [toAdd, setToAdd] = useState<string[]>([]);
  const chosen = lines.filter((one) => ticked.includes(one.id));
  const toSend = chosen.filter((one) => !one.sent);
  const toAskBack = chosen.filter((one) => one.withThem);
  const sentChosen = chosen.filter((one) => !!one.sent);
  const shown = useMemo(() => {
    const words = find.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return candidates.filter((one) => words.every((w) => `${one.number} ${one.title}`.toLowerCase().includes(w)));
  }, [candidates, find]);
  const all = lines.length > 0 && ticked.length === lines.length;
  const tick = (id: string) => setTicked((was) => (was.includes(id) ? was.filter((one) => one !== id) : [...was, id]));
  const day = (value: string | null) => (value ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)) : null);

  return (
    <>
      <section data-dt-frame className="register register-sheet">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil mr-1 text-slate-500">Documents</span>
          <span className="text-[11px] text-slate-500">{counts}</span>
          <button type="button" onClick={() => setAdding((was) => !was)} aria-expanded={adding} data-on={adding ? "true" : undefined} className="ask ml-auto inline-flex items-center gap-1.5">
            {adding ? <Minus className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} Add documents
          </button>
        </div>

        {/* The supplier's other documents, in a short register: search, tick, add. */}
        {adding ? (
          <div className="border-b border-line bg-tint-soft/50">
            <div className="asking flex items-center gap-2 border-b border-line px-5 py-2.5 sm:px-6">
              <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <label className="min-w-0 flex-1">
                <span className="sr-only">Find a document of {supplier}</span>
                <input value={find} onChange={(event) => setFind(event.target.value)} placeholder={`${supplier}'s documents not in this package — find by number or title`} className="plain w-full" />
              </label>
              <span className="font-mono text-[11px] tabular-nums text-slate-500">{shown.length} of {candidates.length}</span>
            </div>
            {candidates.length ? (
              <ul className="max-h-60 divide-y divide-line overflow-y-auto scroll-thin">
                {shown.map((one) => (
                  <li key={one.id}>
                    <label className="flex items-center gap-3 px-5 py-2 text-[12.5px] sm:px-6">
                      <input type="checkbox" checked={toAdd.includes(one.id)} onChange={() => setToAdd((was) => (was.includes(one.id) ? was.filter((id) => id !== one.id) : [...was, one.id]))} />
                      <span className="font-mono font-semibold text-slate-900">{one.number}</span>
                      <span className="min-w-0 flex-1 truncate text-slate-500">{one.title}</span>
                      <span className="text-[11px] text-slate-400">{one.where}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-4 text-xs text-slate-500 sm:px-6">Every document of {supplier} is in this package already.</p>
            )}
            {candidates.length ? (
              <div className="px-5 py-2.5 sm:px-6">
                <ActionForm action={addPackageMemberAction} submitLabel={toAdd.length ? `Add ${toAdd.length} to the package` : "Add to the package"} size="sm" hidden={{ packageId }} className="space-y-0">
                  {toAdd.map((id) => <input key={id} type="hidden" name="documentId" value={id} />)}
                </ActionForm>
              </div>
            ) : null}
          </div>
        ) : null}

        {lines.length ? (
          <DataTable className="rounded-none border-0 shadow-none" exportName="package" id="supplier-package-lines" defaultHidden={["Comments"]}
            head={<tr>
              <Th className="w-10"><input type="checkbox" aria-label="Tick every document" checked={all} onChange={() => setTicked(all ? [] : lines.map((one) => one.id))} /></Th>
              <Th>Document</Th><Th>Where it stands</Th><Th>Sent to supplier</Th><Th>Sent back</Th><Th>Released &amp; issued</Th><Th>Planned</Th><Th>Next</Th><Th>Comments</Th>
            </tr>}>
            {lines.map((one) => {
              const on = ticked.includes(one.id);
              return (
                <tr key={one.id} className={on ? "[&>td]:bg-tint" : undefined}>
                  <Td><input type="checkbox" aria-label={`Tick ${one.number}`} checked={on} onChange={() => tick(one.id)} /></Td>
                  <Td>
                    <Link href={`/documents/${one.id}`} className="doc-number">{one.number}</Link>
                    {one.rev ? <span className="ml-1.5 font-mono text-xs text-slate-400">rev {one.rev}</span> : null}
                    <span className="block max-w-80 truncate text-xs text-slate-500">{one.title}</span>
                  </Td>
                  <Td className="text-xs">
                    <ToneChip tone={one.stage.tone}>{one.stage.word}</ToneChip>
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
          <p className="px-5 py-8 text-center text-sm text-slate-400 sm:px-6">No documents from {supplier} yet. Add them with &ldquo;Add documents&rdquo;, or register them with {supplier} as the supplier.</p>
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
