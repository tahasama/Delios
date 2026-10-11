import Link from "next/link";
import { ActionForm } from "@/components/form";
import { SearchPick, type PickItem } from "@/components/search-pick";
import { Field, inputCls } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import { setDisciplinesAction, addDocumentToActionAction, removeDocumentFromActionAction, answerActionRequestAction } from "@/lib/actions/action-links";

/** A request to add a document to this action, still waiting for Document Control. */
export type Ask = {
  transmittalId: string; number: string; from: string; since: string | null;
  subject: string; message: string | null; documentIds: string[];
};

/**
 * Who this action concerns and which documents it needs, set by hand. The
 * lists set them in bulk; this sets them one at a time, and answers whoever
 * asked for a document to be added. Disciplines: Document Control or Plan.
 * Documents: Document Control, by number only — the status and the date are
 * the ones the requirements list uses when it says nothing.
 */
export function LinksCard({ actionId, code, departments, disciplines, entries, documents, asks, mayTag, control }: {
  actionId: string;
  code: string;
  /** The disciplines tagged now. */
  departments: string[];
  /** The published disciplines. */
  disciplines: { code: string; label: string }[];
  /** The documents it needs now, to take one off. */
  entries: { id: string; docNumber: string; title: string; department: string | null }[];
  /** The register, to pick from: given to Document Control only. */
  documents: PickItem[];
  asks: Ask[];
  mayTag: boolean;
  control: boolean;
}) {
  const label = (c: string | null) => (c ? disciplines.find((d) => d.code === c)?.label ?? c : "every discipline");
  const tagged = disciplines.filter((d) => departments.includes(d.code));
  const addForm = (ask: Ask | null) => (
    <ActionForm
      action={addDocumentToActionAction}
      submitLabel={ask ? "Add it, and answer" : "Add"}
      hidden={{ actionId, code, ...(ask ? { transmittalId: ask.transmittalId } : {}) }}
      className="space-y-3"
    >
      <SearchPick browse items={documents} name="documentIds" initial={ask?.documentIds} label="Document" placeholder="Type a number or a title" required />
      <Field label="For" required>
        <select name="department" required defaultValue={tagged.length === 1 ? tagged[0].code : ""} className={inputCls}>
          <option value="" disabled hidden>Discipline</option>
          {tagged.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
        </select>
      </Field>
    </ActionForm>
  );

  return (
    <section id="links" className="register register-sheet register-sheet-open">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
        <span className="stencil mr-1 text-slate-500">Disciplines and documents</span>
        <span className="text-[11px] text-slate-500">set by hand; every change is kept in the activity log</span>
      </div>

      {asks.length && control ? (
        <ul id="asked" className="scroll-mt-24 divide-y divide-line border-b border-line">
          {asks.map((ask) => (
            <li key={ask.transmittalId} className="space-y-3 px-5 py-3.5 sm:px-6">
              <div className="space-y-1 text-xs leading-5">
                <p className="font-semibold text-slate-800">
                  {ask.from} asks for a document to be added
                  <span className="ml-1.5 font-normal text-slate-500">
                    · <Link href={`/transmittals/${ask.transmittalId}`} className="text-link hover:underline">{ask.number}</Link>
                    {ask.since ? `, ${fmtDate(ask.since)}` : ""}
                  </span>
                </p>
                {ask.message ? <p className="whitespace-pre-line text-slate-600">{ask.message}</p> : <p className="text-slate-600">{ask.subject}</p>}
              </div>
              {tagged.length ? addForm(ask) : <p className="text-xs text-amber-800">Tag the disciplines first, below.</p>}
              <details className="text-xs">
                <summary className="cursor-pointer font-semibold text-link">Nothing to add</summary>
                <ActionForm action={answerActionRequestAction} submitLabel="Answer" hidden={{ transmittalId: ask.transmittalId, code }} className="mt-2 space-y-3">
                  <Field label="Why" required hint={`${ask.from} is told`}>
                    <textarea name="note" required rows={2} className={inputCls} />
                  </Field>
                </ActionForm>
              </details>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="divide-y divide-line">
        {mayTag ? (
          <details className="group px-5 py-3 sm:px-6" open={!departments.length}>
            <summary className="cursor-pointer list-none text-xs font-semibold text-slate-700 [&::-webkit-details-marker]:hidden">
              Disciplines concerned <span className="font-normal text-slate-500">· {tagged.length ? tagged.map((d) => d.label).join(", ") : "none yet"}</span>
            </summary>
            <ActionForm action={setDisciplinesAction} submitLabel="Save disciplines" hidden={{ actionId, code }} className="mt-3 space-y-3">
              <SearchPick
                browse
                items={disciplines.map((d) => ({ id: d.code, name: d.label, detail: d.code }))}
                name="departments"
                initial={departments}
                label="Disciplines"
                placeholder="Type a discipline"
                empty="None: the action concerns nobody yet."
              />
            </ActionForm>
          </details>
        ) : null}

        {control && tagged.length ? (
          <details className="px-5 py-3 sm:px-6">
            <summary className="cursor-pointer list-none text-xs font-semibold text-slate-700 [&::-webkit-details-marker]:hidden">Add a document</summary>
            <div className="mt-3">{addForm(null)}</div>
          </details>
        ) : null}

        {control && entries.length ? (
          <details className="px-5 py-3 sm:px-6">
            <summary className="cursor-pointer list-none text-xs font-semibold text-slate-700 [&::-webkit-details-marker]:hidden">Take a document off</summary>
            <ActionForm action={removeDocumentFromActionAction} submitLabel="Take it off" hidden={{ actionId, code }} className="mt-3 space-y-3">
              <Field label="Document" required>
                <select name="needId" required defaultValue="" className={inputCls}>
                  <option value="" disabled hidden>Document</option>
                  {entries.map((e) => <option key={e.id} value={e.id}>{e.docNumber} · {e.title} · {label(e.department)}</option>)}
                </select>
              </Field>
            </ActionForm>
          </details>
        ) : null}
      </div>
    </section>
  );
}
