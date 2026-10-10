"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Something that can be done from the Next step sheet: a link that goes
 * somewhere, or a form that opens under the sheet. `primary` is the one the
 * sheet is about; `open` starts it open (the first one asking wins).
 */
export type StepItem = {
  key: string;
  label: React.ReactNode;
  primary?: boolean;
  open?: boolean;
  href?: string;
  body?: React.ReactNode;
};

/**
 * The body of the Next step sheet: where the revision is on the left, what
 * can be done about it stacked on the right, and the one chosen opened across
 * the whole sheet underneath — so a form has room, and only one is open.
 */
export function NextStepBody({ status, items }: { status: React.ReactNode; items: StepItem[] }) {
  const [open, setOpen] = useState<string | null>(() => (items.find((one) => one.open && one.primary && one.body) ?? items.find((one) => one.open && one.body))?.key ?? null);
  const chosen = items.find((one) => one.key === open && one.body);
  const panel = useRef<HTMLDivElement>(null);

  // A link elsewhere on the page to "#step-<key>" opens that form here and
  // brings it into view. The address is put back, so the same link works again.
  useEffect(() => {
    const follow = () => {
      const key = window.location.hash.startsWith("#step-") ? window.location.hash.slice(6) : null;
      if (!key || !items.some((one) => one.key === key && one.body)) return;
      setOpen(key);
      history.replaceState(null, "", window.location.pathname + window.location.search);
      requestAnimationFrame(() => panel.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [items]);

  return (
    <>
      <div className={cn("grid gap-x-8 gap-y-4 px-5 py-4 sm:px-6", items.length ? "lg:grid-cols-[minmax(0,1fr)_18rem]" : "")}>
        <div className="min-w-0 self-center">{status}</div>
        {items.length ? (
          <div className="flex flex-wrap gap-2 lg:flex-col lg:border-l lg:border-line lg:pl-6">
            {items.map((one) => {
              const cls = "ask w-auto justify-between whitespace-nowrap text-left lg:w-full";
              const inner = (
                <>
                  <span className="inline-flex min-w-0 items-center gap-2 truncate">{one.label}</span>
                  {one.href ? <ArrowRight className="h-3.5 w-3.5 shrink-0 opacity-70" /> : <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 opacity-70 transition-transform", open === one.key && "rotate-90")} />}
                </>
              );
              return one.href ? (
                <Link key={one.key} href={one.href} data-on={one.primary ? "true" : undefined} className={cls}>{inner}</Link>
              ) : (
                <button
                  key={one.key}
                  type="button"
                  aria-expanded={open === one.key}
                  data-on={one.primary ? "true" : undefined}
                  onClick={() => setOpen((now) => (now === one.key ? null : one.key))}
                  className={cn(cls, open === one.key && !one.primary && "border-brand-line bg-tint")}
                >
                  {inner}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {chosen ? (
        <div ref={panel} className="scroll-mt-24 border-t border-line">
          <div className="flex items-center justify-between gap-3 bg-tint-soft px-5 py-2 sm:px-6">
            <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-slate-800">{chosen.label}</span>
            <button type="button" onClick={() => setOpen(null)} className="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-tint hover:text-slate-700" aria-label="Close">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="px-5 py-4 sm:px-6">{chosen.body}</div>
        </div>
      ) : null}
    </>
  );
}

/**
 * The life of a revision as a line of stages, the one it is at filled: what
 * is behind it ticked, what is ahead plain. Tells where it is without a
 * sentence about it.
 */
export function StagePath({ stages, at, note, under }: {
  stages: string[];
  at: number;
  note?: React.ReactNode;
  /** One short line under each stage, read with the stage it belongs to. */
  under?: React.ReactNode[];
}) {
  return (
    <div>
      <ol className={cn("flex flex-wrap gap-y-2", under ? "items-start gap-y-4" : "items-center")}>
        {stages.map((name, i) => (
          <li key={name} className={cn("flex", under ? "items-start" : "items-center")}>
            {i ? <span className={cn("mx-1 h-px w-3 sm:mx-1.5 sm:w-10", under && "mt-[13px]", i <= at ? "bg-(--color-brand)" : "bg-line-strong")} aria-hidden /> : null}
            <span className={under ? "flex flex-col items-center gap-1.5 text-center" : "contents"}>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold",
                i < at && "text-slate-500",
                i === at && "bg-(--color-brand) text-white",
                i > at && "text-slate-400 ring-1 ring-line-strong",
              )}
              aria-current={i === at ? "step" : undefined}
            >
              {i < at ? "✓" : null} {name}
            </span>
            {under?.[i] ? <span className="px-2.5 text-xs leading-5 text-slate-500">{under[i]}</span> : null}
            </span>
          </li>
        ))}
      </ol>
      {note ? <p className="mt-2.5 text-[13px] text-slate-600">{note}</p> : null}
    </div>
  );
}
