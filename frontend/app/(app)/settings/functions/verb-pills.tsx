"use client";

import { useState } from "react";
import { X } from "lucide-react";

/**
 * What a function holds on every document, as pills, each taken out by its cross (owner: "pills of what that function
 * already capable of doing with a close button"): those left are what the form narrows to the documents chosen. The
 * grid stays the one place a permission is given.
 */
export function VerbPills({ verbs }: { verbs: { code: string; label: string; blurb: string }[] }) {
  const [kept, setKept] = useState(verbs.map((v) => v.code));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {verbs.filter((v) => kept.includes(v.code)).map((v) => (
        <span key={v.code} title={v.blurb} className="inline-flex items-center gap-1 rounded-full bg-tint-soft py-0.5 pr-1 pl-2.5 text-xs font-semibold text-slate-700 ring-1 ring-line">
          <input type="hidden" name="verbs" value={v.code} />
          {v.label}
          <button type="button" onClick={() => setKept((now) => now.filter((one) => one !== v.code))} aria-label={`Leave ${v.label} out`}
            title={`Leave ${v.label} out`} className="grid h-4 w-4 place-items-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-700">
            <X className="h-3 w-3" aria-hidden />
          </button>
        </span>
      ))}
      {kept.length < verbs.length ? (
        <button type="button" onClick={() => setKept(verbs.map((v) => v.code))} className="text-xs font-semibold text-link hover:underline">Put them all back</button>
      ) : null}
    </div>
  );
}
