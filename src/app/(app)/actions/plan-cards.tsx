import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { scheduleSource } from "@/lib/api/schedule";
import { backendDocument } from "@/lib/api/legacy";
import { planLists } from "@/lib/plan-lists";
import { ActionForm } from "@/components/form";
import { Field, inputCls } from "@/components/ui";
import { uploadPlanListAction } from "@/lib/actions/plan-lists";
import { Download, Upload } from "lucide-react";

/**
 * Where the schedule comes from, and the two pages behind it, on one quiet line;
 * and, for whoever plans the project, the three lists it rests on — each one
 * uploaded here as a new revision of its document, put in force by releasing it.
 */
export async function PlanCards() {
  const ctx = await requireScope();
  const plans = ctx.can("PLAN") || ctx.can("CONTROL") || ctx.can("CONFIGURE");
  const { source } = await scheduleSource(ctx);
  const [document, lists] = await Promise.all([
    source ? backendDocument(ctx, source.documentId).catch(() => null) : null,
    plans ? planLists(ctx) : Promise.resolve([]),
  ]);

  const line = (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-slate-500">
      {document ? (
        <span>
          Dates from <Link href={`/documents/${document.id}`} className="font-mono font-semibold text-link hover:underline">{document.number}</Link>
        </span>
      ) : (
        <span>No schedule document yet</span>
      )}
      <span aria-hidden className="text-slate-300">·</span>
      <Link href="/actions/requirements" className="font-semibold text-link hover:underline">Requirements</Link>
      <span aria-hidden className="text-slate-300">·</span>
      <Link href="/actions/schedules" className="font-semibold text-link hover:underline">Schedule versions</Link>
    </p>
  );
  if (!plans) return line;

  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        {line}
        <span className="ask"><Upload className="h-3.5 w-3.5" /> Upload a list</span>
      </summary>
      <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-5 border-t border-line pt-4 lg:grid-cols-3">
        {lists.map((list) => {
          const only = list.documents.length === 1 ? list.documents[0] : null;
          return (
            <section key={list.kind} className="min-w-0">
              <h2 className="stencil text-slate-600">{list.title}</h2>
              <p className="mt-1 text-[11.5px] leading-4 text-slate-500">{list.says}</p>
              {list.documents.length ? (
                <ActionForm action={uploadPlanListAction} hideSubmit hidden={{ kind: list.kind, ...(only ? { documentId: only.id } : {}) }} className="mt-3 space-y-3">
                  {only ? (
                    <p className="text-xs text-slate-600">
                      <Link href={`/documents/${only.id}`} className="font-mono font-semibold text-brand-ink hover:underline">{only.number}</Link>
                      {only.latestRevisionValue
                        ? <span className="text-slate-500"> · rev {only.latestRevisionValue}{only.latestRevisionState ? ` · ${only.latestRevisionState.replaceAll("_", " ").toLowerCase()}` : ""}</span>
                        : <span className="text-slate-500"> · no revision yet</span>}
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
                    <input name="changeDescription" required className={inputCls} placeholder={list.kind === "SCHEDULE" ? "e.g. Update 14: civil works moved two weeks" : "e.g. Electrical added to A00012"} />
                  </Field>
                  <div className="flex flex-wrap items-center gap-3">
                    <button className="ask" data-on="true">Upload</button>
                    {list.template ? <a href={list.template} className="inline-flex items-center gap-1 text-xs font-semibold text-link hover:underline"><Download className="h-3.5 w-3.5" /> Current list to fill</a> : null}
                  </div>
                </ActionForm>
              ) : (
                <p className="mt-3 text-xs text-slate-600">
                  No document holds it yet.{" "}
                  <Link href="/documents/new" className="font-semibold text-link hover:underline">Register one</Link>
                  {list.types.length ? <> as a {list.types.map((one) => `${one.label} (${one.code})`).join(" or ")}</> : null}, then upload here.
                </p>
              )}
            </section>
          );
        })}
      </div>
      <p className="mt-4 text-[11px] text-slate-500">
        An upload is a new revision of its document and changes nothing yet. It goes for review like any document; releasing it puts the list in force.
      </p>
    </details>
  );
}
