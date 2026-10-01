import { ActionForm } from "@/components/form";
import { Field, inputCls } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import { addDocumentReaderAction, removeDocumentReaderAction } from "@/lib/actions/document-access";
import { SearchPick } from "@/components/search-pick";

export type Reader = { id: string; name: string; addedByName: string; reason: string | null; at: Date };

/**
 * Who may read a closed document.
 *
 * Above the open confidentiality levels there is no ladder to climb: the people
 * who may read it are named here, by whoever is answerable for the content. The
 * list is shown to them and to an administrator; to everybody else the document
 * does not exist at all, so there is nothing to show.
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
    <section className="mt-5 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3.5">
      <h3 className="text-[13px] font-semibold text-amber-950">Who may read this</h3>
      <p className="mt-1 text-xs leading-5 text-amber-950/80">
        It is {confidentiality.toLowerCase()}, so it is not in anybody else&apos;s register, counts or searches.
        {answerable.length ? ` ${answerable.join(" and ")} read it because they are answerable for it, and an administrator reads everything.` : " An administrator reads everything."}
      </p>

      <ul className="mt-3 space-y-1.5">
        {readers.length === 0 ? (
          <li className="text-xs text-amber-950/70">Nobody else has been named yet.</li>
        ) : readers.map((reader) => (
          <li key={reader.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2 text-xs">
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
                  single
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
