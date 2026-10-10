import Link from "next/link";
import { fmtDate } from "@/lib/utils";
import { ActionForm } from "@/components/form";
import { Field, inputCls } from "@/components/ui";
import { uploadPlanListAction, uploadLooseListAction } from "@/lib/actions/plan-lists";
import type { PlanList } from "@/lib/plan-lists";
import { ConfirmOrWhy } from "./confirm-or-why";
import { Download, TriangleAlert } from "lucide-react";

const STATE: Record<string, string> = {
  IN_PREPARATION: "in preparation", CORRECTING: "being corrected", RECEIVED: "received", IN_REVIEW: "in review",
  RELEASED: "released", RETURNED: "returned", SUPERSEDED: "superseded", VOID: "void",
};
const said = (state: string) => STATE[state] ?? state.replaceAll("_", " ").toLowerCase();

const fileInputLook = "text-xs text-slate-600 file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-surface file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-brand-ink";
const fileInput = `block w-full ${fileInputLook}`;
const fileInputInline = `block ${fileInputLook}`;

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
  const template = <a href={list.template} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-link hover:underline"><Download className="h-3.5 w-3.5" /> Template to fill (.csv)</a>;

  // The same way out wherever no revision is in force: no document yet, or none released.
  const loose = control ? (
    <details className="mt-4 max-w-xl">
      <summary className="cursor-pointer text-xs font-semibold text-link">Or upload it without a released document</summary>
      <ActionForm action={uploadLooseListAction} hideSubmit resetOnSuccess hidden={{ kind: list.kind }} className="mt-4 space-y-4">
        <p className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>It is applied at once, with no review, and is not tied to a released document. Your name, the file and your reason are kept in the activity log.</span>
        </p>
        <Field label="File" hint="the list as .xlsx or .csv" required>
          <input type="file" name="file" required accept=".xlsx,.csv" className={fileInput} />
        </Field>
        <Field label="Why without a released document" required>
          <input name="reason" required className={inputCls} placeholder="e.g. Approver not available; or the organization approves on paper and a stamped scan follows" />
        </Field>
        <button className="ask" data-on="true">Upload and apply</button>
      </ActionForm>
    </details>
  ) : null;

  return (
    <section className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">
            {list.title}
            <span className="ml-2 text-xs font-normal text-slate-500">{list.says}</span>
          </h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Releasing its document reads the Excel by itself. Upload here only if that read is missing or failed.
          </p>
        </div>
        {template}
      </div>
      {list.direct ? (
        // What is in force came from a direct upload: it can be taken back as it was read.
        <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 ring-1 ring-amber-200">
          <span>In force: uploaded directly on {fmtDate(list.direct)}, without a document.</span>
          <a href={`/api/plan-direct/${list.kind}`} className="inline-flex items-center gap-1 font-semibold underline">
            <Download className="h-3.5 w-3.5" /> Download it (.csv)
          </a>
        </p>
      ) : null}

      {list.documents.length ? (
        <>
          <ul className="mt-4 space-y-1.5 text-xs leading-5 text-slate-600">
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
              <p className="mt-4 text-xs leading-5 text-slate-600">Nothing released yet. Release it from its page and its Excel is read by itself.</p>
              {loose}
            </>
          ) : control ? (
            <ActionForm action={uploadPlanListAction} hideSubmit resetOnSuccess hidden={{ kind: list.kind, ...(only ? { revisionId: only.released!.id } : {}) }} className="mt-5 max-w-xl space-y-4">
              {only ? null : (
                <Field label="Which list" required>
                  <select name="revisionId" required className={inputCls} defaultValue="">
                    <option value="" disabled>Choose…</option>
                    {inForce.map((one) => <option key={one.id} value={one.released!.id}>{one.number} rev {one.released!.value} — {one.title}</option>)}
                  </select>
                </Field>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="file" name="file" required accept=".xlsx,.csv"
                  aria-label={only ? `Excel of rev ${only.released!.value} (.xlsx or .csv)` : "Excel of the revision in force (.xlsx or .csv)"}
                  className={`${fileInputInline} min-w-0 flex-1`}
                />
              </div>
              {/* The uploader vouches for the file, or says why it differs. */}
              <ConfirmOrWhy revision={only ? `rev ${only.released!.value}` : "the revision in force"} />
              <button className="ask" data-on="true">Upload and read</button>
            </ActionForm>
          ) : (
            <p className="mt-4 text-xs text-slate-500">Document Control uploads the spreadsheet of the revision in force.</p>
          )}
        </>
      ) : (
        <>
          <p className="mt-4 text-xs leading-5 text-slate-600">
            No document holds it yet.{" "}
            <Link href={`/documents/new?${new URLSearchParams({ ...(type ? { docType: type.code } : {}), title: list.title })}`} className="font-semibold text-link hover:underline">Register one</Link>
            {list.types.length ? <> as a {list.types.map((one) => `${one.label} (${one.code})`).join(" or ")}</> : null}, then release it from its page.
          </p>
          {loose}
        </>
      )}
    </section>
  );
}
