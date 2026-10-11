import { ActionForm } from "@/components/form";
import { fmtDate } from "@/lib/utils";
import { recordActionNoteAction } from "@/lib/actions/action-notes";
import type { WentAhead } from "@/lib/action-state";

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
/** The answer to "Went ahead?", in the words the schedule's column uses. */
const ANSWER: Record<WentAhead, { word: string; tone: string }> = {
  AHEAD: { word: "Not yet", tone: "text-slate-600 ring-line-strong" },
  DONE: { word: "With documents", tone: "text-emerald-800 ring-emerald-300 bg-emerald-50" },
  CARRIED: { word: "Missing documents", tone: "text-amber-900 ring-amber-300 bg-amber-50" },
  POSTPONED: { word: "Postponed", tone: "text-slate-700 ring-slate-300 bg-slate-100" },
};

export function ActionNotes({ notes, actionId, mayNote, answer, missing }: {
  notes: Note[];
  actionId: string;
  /** Whoever writes the note on this project: Document Control, or the manager. */
  mayNote: boolean;
  answer: WentAhead;
  /** How many of the action's documents are not there. */
  missing: number;
}) {
  return (
    <section id="note" className="register register-sheet register-sheet-open">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
        <span className="stencil text-slate-500">Went ahead?</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${ANSWER[answer].tone}`}>{ANSWER[answer].word}</span>
        {notes.length ? (
          <span className="ml-auto font-mono text-[11px] tabular-nums text-slate-500">{notes.length} written</span>
        ) : null}
      </div>

      {notes.length ? (
        <ul className="divide-y divide-line">
          {notes.map((note) => (
            <li key={note.id} className="px-5 py-3 text-xs leading-5 sm:px-6">
              <p className={`font-semibold ${note.decision === "CARRIED" ? "text-amber-800" : "text-slate-700"}`}>
                {note.decision === "CARRIED" ? "Missing documents — it went ahead without them" : "Postponed — it did not happen on the day"}
                {note.plannedDate ? <span className="font-normal text-slate-500"> &middot; the day stood at {fmtDate(note.plannedDate)}</span> : null}
              </p>
              <p className="mt-0.5 text-slate-600"><strong className="font-semibold text-slate-800">{note.responsibleName}</strong> carries it: {note.reason}</p>
              {note.delayResponsible ? (
                <p className="text-slate-600">Delay owed by <strong className="font-semibold text-slate-800">{note.delayResponsible}</strong>{note.delayReason ? `: ${note.delayReason}` : ""}</p>
              ) : null}
              <p className="mt-0.5 text-[11px] text-slate-500">Written down by {note.recordedByName}, {fmtDate(note.createdAt)} &mdash; and kept.</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-3 text-xs leading-5 text-slate-600 sm:px-6">
          {answer === "AHEAD"
            ? "Answered after the day: with documents, missing documents, or postponed."
            : answer === "DONE"
              ? "Every document was there on the day. Nothing to write unless the work was postponed."
              : answer === "CARRIED"
                ? `The day passed with ${missing} document${missing === 1 ? "" : "s"} missing. Write down who let it go ahead, and why — or that it was postponed.`
                : "Postponed."}
        </p>
      )}

      {mayNote && answer !== "POSTPONED" ? (
        /* Only the answers a person gives: "with documents" is read from the documents themselves. */
        <ActionForm action={recordActionNoteAction} hideSubmit hidden={{ actionId }}>
          <div className="asking grid grid-cols-1 gap-x-5 gap-y-4 border-t border-line px-5 py-4 sm:grid-cols-2 sm:px-6">
            <label className="min-w-0">
              <span className="sr-only">Went ahead?</span>
              <select name="decision" required defaultValue="" className="plain w-full">
                <option value="" disabled>Write down&hellip;</option>
                {missing > 0 || answer === "CARRIED" ? <option value="CARRIED">Missing documents &mdash; it went ahead without them</option> : null}
                <option value="STOPPED">Postponed &mdash; it did not happen on the day</option>
              </select>
            </label>
            <label className="min-w-0">
              <span className="sr-only">Who approved it</span>
              <input name="responsibleName" required className="plain w-full" placeholder="Who decided it — the manager this day answers to" />
            </label>
            <label className="min-w-0 sm:col-span-2">
              <span className="sr-only">Why</span>
              <input name="reason" required className="plain w-full" placeholder="Why — in their words, because an audit reads this" />
            </label>
            <label className="min-w-0">
              <span className="sr-only">Delay owed by</span>
              <input name="delayResponsible" className="plain w-full" placeholder="Delay owed by — optional" />
            </label>
            <label className="min-w-0">
              <span className="sr-only">What they say about the delay</span>
              <input name="delayReason" className="plain w-full" placeholder="What they say about it — optional" />
            </label>
            <div className="flex justify-end sm:col-span-2">
              <button className="ask">Write it down</button>
            </div>
          </div>
        </ActionForm>
      ) : !mayNote ? (
        <p className="border-t border-line px-5 py-3 text-xs text-slate-500 sm:px-6">Document Control writes this down, from what the manager and the late party tell them.</p>
      ) : null}
    </section>
  );
}
