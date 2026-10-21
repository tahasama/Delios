"use client";

import { useState } from "react";
import { SwitchControl } from "@/components/switch";
import { cn } from "@/lib/core/utils";
import {
  STAMP_ON_KEY, STAMP_WHEN, STAMP_SHOWS, STAMP_COMMENTS_KEY, STAMP_PLACE_KEY, STAMP_PLACES, STAMP_KINDS, type StampAnswers,
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
  const returned = on("STAMP:RETURNED") && !on("STAMP:RELEASED");

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
            <Band title="What it shows" said="always: its word, the grade that stands, larger (usually the last decider's), who gave it and when" />
            <ul className="divide-y divide-line">
              {STAMP_SHOWS.map((one) => <Line key={one.key} name={one.key} on={on(one.key)} set={flip(one.key)} label={one.label} text={one.text} />)}
              <Line name={STAMP_COMMENTS_KEY} on={on(STAMP_COMMENTS_KEY)} set={flip(STAMP_COMMENTS_KEY)} label="Why: the comments"
                text="the stamp says how many, and they are listed on a last page of the PDF" />
            </ul>
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
              <div className={cn("w-40 rounded-[2px] border px-1.5 py-1", returned ? "border-red-800 text-red-900" : "border-emerald-800 text-emerald-900")}>
                <p className="text-[7px] font-bold tracking-wide">{returned ? "RETURNED" : "RELEASED"}</p>
                <p className="text-[9px] leading-3 font-bold">{returned ? "R Rejected" : "A Accepted"}</p>
                <p className="text-[6.5px] leading-[9px]">by the decider, the day</p>
                {on("STAMP_SHOW:STEPS") ? <><p className="text-[6.5px] leading-[9px]">1. Advice: grade, who, day</p><p className="text-[6.5px] leading-[9px]">2. Decision: grade, who, day</p></> : null}
                {on("STAMP_SHOW:STATUS") ? <p className="text-[6.5px] leading-[9px]">Released for its status</p> : null}
                {on("STAMP_SHOW:DOCUMENT") ? <p className="text-[6.5px] leading-[9px]">Its number  rev A</p> : null}
                {on("STAMP_SHOW:REVIEW") ? <p className="text-[6.5px] leading-[9px]">Review number</p> : null}
                {on(STAMP_COMMENTS_KEY) ? <p className="text-[6.5px] leading-[9px]">Why: the comments, on the last page</p> : null}
              </div>
            ) : <p className="m-auto text-[11px] text-slate-400">Not stamped</p>}
          </div>
        </div>
      </div>
    </fieldset>
  );
}
