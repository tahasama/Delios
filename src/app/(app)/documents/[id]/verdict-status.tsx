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
  /** The verdict is an objection: the revision cannot be released until it is settled. */
  blocks?: boolean;
  /** The verdict says something is wrong, so it has to say what. */
  wantsComment?: boolean;
  /** Advice, whose code is an internal name rather than something people cite. */
  advice?: boolean;
  meaning?: string | null;
};
export type StatusOption = {
  code: string;
  label: string;
  allowsWork: boolean;
  may?: string | null;
};

/**
 * What every step of a route answers: a verdict, and what the revision is
 * issued for once this step is done.
 *
 * Both are asked at every step, not only at the last one. A step that keeps the
 * status the revision arrived with has to say so on purpose, because passing a
 * document on without having looked at what it is for is the mistake this
 * screen exists to prevent. The last step's answer is binding, and what it
 * leaves behind is a revision that is Not released until Document Control
 * publishes it.
 */
export function VerdictDecision({ verdicts, statuses, deciding, carrying, laterSteps = [], request, advice }: {
  verdicts: VerdictOption[];
  statuses: StatusOption[];
  deciding: boolean;
  /** The status the revision carries as this step opens, if it has one. */
  carrying?: string | null;
  /**
   * The steps of this route that come after this one, so a comment that stops
   * the release can say which of them settles it. "Approved, under reserve of
   * the architect" is that: the architect's step closes it, and the revision
   * does not go round again for it.
   */
  laterSteps?: { number: number; title: string }[];
  /**
   * The request form, shown only on the deciding step and only once a verdict
   * that lets the revision go out has been chosen. A verdict that sends it back
   * has nothing to issue, and asking would be asking about a document that is
   * not going anywhere.
   */
  request?: React.ReactNode;
  /**
   * On an advice step: what this adviser's comments amount to. Advice is not
   * chosen — it is read off what they wrote, so the two can never disagree.
   */
  advice?: { code: string; comments: number; blocking: number } | null;
}) {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState(carrying ?? "");
  const verdict = verdicts.find((one) => one.code === code);
  const proceeds = verdict?.proceeds === true;
  const chosen = statuses.find((one) => one.code === status);
  const unchanged = !!carrying && status === carrying;
  // A verdict that says something is wrong has to say what. One that accepts
  // the revision outright has nothing to add, so it is not asked.
  const needsComment = verdict?.wantsComment === true;

  return (
    <>
      {!deciding && advice ? (
        // Advice is what the comments say. Write, or mark blocking, the comments
        // on the review; this follows them.
        <div className="rounded-lg bg-tint-soft px-3 py-2 text-xs text-slate-700">
          <input type="hidden" name="outcome" value={advice.code} />
          <span className="stencil mr-2 text-slate-500">Your advice</span>
          <strong>{verdicts.find((one) => one.code === advice.code)?.label ?? advice.code}</strong>
          <span className="block text-[11px] text-slate-500">
            {advice.comments
              ? `Worked out from your ${advice.comments} comment${advice.comments === 1 ? "" : "s"}${advice.blocking ? `, ${advice.blocking} of them blocking` : ""}.`
              : "You have written no comment, so you have nothing to say."}
            {" "}To change it, add or edit your comments on the review — not here.
          </span>
        </div>
      ) : (
        <Field label="Your verdict" required hint={deciding ? "this one decides the revision" : "input for whoever decides"}>
          <select name="outcome" required className={inputCls} value={code} onChange={(event) => setCode(event.target.value)}>
            <option value="" disabled>Choose…</option>
            {verdicts.map((one) => <option key={one.code} value={one.code}>{one.advice ? one.label : `${one.code} — ${one.label} (${one.effect})`}</option>)}
          </select>
          {verdict?.meaning ? <span className="mt-1.5 block text-[11px] text-slate-500">{verdict.meaning}</span> : null}
        </Field>
      )}

      {needsComment ? (
        <Field
          label={proceeds ? "What the next revision must fix" : "What must change"}
          required
          hint={`${verdict!.code} — ${verdict!.label.toLowerCase()}: say what, and where`}
        >
          <textarea
            name="comment"
            rows={3}
            required
            className={inputCls}
            placeholder={proceeds ? "what to settle in the next revision" : "what must change before it comes back"}
          />
        </Field>
      ) : null}

      {/* A reservation on somebody else's answer is settled by that answer. */}
      {needsComment && proceeds && laterSteps.length ? (
        <Field label="What settles it" hint="a reservation on a later step is closed when that step answers — the revision does not go round again for it">
          <select name="closesWithStep" defaultValue="" className={inputCls}>
            <option value="">The next revision</option>
            {laterSteps.map((step) => <option key={step.number} value={step.number}>{step.number}. {step.title}</option>)}
          </select>
        </Field>
      ) : null}
      <>
          <Field
            label="Issued for"
            required
            hint={carrying ? `it arrived at ${carrying} — change it, or confirm it stays` : "what the revision is issued for once this step is done"}
          >
            <select name="issuedFor" required value={status} onChange={(event) => setStatus(event.target.value)} className={inputCls}>
              <option value="" disabled>Choose…</option>
              {statuses.map((one) => <option key={one.code} value={one.code}>{one.code} — {one.label}</option>)}
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

          {unchanged ? (
            <label className="flex items-start gap-2 text-xs text-slate-700">
              <input type="checkbox" name="confirmStatus" required className="mt-0.5" />
              <span>It stays at <strong>{carrying}</strong>. I have looked at what it is issued for and it is still right.</span>
            </label>
          ) : null}

          {deciding && verdict && proceeds ? request : null}

          {deciding ? (
            <p className="rounded-lg bg-orange-50 px-3 py-2 text-[11px] leading-5 text-orange-900 ring-1 ring-orange-200">
              This is the last step. Once you answer, the revision reads <strong>Not released</strong> until Document Control publishes it — nobody may work from it before that.
            </p>
          ) : null}
      </>

    </>
  );
}
