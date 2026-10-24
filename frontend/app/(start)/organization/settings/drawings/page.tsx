import { requireOrgAdmin } from "@/lib/core/org-scope";
import { Field } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { api } from "@/lib/client";
import { fmtDate } from "@/lib/core/utils";
import { askDwgReaderAction } from "@/lib/organization/forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Viewing drawings" };

type Asked = { id: string; what: string; message: string | null; byName: string; at: string };

/**
 * Viewing drawings (owner: the paid reader is suggested only to those who decide): which reader shows DWG drawings in
 * the page, what it leaves out, and that a certified reader can be added, paid, with "Ask for it", which lands with
 * DELIOS (kept, and emailed).
 */
export default async function DrawingsPage() {
  await requireOrgAdmin();
  const { freeReader, asked } = await api<{ freeReader: boolean; asked: Asked[] }>("/api/admin/product-requests");
  return (
    <div className="space-y-4">
      <section className="register register-sheet register-sheet-open" aria-labelledby="reader-head">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <h2 id="reader-head" className="stencil mr-1 text-slate-500">The reader in use</h2>
          <span className="text-[11px] text-slate-500">how DWG drawings are shown in a document&rsquo;s Preview, on every project</span>
        </div>
        <div className="space-y-2 px-5 py-3.5 text-[13px] leading-5 text-slate-700 sm:px-6">
          <p>
            <span className="font-semibold text-slate-900">{freeReader ? "A free reader (LibreDWG)." : "None: DWG drawings are offered to download."}</span>{" "}
            {freeReader ? "It is for viewing only: the revision's PDF stays the reference." : "DXF drawings are still drawn in the page."}
          </p>
          {freeReader ? (
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-600">
              <li>Paper layouts, linked drawings (xrefs) and pictures are not shown.</li>
              <li>Lettering is drawn in one font, so it is approximate.</li>
              <li>Some drawings do not open, depending on their version and content.</li>
            </ul>
          ) : null}
        </div>
      </section>

      <section className="register register-sheet register-sheet-open" aria-labelledby="certified-head">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <h2 id="certified-head" className="stencil mr-1 text-slate-500">A certified reader</h2>
          <span className="text-[11px] text-slate-500">paid; it opens every drawing as AutoCAD shows it, its layouts too</span>
        </div>
        <ActionForm action={askDwgReaderAction} submitLabel="Ask for it" resetOnSuccess className="space-y-3 px-5 py-3.5 sm:px-6">
          <p className="text-[13px] leading-5 text-slate-700">
            DELIOS can add one for your organization. Ask, and DELIOS answers you by email with what it costs for the drawings you keep.
          </p>
          <Field label="Anything to add" hint="optional — how many drawings, which versions, files that must stay on our servers…">
            <textarea name="message" rows={3} maxLength={2000} className="plain w-full" />
          </Field>
        </ActionForm>
        {asked.length ? (
          <ul className="divide-y divide-line border-t border-line">
            {asked.map((one) => (
              <li key={one.id} className="px-5 py-2.5 text-xs text-slate-600 sm:px-6">
                <span className="font-semibold text-slate-800">Asked {fmtDate(one.at)} by {one.byName}</span>
                {one.message ? <span className="mt-0.5 block whitespace-pre-line">{one.message}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
