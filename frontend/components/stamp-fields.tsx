"use client";

import { useState } from "react";
import { SwitchControl } from "@/components/switch";
import { cn } from "@/lib/core/utils";
import { STAMP_SHOWS, STAMP_COMMENTS_KEY, STAMP_PLACE_KEY, STAMP_PLACES } from "@/lib/settings/stamp";

export type StampValues = { shows: Record<string, boolean>; comments: boolean; place: string };

/**
 * The stamp as one thing (owner): what it always carries, what the project adds, why, and where it sits, with the
 * stamp itself drawn on a page as it will read. Fields of the form around it (the Control room's, or the defaults').
 */
export function StampFields({ initial, disabled = false }: { initial: StampValues; disabled?: boolean }) {
  const [shows, setShows] = useState(initial.shows);
  const [comments, setComments] = useState(initial.comments);
  const [place, setPlace] = useState(initial.place);
  const top = place.startsWith("TOP");
  const right = place.endsWith("RIGHT");

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_13rem]">
      <fieldset disabled={disabled} className="min-w-0 space-y-3 disabled:opacity-70">
        <input type="hidden" name={STAMP_PLACE_KEY} value={place} />
        <p className="text-xs leading-5 text-slate-600">
          Always on it: <span className="font-semibold text-slate-800">Released</span>, the grade that stands, larger (the most severe of
          the deciders&rsquo;, usually the last&rsquo;s), who gave it and when.
        </p>
        <ul className="divide-y divide-line rounded-md ring-1 ring-line">
          {STAMP_SHOWS.map((one) => (
            <li key={one.key}>
              <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2">
                <SwitchControl name={one.key} checked={!!shows[one.key]} onChange={(on) => setShows({ ...shows, [one.key]: on })} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-slate-800">{one.label}</span>
                  <span className="block text-xs text-slate-600">{one.text}</span>
                </span>
              </label>
            </li>
          ))}
          <li>
            <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2">
              <SwitchControl name={STAMP_COMMENTS_KEY} checked={comments} onChange={setComments} className="mt-0.5" />
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-slate-800">Why: the comments</span>
                <span className="block text-xs text-slate-600">the stamp says how many, and they are listed on a last page of the PDF</span>
              </span>
            </label>
          </li>
        </ul>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-[13px] font-medium text-slate-900">Where it sits</span>
          <span className="choice" role="group" aria-label="Where the stamp sits">
            {STAMP_PLACES.map((one) => (
              <button key={one.value} type="button" aria-pressed={place === one.value} onClick={() => setPlace(one.value)}
                className={cn("choice-side", place === one.value && "choice-on")}>
                {one.label}
              </button>
            ))}
          </span>
        </div>
      </fieldset>

      {/* The page, with the stamp where it will sit, reading as it will. */}
      <div aria-hidden className={cn("relative flex h-56 rounded-sm bg-white p-2 shadow-sm ring-1 ring-line", top ? "items-start" : "items-end", right ? "justify-end" : "justify-start")}>
        <div className="w-36 rounded-[2px] border border-emerald-800 px-1.5 py-1 text-emerald-900">
          <p className="text-[7px] font-bold tracking-wide">RELEASED</p>
          <p className="text-[9px] leading-3 font-bold">A Accepted</p>
          <p className="text-[6.5px] leading-[9px]">by the decider, the day</p>
          {shows["STAMP_SHOW:STEPS"] ? <p className="text-[6.5px] leading-[9px]">1. Each step: grade, who, day</p> : null}
          {shows["STAMP_SHOW:STATUS"] ? <p className="text-[6.5px] leading-[9px]">Released for its status</p> : null}
          {shows["STAMP_SHOW:DOCUMENT"] ? <p className="text-[6.5px] leading-[9px]">Its number  rev A</p> : null}
          {shows["STAMP_SHOW:REVIEW"] ? <p className="text-[6.5px] leading-[9px]">Review number</p> : null}
          {comments ? <p className="text-[6.5px] leading-[9px]">Why: the comments, on the last page</p> : null}
        </div>
      </div>
    </div>
  );
}
