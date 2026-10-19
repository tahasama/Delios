import { ActionForm } from "@/components/form";
import { Field, inputCls } from "@/components/ui";
import { fmtDate } from "@/lib/core/utils";
import { addNumberAction, takeBackNumberAction } from "@/lib/documents/forms-numbers";

export type Equivalent = {
  id: string; partyId: string; partyCode: string; partyName: string; number: string; source: "MATCHED" | "REGISTERED" | "TYPED";
  recordedByName: string; recordedAt: string; takenBackAt: string | null; takenBackByName: string | null; takenBackReason: string | null;
};

const HOW: Record<Equivalent["source"], string> = {
  MATCHED: "matched to what they sent",
  REGISTERED: "registered from what they sent",
  TYPED: "written in",
};

/**
 * Equivalence: the document under another organization's number as well as ours, one to one, the register finding it
 * under both. Matched when what they sent is put in it, or written in by whoever keeps the register; taken back with why.
 */
export function AlsoKnownAs({ documentId, numbers, parties, mayKeep }: {
  documentId: string;
  numbers: Equivalent[];
  parties: { id: string; code: string; name: string }[];
  mayKeep: boolean;
}) {
  if (!numbers.length && !mayKeep) return null;
  return (
    <div className="mt-4 border-t border-line pt-3">
      <h3 className="stencil mb-2 text-slate-500">Also known as</h3>
      {numbers.length ? (
        <ul className="space-y-1.5 text-xs leading-5 text-slate-700">
          {numbers.map((one) => (
            <li key={one.id} className={one.takenBackAt ? "text-slate-400" : undefined}>
              <span className="font-semibold text-slate-800">{one.partyName}</span>:{" "}
              <span className={`font-mono font-semibold ${one.takenBackAt ? "line-through" : ""}`}>{one.number}</span>
              <span className="text-slate-500"> · {HOW[one.source]} by {one.recordedByName}, {fmtDate(one.recordedAt)}</span>
              {one.takenBackAt ? (
                <span className="block">Taken back {fmtDate(one.takenBackAt)} by {one.takenBackByName}: {one.takenBackReason}</span>
              ) : mayKeep ? (
                <details className="inline">
                  <summary className="ml-2 inline cursor-pointer list-none text-[11px] font-semibold text-link">take back</summary>
                  <ActionForm action={takeBackNumberAction} submitLabel="Take it back" size="sm" hidden={{ documentId, equivalentId: one.id }} className="mt-2 max-w-md">
                    <Field label="Why" required><input name="reason" required className={inputCls} /></Field>
                  </ActionForm>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-500">Known by our number only. Another organization&rsquo;s number for it is kept here, found by the register too.</p>
      )}
      {mayKeep && parties.length ? (
        <details className="mt-2">
          <summary className="cursor-pointer list-none text-xs font-semibold text-link">Add their number</summary>
          <ActionForm action={addNumberAction} submitLabel="Keep it" size="sm" hidden={{ documentId }} className="mt-2 max-w-xl">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Whose number" required>
                <select name="partyId" required defaultValue="" className={inputCls}>
                  <option value="" disabled>Choose</option>
                  {parties.map((one) => <option key={one.id} value={one.id}>{one.code} — {one.name}</option>)}
                </select>
              </Field>
              <Field label="Their number" required><input name="number" required className={inputCls} /></Field>
            </div>
          </ActionForm>
        </details>
      ) : null}
    </div>
  );
}
