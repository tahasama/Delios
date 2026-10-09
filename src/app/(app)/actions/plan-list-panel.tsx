import Link from "next/link";
import { ActionForm } from "@/components/form";
import { Field, inputCls } from "@/components/ui";
import { uploadPlanListAction } from "@/lib/actions/plan-lists";
import type { PlanList } from "@/lib/plan-lists";
import { Download } from "lucide-react";

const STATE: Record<string, string> = {
  IN_PREPARATION: "in preparation", CORRECTING: "being corrected", RECEIVED: "received", IN_REVIEW: "in review",
  RELEASED: "released", RETURNED: "returned", SUPERSEDED: "superseded", VOID: "void",
};

/**
 * One of the schedule's lists: what it is, the document that holds it, and the
 * form that uploads its next version. With no document yet, the way to register
 * one, already filled in.
 */
export function PlanListPanel({ list }: { list: PlanList }) {
  const only = list.documents.length === 1 ? list.documents[0] : null;
  const type = list.types[0] ?? null;
  return (
    <section className="min-w-0">
      <h2 className="stencil text-slate-600">{list.title}</h2>
      <p className="mt-1 text-[11.5px] leading-4 text-slate-500">{list.says}</p>
      {list.documents.length ? (
        <ActionForm action={uploadPlanListAction} hideSubmit hidden={{ kind: list.kind, ...(only ? { documentId: only.id } : {}) }} className="mt-3 max-w-xl space-y-3">
          {only ? (
            <p className="text-xs text-slate-600">
              <Link href={`/documents/${only.id}`} className="font-mono font-semibold text-brand-ink hover:underline">{only.number}</Link>
              <span className="text-slate-500">
                {only.latestRevisionValue ? ` · rev ${only.latestRevisionValue} · ${STATE[only.latestRevisionState ?? ""] ?? (only.latestRevisionState ?? "").toLowerCase()}` : " · no revision yet"}
              </span>
            </p>
          ) : (
            <Field label="Which list" required>
              <select name="documentId" required className={inputCls} defaultValue="">
                <option value="" disabled>Choose…</option>
                {list.documents.map((one) => <option key={one.id} value={one.id}>{one.number} — {one.title}</option>)}
              </select>
            </Field>
          )}
          <Field label="Files" hint="the list as .xlsx or .csv, and a PDF of it" required>
            <input type="file" name="file" multiple required accept=".xlsx,.csv,.pdf" className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-surface file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-brand-ink" />
          </Field>
          <Field label="What changed" required>
            <input name="changeDescription" required className={inputCls} placeholder={list.kind === "SCHEDULE" ? "e.g. Update 14: civil works moved two weeks" : list.kind === "DEPARTMENTS" ? "e.g. Electrical added to A00012" : "e.g. Mechanical list for the pump station"} />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <button className="ask" data-on="true">Upload</button>
            {list.template ? <a href={list.template} className="inline-flex items-center gap-1 text-xs font-semibold text-link hover:underline"><Download className="h-3.5 w-3.5" /> Current list to fill</a> : null}
          </div>
          <p className="text-[11px] text-slate-500">It changes nothing yet: send it for review from its page; releasing it puts it in force.</p>
        </ActionForm>
      ) : (
        <p className="mt-3 text-xs text-slate-600">
          No document holds it yet.{" "}
          <Link href={`/documents/new?${new URLSearchParams({ ...(type ? { docType: type.code } : {}), title: list.title })}`} className="font-semibold text-link hover:underline">Register one</Link>
          {list.types.length ? <> as a {list.types.map((one) => `${one.label} (${one.code})`).join(" or ")}</> : null}, then upload here.
        </p>
      )}
    </section>
  );
}
