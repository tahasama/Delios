"use client";

import { useState } from "react";
import { Field, inputCls } from "@/components/ui";
import { SearchPick } from "@/components/search-pick";

export type PickPerson = { id: string; name: string; organization: string; /** Why the matrix proposes them. */ basis?: string | null };
export type PickParty = { id: string; name: string };
export type PickReason = { code: string; label: string };

/**
 * Asking for a revision to be sent somewhere.
 *
 * The same questions wherever it is asked: why they are getting it, who they
 * are, and anything the sender needs to know. The distribution matrix proposes
 * our own people and ticks them; everyone else is one search away.
 *
 * The answer is one of: who receives it, leave it to whoever wrote it, or —
 * on the deciding step, where the project allows it — no issue required for
 * now. Releasing a revision is issuing it, so this answer is what lets it be
 * released at all: leave it to the author and the route waits for them.
 *
 * A document we produced may need somebody outside to approve it before it is
 * released; that is asked first, because it changes what releasing means.
 */
export function RequestIssue({ reasons, proposed, others, parties, author, onDecision, ours = true, noIssue = false }: {
  /** The published reasons for issue. */
  reasons: PickReason[];
  /** Our people the matrix puts on the distribution for this document. */
  proposed: PickPerson[];
  /** Everyone else on the project. */
  others: PickPerson[];
  /** Organizations on this project. */
  parties: PickParty[];
  /** Whoever wrote the revision, named so the offer to delegate is complete. */
  author?: string | null;
  /** Shown inside the deciding step's verdict form. */
  onDecision?: boolean;
  /** We produced the document, so an outside approval may be needed before release. */
  ours?: boolean;
  /** The project allows "no issue required for now" (POLICY_NO_ISSUE). */
  noIssue?: boolean;
}) {
  const [choice, setChoice] = useState<"SEND" | "AUTHOR" | "NONE">("SEND");
  // Some of our revisions cannot be released until somebody outside has
  // approved them. Saying so here is what makes the release wait for them.
  const [outside, setOutside] = useState(false);
  const offerNone = onDecision && noIssue && !outside;
  const chosen = choice === "NONE" && !offerNone ? "SEND" : choice;

  const option = (value: typeof choice, label: React.ReactNode) => (
    <label className="flex items-start gap-2 text-xs text-slate-700">
      <input type="radio" name="issueChoice" value={value} checked={chosen === value} onChange={() => setChoice(value)} className="mt-0.5" />
      <span>{label}</span>
    </label>
  );

  return (
    <div className={onDecision ? "space-y-3 border-t border-line pt-3" : "space-y-3"}>
      {ours && parties.length ? (
        <div className="rounded-lg bg-amber-50 px-3 py-2.5 ring-1 ring-amber-200">
          <label className="flex items-start gap-2 text-xs text-amber-950">
            <input type="checkbox" name="needsApproval" checked={outside} onChange={(event) => setOutside(event.target.checked)} className="mt-0.5" />
            <span>
              <strong className="font-semibold">Somebody outside has to approve it first.</strong> It is not released until their
              answer comes back: they accept and it is released and issued, they refuse and it goes back to review.
            </span>
          </label>
          {outside ? (
            <div className="mt-2">
              <Field label="Who approves it" required>
                <select name="approverId" required defaultValue="" className={inputCls}>
                  <option value="" disabled>Choose…</option>
                  {parties.map((party) => <option key={party.id} value={party.id}>{party.name}</option>)}
                </select>
              </Field>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-1.5">
        {onDecision ? <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Once it is released</p> : null}
        {option("SEND", "Say who receives it")}
        {option("AUTHOR", <>Leave it to {author ?? "whoever wrote it"} — they are notified, and ask for it themselves when they know who needs it</>)}
        {offerNone ? option("NONE", "No issue required for now — it is released and nobody is told; the document says so") : null}
      </div>
      {chosen === "AUTHOR" ? <input type="hidden" name="delegateNextStep" value="on" /> : null}
      {chosen === "NONE" ? <input type="hidden" name="askNow" value="off" /> : null}

      {chosen === "SEND" ? (
        <>
          <Field label="Why they are getting it" required hint="what is wanted of them, from your organization's list">
            <select name="issueReason" required defaultValue={reasons[0]?.code ?? "INFORMATION"} className={inputCls}>
              {reasons.map((one) => <option key={one.code} value={one.code}>{one.code} — {one.label}</option>)}
            </select>
          </Field>

          {/* Found the way a transmittal is addressed: type, Enter. The
              matrix's people start on the list; anyone else on the project
              is one search away. */}
          <SearchPick
            name="internalUserIds"
            items={[
              ...proposed.map((person) => ({ id: person.id, name: person.name, detail: person.basis ?? person.organization })),
              ...others.map((person) => ({ id: person.id, name: person.name, detail: person.organization })),
            ]}
            initial={proposed.map((person) => person.id)}
            label="Our own people"
            hint={proposed.length ? "the distribution matrix put these on it — remove anyone who should not have it" : "the matrix names nobody for this document"}
          />

          {parties.length ? (
            <SearchPick
              name="partyIds"
              browse
              items={parties.map((party) => ({ id: party.id, name: party.name }))}
              label="Other organizations"
              hint="one transmittal for each — optional"
              placeholder="No other organization"
            />
          ) : null}

          <Field label="Anything the sender needs to know" hint="optional — it goes on the transmittal">
            <input name="issueNote" className={inputCls} placeholder="e.g. hold the supplier copy until the PO is signed" />
          </Field>
        </>
      ) : null}
    </div>
  );
}
