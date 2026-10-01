import { Card, Field, inputCls } from "@/components/ui";
import { SearchPick } from "@/components/search-pick";
import { ActionForm } from "@/components/form";
import { fmtDate } from "@/lib/utils";
import {
  delegateReviewAction,
  grantDelegationAction,
  refuseDelegationAction,
  endDelegationAction,
} from "@/lib/actions/delegation";

export type DelegationRow = {
  id: string;
  fromName: string;
  toName: string;
  status: string;
  endDate: Date;
  reason: string | null;
  refusedReason: string | null;
  askedByName: string | null;
  grantedByName: string | null;
  mine: boolean;
  /** Why the matrix would not have made this hand-over, when it would not. */
  flag?: string | null;
};

/**
 * The hand-overs on record for this step: who delegated it to whom, until
 * when, flagged where the matrix would not have made it — and, for Document
 * Control, the ones waiting to be put in force.
 */
export function DelegatePanel({ rows, controller, off = false }: {
  rows: DelegationRow[];
  controller: boolean;
  /** The organization does not use hand-overs: none is asked for or put in force. */
  off?: boolean;
}) {
  const open = rows.filter((row) => row.status === "OPEN");
  const active = rows.filter((row) => row.status === "ACTIVE");
  const answered = rows.filter((row) => row.status === "REFUSED" || row.status === "WITHDRAWN");
  if (!rows.length) return null;

  return (
    <Card
      title="Delegated"
      description="Somebody else answers this step in its holder's place, until a date."
    >
      {active.length ? (
        <ul className="mb-3 space-y-2">
          {active.map((row) => (
            <li key={row.id} className="rounded-lg bg-tint-soft px-3 py-2 text-xs text-slate-700">
              <p>{row.fromName} delegated it to <strong className="font-semibold text-slate-900">{row.toName}</strong>, until {fmtDate(row.endDate)}.</p>
              {row.flag ? <p className="mt-0.5 text-[11px] font-semibold text-amber-700">Flagged: {row.flag}</p> : null}
              {row.reason ? <p className="mt-0.5 text-[11px] text-slate-500">{row.reason}</p> : null}
              {row.mine || controller ? (
                <ActionForm action={endDelegationAction} submitLabel="End it" size="sm" variant="secondary" hidden={{ delegationId: row.id }} className="mt-2" />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {open.length ? (
        <ul className="mb-3 space-y-2">
          {open.map((row) => (
            <li key={row.id} className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-950 ring-1 ring-amber-200">
              <p><strong className="font-semibold">{row.askedByName ?? row.fromName}</strong> asks that {row.toName} answer in {row.fromName}&apos;s place, until {fmtDate(row.endDate)}.</p>
              {row.flag ? <p className="mt-0.5 text-[11px] font-semibold text-amber-700">Flagged: {row.flag}</p> : null}
              {row.reason ? <p className="mt-0.5 text-[11px] opacity-80">{row.reason}</p> : null}
              {controller ? (
                <div className="mt-2 space-y-2">
                  {off ? (
                    <p className="text-[11px] opacity-80">Hand-overs are no longer used on this project, so this can only be declined.</p>
                  ) : (
                    <ActionForm action={grantDelegationAction} submitLabel="Put it in force" size="sm" hidden={{ delegationId: row.id }} />
                  )}
                  <ActionForm action={refuseDelegationAction} submitLabel="Decline" size="sm" variant="secondary" hidden={{ delegationId: row.id }}>
                    <input name="refusedReason" className={inputCls} placeholder="Why — so they know what to do next" />
                  </ActionForm>
                </div>
              ) : (
                <p className="mt-1 text-[11px] opacity-80">Waiting for Document Control.</p>
              )}
              {row.mine && !controller ? (
                <ActionForm action={endDelegationAction} submitLabel="Take it back" size="sm" variant="secondary" hidden={{ delegationId: row.id }} className="mt-2" />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {answered.length ? (
        <ul className="mt-3 space-y-1 border-t border-line pt-3 text-[11px] text-slate-500">
          {answered.map((row) => (
            <li key={row.id}>
              {row.toName} — {row.status === "REFUSED" ? `declined${row.refusedReason ? `: ${row.refusedReason}` : ""}` : "taken back"}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

/**
 * The hand-over form on its own: opened from the answer card's Delegate
 * button, in place of the verdict, so the step is either answered or handed on.
 */
export function DelegateForm({ cycleId, verb, candidates, throughControl, strict = false }: {
  cycleId: string;
  verb: "REVIEW" | "APPROVE";
  candidates: { id: string; name: string; functionName: string; inMatrix: boolean }[];
  throughControl: boolean;
  strict?: boolean;
}) {
  const act = verb === "APPROVE" ? "decide" : "advise";
  const tomorrow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return candidates.length ? (
    <ActionForm
      action={delegateReviewAction}
      submitLabel={throughControl ? "Ask Document Control" : "Hand it over"}
      size="sm"
      hidden={{ cycleId, verb }}
    >
      <SearchPick
        single
        name="toUserId"
        items={candidates.map((one) => ({
          id: one.id,
          name: one.name,
          detail: one.inMatrix ? one.functionName : `${one.functionName} · not in the matrix for this`,
          note: one.inMatrix ? null : `The matrix does not name ${one.name} to ${act} on this kind of document. You can still choose them: it is flagged, and the record says you handed it to them.`,
        }))}
        label="Who answers it"
        required
        hint={strict ? "only people the matrix names for this" : "the matrix's people first — anyone else is flagged"}
      />
      <Field label="Until" required hint="a delegation without an end date is a transfer of the job">
        <input type="date" name="endDate" required defaultValue={tomorrow} className={inputCls} />
      </Field>
      <Field label="Why" hint="optional — on leave, on site, no longer the right person">
        <input name="reason" className={inputCls} />
      </Field>
      <p className="text-[11px] leading-4 text-slate-500">
        {throughControl ? "Document Control puts it in force; until they do, the step is still yours." : "It takes effect at once."}
        {" "}The record says you delegated it to them, and you answer for that choice.
      </p>
    </ActionForm>
  ) : (
    <p className="text-xs leading-5 text-slate-500">
      Nobody else is named to {act} on this kind of document, and on this project the matrix is the only rule — so there is nobody this step can be handed to.
    </p>
  );
}
