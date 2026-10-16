import { ActionForm } from "@/components/form";
import { SearchPick, type PickItem } from "@/components/search-pick";
import { Field, inputCls } from "@/components/ui";
import { fmtDate } from "@/lib/core/utils";
import { recordActionNoteAction, confirmPostponementAction, reverseDecisionAction } from "@/lib/actions/forms-decisions";
import type { PlanDecision } from "@/lib/actions/api";

type Note = PlanDecision;

/** The answer to "Went ahead?", the same as the schedule's column says it. */
export type WentAhead = "NOT_YET" | "WITH_DOCUMENTS" | "MISSING_DOCUMENTS" | "POSTPONED";

const ANSWER: Record<WentAhead, { word: string; tone: string }> = {
  NOT_YET: { word: "Answered after the day", tone: "text-slate-600 ring-line-strong" },
  WITH_DOCUMENTS: { word: "With documents", tone: "text-emerald-800 ring-emerald-300 bg-emerald-50" },
  MISSING_DOCUMENTS: { word: "Missing documents", tone: "text-amber-900 ring-amber-300 bg-amber-50" },
  POSTPONED: { word: "Postponed", tone: "text-slate-700 ring-slate-300 bg-slate-100" },
};

/**
 * Went ahead? One of four answers, as the schedule's column says it: not yet
 * (before the day), with documents and missing documents (both read from the
 * documents), or postponed. Missing documents are explained by each discipline
 * short of them, under "Disciplines concerned"; what is written here is the
 * postponement: who decided and why, then whoever plans the project confirms it
 * with what changes, and the control function can take it back. Nothing is erased:
 * a postponement taken back stays, marked.
 */
