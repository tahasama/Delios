"use client";

import { useEffect, useRef, useState } from "react";
import { ResizablePane } from "@/components/resizable-pane";
import { PREF } from "@/lib/core/preferences";
import { SwitchControl } from "@/components/switch";
import { cn } from "@/lib/core/utils";
import { inputCls } from "@/components/ui";
import {
  STAMP_ON_KEY, STAMP_WHEN, STAMP_SHOWS, STAMP_COMMENTS_KEY, STAMP_PLACE_KEY, STAMP_PLACES, STAMP_KINDS, STAMP_NOTE_KEY, STAMP_NOTE_MAX, STAMP_SIZE_KEY, STAMP_SIZES,
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

/** The preview's page at its own width, in pixels: the stamp drawn on it is at scale 1. */
const PAGE_W = 208;

/**
 * The stamp, as one card (owner): stamped or not, when a review stamps, what the stamp shows, why, where it sits, and the
 * marks across the page; beside it, the stamp drawn on a page as it will read. Fields of the form around it.
 */
export function StampFields({ initial, disabled = false, pane = null }: { initial: StampAnswers; disabled?: boolean; pane?: number | null }) {
  const [a, setA] = useState<StampAnswers>(initial);
  const on = (key: string) => a[key] === "ON";
  const flip = (key: string) => (value: boolean) => setA({ ...a, [key]: value ? "ON" : "OFF" });
  const stamped = on(STAMP_ON_KEY);
  const place = a[STAMP_PLACE_KEY];
  const size = a[STAMP_SIZE_KEY] || "M";
  const scale = STAMP_SIZES.find((one) => one.value === size)?.scale ?? 1;
  const when = on("STAMP_SHOW:TIME") ? "21 Oct 2026 14:32" : "21 Oct 2026";
  const [shownReturned, setShownReturned] = useState(false);
  // The page grows with the preview, dragged wider: the stamp is drawn to the page's scale.
  const page = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const box = page.current;
    if (!box) return;
    const watch = new ResizeObserver(() => setZoom(box.offsetWidth / PAGE_W));
    watch.observe(box);
    return () => watch.disconnect();
  }, []);

  return (
    <fieldset disabled={disabled} className="min-w-0 disabled:opacity-70">
      <input type="hidden" name={STAMP_PLACE_KEY} value={place} />
      <div className="flex flex-wrap">
        <div className="min-w-0 flex-1 basis-96">
          <ul>
            <Line name={STAMP_ON_KEY} on={stamped} set={flip(STAMP_ON_KEY)} label="Stamp the PDF people open"
              text="a copy is made with the stamp; the file as sent is kept either way. Off: no PDF is stamped or marked." />
          </ul>
          <div className={cn(!stamped && "opacity-50")}>
            <Band title="When" said="a review stamps the revision it decided" />
            <ul className="divide-y divide-line">
              {STAMP_WHEN.map((one) => <Line key={one.key} name={one.key} on={on(one.key)} set={flip(one.key)} label={one.label} text={one.text} />)}
            </ul>
            <Band title="What it shows" said="besides the outcome" />
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
            <Band title="Where it sits, and how large" said="on every page; its frame and its words grow or shrink together" />
            <div className="flex flex-wrap items-center gap-3 px-5 py-3 sm:px-6">
              <input type="hidden" name={STAMP_SIZE_KEY} value={size} />
              <span className="choice" role="group" aria-label="Where the stamp sits">
                {STAMP_PLACES.map((one) => (
                  <button key={one.value} type="button" aria-pressed={place === one.value} onClick={() => setA({ ...a, [STAMP_PLACE_KEY]: one.value })}
                    className={cn("choice-side", place === one.value && "choice-on")}>
                    {one.label}
                  </button>
                ))}
              </span>
              <span className="choice" role="group" aria-label="How large the stamp is">
                {STAMP_SIZES.map((one) => (
                  <button key={one.value} type="button" aria-pressed={size === one.value} onClick={() => setA({ ...a, [STAMP_SIZE_KEY]: one.value })}
                    className={cn("choice-side", size === one.value && "choice-on")}>
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

        {/* The page, with the stamp where it will sit, at its size, reading as it will. */}
        <ResizablePane name={PREF.stampPane} initial={pane} min={240} edge="left" className="w-full border-t border-line p-4 md:w-60 md:border-t-0 md:border-l">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[11px] text-slate-500">As it reads on the page</p>
            <span className="choice" role="group" aria-label="Show it as">
              {(["Released", "Returned"] as const).map((one) => (
                <button key={one} type="button" aria-pressed={(one === "Returned") === shownReturned} onClick={() => setShownReturned(one === "Returned")}
                  className={cn("choice-side", (one === "Returned") === shownReturned && "choice-on")}>{one}</button>
              ))}
            </span>
          </div>
          <div ref={page} aria-hidden className={cn("flex aspect-[1/1.414] overflow-hidden rounded-sm bg-white p-2 shadow-sm ring-1 ring-line",
            place.startsWith("TOP") ? "items-start" : "items-end", place.endsWith("RIGHT") ? "justify-end" : "justify-start", !stamped && "opacity-40")}>
            {stamped ? (
              // As the worker draws it (Stamping.Stamp): the register's colour for the state, the outcome alone.
              <div style={{ transform: `scale(${scale * zoom})`, transformOrigin: `${place.startsWith("TOP") ? "top" : "bottom"} ${place.endsWith("RIGHT") ? "right" : "left"}` }}
                className={cn("w-48 shrink-0 rounded-md border bg-white px-2 py-1.5", shownReturned ? "border-rose-700" : "border-emerald-700")}>
                <p className="text-[6.5px] font-bold text-slate-800">Your organization · project code</p>
                <p className={cn("mt-1 rounded px-1.5 py-[2px] text-[7.5px] font-bold",
                  shownReturned ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700")}>
                  {shownReturned ? "C3 — Rejected" : "C1 — Accepted"}
                </p>
                <div className="mt-1 text-[5.5px] leading-[8px] text-slate-800">
                  {!on("STAMP_SHOW:STEPS") ? <>
                    <p><span className="inline-block w-12 font-bold text-slate-500">REVIEWED BY</span>the decider</p>
                    <p><span className="inline-block w-12 font-bold text-slate-500">DATE</span>{when}</p>
                  </> : null}
                  {on("STAMP_SHOW:STATUS") ? <p><span className="inline-block w-12 font-bold text-slate-500">RELEASED FOR</span>its status</p> : null}
                  {on("STAMP_SHOW:DOCUMENT") ? <p><span className="inline-block w-12 font-bold text-slate-500">DOCUMENT</span>its number rev A</p> : null}
                  {on("STAMP_SHOW:REVIEW") ? <p><span className="inline-block w-12 font-bold text-slate-500">REVIEW</span>its number</p> : null}
                  {on(STAMP_COMMENTS_KEY) ? <p><span className="inline-block w-12 font-bold text-slate-500">WHY</span>comments, on the last page</p> : null}
                </div>
                {on("STAMP_SHOW:STEPS") ? (
                  <div className="mt-1 border-t border-slate-200 pt-[2px] text-[5px] leading-[7px] text-slate-800">
                    <div className="grid grid-cols-[1.3fr_1.2fr_1fr_1fr] font-bold text-slate-500"><span>STEP</span><span>GRADE</span><span>BY</span><span>ON</span></div>
                    <div className="grid grid-cols-[1.3fr_1.2fr_1fr_1fr]"><span>1. Review</span><span>No comment</span><span>an adviser</span><span>{when}</span></div>
                    <div className="grid grid-cols-[1.3fr_1.2fr_1fr_1fr]"><span>2. Decision</span><span>{shownReturned ? "C3 — Rejected" : "C1 — Accepted"}</span><span>the decider</span><span>{when}</span></div>
                  </div>
                ) : null}
                {a[STAMP_NOTE_KEY] ? <p className="mt-1 border-t border-slate-200 pt-[2px] text-[4.5px] leading-[6px] text-slate-500">{a[STAMP_NOTE_KEY]}</p> : null}
              </div>
            ) : <p className="m-auto text-[11px] text-slate-400">Not stamped</p>}
          </div>
          <p className="mt-2 hidden text-[11px] text-slate-400 md:block">Drag its left edge to see it larger.</p>
        </ResizablePane>
      </div>
    </fieldset>
  );
}
