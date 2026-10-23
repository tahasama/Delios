"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Minus, MoveDiagonal2, Plus, X } from "lucide-react";
import { ActionForm } from "@/components/form";
import { Field } from "@/components/ui";
import { Select } from "@/components/select";
import { cn, fmtDate } from "@/lib/core/utils";
import { markDayAction, unmarkDayAction } from "@/lib/settings/forms-calendar";
import { CALENDAR_DAY, PREF, savePreference } from "@/lib/core/preferences";

type DayOff = { id: string; day: string; name: string; country: string | null; source: "ORGANIZATION" | "PROJECT" };
type ActionDay = { code: string; name: string; start: string | null; finish: string | null };

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** A day as yyyy-mm-dd, whatever the browser's time zone. */
const key = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
/** 1 Monday … 7 Sunday, as the backend numbers days. */
const isoDay = (y: number, m: number, d: number) => ((new Date(Date.UTC(y, m, d)).getUTCDay() + 6) % 7) + 1;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * The calendar (owner): one month at a time, Monday to Sunday, stepped through with its arrows as the date picker is
 * (owner: "apply the regular calendar"), from `from` to `to`. Days off each week are
 * shaded; an organization's public holiday and a project's own day off are marked, each with its name; the schedule's
 * action days are highlighted. A click on a day opens it under the months: what it holds, and, for whoever keeps this
 * calendar, claims it (a name, and for the organization its country) or unclaims it, asked first.
 */
