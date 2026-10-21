"use client";

import { useState } from "react";
import { SwitchControl } from "@/components/switch";
import { cn } from "@/lib/core/utils";
import { inputCls } from "@/components/ui";
import {
  STAMP_ON_KEY, STAMP_WHEN, STAMP_SHOWS, STAMP_COMMENTS_KEY, STAMP_PLACE_KEY, STAMP_PLACES, STAMP_KINDS, STAMP_NOTE_KEY, STAMP_NOTE_MAX,
  type StampAnswers,
} from "@/lib/settings/stamp";

/** One switch with what it switches, a line of the card. */
function Line({ name, on, set, label, text }: { name: string; on: boolean; set: (on: boolean) => void; label: string; text: string }) {
  return (
    <li>
      <label className="flex cursor-pointer items-start gap-2.5 px-5 py-2.5 sm:px-6">
        <SwitchControl name={name} checked={on} onChange={set} className="mt-0.5" />
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold text-slate-800">{label}</span>
          <span className="block text-xs text-slate-600">{text}</span>
        </span>
      </label>
    </li>
  );
}

/** A band heading part of the card. */
function Band({ title, said }: { title: string; said: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-y border-line bg-tint-soft px-5 py-2 sm:px-6">
      <span className="stencil mr-1 text-slate-500">{title}</span>
      <span className="text-[11px] text-slate-500">{said}</span>
    </div>
  );
}

/**
 * The stamp, as one card (owner): stamped or not, when a review stamps, what the stamp shows, why, where it sits, and the
 * marks across the page; beside it, the stamp drawn on a page as it will read. Fields of the form around it.
 */
