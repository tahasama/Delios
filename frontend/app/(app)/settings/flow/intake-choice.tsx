"use client";

import { useActionState, useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { inputCls } from "@/components/ui";
import { cn } from "@/lib/core/utils";
import { AS_RECEIVED_RISKS } from "@/components/as-received-warning";
import { setIntakeAction } from "@/lib/settings/forms-how-it-works";

type Option = { code: string; label: string };
const WAYS = [
  { value: "PLACEHOLDERS", label: "By placeholder", text: "We register and number what we ask of them; they fill it. What comes unplanned is matched to one of ours or registered under our numbering." },
  { value: "AS_RECEIVED", label: "As they come, an exception", text: "No placeholders: what they send goes into the register under their own number, revision, status and review outcome once the check accepts it." },
] as const;

/**
 * How other organizations' documents come into the project. By placeholder is the way (owner); taking them as they
 * come is an exception a project is made into by hand, with what they are filed under and its warning read, never a
 * choice drawn as its equal. Once either way is in use, the other is refused.
 */
export function IntakeChoice({ mode, filing, deliverableTypes, docTypes, disciplines, readOnly, fixed }: {
  mode: string;
  filing: { deliverableType: string | null; docType: string | null; discipline: string | null };
  deliverableTypes: Option[];
  docTypes: Option[];
  disciplines: Option[];
  readOnly: boolean;
  fixed: boolean;
}) {
  const [asked, setAsked] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(setIntakeAction, undefined);
  useEffect(() => { if (state?.ok) setAsked(null); }, [state]);
  const locked = readOnly || fixed;
  const shown = WAYS.find((one) => one.value === asked);
  const name = (list: Option[], code: string | null) => list.find((one) => one.code === code)?.label ?? code ?? "";
  // As they come may be asked again to change what they are filed under.
  const askFiling = asked === "AS_RECEIVED";
  const select = (field: string, label: string, list: Option[], value: string | null) => (
    <label className="flex min-w-0 flex-col gap-1 text-xs text-slate-700">
      <span className="font-medium">{label}</span>
      <select name={field} defaultValue={value ?? ""} className={inputCls}>
        <option value="">Choose…</option>
        {list.map((one) => <option key={one.code} value={one.code}>{one.label}</option>)}
      </select>
    </label>
  );

  const exception = mode === "AS_RECEIVED";
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="min-w-0 text-[13px] font-medium text-slate-900">Other organizations&rsquo; documents come in</p>
        <span className={cn("text-[13px] font-semibold", exception ? "text-red-700" : "text-slate-900")}>
          {exception ? "As they come (an exception)" : "By placeholder"}
        </span>
      </div>
      <p className="mt-1 text-xs leading-5 text-slate-600">
        {fixed ? <span className="mr-1.5 inline-flex items-center gap-1 font-medium text-slate-500"><Lock className="h-3 w-3" aria-hidden />The organization&rsquo;s, on every project.</span> : null}
        {exception
          ? <>This project is an exception: no placeholders; what they send goes into the register under their own number, revision, status and review outcome once the check accepts it, filed under {name(deliverableTypes, filing.deliverableType)} / {name(docTypes, filing.docType)} / {name(disciplines, filing.discipline)}.</>
          : <>We register and number what we ask of them; they fill it. What comes unplanned is matched to one of ours or made a document under our numbering.</>}
      </p>
      {!locked && asked === null ? (
        <button type="button" onClick={() => setAsked(exception ? "PLACEHOLDERS" : "AS_RECEIVED")} className="mt-1 text-xs font-semibold text-link hover:underline">
          {exception ? "Change what they are filed under, or go back to placeholders" : "Make this project an exception: take them as they come"}
        </button>
      ) : null}

      {asked !== null && !locked ? (
        <form action={formAction} className="choice-confirm mt-2 space-y-2 rounded-md px-3 py-2.5">
          {exception ? (
            <span className="choice" role="group" aria-label="Which way">
              {WAYS.map((one) => (
                <button key={one.value} type="button" aria-pressed={asked === one.value} onClick={() => setAsked(one.value)}
                  className={cn("choice-side", asked === one.value && "choice-on")}>
                  {one.value === "AS_RECEIVED" ? "Keep the exception" : "Back to placeholders"}
                </button>
              ))}
            </span>
          ) : null}
          <input type="hidden" name="mode" value={asked} />
          <p className="text-xs leading-5 text-slate-700"><span className="font-semibold text-slate-900">From now on: </span>{shown?.label}. {shown?.text}</p>
          <p className="text-xs leading-5 text-slate-500">One way or the other: once one is in use, the other is refused.</p>
          {askFiling ? (
            <>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {select("deliverableType", "Deliverable type", deliverableTypes, filing.deliverableType)}
                {select("docType", "Document type", docTypes, filing.docType)}
                {select("discipline", "Discipline", disciplines, filing.discipline)}
              </div>
              <div className="rounded-md bg-red-50 px-3 py-2 text-xs leading-5 text-red-900 ring-1 ring-red-200">
                <p className="font-semibold">The register is no longer consistent</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {AS_RECEIVED_RISKS.map(([what, why]) => <li key={what}><span className="font-semibold">{what}:</span> {why}</li>)}
                </ul>
                <label className="mt-2 flex items-center gap-2 font-medium">
                  <input type="checkbox" name="understood" />
                  I understand what it does to the register
                </label>
              </div>
            </>
          ) : null}
          {state?.error ? <p role="alert" className="text-xs text-red-700">{state.error}</p> : null}
          <div className="flex items-center gap-2">
            <button type="submit" disabled={pending} data-on="true" className="ask">{pending ? "Saving…" : asked === mode ? "Save" : asked === "AS_RECEIVED" ? "Make it the exception" : "Switch it"}</button>
            <button type="button" onClick={() => setAsked(null)} className="ask">Keep as is</button>
          </div>
        </form>
      ) : state?.ok ? (
        <p className="mt-1 text-xs text-emerald-700">{state.ok}</p>
      ) : null}
    </li>
  );
}
