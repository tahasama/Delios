"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, X } from "lucide-react";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const parse = (value: string) => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : null);
const short = (value: string) => {
  const date = parse(value);
  return date ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(date) : "";
};
const long = (value: string) => {
  const date = parse(value);
  return date ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date) : "";
};

/** The chosen window, written the way the register writes any other date. */
export function dateWindowLabel(from: string, to: string) {
  if (!from) return "";
  return !to || to === from ? long(from) : `${short(from)} – ${long(to)}`;
}

/**
 * The date filter, asked in two steps because it is two questions. The cell
 * opens the list of dates the register holds; choosing one opens the calendar
 * for that date. One click is a day, a second click makes it a window, and the
 * arrow at the top goes back to the list.
 */
export function DateWindow({ fields, on, from, to }: {
  fields: { code: string; label: string }[];
  on: string;
  from: string;
  to: string;
}) {
  const [open, setOpen] = useState(false);
  /** Empty means the panel is on step one, the list of dates. */
  const [field, setField] = useState(on);
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to || from);
  const [month, setMonth] = useState(() => parse(from) ?? new Date());
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { setField(on); setStart(from); setEnd(to || from); }, [on, from, to]);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    const esc = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const submit = () => box.current?.closest("form")?.requestSubmit();
  const choose = (code: string) => { setField(code); setStart(""); setEnd(""); setMonth(new Date()); };
  const back = () => { setField(""); setStart(""); setEnd(""); };
  const pick = (day: Date) => {
    const value = iso(day);
    if (!start || (start && end && start !== end)) { setStart(value); setEnd(value); return; }
    if (value < start) { setEnd(start); setStart(value); return; }
    setEnd(value);
  };
  const clear = () => { setField(""); setStart(""); setEnd(""); setOpen(false); setTimeout(submit); };
  const apply = () => { setOpen(false); setTimeout(submit); };

  const applied = !!on && !!from;
  const held = !!field && !!start;
  const label = (code: string) => fields.find((item) => item.code === code)?.label ?? "";
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const today = iso(new Date());

  return (
    <div ref={box} className="relative min-w-0">
      {/* Outside the panel, so narrowing by something else while it is shut
          keeps the date window that is already applied. */}
      <input type="hidden" name="on" value={held ? field : ""} />
      <input type="hidden" name="from" value={held ? start : ""} />
      <input type="hidden" name="to" value={held ? (end && end !== start ? end : start) : ""} />

      <button
        type="button"
        onClick={() => setOpen((shown) => !shown)}
        aria-expanded={open}
        data-on={applied ? "true" : "false"}
        className="plain"
        title={applied ? `${label(on)}, ${dateWindowLabel(from, to)} — click to change it` : "Filter by a date the register holds"}
      >
        {applied ? <>{label(on)} <span className="font-mono text-[11px] tabular-nums">{dateWindowLabel(from, to)}</span></> : "Date"}
      </button>

      {open ? (
        <div className="dt-menu absolute left-0 top-full z-40 mt-1 w-60 rounded-xl p-1.5">
          {!field ? (
            <>
              <p className="stencil px-2 pb-1 pt-1 text-slate-400">Which date</p>
              {fields.map((item) => (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => choose(item.code)}
                  className="block w-full rounded-lg px-2 py-1.5 text-left text-xs text-slate-700 transition-colors hover:bg-slate-50 hover:text-brand-ink"
                >
                  {item.label}
                </button>
              ))}
            </>
          ) : (
            <>
              <div className="flex items-center justify-between px-1 pb-1 pt-0.5">
                <button type="button" onClick={back} className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-brand-ink" title="Back to the list of dates">
                  <ChevronLeft className="h-3 w-3" /> {label(field)}
                </button>
                <button type="button" onClick={() => setOpen(false)} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close without applying">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="flex items-center justify-between border-t border-line px-1 py-1.5">
                <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded px-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Previous month">‹</button>
                <span className="text-xs font-semibold text-slate-800">{MONTHS[month.getMonth()]} {month.getFullYear()}</span>
                <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded px-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Next month">›</button>
              </div>

              <div className="grid grid-cols-7 gap-0.5 px-1 pb-1 text-center">
                {WEEKDAYS.map((weekday) => <span key={weekday} className="text-[10px] font-semibold uppercase text-slate-400">{weekday}</span>)}
                {Array.from({ length: lead }).map((_, i) => <span key={`lead-${i}`} />)}
                {Array.from({ length: days }).map((_, i) => {
                  const day = new Date(month.getFullYear(), month.getMonth(), i + 1);
                  const value = iso(day);
                  const inWindow = !!start && !!end && value >= start && value <= end;
                  const edge = value === start || value === end;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => pick(day)}
                      className={`rounded-sm py-1 font-mono text-[11px] tabular-nums transition-colors ${
                        edge ? "bg-brand font-semibold text-white"
                          : inWindow ? "bg-tint text-brand-ink"
                            : value === today ? "text-brand-ink ring-1 ring-brand-line/40 hover:bg-slate-100"
                              : "text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center justify-between border-t border-line px-1 pt-1.5">
                <span className="text-[10px] text-slate-400">{start && end && start !== end ? "A window" : start ? "One day — click another for a window" : "Pick a day"}</span>
                <span className="flex gap-1">
                  <button type="button" onClick={clear} className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-100">Clear</button>
                  <button type="button" onClick={apply} disabled={!held} className="rounded bg-brand px-2 py-0.5 text-[11px] font-semibold text-white disabled:opacity-40">Apply</button>
                </span>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
