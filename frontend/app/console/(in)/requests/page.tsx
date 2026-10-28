import { ActionForm } from "@/components/form";
import { consoleApi } from "@/lib/console/client";
import { carryOutMergeAction } from "@/lib/console/forms";
import type { ProductRequest } from "@/lib/console/types";
import { cn, fmtDate } from "@/lib/core/utils";
import { Nothing, Plate, Sheet } from "../parts";

export const metadata = { title: "Requests" };

type Requests = {
  products: ProductRequest[];
  merges: { id: string; keep: string; merge: string; requestedByName: string; why: string; requestedAt: string; state: string; refusedByName: string | null; refusedWhy: string | null; doneAt: string | null }[];
  claims: { id: string; entry: string; claimer: string; claimedByName: string; method: string; state: string; createdAt: string; answeredAt: string | null; answeredByName: string | null; refusedWhy: string | null }[];
};

const MERGE_WORDS: Record<string, string> = { ASKED: "waiting for every side", AGREED: "agreed by every side: ours to carry out", REFUSED: "refused", DONE: "carried out" };
const WHAT_WORDS: Record<string, string> = { DWG_READER: "A certified DWG reader", OFFICE_READER: "Word and PowerPoint shown in the page" };

/** What organizations ask of DELIOS: readers the app does not carry, merges of duplicates, claims on entries. */
export default async function RequestsPage() {
  const r = await consoleApi<Requests>("/api/console/requests");
  const agreed = r.merges.filter((m) => m.state === "AGREED");
  return (
    <>
      <Plate
        title="Requests"
        meta="Asked of DELIOS by organizations. A merge is carried out by us once every side agreed; nothing is deleted, the merged name and code stay reserved."
        figures={[
          { term: "Merges to carry out", value: agreed.length, tone: agreed.length ? "text-amber-700" : undefined },
          { term: "Claims waiting", value: r.claims.filter((c) => c.state === "WAITING").length },
          { term: "Asked of DELIOS", value: r.products.length, said: "readers and services" },
        ]}
      />
      <Sheet id="merges" title="Merges of organizations listed twice" said={`${r.merges.length}`}>
        {r.merges.length ? (
          <ul className="divide-y divide-line">
            {r.merges.map((m) => (
              <li key={m.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-start sm:px-6">
                <div className="min-w-0 flex-1 text-[13px]">
                  <p><span className="font-medium text-slate-900">{m.merge}</span> into <span className="font-medium text-slate-900">{m.keep}</span></p>
                  <p className="text-[12px] text-slate-600">Asked by {m.requestedByName} on {fmtDate(m.requestedAt)}: {m.why}</p>
                  <p className={cn("text-[12px] font-semibold", m.state === "AGREED" ? "text-amber-700" : m.state === "DONE" ? "text-emerald-700" : "text-slate-500")}>
                    {MERGE_WORDS[m.state] ?? m.state}{m.refusedByName ? `, by ${m.refusedByName}: ${m.refusedWhy}` : ""}{m.doneAt ? ` on ${fmtDate(m.doneAt)}` : ""}
                  </p>
                </div>
                {m.state === "AGREED" ? (
                  <ActionForm action={carryOutMergeAction} hidden={{ mergeId: m.id }} submitLabel="Carry it out" size="sm"
                    confirmText={`${m.merge} becomes ${m.keep} in every organization's data. Nothing is deleted; it cannot be undone.`} />
                ) : null}
              </li>
            ))}
          </ul>
        ) : <Nothing>No merge asked.</Nothing>}
      </Sheet>
      <Sheet id="claims" title="Claims on an organization's entry" said="confirmed by its guest's email, or vouched for by whoever recorded it">
        {r.claims.length ? (
          <ul className="divide-y divide-line">
            {r.claims.map((c) => (
              <li key={c.id} className="px-5 py-3 text-[13px] sm:px-6">
                <span className="font-medium text-slate-900">{c.claimer}</span> claims <span className="font-medium text-slate-900">{c.entry}</span>
                <span className="block text-[12px] text-slate-600">
                  By {c.claimedByName}, {c.method === "VOUCH" ? "vouched for by whoever recorded it" : "proven by its guest's email"} · {fmtDate(c.createdAt)} ·{" "}
                  <span className="font-semibold">{c.state.toLowerCase()}</span>{c.answeredByName ? ` by ${c.answeredByName}` : ""}{c.refusedWhy ? `: ${c.refusedWhy}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : <Nothing>No claim made.</Nothing>}
      </Sheet>
      <Sheet id="products" title="Asked of DELIOS" said="emailed to DELIOS's address too, when one is set">
        {r.products.length ? (
          <ul className="divide-y divide-line">
            {r.products.map((p) => (
              <li key={p.id} className="px-5 py-3 text-[13px] sm:px-6">
                <span className="font-medium text-slate-900">{p.organizationName}</span> asks for {WHAT_WORDS[p.what]?.toLowerCase() ?? p.what}
                <span className="block text-[12px] text-slate-600">{p.byName} · <a href={`mailto:${p.byEmail}`} className="text-link hover:underline">{p.byEmail}</a> · {fmtDate(p.at)}{p.message ? ` · ${p.message}` : ""}</span>
              </li>
            ))}
          </ul>
        ) : <Nothing>Nothing asked.</Nothing>}
      </Sheet>
    </>
  );
}
