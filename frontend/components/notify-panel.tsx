"use client";

import { ActionForm } from "@/components/form";
import { Field, inputCls } from "@/components/ui";
import { SearchPick, type PickItem } from "@/components/search-pick";
import { sendNoticeAction } from "@/lib/actions/forms-notices";
import { Bell } from "lucide-react";

/**
 * Telling people by hand, the same everywhere a notice can be sent: the people
 * it would go to are already chosen, any can be taken off or others added by
 * name, the message can be changed, and the line beside the button says how
 * long since the first notice on the same matter (automatic or not) and how
 * many have gone.
 */
export function NotifyPanel({ subject, title, body, link, outsideLink, people, chosen, history, label = "Notify", bare = false }: {
  /** What the notice is about, as the backend keys it: notices on the same subject are counted together. */
  subject: string;
  title: string;
  body: string;
  /** The page the notice opens. */
  link: string;
  /** The page it opens for another organization's people (a supplier), who cannot open {@link link}. */
  outsideLink?: string;
  /** Everyone on the project who can be told. */
  people: PickItem[];
  /** Who it goes to unless changed. */
  chosen: string[];
  /** The notices already sent on this matter. */
  history: { count: number; daysSinceFirst: number | null; lastTo: string[] };
  label?: string;
  /** Already opened by a section of its own (its heading is the button): the form alone, no second "Notify". */
  bare?: boolean;
}) {
  const sent = history.count
    ? `${history.count} sent · first ${history.daysSinceFirst === 0 ? "today" : `${history.daysSinceFirst} day${history.daysSinceFirst === 1 ? "" : "s"} ago`}`
    : "none sent yet";
  // The message box is as tall as the message it starts with; it still grows as it is written.
  const rows = Math.min(14, Math.max(3, body.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 90)), 0)));
  const form = (
    <ActionForm action={sendNoticeAction} submitLabel="Send" hidden={{ subject, title, link, ...(outsideLink ? { outsideLink } : {}) }} className={bare ? "space-y-3" : "mt-3 space-y-3"}>
      <SearchPick items={people} name="people" initial={chosen} label="To" hint="take anyone off, or add others by name" required />
      <Field label="Message" hint="what they read with it">
        <textarea name="body" rows={rows} maxLength={4000} defaultValue={body} className={`${inputCls} field-sizing-content`} />
      </Field>
      {history.lastTo.length ? <p className="text-[11px] text-slate-500">Last sent to {history.lastTo.join(", ")}.</p> : null}
    </ActionForm>
  );
  if (bare) return <div className="w-full text-xs"><p className="mb-3 text-[11px] text-slate-500">{sent}</p>{form}</div>;
  return (
    <details className="group w-full text-xs">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 [&::-webkit-details-marker]:hidden">
        <span className="ask"><Bell aria-hidden className="h-3.5 w-3.5" /> {label}</span>
        <span className="text-[11px] text-slate-500">{sent}</span>
      </summary>
      {form}
    </details>
  );
}