export function MonthsCalendar({ from, to, weekend, today, daysOff, actions = [], claim, countries, daySize = CALENDAR_DAY.normal, namesShown = true, aside, month, before, after }: {
  from: string; to: string; weekend: number[]; today?: string; daysOff: DayOff[]; actions?: ActionDay[];
  /** How large a day is drawn (its side, in pixels), as the person left it (cookie `calendar-day`, read by the server). */
  daySize?: number;
  /** Whether the names of the days off and the actions are written inside the days (cookie `calendar-names`). */
  namesShown?: boolean;
  /** Drawn at the end of the key's line: where the days off are kept, on the Schedule's calendar. */
  aside?: React.ReactNode;
  /** The month it opens on ("yyyy-mm"); none: this month where it is on the calendar, else its first. */
  month?: string;
  /** Where the arrows go past its first and last months (the organization's calendar: the year before, the year after). */
  before?: string;
  after?: string;
  /** Who keeps this calendar: the organization's holidays, or the project's own days off; none: read only. */
  claim?: { level: "organization" | "project"; defaultCountry?: string | null };
  /** The countries a holiday may be kept in (the organization's calendar). */
  countries?: { code: string; name: string }[];
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [country, setCountry] = useState<string>("");
  // The whole calendar grows or shrinks as its corner is dragged: each day keeps its square, each month its seven
  // columns, so it never reads out of proportion. Double-click puts it back.
  const [size, setSize] = useState(daySize);
  const [names, setNames] = useState(namesShown);
  const onResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const x = e.clientX, y = e.clientY;
    const from = size;
    let next = from;
    document.body.classList.add("dt-resizing");
    const move = (ev: PointerEvent) => {
      // A month is seven days wide and about six high: the corner moves by that much per pixel of a day.
      const delta = ((ev.clientX - x) / 7 + (ev.clientY - y) / 6) / 2;
      next = Math.round(Math.min(CALENDAR_DAY.max, Math.max(CALENDAR_DAY.min, from + delta)));
      setSize(next);
    };
    const up = () => {
      document.body.classList.remove("dt-resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      savePreference(PREF.calendarDay, String(next));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const resetSize = () => { setSize(CALENDAR_DAY.normal); savePreference(PREF.calendarDay, ""); };
  // The same by a step, from the buttons beside "Names in the days".
  const stepSize = (by: number) => {
    const next = Math.min(CALENDAR_DAY.max, Math.max(CALENDAR_DAY.min, size + by));
    setSize(next);
    savePreference(PREF.calendarDay, next === CALENDAR_DAY.normal ? "" : String(next));
  };
  const sizeBtn = "inline-flex h-6 w-6 items-center justify-center rounded text-slate-600 hover:bg-tint disabled:opacity-40";
  const toggleNames = (on: boolean) => { setNames(on); savePreference(PREF.calendarNames, on ? "" : "0"); };
  // A month as wide as its seven days and their gaps, with its own padding.
  const monthWidth = size * 7 + 6 * 2 + 20;
  const writes = names && size >= 44;
  // After a claim or an unclaim the page is drawn again; the day stays open.
  useEffect(() => { if (open && (open < from || open > to)) setOpen(null); }, [from, to, open]);

  const shown = useMemo(() => daysOff.filter((d) => !country || d.country === null || d.country === country), [daysOff, country]);
  const byDay = useMemo(() => {
    const map = new Map<string, DayOff[]>();
    for (const d of shown) map.set(d.day, [...(map.get(d.day) ?? []), d]);
    return map;
  }, [shown]);
  const actionsOn = (day: string) => actions.filter((a) => a.start && a.start <= day && (a.finish ?? a.start) >= day);
  const nameOf = (code: string | null) => (code ? countries?.find((c) => c.code === code)?.name ?? code : "every country");

  const months: { y: number; m: number }[] = [];
  for (let y = +from.slice(0, 4), m = +from.slice(5, 7) - 1; key(y, m, 1) <= to; m === 11 ? (y++, m = 0) : m++) months.push({ y, m });
  const indexOf = (ym: string | undefined) => (ym ? months.findIndex(({ y, m }) => key(y, m, 1).slice(0, 7) === ym) : -1);
  const opening = Math.max(0, indexOf(month) >= 0 ? indexOf(month) : indexOf(today?.slice(0, 7)));
  const [at, setAt] = useState(opening);
  useEffect(() => { setAt(opening); }, [opening]);
  const here = months[Math.min(at, months.length - 1)];
  const onToday = indexOf(today?.slice(0, 7));

  const openDays = open ? byDay.get(open) ?? [] : [];
  const openActions = open ? actionsOn(open) : [];
  const mine = open && claim ? openDays.filter((d) => d.source === (claim.level === "organization" ? "ORGANIZATION" : "PROJECT")) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
          <li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-tint ring-1 ring-line" /> Day off each week</li>
          <li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-rose-100 ring-1 ring-rose-300" /> Public holiday</li>
          {claim?.level !== "organization" ? <li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-amber-100 ring-1 ring-amber-300" /> The project&rsquo;s own day off</li> : null}
          {actions.length ? <li className="flex items-center gap-1.5"><span className="h-1 w-3 rounded-full bg-sky-600" /> An action&rsquo;s days</li> : null}
          {today ? <li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm ring-2 ring-brand-line" /> Today</li> : null}
        </ul>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={names} onChange={(e) => toggleNames(e.target.checked)} /> Names in the days
        </label>
        <span className="flex items-center gap-1 text-xs text-slate-600" title="Drag the corner of the calendar too. Double-click Size to put it back.">
          <span onDoubleClick={resetSize} className="select-none">Size</span>
          <button type="button" onClick={() => stepSize(-16)} disabled={size <= CALENDAR_DAY.min} className={sizeBtn} title="Smaller" aria-label="Smaller"><Minus className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={() => stepSize(16)} disabled={size >= CALENDAR_DAY.max} className={sizeBtn} title="Larger" aria-label="Larger"><Plus className="h-3.5 w-3.5" /></button>
          {size !== CALENDAR_DAY.normal ? <button type="button" onClick={resetSize} className="text-link hover:underline">Normal</button> : null}
        </span>
        {countries ? (
          <div className="w-60">
            <Select value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Whose holidays" className="plain w-full">
              <option value="">Every country&rsquo;s holidays</option>
              {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </Select>
          </div>
        ) : null}
        {aside}
      </div>

      <div className="relative mx-auto w-fit max-w-full pr-5 pb-5">
      <div style={{ width: `min(100%, ${monthWidth}px)` }}>
        {[here].filter(Boolean).map(({ y, m }) => {
          const first = isoDay(y, m, 1);
          const length = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
          const marked = Array.from({ length }, (_, i) => key(y, m, i + 1)).filter((d) => byDay.has(d)).length;
          return (
            <section key={`${y}-${m}`} className="rounded-md bg-surface p-2.5 ring-1 ring-line">
              <div className="mb-2 flex items-center gap-1 px-0.5">
                <Step to={at > 0 ? () => setAt(at - 1) : before} label="Previous month"><ChevronLeft className="h-4 w-4" aria-hidden /></Step>
                <h3 className="min-w-36 text-center text-[13px] font-semibold text-slate-800">{MONTHS[m]} {y}</h3>
                <Step to={at < months.length - 1 ? () => setAt(at + 1) : after} label="Next month"><ChevronRight className="h-4 w-4" aria-hidden /></Step>
                {onToday >= 0 && onToday !== at ? (
                  <button type="button" onClick={() => setAt(onToday)} className="ml-1 text-xs font-semibold text-link hover:underline">This month</button>
                ) : null}
                {marked ? <span className="ml-auto text-[11px] text-slate-500">{marked} off</span> : null}
              </div>
              <div className="grid grid-cols-7 gap-0.5 text-center">
                {WEEK.map((w, i) => (
                  <span key={w} className={cn("pb-0.5 text-[10.5px] font-medium", weekend.includes(i + 1) ? "text-slate-400" : "text-slate-500")}>{w.slice(0, 2)}</span>
                ))}
                {Array.from({ length: first - 1 }, (_, i) => <span key={`gap-${i}`} />)}
                {Array.from({ length }, (_, i) => {
                  const day = key(y, m, i + 1);
                  const off = byDay.get(day) ?? [];
                  const holiday = off.some((d) => d.source === "ORGANIZATION");
                  const own = off.some((d) => d.source === "PROJECT");
                  const busy = actionsOn(day);
                  const resting = weekend.includes(isoDay(y, m, i + 1));
                  const words = [...off.map((d) => d.name), ...busy.map((a) => `${a.code} · ${a.name}`)].join("\n");
                  return (
                    // A day is opened by a click; an action's name written in it opens the action itself (owner), so the day
                    // is not a button (a link may not sit inside one) but answers the keys as one.
                    <div key={day} role="button" tabIndex={0} onClick={() => setOpen(open === day ? null : day)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(open === day ? null : day); } }}
                      title={words || undefined} aria-pressed={open === day} aria-label={`${fmtDate(day)}${words ? `: ${words.replace(/\n/g, ", ")}` : ""}`}
                      style={{ height: size }}
                      className={cn("relative flex cursor-pointer flex-col items-end overflow-hidden rounded-sm px-1 pt-0.5 text-[12px] tabular-nums transition-colors",
                        size < 40 && "items-center justify-center p-0",
                        holiday ? "bg-rose-100 font-semibold text-rose-800 ring-1 ring-rose-300"
                          : own ? "bg-amber-100 font-semibold text-amber-900 ring-1 ring-amber-300"
                          : resting ? "bg-tint text-slate-400" : "text-slate-700 hover:bg-tint-soft",
                        day === today && "ring-2 ring-brand-line",
                        open === day && "outline-2 outline-offset-1 outline-brand-line")}>
                      {i + 1}
                      {writes && (off.length || busy.length) ? (
                        <span className="mt-0.5 flex w-full min-w-0 flex-col items-start gap-px text-left text-[11px] font-medium leading-tight">
                          {[...off.map((d) => ({ key: d.id, text: d.name, action: false })), ...busy.map((a) => ({ key: a.code, text: a.name, action: true }))]
                            .slice(0, Math.max(1, Math.floor((size - 22) / 14)))
                            .map((one) => one.action ? (
                              <Link key={one.key} href={`/actions/${one.key}`} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}
                                title={`Open ${one.key} · ${one.text}`} className="w-full truncate text-sky-800 hover:underline">{one.text}</Link>
                            ) : <span key={one.key} className="w-full truncate">{one.text}</span>)}
                        </span>
                      ) : null}
                      {busy.length ? <span className="absolute inset-x-1.5 bottom-0.5 h-[3px] rounded-full bg-sky-600" aria-hidden /> : null}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {/* The corner that makes the whole calendar larger or smaller. */}
      <div role="separator" aria-label="Drag to make the calendar larger or smaller"
        title="Drag to make the calendar larger or smaller. Double-click to put it back." onPointerDown={onResize} onDoubleClick={resetSize}
        className="absolute right-0 bottom-0 flex h-5 w-5 cursor-nwse-resize touch-none items-center justify-center rounded text-slate-500 ring-1 ring-line hover:text-link hover:ring-link/50">
        <MoveDiagonal2 className="h-3.5 w-3.5" />
      </div>
      </div>

      {/* The day opened: what it holds, and claiming or unclaiming it. */}
      {open ? (
        <section className="register register-sheet register-sheet-open" aria-label={`The ${fmtDate(open)}`}>
          <div className="flex items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
            <span className="stencil mr-1 text-slate-500">{fmtDate(open)}</span>
            <span className="text-[11px] text-slate-500">
              {weekend.includes(isoDay(+open.slice(0, 4), +open.slice(5, 7) - 1, +open.slice(8, 10))) ? "a day off each week" : openDays.length ? "not counted as a working day" : "a working day"}
            </span>
            <button type="button" onClick={() => setOpen(null)} title="Close" aria-label="Close" className="ml-auto rounded-sm p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <div className="space-y-3 px-5 py-4 sm:px-6">
            {openDays.length || openActions.length ? (
              <ul className="space-y-1 text-xs text-slate-700">
                {openDays.map((d) => (
                  <li key={d.id}>
                    <span className="font-semibold">{d.name}</span>
                    <span className="text-slate-500"> · {d.source === "ORGANIZATION" ? `public holiday, ${nameOf(d.country)}` : "the project's own day off"}</span>
                  </li>
                ))}
                {openActions.map((a) => (
                  <li key={a.code}>
                    <Link href={`/actions/${a.code}`} className="font-semibold text-link hover:underline">{a.code} · {a.name}</Link>
                    <span className="text-slate-500"> · {a.finish && a.finish !== a.start ? `${fmtDate(a.start)} → ${fmtDate(a.finish)}` : fmtDate(a.start)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {claim && mine.length ? (
              mine.map((d) => (
                <ActionForm key={d.id} action={unmarkDayAction} hidden={{ level: claim.level, dayId: d.id }} variant="secondary"
                  submitLabel={`Take ${d.name} off`} confirmText={`From now on: ${fmtDate(open)} counts as a working day${d.country ? ` in ${nameOf(d.country)}` : ""}. Instead of: ${d.name}, a day off. Go ahead?`}
                  className="space-y-0" />
              ))
            ) : claim ? (
              <ActionForm key={open} action={markDayAction} hidden={{ level: claim.level, day: open }} submitLabel="Mark it a day off" resetOnSuccess
                className="asking space-y-3">
                <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                  <Field label="What it is" required hint={claim.level === "organization" ? "Christmas Day, Eid al-Fitr…" : "site shutdown, local holiday…"}>
                    <input name="name" required maxLength={120} autoFocus autoComplete="off" className="plain w-full" />
                  </Field>
                  {claim.level === "organization" && countries ? (
                    <Field label="Kept in" hint="only projects in that country skip it; none: every project">
                      <Select name="country" defaultValue={country || claim.defaultCountry || ""} className="plain w-full">
                        <option value="">Every country</option>
                        {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                      </Select>
                    </Field>
                  ) : null}
                </div>
              </ActionForm>
            ) : !openDays.length && !openActions.length ? (
              <p className="text-xs text-slate-500">Nothing on this day.</p>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** An arrow of the month's head: a step within the calendar, a link past it, or nothing to go to. */
function Step({ to, label, children }: { to?: (() => void) | string; label: string; children: React.ReactNode }) {
  const cls = "inline-flex rounded-sm p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800";
  if (typeof to === "string") return <Link href={to} scroll={false} title={label} aria-label={label} className={cls}>{children}</Link>;
  return <button type="button" onClick={to} disabled={!to} title={label} aria-label={label} className={cn(cls, "disabled:opacity-30 disabled:hover:bg-transparent")}>{children}</button>;
}
