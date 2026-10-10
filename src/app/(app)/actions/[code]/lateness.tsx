import { ActionForm } from "@/components/form";
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
 * Two questions and a reason: what happened, who carries it, and why. The note
 * keeps the day the action stood at when it was written, because a later
 * schedule moves the date and would otherwise erase what was agreed.
 *
 * Drawn as the register draws a question: a sheet with a stencilled name, the
 * plain fields on one grid, and what has been written under it. It is a record
 * beside the documents, not the subject of the page, so it carries no heading
 * of its own.
 */
export function ActionNotes({ notes, actionId, mayNote }: {
  notes: Note[];
  actionId: string;
  /** Whoever writes the note on this project: Document Control, or the manager. */
  mayNote: boolean;
}) {
  if (!notes.length && !mayNote) return null;
  return (
    <section id="note" className="register register-sheet register-sheet-open">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2 sm:px-6">
        <span className="stencil mr-1 text-slate-400">Went ahead?</span>
        <span className="text-[11px] text-slate-400">when the day came with documents missing: did the work go ahead, or was it postponed &mdash; kept, with the date the day stood at</span>
        {notes.length ? (
          <span className="ml-auto font-mono text-[11px] tabular-nums text-slate-500">{notes.length} written</span>
        ) : null}
      </div>

      {notes.length ? (
        <ul className="divide-y divide-line">
          {notes.map((note) => (
            <li key={note.id} className="px-5 py-3 text-xs leading-5 sm:px-6">
              <p className={`font-semibold ${note.decision === "CARRIED" ? "text-amber-800" : "text-slate-700"}`}>
                {note.decision === "CARRIED" ? "Went ahead with missing documents" : "Postponed — the work did not happen"}
                {note.plannedDate ? <span className="font-normal text-slate-500"> &middot; the day stood at {fmtDate(note.plannedDate)}</span> : null}
              </p>
              <p className="mt-0.5 text-slate-600"><strong className="font-semibold text-slate-800">{note.responsibleName}</strong> carries it: {note.reason}</p>
              {note.delayResponsible ? (
                <p className="text-slate-600">Delay owed by <strong className="font-semibold text-slate-800">{note.delayResponsible}</strong>{note.delayReason ? `: ${note.delayReason}` : ""}</p>
              ) : null}
              <p className="mt-0.5 text-[11px] text-slate-400">Written down by {note.recordedByName}, {fmtDate(note.createdAt)} &mdash; and kept.</p>
            </li>
          ))}
        </ul>
      ) : null}

      {mayNote ? (
        /* The register's own controls: a line of the page, not a form to fill
           in — the same plain fields the schedule asks its questions with. */
        <ActionForm action={recordActionNoteAction} hideSubmit hidden={{ actionId }}>
          <div className="asking grid grid-cols-1 gap-x-4 gap-y-3.5 px-5 py-3.5 sm:grid-cols-2 sm:px-6">
            <label className="min-w-0">
              <span className="sr-only">Went ahead?</span>
              <select name="decision" required defaultValue="" className="plain w-full">
                <option value="" disabled>Went ahead?&hellip;</option>
                <option value="CARRIED">Yes, with missing documents</option>
                <option value="STOPPED">The work was postponed &mdash; it did not happen</option>
              </select>
            </label>
            <label className="min-w-0">
              <span className="sr-only">Who approved it</span>
              <input name="responsibleName" required className="plain w-full" placeholder="Who approved it — the manager this day answers to" />
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
      ) : (
        <p className="px-5 py-3.5 text-xs text-slate-500 sm:px-6">Document Control writes this note, from what the manager and the late party tell them.</p>
      )}
    </section>
  );
}
