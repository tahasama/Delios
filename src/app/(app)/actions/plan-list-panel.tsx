import Link from "next/link";
import { ActionForm } from "@/components/form";
import { Field, inputCls } from "@/components/ui";
import { uploadPlanListAction, uploadLooseListAction } from "@/lib/actions/plan-lists";
import type { PlanList } from "@/lib/plan-lists";
import { Download, TriangleAlert } from "lucide-react";

const STATE: Record<string, string> = {
  IN_PREPARATION: "in preparation", CORRECTING: "being corrected", RECEIVED: "received", IN_REVIEW: "in review",
  RELEASED: "released", RETURNED: "returned", SUPERSEDED: "superseded", VOID: "void",
};

const fileInput = "block w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-surface file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-brand-ink";

/**
 * One of the schedule's lists: what it is, the document that holds it, and the
 * form that uploads its next version. With no document yet, the way to register
 * one, already filled in — or, for Document Control, to upload the list without
 * one, knowingly and with a reason kept in the activity log.
 */
export function PlanListPanel({ list, control }: { list: PlanList; control: boolean }) {
  const only = list.documents.length === 1 ? list.documents[0] : null;
  const type = list.types[0] ?? null;
  const state = only?.latestRevisionState ?? null;
  const template = list.template
    ? <a href={list.template} className="inline-flex items-center gap-1 text-xs font-semibold text-link hover:underline"><Download className="h-3.5 w-3.5" /> Current list to fill</a>
    : null;

  return (
    <section className="min-w-0">
      <h2 className="stencil text-slate-600">{list.title}</h2>
      <p className="mt-1 text-[11.5px] leading-4 text-slate-500">{list.says}</p>

      {list.documents.length ? (
        <>
          {only ? (
            <p className="mt-2 text-xs text-slate-600">
              <Link href={`/documents/${only.id}`} className="font-mono font-semibold text-brand-ink hover:underline">{only.number}</Link>
              <span className="text-slate-500">{only.latestRevisionValue ? ` · rev ${only.latestRevisionValue} · ${STATE[state ?? ""] ?? (state ?? "").toLowerCase()}` : " · no revision yet"}</span>
            </p>
          ) : null}
          {state === "IN_REVIEW" ? (
            <p className="mt-2 text-xs text-slate-600">Rev {only!.latestRevisionValue} is in review. Upload the next version once it is released or returned.</p>
          ) : (
            <ActionForm action={uploadPlanListAction} hideSubmit hidden={{ kind: list.kind, ...(only ? { documentId: only.id } : {}) }} className="mt-2.5 max-w-xl space-y-2.5">
              {only ? null : (
                <Field label="Which list" required>
                  <select name="documentId" required className={inputCls} defaultValue="">
                    <option value="" disabled>Choose…</option>
                    {list.documents.map((one) => <option key={one.id} value={one.id}>{one.number} — {one.title}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Files" hint="the list as .xlsx or .csv, and a PDF of it" required>
                <input type="file" name="file" multiple required accept=".xlsx,.csv,.pdf" className={fileInput} />
              </Field>
              {state === "IN_PREPARATION" ? (
                <Field label={`Why these files go onto rev ${only!.latestRevisionValue}`} hint="no new revision is started, so your reason is kept as proof" required>
                  <input name="why" required className={inputCls} placeholder="e.g. The PDF was missing from the first upload" />
                </Field>
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                <button className="ask" data-on="true">Upload</button>
                {template}
                <span className="text-[11px] text-slate-500">Send it for review from its page; releasing it puts it in force.</span>
              </div>
            </ActionForm>
          )}
        </>
      ) : (
        <>
          <p className="mt-2 text-xs text-slate-600">
            No document holds it yet.{" "}
            <Link href={`/documents/new?${new URLSearchParams({ ...(type ? { docType: type.code } : {}), title: list.title })}`} className="font-semibold text-link hover:underline">Register one</Link>
            {list.types.length ? <> as a {list.types.map((one) => `${one.label} (${one.code})`).join(" or ")}</> : null}, then upload here.
          </p>
          {control ? (
            <details className="mt-2.5 max-w-xl">
              <summary className="cursor-pointer text-xs font-semibold text-link">Or upload it without a register document</summary>
              <ActionForm action={uploadLooseListAction} hideSubmit resetOnSuccess hidden={{ kind: list.kind }} className="mt-2.5 space-y-2.5">
                <p className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>It is applied at once, with no review, and is not a controlled document. Your name, the file and your reason are kept in the activity log.</span>
                </p>
                <Field label="File" hint="the list as .xlsx or .csv" required>
                  <input type="file" name="file" required accept=".xlsx,.csv" className={fileInput} />
                </Field>
                <Field label="Why without a register document" required>
                  <input name="reason" required className={inputCls} placeholder="e.g. The planner sent it by email; the schedule document follows next week" />
                </Field>
                <label className="flex items-start gap-2 text-xs text-slate-700">
                  <input type="checkbox" name="aware" value="yes" required className="mt-0.5" />
                  I know this list is not a document in the register.
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <button className="ask" data-on="true">Upload and apply</button>
                  {template}
                </div>
              </ActionForm>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}
