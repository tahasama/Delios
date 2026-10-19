import Link from "next/link";
import { ActionForm } from "@/components/form";
import { AsReceivedWarning } from "@/components/as-received-warning";
import { MatchDocument } from "./match-document";
import { matchItemAction } from "@/lib/transmittals/forms";
import type { TransmittalItem, TransmittalPage } from "@/lib/types";

/**
 * What came unplanned on a received transmittal, each with where it stands: in our register (matched to one of ours, or
 * made a document), returned, or waiting. Waiting, whoever checks what arrives matches it to one of ours (equivalence:
 * what came becomes that document's, their number kept beside ours) or makes it a document. Into a package taking
 * documents as they come, it waits for the check instead, which puts it in the register as it came.
 */
export function UnplannedItems({ transmittalId, items, page, from, mayAct }: {
  transmittalId: string;
  items: TransmittalItem[];
  page: TransmittalPage;
  from: string;
  mayAct: boolean;
}) {
  if (!items.length) return null;
  const inRegister = (item: TransmittalItem) => page.carried.find((one) => one.id === item.id);
  return (
    <section id="unplanned" className="register register-sheet register-sheet-open">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2 sm:px-6">
        <span className="stencil mr-1 text-slate-400">{page.asReceived ? "Sent as they are" : "What came unplanned"}</span>
        <span className="text-[11px] text-slate-400">
          {page.asReceived
            ? "into a package taking documents as they come: the check puts each in the register as it came"
            : "each is one of ours (matched, their number kept beside ours) or made a document"}
        </span>
        <span className="ml-auto font-mono text-[11px] tabular-nums text-slate-500">{items.length}</span>
      </div>
      {page.asReceived ? <div className="px-5 pt-3 sm:px-6"><AsReceivedWarning who={from} /></div> : null}
      <ul className="divide-y divide-line">
        {items.map((item) => {
          const ours = inRegister(item);
          const waiting = !item.registeredAt && !item.returnedAt;
          return (
            <li key={item.id} className="px-5 py-3 sm:px-6">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div className="min-w-0">
                  <p className="text-[13px] text-slate-900">
                    {item.documentNumber ? <span className="mr-2 font-mono font-semibold">{item.documentNumber}</span> : null}
                    {item.title}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {[
                      item.documentNumber ? `their number` : "no number of theirs",
                      page.asReceived && item.revision ? `their rev ${item.revision}` : null,
                      item.theirStatus ? `their status ${item.theirStatus}` : null,
                      item.theirOutcome ? `their review outcome ${item.theirOutcome}` : null,
                      `${item.files.length} file${item.files.length === 1 ? "" : "s"}`,
                    ].filter(Boolean).join(" · ")}
                  </p>
                </div>
                {ours ? (
                  <Link href={`/documents/${ours.documentId}`} className="text-[11px] text-slate-600 hover:text-link">
                    {item.matched ? "matched to" : page.asReceived ? "in the register as it came:" : "made a document:"}{" "}
                    <span className="font-mono font-semibold">{ours.number}</span> rev {ours.revision}
                  </Link>
                ) : item.returnedAt ? (
                  <span className="text-[11px] text-red-700">returned by {item.returnedBy}: {item.returnedReason}</span>
                ) : page.asReceived ? (
                  <span className="text-[11px] text-amber-800">waiting for the check</span>
                ) : null}
              </div>
              {waiting && mayAct && !page.asReceived ? (
                <ActionForm action={matchItemAction} hideSubmit hidden={{ transmittalId, itemId: item.id }} className="mt-2 space-y-0">
                  <div className="asking flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-600">One of ours?</span>
                    <MatchDocument proposed={page.matchedBefore?.[item.id] ?? null} />
                    <button className="ask">Match</button>
                    {page.matchedBefore?.[item.id] ? <span className="text-[11px] text-slate-500">matched to it before</span> : null}
                    {item.files[0] ? (
                      <Link href={`/documents/new?received=1&fromFile=${item.files[0].id}`} className="ml-auto text-[11px] font-semibold text-link hover:underline">
                        None of ours? Make it a document &rarr;
                      </Link>
                    ) : null}
                  </div>
                </ActionForm>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
