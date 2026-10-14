"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, X } from "lucide-react";
import { DataTable, Th, Td, ToneChip } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { removePackageMemberAction } from "@/lib/packages/forms";

export type DeliveryLine = {
  id: string; number: string; title: string; revision: string | null; status: string | null;
  required: string[]; requiredMeaning: string | null; ready: boolean; missing: boolean;
  comments: { by: string; text: string; blocking: boolean; settled: boolean; rev: string }[];
};

/**
 * The documents of a delivery package. Whoever may change what is in it ticks lines, and the bar under the list takes
 * them out; a document the rule matches stays out until added back by hand.
 */
export function DeliveryLines({ packageId, packageNumber, lines, mayTakeOut, ruled, counts, pickHref }: {
  packageId: string;
  packageNumber: string;
  lines: DeliveryLine[];
  mayTakeOut: boolean;
  ruled: boolean;
  counts: React.ReactNode;
  /** The register opened for this package, as for an action: its documents ticked, tick to add, untick to take out. */
  pickHref: string | null;
}) {
  const [picked, setTicked] = useState<string[]>([]);
  // Taken out, a line leaves the list and its tick with it.
  const ticked = picked.filter((id) => lines.some((one) => one.id === id));
  const all = lines.length > 0 && ticked.length === lines.length;
  const tick = (id: string) => setTicked((was) => (was.includes(id) ? was.filter((one) => one !== id) : [...was, id]));

  return (
    <>
      <section data-dt-frame className="register register-sheet">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil mr-1 text-slate-500">Documents</span>
          <span className="text-[11px] text-slate-500">{counts}</span>
          {pickHref ? <Link href={pickHref} className="ask ml-auto inline-flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" /> Add or take out</Link> : null}
        </div>
        {lines.length ? (
          <DataTable className="rounded-none border-0 shadow-none" id="delivery-package" exportName={packageNumber} defaultHidden={["Comments"]}
            head={<tr>
              {mayTakeOut ? <Th className="w-10"><input type="checkbox" aria-label="Tick every document" checked={all} onChange={() => setTicked(all ? [] : lines.map((one) => one.id))} /></Th> : null}
              <Th>Document</Th><Th>Title</Th><Th>Has</Th><Th>Needs</Th><Th>Ready</Th><Th>Comments</Th>
            </tr>}>
            {lines.map((m) => {
              const on = ticked.includes(m.id);
              return (
                <tr key={m.id} className={on ? "[&>td]:bg-tint" : undefined}>
                  {mayTakeOut ? <Td><input type="checkbox" aria-label={`Tick ${m.number}`} checked={on} onChange={() => tick(m.id)} /></Td> : null}
                  <Td><Link href={`/documents/${m.id}`} className="doc-number">{m.number}</Link></Td>
                  <Td className="max-w-72 text-[12.5px] text-slate-500">{m.title}{m.missing && !m.ready ? <span className="block text-[11px] text-amber-700">not yet at required status</span> : null}</Td>
                  <Td className="whitespace-nowrap text-xs text-slate-600">{m.revision ? <>rev {m.revision} · {m.status}</> : "not released"}</Td>
                  <Td className="whitespace-nowrap text-xs text-slate-600" title={m.requiredMeaning ?? undefined}>{m.required.join(" or ")}</Td>
                  <Td>{m.ready ? <ToneChip tone="done">ready</ToneChip> : <ToneChip tone="waiting">not ready</ToneChip>}</Td>
                  <Td className="min-w-64 max-w-md text-xs text-slate-600">
                    {m.comments.length ? (
                      <ul className="space-y-1">
                        {m.comments.map((one, i) => (
                          <li key={i} className={one.blocking && !one.settled ? "text-red-700" : undefined}>
                            <span className="font-mono text-slate-400">rev {one.rev} · </span><span className="font-semibold">{one.by}</span>{one.blocking ? <span className="text-[10px] uppercase tracking-wide"> · blocking</span> : null}: {one.text}
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
          <p className="px-5 py-6 text-center text-xs text-slate-400 sm:px-6">No documents yet. Add them with &ldquo;Add or take out&rdquo;.</p>
        )}
      </section>

      {/* What can be done with the ticked documents. */}
      {mayTakeOut && ticked.length ? (
        <div className="dock palette-light sticky bottom-4 z-30 mx-auto flex w-fit max-w-full flex-wrap items-center gap-2 rounded-sm border border-white/10 bg-brand-strong p-2.5 text-white shadow-[0_8px_30px_rgb(0_0_0/0.18)]">
          <span className="px-2 font-mono text-sm tabular-nums">{ticked.length}<span className="ml-1.5 text-[10px] uppercase tracking-[0.12em] text-white/60">ticked</span></span>
          <ActionForm action={removePackageMemberAction} submitLabel={`Take out (${ticked.length})`} size="sm" variant="secondary" hidden={{ packageId }} className="space-y-0">
            {ticked.map((id) => <input key={id} type="hidden" name="documentId" value={id} />)}
          </ActionForm>
          {ruled ? <span className="px-2 text-xs text-white/70">One the rule matches stays out until added back by hand.</span> : null}
          <button type="button" onClick={() => setTicked([])} className="ml-auto rounded-sm p-2 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Clear the ticks"><X className="h-4 w-4" /></button>
        </div>
      ) : null}
    </>
  );
}
