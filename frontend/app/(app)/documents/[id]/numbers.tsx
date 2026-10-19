import { ActionForm } from "@/components/form";
import { Field, inputCls } from "@/components/ui";
import { fmtDate } from "@/lib/core/utils";
import { takeBackNumberAction } from "@/lib/documents/forms-numbers";

export type Equivalent = {
  id: string; partyId: string; partyCode: string; partyName: string; number: string; source: "MATCHED" | "REGISTERED" | "TYPED";
  recordedByName: string; recordedAt: string; takenBackAt: string | null; takenBackByName: string | null; takenBackReason: string | null;
};

const HOW: Record<Equivalent["source"], string> = {
  MATCHED: "matched to what they sent",
  REGISTERED: "registered from what they sent",
  TYPED: "written in before numbers were matched only",
};

/**
 * Equivalence: the document under another organization's number as well as ours, one to one, the register finding it
 * under both. Matched when what they sent is put in it, or registered from what they sent; never typed (owner: numbering is never manual). Taken back with why.
 */
export function AlsoKnownAs({ documentId, numbers, mayKeep }: {
  documentId: string;
  numbers: Equivalent[];
  mayKeep: boolean;
}) {
  if (!numbers.length) return null;
  return (
    <div className="mt-4 border-t border-line pt-3">
      <h3 className="stencil mb-2 text-slate-500">Also known as</h3>
      {(
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
      )}
    </div>
  );
}
