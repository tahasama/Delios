import { Card, Field, inputCls } from "@/components/ui";
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
};

/**
 * Handing this step to somebody else.
 *
 * Only people the distribution matrix already names for the same act on this
 * kind of document are offered, so the list itself carries the rule: an
 * electrical technician never appears on an electrical drawing's review, however
 * the handover is asked for.
 */
export function DelegatePanel({
  cycleId, verb, candidates, throughControl, rows, controller, mayHandOver,
}: {
  cycleId: string;
  verb: "REVIEW" | "APPROVE";
  candidates: { id: string; name: string; functionName: string }[];
  /** Document Control carries the handover out on this project. */
  throughControl: boolean;
  rows: DelegationRow[];
  controller: boolean;
  /** The viewer holds this step, so there is something of theirs to hand over. */
  mayHandOver: boolean;
}) {
  const open = rows.filter((row) => row.status === "OPEN");
  const active = rows.filter((row) => row.status === "ACTIVE");
  const answered = rows.filter((row) => row.status === "REFUSED" || row.status === "WITHDRAWN");
  const act = verb === "APPROVE" ? "decide" : "advise";
  const tomorrow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  if (!mayHandOver && !controller && !rows.length) return null;

  return (
    <Card
      title="Somebody else answers it"
      description={`Only people the distribution matrix names to ${act} on this kind of document can be given it — and a delegation always ends on a date.`}
    >
      {active.length ? (
        <ul className="mb-3 space-y-2">
          {active.map((row) => (
            <li key={row.id} className="rounded-lg bg-tint-soft px-3 py-2 text-xs text-slate-700">
              <p><strong className="font-semibold text-slate-900">{row.toName}</strong> answers for {row.fromName}, until {fmtDate(row.endDate)}.</p>
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
              {row.reason ? <p className="mt-0.5 text-[11px] opacity-80">{row.reason}</p> : null}
              {controller ? (
                <div className="mt-2 space-y-2">
                  <ActionForm action={grantDelegationAction} submitLabel="Put it in force" size="sm" hidden={{ delegationId: row.id }} />
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

      {mayHandOver && !active.length && !open.length ? (
        candidates.length ? (
          <ActionForm
            action={delegateReviewAction}
            submitLabel={throughControl ? "Ask Document Control" : "Hand it over"}
            size="sm"
            hidden={{ cycleId, verb }}
          >
            <Field label="Who answers it" required>
              <select name="toUserId" required defaultValue="" className={inputCls}>
                <option value="" disabled>Choose…</option>
                {candidates.map((one) => (
                  <option key={one.id} value={one.id}>{one.name} — {one.functionName}</option>
                ))}
              </select>
            </Field>
            <Field label="Until" required hint="a delegation without an end date is a transfer of the job">
              <input type="date" name="endDate" required defaultValue={tomorrow} className={inputCls} />
            </Field>
            <Field label="Why" hint="optional — on leave, on site, no longer the right person">
              <input name="reason" className={inputCls} />
            </Field>
            {throughControl ? (
              <p className="text-[11px] leading-4 text-slate-500">Document Control puts it in force; until they do, the step is still yours.</p>
            ) : (
              <p className="text-[11px] leading-4 text-slate-500">This project has no control function, so it takes effect at once and the record says you did it.</p>
            )}
          </ActionForm>
        ) : (
          <p className="text-xs leading-5 text-slate-500">
            Nobody else is named to {act} on this kind of document, so there is nobody this step can be handed to. The distribution matrix decides that.
          </p>
        )
      ) : null}

      {answered.length ? (
        <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
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
