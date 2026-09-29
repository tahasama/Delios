"use client";

import { useState } from "react";
import { Field, inputCls } from "@/components/ui";

export type PickPerson = { id: string; name: string; organization: string; /** Why the matrix proposes them. */ basis?: string | null };
export type PickParty = { id: string; name: string };
export type PickReason = { code: string; label: string };

/**
 * Asking for a revision to be sent somewhere.
 *
 * The same questions wherever it is asked: why they are getting it, who they
 * are, and anything the sender needs to know. The distribution matrix proposes
 * our own people and ticks them; everyone else is one click away.
 *
 * On the deciding step of a review it appears with **ask for it to be issued
 * now** ticked, because the person who has just settled what a revision is for
 * is the likeliest to know who needs it. Releasing a revision is issuing it, so
 * this answer is what lets it be released at all: leave it to whoever wrote it
 * and the route waits for them, name an outside approver and the release waits
 * for that party.
 */
export function RequestIssue({ reasons, proposed, others, parties, author, onDecision }: {
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
  /** Shown inside the deciding step's verdict form, where asking is optional. */
  onDecision?: boolean;
}) {
  const [asking, setAsking] = useState(true);
  const [delegated, setDelegated] = useState(false);
  const [addingOthers, setAddingOthers] = useState(false);
  // Some revisions cannot be released until somebody outside has approved them.
  // Saying so here is what makes the release wait for their answer.
  const [outside, setOutside] = useState(false);

  return (
    <div className={onDecision ? "space-y-3 border-t border-slate-100 pt-3" : "space-y-3"}>
      {onDecision ? (
        <>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Once it is released</p>
          <label className="flex items-start gap-2 text-xs text-slate-700">
            <input type="checkbox" name="askNow" defaultChecked value="on" checked={asking} onChange={(event) => setAsking(event.target.checked)} className="mt-0.5" />
            <span>Ask for it to be issued now. Untick if it is not to go anywhere yet — the revision is released and nobody is told, and the document says so.</span>
          </label>
          {!asking ? <input type="hidden" name="askNow" value="off" /> : null}
        </>
      ) : null}

      {onDecision && !asking ? null : (
        <>
          <label className="flex items-start gap-2 text-xs text-slate-700">
            <input type="checkbox" name="delegateNextStep" checked={delegated} onChange={(event) => setDelegated(event.target.checked)} className="mt-0.5" />
            <span>Leave it to {author ?? "whoever wrote it"} — they will be notified, and they ask for it themselves when they know who needs it.</span>
          </label>

          {delegated ? null : (
            <>
              <Field label="Why they are getting it" required hint="what is wanted of them, from your organization's list">
                <select name="issueReason" required defaultValue={reasons[0]?.code ?? "INFORMATION"} className={inputCls}>
                  {reasons.map((one) => <option key={one.code} value={one.code}>{one.code} — {one.label}</option>)}
                </select>
              </Field>

              <div>
                <p className="text-xs font-medium text-slate-700">Our own people</p>
                <p className="mb-1.5 text-[11px] text-slate-400">
                  {proposed.length ? "The distribution matrix puts these people on it. Untick anyone who should not have it." : "The matrix names nobody for this document."}
                </p>
                <div className="space-y-1">
                  {proposed.map((person) => (
                    <label key={person.id} className="flex items-start gap-2 text-xs text-slate-700">
                      <input type="checkbox" name="internalUserIds" value={person.id} defaultChecked className="mt-0.5" />
                      <span>
                        {person.name}
                        {person.basis ? <span className="ml-1 text-[11px] text-slate-400">· {person.basis}</span> : null}
                      </span>
                    </label>
                  ))}
                </div>
                {others.length ? (
                  addingOthers ? (
                    <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                      {others.map((person) => (
                        <label key={person.id} className="flex items-start gap-2 text-xs text-slate-600">
                          <input type="checkbox" name="internalUserIds" value={person.id} className="mt-0.5" />
                          <span>{person.name} <span className="text-[11px] text-slate-400">· {person.organization}</span></span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <button type="button" onClick={() => setAddingOthers(true)} className="mt-1.5 text-[11px] font-semibold text-link hover:underline">
                      Add somebody the matrix does not name
                    </button>
                  )
                ) : null}
              </div>

              {parties.length ? (
                <div>
                  <p className="text-xs font-medium text-slate-700">Other organizations</p>
                  <p className="mb-1.5 text-[11px] text-slate-400">One transmittal for each.</p>
                  <div className="flex flex-wrap gap-1.5">
                    {parties.map((party) => (
                      <label key={party.id} className="flex items-center gap-1.5 rounded-full border border-slate-300 px-2.5 py-1 text-xs text-slate-600">
                        <input type="checkbox" name="partyIds" value={party.id} />
                        {party.name}
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              {parties.length ? (
                <div className="rounded-lg bg-tint-soft px-3 py-2.5">
                  <label className="flex items-start gap-2 text-xs text-slate-700">
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

              <Field label="Anything the sender needs to know" hint="optional — it goes on the transmittal">
                <input name="issueNote" className={inputCls} placeholder="e.g. hold the supplier copy until the PO is signed" />
              </Field>
            </>
          )}
        </>
      )}
    </div>
  );
}