export function ActionNotes({ notes, actionId, mayNote, mayPlan, mayControl, answer, missing, total, day, postponeCodes, people }: {
  notes: Note[];
  actionId: string;
  /** Who writes a postponement down: the control function, or whoever the project lets. */
  mayNote: boolean;
  /** Whoever plans the project: they confirm a postponement. */
  mayPlan: boolean;
  /** The control function: takes a decision back. */
  mayControl: boolean;
  answer: WentAhead;
  /** How many of the action's documents are not there, of how many. */
  missing: number;
  total: number;
  /** The action's day, as written. */
  day: string | null;
  /** The published decisions that mean "postponed"; the first is the one written down here. */
  postponeCodes: string[];
  /** Everyone on the project, of every organization: who decided a postponement is one of them. */
  people: PickItem[];
}) {
  const active = notes.find((note) => postponeCodes.includes(note.decision) && !note.reversedAt) ?? null;
  const situation = answer === "NOT_YET"
    ? `Nothing to fill in now. ${day ? `After ${day}` : "After its day"} this says whether it went ahead, from its documents.`
    : answer === "WITH_DOCUMENTS"
      ? `Every document was there on ${day ?? "the day"}.`
      : answer === "MISSING_DOCUMENTS"
        ? `${day ?? "The day"} passed with ${missing} of ${total} document${total === 1 ? "" : "s"} missing. Each discipline short of documents says why it went ahead without them, under Disciplines concerned; or write down here that it was postponed.`
        : active?.confirmedAt
          ? "Postponed, and confirmed by whoever plans the project: a new schedule revision is to follow."
          : "Postponed. Whoever plans the project is asked to confirm it.";

  return (
    <section id="note" className="register register-sheet register-sheet-open">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
        <span className="stencil text-slate-500">Went ahead?</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${ANSWER[answer].tone}`}>{ANSWER[answer].word}</span>
      </div>

      <p className="px-5 py-3 text-xs leading-5 text-slate-600 sm:px-6">{situation}</p>

      {notes.length ? (
        <ul className="divide-y divide-line border-t border-line">
          {notes.map((note) => {
            const postponement = postponeCodes.includes(note.decision);
            return (
              <li key={note.id} className={`space-y-1 px-5 py-3 text-xs leading-5 sm:px-6 ${note.reversedAt ? "text-slate-500" : ""}`}>
                <p className={`font-semibold ${note.reversedAt ? "text-slate-500 line-through" : postponement ? "text-slate-800" : "text-amber-800"}`}>
                  {postponement ? "Postponed" : "Missing documents"}
                  {note.plannedStart ? <span className="font-normal text-slate-500 no-underline"> &middot; the day stood at {fmtDate(note.plannedStart)}</span> : null}
                </p>
                <p className="whitespace-pre-line text-slate-600"><strong className="font-semibold text-slate-800">{note.responsibleName}</strong> decided: {note.reason}</p>
                {note.delayOwedBy ? (
                  <p className="whitespace-pre-line text-slate-600">Held up by <strong className="font-semibold text-slate-800">{note.delayOwedBy}</strong>{note.delayReason ? `: ${note.delayReason}` : ""}</p>
                ) : null}
                {postponement && note.confirmedAt ? (
                  <p className="whitespace-pre-line text-emerald-800">Confirmed by <strong className="font-semibold">{note.confirmedBy}</strong>, {fmtDate(note.confirmedAt)}: {note.confirmNote}</p>
                ) : postponement && !note.reversedAt ? (
                  <p className="text-amber-800">Waiting for whoever plans the project to confirm it.</p>
                ) : null}
                {note.reversedAt ? (
                  <p className="whitespace-pre-line text-red-800">Taken back by <strong className="font-semibold">{note.reversedBy}</strong>, {fmtDate(note.reversedAt)}: {note.reversedReason}</p>
                ) : null}
                <p className="text-[11px] text-slate-500">Written down by {note.recordedBy}, {fmtDate(note.recordedAt)}, and kept.</p>

                {/* Whoever plans confirms it, with what changes for the next schedule revision. */}
                {postponement && note === active && !note.confirmedAt && mayPlan ? (
                  <ActionForm action={confirmPostponementAction} submitLabel="Confirm the postponement" hidden={{ actionId, decisionId: note.id }} className="space-y-3 pt-2">
                    <Field label="What changes" required hint="the new day, or what the next schedule revision will carry">
                      <textarea name="note" required rows={3} className={inputCls} />
                    </Field>
                  </ActionForm>
                ) : null}
                {/* The control function can take it back: a planner who would not confirm, a mistake. */}
                {note === active && mayControl ? (
                  <details className="pt-1">
                    <summary className="cursor-pointer text-xs font-semibold text-link">Take it back</summary>
                    <ActionForm action={reverseDecisionAction} submitLabel="Take it back" hidden={{ actionId, decisionId: note.id }} className="mt-2 space-y-3">
                      <Field label="Why" required hint="kept with the postponement, and everyone concerned is told">
                        <textarea name="note" required rows={2} className={inputCls} />
                      </Field>
                    </ActionForm>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* Only if it does not go ahead on the day: kept folded, so nobody takes it for a form to fill. */}
      {mayNote && !active && postponeCodes.length ? (
        <details className="border-t border-line px-5 py-3 sm:px-6">
          <summary className="cursor-pointer list-none text-xs font-semibold text-link [&::-webkit-details-marker]:hidden">
            {answer === "NOT_YET" ? `Will it not go ahead${day ? ` on ${day}` : ""}? Record a postponement` : "It did not go ahead? Record a postponement"}
          </summary>
          <ActionForm action={recordActionNoteAction} submitLabel="Record the postponement" hidden={{ actionId, decision: postponeCodes[0] }} className="mt-3 space-y-4">
            <SearchPick single items={people} name="decidedBy" label="Who decided" hint="anyone on the project: client, contractor, owner, our own people" placeholder="Type a name or an organization" required />
            <Field label="Why" required>
              <textarea name="reason" required rows={3} className={inputCls} />
            </Field>
            <p className="text-[11px] text-slate-500">Everyone concerned is told, and whoever plans the project is asked to confirm it.</p>
          </ActionForm>
        </details>
      ) : null}
    </section>
  );
}
