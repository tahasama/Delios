import { ActionForm } from "@/components/form";
import { Field, inputCls } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import { recordActionNoteAction } from "@/lib/actions/action-notes";

export type Note = {
  id: string;
  decision: string;
  plannedDate: Date | null;
  responsibleName: string;
  reason: string;
  delayResponsible: string | null;
  delayReason: string | null;
  recordedByName: string;
  createdAt: Date;
};

/**
 * What was decided about an action that did not have its documents.
 *
 * The answer is one of four, as the schedule's column says it: not yet (before
 * the day), with documents (read from the documents), missing documents or
 * postponed (both written down, with who decided and why). The note
 * keeps the day the action stood at when it was written, because a later
 * schedule moves the date and would otherwise erase what was agreed.
 *
 * Drawn as the register draws a question: a sheet with a stencilled name, the
 * plain fields on one grid, and what has been written under it. It is a record
 * beside the documents, not the subject of the page, so it carries no heading
 * of its own.
 */
/** The answer to "Went ahead?", the same as the schedule's column says it. */
export type WentAhead = "NOT_YET" | "WITH_DOCUMENTS" | "MISSING_DOCUMENTS" | "POSTPONED";

const ANSWER: Record<WentAhead, { word: string; tone: string }> = {
  NOT_YET: { word: "Not yet", tone: "text-slate-600 ring-line-strong" },
  WITH_DOCUMENTS: { word: "With documents", tone: "text-emerald-800 ring-emerald-300 bg-emerald-50" },
  MISSING_DOCUMENTS: { word: "Missing documents", tone: "text-amber-900 ring-amber-300 bg-amber-50" },
  POSTPONED: { word: "Postponed", tone: "text-slate-700 ring-slate-300 bg-slate-100" },
};

export function ActionNotes({ notes, actionId, mayNote, answer, missing, total, day, heldUpBy }: {
  notes: Note[];
  actionId: string;
  /** Whoever writes the note on this project: Document Control, or the manager. */
  mayNote: boolean;
  answer: WentAhead;
  /** How many of the action's documents are not there, of how many. */
  missing: number;
  total: number;
  /** The action's day, as written. */
  day: string | null;
  /** Who the late documents were owed by, to choose from when saying who held it up. */
  heldUpBy: string[];
}) {
  // What the situation is, in one sentence, for every answer.
  const situation = answer === "NOT_YET"
    ? `Its day${day ? `, ${day},` : ""} has not come. Answered after it; a postponement can be written down now.`
    : answer === "WITH_DOCUMENTS"
      ? `Every document was there on ${day ?? "the day"}. Nothing to write down unless the work was postponed.`
      : answer === "MISSING_DOCUMENTS"
        ? `${day ?? "The day"} passed with ${missing} of ${total} document${total === 1 ? "" : "s"} missing. Write down who let it go ahead and why, or that it was postponed.`
        : `Postponed${notes[0]?.plannedDate ? ` — its day stood at ${fmtDate(notes[0].plannedDate)}` : ""}.`;

  return (
    <section id="note" className="register register-sheet register-sheet-open">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
        <span className="stencil text-slate-500">Went ahead?</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${ANSWER[answer].tone}`}>{ANSWER[answer].word}</span>
        {notes.length ? (
          <span className="ml-auto font-mono text-[11px] tabular-nums text-slate-500">{notes.length} written</span>
        ) : null}
      </div>

      <p className="px-5 py-3 text-xs leading-5 text-slate-600 sm:px-6">{situation}</p>

      {notes.length ? (
        <ul className="divide-y divide-line border-t border-line">
          {notes.map((note) => (
            <li key={note.id} className="px-5 py-3 text-xs leading-5 sm:px-6">
              <p className={`font-semibold ${note.decision === "CARRIED" ? "text-amber-800" : "text-slate-700"}`}>
                {note.decision === "CARRIED" ? "Missing documents" : "Postponed"}
                {note.plannedDate ? <span className="font-normal text-slate-500"> &middot; the day stood at {fmtDate(note.plannedDate)}</span> : null}
              </p>
              <p className="mt-0.5 whitespace-pre-line text-slate-600"><strong className="font-semibold text-slate-800">{note.responsibleName}</strong> decided: {note.reason}</p>
              {note.delayResponsible ? (
                <p className="whitespace-pre-line text-slate-600">Held up by <strong className="font-semibold text-slate-800">{note.delayResponsible}</strong>{note.delayReason ? `: ${note.delayReason}` : ""}</p>
              ) : null}
              <p className="mt-0.5 text-[11px] text-slate-500">Written down by {note.recordedByName}, {fmtDate(note.createdAt)}, and kept.</p>
            </li>
          ))}
        </ul>
      ) : null}

      {mayNote && answer !== "POSTPONED" ? (
        /* The choices are the schedule's own answers; "With documents" is read
           from the documents, so it is never written down. */
        <ActionForm action={recordActionNoteAction} submitLabel="Write it down" hidden={{ actionId }} className="space-y-4 border-t border-line px-5 py-4 sm:px-6">
          <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
            <Field label="Went ahead?" required>
              <select name="decision" required defaultValue="" className={inputCls}>
                <option value="" disabled hidden>Choose…</option>
                {missing > 0 ? <option value="CARRIED">Missing documents</option> : null}
                <option value="STOPPED">Postponed</option>
              </select>
            </Field>
            <Field label="Who decided" required hint="the manager this day answers to">
              <input name="responsibleName" required className={inputCls} />
            </Field>
          </div>
          <Field label="Why" required hint="in the manager's own words — they give the reason, you write it down">
            <textarea name="reason" required rows={3} className={inputCls} />
          </Field>
          <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
            <Field label="Held up by" hint="optional — who the missing documents were waiting on">
              <input name="delayResponsible" list={`held-up-${actionId}`} className={inputCls} />
              <datalist id={`held-up-${actionId}`}>{heldUpBy.map((one) => <option key={one} value={one} />)}</datalist>
            </Field>
            <Field label="Their explanation" hint="optional — what they said about it">
              <input name="delayReason" className={inputCls} />
            </Field>
          </div>
        </ActionForm>
      ) : !mayNote && answer !== "WITH_DOCUMENTS" ? (
        <p className="border-t border-line px-5 py-3 text-xs text-slate-500 sm:px-6">Document Control writes this down, from what the manager tells them.</p>
      ) : null}
    </section>
  );
}
