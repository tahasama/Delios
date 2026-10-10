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
const said = (state: string) => STATE[state] ?? state.replaceAll("_", " ").toLowerCase();

const fileInput = "block w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-surface file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-brand-ink";

/**
 * One of the schedule's lists: what it is, the document that holds it, and the
 * upload of the spreadsheet of its revision in force. Revisions are made on the
 * document's page; here the released one's list is read. With no document, the
 * way to register one, already filled in — or, knowingly and with a reason, to
 * upload the list without one.
 */
export function PlanListPanel({ list, control }: { list: PlanList; control: boolean }) {
  const type = list.types[0] ?? null;
  const inForce = list.documents.filter((one) => one.released);
  const only = inForce.length === 1 ? inForce[0] : null;
  const template = list.template
    ? <a href={list.template} className="inline-flex items-center gap-1 text-xs font-semibold text-link hover:underline"><Download className="h-3.5 w-3.5" /> Current list to fill</a>
    : null;

  // The same way out wherever no revision is in force: no document yet, or none released.
  const loose = control ? (
    <details className="mt-2.5 max-w-xl">
      <summary className="cursor-pointer text-xs font-semibold text-link">Or upload it without a released document</summary>
      <ActionForm action={uploadLooseListAction} hideSubmit resetOnSuccess hidden={{ kind: list.kind }} className="mt-2.5 space-y-2.5">
        <p className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>It is applied at once, with no review, and is not tied to a released document. Your name, the file and your reason are kept in the activity log.</span>
        </p>
        <Field label="File" hint="the list as .xlsx or .csv" required>
          <input type="file" name="file" required accept=".xlsx,.csv" className={fileInput} />
        </Field>
        <Field label="Why without a released document" required>
          <input name="reason" required className={inputCls} placeholder="e.g. The planner sent it by email; the document is released next week" />
        </Field>
        <label className="flex items-start gap-2 text-xs text-slate-700">
          <input type="checkbox" name="aware" value="yes" required className="mt-0.5" />
          I know this list is not a released document in the register.
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button className="ask" data-on="true">Upload and apply</button>
          {template}
        </div>
      </ActionForm>
    </details>
  ) : null;

  return (
    <section className="min-w-0">
      <h2 className="stencil text-slate-600">{list.title}</h2>
      <p className="mt-1 text-[11.5px] leading-4 text-slate-500">{list.says}</p>

      {list.documents.length ? (
        <>
          <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
            {list.documents.map((doc) => (
              <li key={doc.id}>
                <Link href={`/documents/${doc.id}`} className="font-mono font-semibold text-brand-ink hover:underline">{doc.number}</Link>
                <span className="text-slate-500">
                  {doc.released ? ` · in force: rev ${doc.released.value}${doc.read ? ", list read" : ", list not read yet"}` : " · nothing released yet"}
                  {doc.pending ? ` · rev ${doc.pending.value} ${said(doc.pending.state)}` : ""}
                </span>
              </li>
            ))}
          </ul>
          {!inForce.length ? (
            <>
              <p className="mt-2 text-xs text-slate-600">Release it from its page; then upload the spreadsheet of that revision here.</p>
              {loose}
            </>
          ) : control ? (
            <ActionForm action={uploadPlanListAction} hideSubmit resetOnSuccess hidden={{ kind: list.kind, ...(only ? { revisionId: only.released!.id } : {}) }} className="mt-2.5 max-w-xl space-y-2.5">
              {only ? null : (
                <Field label="Which list" required>
                  <select name="revisionId" required className={inputCls} defaultValue="">
                    <option value="" disabled>Choose…</option>
                    {inForce.map((one) => <option key={one.id} value={one.released!.id}>{one.number} rev {one.released!.value} — {one.title}</option>)}
                  </select>
                </Field>
              )}
              <Field label={only ? `Spreadsheet of rev ${only.released!.value}` : "Spreadsheet of the revision in force"} hint=".xlsx or .csv" required>
                <input type="file" name="file" required accept=".xlsx,.csv" className={fileInput} />
              </Field>
              {only?.read || !only ? (
                <Field
                  label={only ? `Why another file for rev ${only.released!.value}` : "Why another file, if its list was already read"}
                  hint="its list was already read; no new revision marks this, so your reason is kept as proof"
                  required={!!only}
                >
                  <input name="reason" required={!!only} className={inputCls} placeholder="e.g. The first export missed a column" />
                </Field>
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                <button className="ask" data-on="true">Upload and read</button>
                {template}
              </div>
            </ActionForm>
          ) : (
            <p className="mt-2 text-xs text-slate-500">Document Control uploads the spreadsheet of the revision in force.</p>
          )}
        </>
      ) : (
        <>
          <p className="mt-2 text-xs text-slate-600">
            No document holds it yet.{" "}
            <Link href={`/documents/new?${new URLSearchParams({ ...(type ? { docType: type.code } : {}), title: list.title })}`} className="font-semibold text-link hover:underline">Register one</Link>
            {list.types.length ? <> as a {list.types.map((one) => `${one.label} (${one.code})`).join(" or ")}</> : null}, then upload here.
          </p>
          {loose}
        </>
      )}
    </section>
  );
}
