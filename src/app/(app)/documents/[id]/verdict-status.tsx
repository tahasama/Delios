"use client";

import { useState } from "react";
import { Field, inputCls } from "@/components/ui";

export type VerdictOption = {
  code: string;
  label: string;
  effect: string;
  proceeds: boolean;
  /** The verdict carries comments into the next revision (accepted with comments). */
  resubmit?: boolean;
  meaning?: string | null;
};
export type StatusOption = { code: string; label: string; allowsWork: boolean; may?: string | null };

/**
 * Two different acts, so two different forms.
 *
 * An advisory step is not asked anything. Its comments are the advice: no
 * comment means nothing to say, a comment that stops the release means "settle
 * this first". Asking for a code as well would only let the two disagree.
 *
 * The deciding step chooses from the verdict list, and a verdict that proceeds
 * must say what the revision may then be used for — the control function
 * releases at exactly that and cannot change it.
 */
export function VerdictDecision({ verdicts, statuses, deciding, own, commentsHref }: {
  verdicts: VerdictOption[];
  statuses: StatusOption[];
  deciding: boolean;
  /** This person's comments on this step: on an advisory step they *are* the advice. */
  own?: { total: number; blocking: number };
  /** Where the comments are written, for an adviser who has not written any. */
  commentsHref?: string;
}) {
  // An advisory step asks nothing. What the person wrote is the advice, so the
  // form says what will be recorded and takes an optional note.
  if (!deciding) {
    const advice = (own?.blocking ?? 0) > 0 ? "Comments, blocking" : (own?.total ?? 0) > 0 ? "Comments, not blocking" : "Nothing to say";
    return (
      <>
        <div className="rounded-lg bg-surface px-3 py-2.5 text-xs ring-1 ring-slate-200">
          <p className="font-semibold text-slate-800">Your advice will read: {advice}</p>
          <p className="mt-1 leading-5 text-slate-500">
            {(own?.total ?? 0) === 0 ? (
              <>You have written no comments. {commentsHref ? <a href={commentsHref} className="font-semibold text-link underline">Write one</a> : "Write one"} if something is wrong, or send this as it stands.</>
            ) : (
              <>
                {own!.total} comment{own!.total === 1 ? "" : "s"}
                {own!.blocking ? `, ${own!.blocking} of them marked as stopping the release` : ", none stopping the release"}.
                {commentsHref ? <> <a href={commentsHref} className="font-semibold text-link underline">Change them</a>.</> : null}
              </>
            )}
          </p>
        </div>
        <Field label="Note" hint="optional — your comments say the rest">
          <textarea name="note" rows={2} className={inputCls} placeholder="anything worth recording beside the comments" />
        </Field>
      </>
    );
  }
  return <Decision verdicts={verdicts} statuses={statuses} />;
}

/** The deciding step: the verdict, what it may be used for, and why. */
function Decision({ verdicts, statuses }: { verdicts: VerdictOption[]; statuses: StatusOption[] }) {
  const deciding = true;
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const verdict = verdicts.find((v) => v.code === code);
  const proceeds = verdict?.proceeds === true;
  const chosen = statuses.find((s) => s.code === status);
  // A verdict that returns the revision needs a reason; one that carries
  // comments into the next revision needs the comments themselves.
  const needsWords = !!verdict && (!proceeds || verdict.resubmit === true);

  return (
    <>
      <Field label="Your verdict" required hint="the one decision on this revision">
        <select name="outcome" required className={inputCls} value={code} onChange={(e) => setCode(e.target.value)}>
          <option value="" disabled>Choose…</option>
          {verdicts.map((v) => <option key={v.code} value={v.code}>{v.code} — {v.label} ({v.effect})</option>)}
        </select>
        {verdict?.meaning ? <span className="mt-1.5 block text-[11px] text-slate-500">{verdict.meaning}</span> : null}
      </Field>

      {proceeds ? (
        <Field label="It may then be used for" required hint="your decision — the control function releases at exactly this and cannot change it">
          <select name="proposedStatus" required value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
            <option value="" disabled>Choose…</option>
            {statuses.map((s) => <option key={s.code} value={s.code}>to be {s.code} — {s.label}</option>)}
          </select>
          {chosen ? (
            <span className={`mt-1.5 block text-[11px] ${chosen.allowsWork ? "font-semibold text-amber-700" : "text-slate-500"}`}>
              {chosen.may
                ? `Once released: ${chosen.may.charAt(0).toLowerCase()}${chosen.may.slice(1)} (${chosen.code}).`
                : chosen.allowsWork
                  ? `Once released, people may build, fabricate or order from it (${chosen.code}).`
                  : `Once released, it may be read and commented on, but not built from (${chosen.code}).`}
            </span>
          ) : null}
        </Field>
      ) : null}

      <Field
        label={needsWords ? (proceeds ? "What the next revision must fix" : "What must change") : "Note"}
        required={needsWords}
        hint={needsWords ? "the author needs to know what to do" : "optional — your comments say the rest"}
      >
        <textarea
          name="note"
          rows={2}
          required={needsWords}
          className={inputCls}
          placeholder={needsWords ? (proceeds ? "what to settle in the next revision" : "what must change before it comes back") : "anything worth recording"}
        />
      </Field>
    </>
  );
}