export function StampFields({ initial, disabled = false }: { initial: StampAnswers; disabled?: boolean }) {
  const [a, setA] = useState<StampAnswers>(initial);
  const on = (key: string) => a[key] === "ON";
  const flip = (key: string) => (value: boolean) => setA({ ...a, [key]: value ? "ON" : "OFF" });
  const stamped = on(STAMP_ON_KEY);
  const place = a[STAMP_PLACE_KEY];

  return (
    <fieldset disabled={disabled} className="min-w-0 disabled:opacity-70">
      <input type="hidden" name={STAMP_PLACE_KEY} value={place} />
      <div className="grid md:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="min-w-0">
          <ul>
            <Line name={STAMP_ON_KEY} on={stamped} set={flip(STAMP_ON_KEY)} label="Stamp the PDF people open"
              text="a copy is made with the stamp; the file as sent is kept either way. Off: no PDF is stamped or marked." />
          </ul>
          <div className={cn(!stamped && "opacity-50")}>
            <Band title="When" said="a review stamps the revision it decided" />
            <ul className="divide-y divide-line">
              {STAMP_WHEN.map((one) => <Line key={one.key} name={one.key} on={on(one.key)} set={flip(one.key)} label={one.label} text={one.text} />)}
            </ul>
            <Band title="What it shows" said="always: the organization and the project, every grade the review could give with the one given ticked, who reviewed it and when" />
            <ul className="divide-y divide-line">
              {STAMP_SHOWS.map((one) => <Line key={one.key} name={one.key} on={on(one.key)} set={flip(one.key)} label={one.label} text={one.text} />)}
              <Line name={STAMP_COMMENTS_KEY} on={on(STAMP_COMMENTS_KEY)} set={flip(STAMP_COMMENTS_KEY)} label="Why: the comments"
                text="the stamp says how many, and they are listed on a last page of the PDF" />
            </ul>
            <Band title="Words at its foot" said="what the review does not relieve the sender of, as your contracts say it; none unless written" />
            <div className="px-5 py-3 sm:px-6">
              <textarea name={STAMP_NOTE_KEY} rows={2} maxLength={STAMP_NOTE_MAX} value={a[STAMP_NOTE_KEY] ?? ""}
                onChange={(e) => setA({ ...a, [STAMP_NOTE_KEY]: e.target.value })} aria-label="Words at the stamp's foot"
                placeholder="e.g. Review does not relieve the sender of its responsibility for the work and its compliance with the contract."
                className={cn(inputCls, "h-auto py-1.5")} />
            </div>
            <Band title="Where it sits" said="on every page" />
            <div className="px-5 py-3 sm:px-6">
              <span className="choice" role="group" aria-label="Where the stamp sits">
                {STAMP_PLACES.map((one) => (
                  <button key={one.value} type="button" aria-pressed={place === one.value} onClick={() => setA({ ...a, [STAMP_PLACE_KEY]: one.value })}
                    className={cn("choice-side", place === one.value && "choice-on")}>
                    {one.label}
                  </button>
                ))}
              </span>
            </div>
            <Band title="Marks across the page" said="not a review's stamp: where a revision stands since" />
            <ul className="divide-y divide-line">
              {STAMP_KINDS.map((one) => <Line key={one.key} name={one.key} on={on(one.key)} set={flip(one.key)} label={one.label} text={one.text} />)}
            </ul>
          </div>
        </div>

        {/* The page, with the stamp where it will sit, reading as it will. */}
        <div className="border-t border-line p-4 md:border-t-0 md:border-l">
          <p className="mb-2 text-[11px] text-slate-500">As it reads on the page</p>
          <div aria-hidden className={cn("flex h-64 rounded-sm bg-white p-2 shadow-sm ring-1 ring-line",
            place.startsWith("TOP") ? "items-start" : "items-end", place.endsWith("RIGHT") ? "justify-end" : "justify-start", !stamped && "opacity-40")}>
            {stamped ? (
              // As the worker draws it (Stamping.Stamp): one design, one ink; the box ticked says the outcome.
              <div className="w-52 border-[1.5px] border-[#1c346e] bg-white p-[2px] text-[#1c346e]">
                <div className="border-[0.5px] border-[#1c346e] px-1.5 py-1">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[7.5px] font-bold">YOUR ORGANIZATION</span>
                    <span className="text-[5px] font-bold">DOCUMENT REVIEW</span>
                  </div>
                  <p className="text-[5.5px] opacity-75">Project code</p>
                  <div className="mt-[2px] space-y-[1px] border-t border-[#1c346e] pt-[2px] text-[6px] leading-[8px]">
                    {[["C1", "Accepted", true], ["C2", "Accepted with comments", false], ["C3", "Rejected", false]].map(([code, words, given]) => (
                      <div key={String(code)} className={cn("flex items-center gap-1", given ? "font-bold" : "opacity-75")}>
                        <span className="grid h-[6px] w-[6px] place-items-center border-[0.5px] border-[#1c346e] text-[5px] leading-none">{given ? "×" : ""}</span>
                        <span className="w-4">{code}</span><span>{words}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-[2px] border-t border-[#1c346e] pt-[2px] text-[5.5px] leading-[8px]">
                    <p><span className="inline-block w-12 font-bold opacity-75">REVIEWED BY</span>the decider</p>
                    <p><span className="inline-block w-12 font-bold opacity-75">DATE</span>the day</p>
                    {on("STAMP_SHOW:STATUS") ? <p><span className="inline-block w-12 font-bold opacity-75">RELEASED FOR</span>its status</p> : null}
                    {on("STAMP_SHOW:DOCUMENT") ? <p><span className="inline-block w-12 font-bold opacity-75">DOCUMENT</span>its number rev A</p> : null}
                    {on("STAMP_SHOW:REVIEW") ? <p><span className="inline-block w-12 font-bold opacity-75">REVIEW</span>its number</p> : null}
                    {on(STAMP_COMMENTS_KEY) ? <p><span className="inline-block w-12 font-bold opacity-75">WHY</span>comments, on the last page</p> : null}
                  </div>
                  {on("STAMP_SHOW:STEPS") ? (
                    <div className="mt-[2px] border-t border-[#1c346e] pt-[2px] text-[5px] leading-[7px]">
                      <div className="grid grid-cols-[1.3fr_1.2fr_1fr_0.9fr] font-bold opacity-75"><span>STEP</span><span>GRADE</span><span>BY</span><span>ON</span></div>
                      <div className="grid grid-cols-[1.3fr_1.2fr_1fr_0.9fr]"><span>1. Review</span><span>No comment</span><span>an adviser</span><span>the day</span></div>
                      <div className="grid grid-cols-[1.3fr_1.2fr_1fr_0.9fr]"><span>2. Decision</span><span>C1 — Accepted</span><span>the decider</span><span>the day</span></div>
                    </div>
                  ) : null}
                  {a[STAMP_NOTE_KEY] ? <p className="mt-[2px] border-t border-[#1c346e] pt-[2px] text-[4.5px] leading-[6px] opacity-75">{a[STAMP_NOTE_KEY]}</p> : null}
                </div>
              </div>
            ) : <p className="m-auto text-[11px] text-slate-400">Not stamped</p>}
          </div>
        </div>
      </div>
    </fieldset>
  );
}
