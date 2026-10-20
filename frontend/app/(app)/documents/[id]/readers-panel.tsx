import { ActionForm } from "@/components/form";
import { Field, inputCls } from "@/components/ui";
import { fmtDate } from "@/lib/core/utils";
import { addDocumentReaderAction, removeDocumentReaderAction } from "@/lib/documents/forms-readers";
import { SearchPick } from "@/components/search-pick";

type Reader = { id: string; name: string; addedByName: string; reason: string | null; at: Date };

/**
 * Who may read a document above some function's clearance.
 *
 * Clearance is the one confidentiality rule: whoever's function does not reach the document's level reads it only if
 * named here, by whoever is answerable for the content.
 */
export function ReadersPanel({
  documentId, confidentiality, readers, candidates, mayName, answerable,
}: {
  documentId: string;
  confidentiality: string;
  readers: Reader[];
  candidates: { id: string; name: string; functionName: string | null }[];
  /** The viewer may add and remove people. */
  mayName: boolean;
  /** Who is answerable for the content, and therefore always reads it. */
  answerable: string[];
}) {
  return (
    <section className="mt-5 rounded-md bg-amber-50 px-3 py-2.5 ring-1 ring-amber-200">
      <h3 className="text-[13px] font-semibold text-amber-950">Who may read this</h3>
      <p className="mt-1 text-xs leading-5 text-amber-950/80">
        It is {confidentiality.toLowerCase()}: whoever&apos;s function has a lower clearance reads it only if named here; for them it
        is in no register, count or search.
        {answerable.length ? ` ${answerable.join(" and ")} read it because they are answerable for it.` : ""}
      </p>

      <ul className="mt-3 space-y-1.5">
        {readers.length === 0 ? (
          <li className="text-xs text-amber-950/70">Nobody else has been named yet.</li>
        ) : readers.map((reader) => (
          <li key={reader.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface px-3 py-2 text-xs ring-1 ring-line">
            <span>
              <strong className="font-semibold text-slate-900">{reader.name}</strong>
              <span className="ml-1.5 text-slate-500">named by {reader.addedByName} on {fmtDate(reader.at)}{reader.reason ? ` — ${reader.reason}` : ""}</span>
            </span>
            {mayName ? (
              <ActionForm action={removeDocumentReaderAction} submitLabel="Remove" size="sm" variant="secondary" hidden={{ accessId: reader.id }} className="inline-block" />
            ) : null}
          </li>
        ))}
      </ul>

      {mayName ? (
        candidates.length ? (
          <div className="mt-3 max-w-xl">
            <ActionForm action={addDocumentReaderAction} submitLabel="Let them read it" size="sm" hidden={{ documentId }}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <SearchPick
                  name="userId"
                  items={candidates.map((one) => ({ id: one.id, name: one.name, detail: one.functionName ?? null }))}
                  label="Who"
                  required
                />
                <Field label="Why" hint="optional — it goes on the record">
                  <input name="reason" className={inputCls} />
                </Field>
              </div>
            </ActionForm>
          </div>
        ) : <p className="mt-3 text-xs text-amber-950/70">Everybody on the project is already named.</p>
      ) : (
        <p className="mt-3 text-xs text-amber-950/70">Whoever registered it, and whoever authored or uploaded a revision of it, say who else may read it.</p>
      )}
    </section>
  );
}
