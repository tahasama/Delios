import Link from "next/link";
import { ActionForm } from "@/components/form";
import { SearchPick, type PickItem } from "@/components/search-pick";
import { Field, inputCls } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import { setDisciplinesAction, addDocumentToActionAction, answerActionRequestAction } from "@/lib/actions/action-links";

/** A request about this action, still waiting for Document Control: a document to add, or a missing discipline. */
export type Ask = {
  transmittalId: string; number: string; from: string; since: string | null; kind: "DOCUMENT" | "DISCIPLINE";
  subject: string; message: string | null; documentIds: string[];
};

/**
 * Who this action concerns and which documents it needs, set by hand, and the
 * requests about them. Document Control only. Documents are chosen in the
 * register, opened for this action: ticked is needed, unticked is not.
 */
export function LinksCard({ actionId, code, departments, disciplines, documents, asks, count }: {
  actionId: string;
  code: string;
  /** The disciplines tagged now. */
  departments: string[];
  /** The published disciplines. */
  disciplines: { code: string; label: string }[];
  /** The register, to pick the document a request names. */
  documents: PickItem[];
  asks: Ask[];
  /** How many documents it needs now. */
  count: number;
}) {
  const tagged = disciplines.filter((d) => departments.includes(d.code));
  const disciplineItems = disciplines.map((d) => ({ id: d.code, name: d.label, detail: d.code }));

  return (
    <section id="links" className="register register-sheet register-sheet-open">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
        <span className="stencil mr-1 text-slate-500">Disciplines and documents</span>
        <span className="text-[11px] text-slate-500">Document Control</span>
      </div>

      {asks.length ? (
        <ul id="asked" className="scroll-mt-24 divide-y divide-line border-b border-line">
          {asks.map((ask) => (
            <li key={ask.transmittalId} className="space-y-3 px-5 py-3.5 sm:px-6">
              <div className="space-y-1 text-xs leading-5">
                <p className="font-semibold text-slate-800">
                  {ask.from} asks for {ask.kind === "DISCIPLINE" ? "a missing discipline" : "a document"} to be added
                  <span className="ml-1.5 font-normal text-slate-500">
                    · <Link href={`/transmittals/${ask.transmittalId}`} className="text-link hover:underline">{ask.number}</Link>
                    {ask.since ? `, ${fmtDate(ask.since)}` : ""}
                  </span>
                </p>
                <p className="whitespace-pre-line text-slate-600">{ask.message ?? ask.subject}</p>
              </div>
              {ask.kind === "DISCIPLINE" ? (
                <ActionForm action={setDisciplinesAction} submitLabel="Tag, and answer" hidden={{ actionId, code, transmittalId: ask.transmittalId }} className="space-y-3">
                  <SearchPick browse items={disciplineItems} name="departments" initial={departments} label="Disciplines concerned" placeholder="Type a discipline" />
                </ActionForm>
              ) : tagged.length ? (
                <ActionForm action={addDocumentToActionAction} submitLabel="Add it, and answer" hidden={{ actionId, transmittalId: ask.transmittalId }} className="space-y-3">
                  <SearchPick browse items={documents} name="documentIds" initial={ask.documentIds} label="Document" placeholder="Type a number or a title" required />
                  <Field label="For" required>
                    <select name="department" required defaultValue={tagged.length === 1 ? tagged[0].code : ""} className={inputCls}>
                      <option value="" disabled hidden>Discipline</option>
                      {tagged.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
                    </select>
                  </Field>
                </ActionForm>
              ) : <p className="text-xs text-amber-800">Tag the disciplines first, below.</p>}
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
        <details className="px-5 py-3 sm:px-6" open={!departments.length}>
          <summary className="cursor-pointer list-none text-xs font-semibold text-slate-700 [&::-webkit-details-marker]:hidden">
            Disciplines <span className="font-normal text-slate-500">· {tagged.length ? tagged.map((d) => d.label).join(", ") : "none yet"}</span>
          </summary>
          <ActionForm action={setDisciplinesAction} submitLabel="Save disciplines" hidden={{ actionId, code }} className="mt-3 space-y-3">
            <SearchPick browse items={disciplineItems} name="departments" initial={departments} label="Disciplines" placeholder="Type a discipline" empty="None: the action concerns nobody yet." />
          </ActionForm>
        </details>

        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-6">
          <p className="text-xs text-slate-700">
            <span className="font-semibold">Documents</span> <span className="text-slate-500">· {count} needed</span>
          </p>
          {tagged.length ? (
            <Link href={`/documents?pick=${encodeURIComponent(code)}`} className="ask">Add or take off, in the register</Link>
          ) : <span className="text-xs text-amber-800">Tag the disciplines first.</span>}
        </div>
      </div>
    </section>
  );
}
