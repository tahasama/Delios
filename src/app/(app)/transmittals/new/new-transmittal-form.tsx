"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ActionForm } from "@/components/form";
import { createTransmittalAction } from "@/lib/actions/transmittals";
import { RecipientPicker, type Company } from "./recipient-picker";
import { cn } from "@/lib/utils";
import { ArrowDownLeft, ArrowUpRight, Search } from "lucide-react";

type Opt = { code: string; label: string; props: Record<string, unknown> };
type RevOpt = { id: string; label: string; released: boolean; number: string; rev: string; status: string | null; title: string };
type UserOpt = { id: string; name: string; role: string };
/** Anything the form can start filled in with — from a link such as "Send rev B to them". */
export type Prefill = {
  revisionIds?: string[];
  userIds?: string[];
  /** People copied in on the question, copied in on the answer. */
  copyIds?: string[];
  outsiders?: string; reason?: string; party?: string; subject?: string; message?: string;
  /** The transmittal being answered: its id, and what to call it on screen. */
  answering?: { id: string; number: string; subject: string | null };
};

const STEPS = ["Which way, and why", "What goes with it", "Who gets it"];

/** The two things this form can be for, each said in a sentence, because the
 *  second is not a forward: it records something that has already arrived. */
const WAYS = {
  OUTGOING: {
    title: "We are sending",
    says: "Documents, or a letter, going from us to named people. They are notified here, and their opening it is the receipt.",
    Icon: ArrowUpRight,
  },
  INCOMING: {
    title: "We received",
    says: "Something that reached us outside this system — by email, post, or a supplier's own portal. Recording it gives it a number and puts it in the register for Document Control to check on arrival. To pass something on to colleagues, send instead.",
    Icon: ArrowDownLeft,
  },
} as const;

/** A field in this form: its name in stencil above it, and a short hint beside the name. */
function Ask({ label, hint, required, children, className }: { label: string; hint?: string; required?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block min-w-0", className)}>
      <span className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
        <span className="stencil text-slate-500">{label}{required ? <span className="ml-0.5 text-red-500">*</span> : null}</span>
        {hint ? <span className="text-[11px] text-slate-400">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

const field = "plain w-full py-1.5 text-[13px]";

/**
 * Three short steps, in the order a person thinks: which way it travels and
 * why, what it carries, then who is notified. Each step is a sheet of its own
 * in the register's vocabulary — band, stencil, plain fields — and grows with
 * what it holds rather than scrolling inside itself.
 *
 * Fields that do not apply to the current choice are not shown: outgoing lists
 * only released revisions, and a received transmittal has no subject of ours.
 */
export function NewTransmittalForm({
  reasons, revisions, companies, ourOrganization, defaultDirection, preselectedRevisionIds, prefill,
}: {
  reasons: Opt[];
  revisions: RevOpt[];
  users: UserOpt[];
  reviewers: UserOpt[];
  /** Companies with people who can be sent something, for the recipient picker. */
  companies: Company[];
  ourOrganization: string;
  defaultDirection: "OUTGOING" | "INCOMING";
  preselectedRevisionIds?: string[];
  prefill?: Prefill;
}) {
  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState(defaultDirection);
  const [reasonCode, setReasonCode] = useState(prefill?.reason && reasons.some((r) => r.code === prefill.reason) ? prefill.reason : "");
  const [party, setParty] = useState(prefill?.party ?? "");
  const [subject, setSubject] = useState(prefill?.subject ?? "");
  const [message, setMessage] = useState(prefill?.message ?? "");
  const [find, setFind] = useState("");
  const [chosen, setChosen] = useState<string[]>([...new Set([...(preselectedRevisionIds ?? []), ...(prefill?.revisionIds ?? [])])]);
  // Creating a transmittal sends nothing by itself. Saying so, and offering to
  // do both at once, is why people stopped finding a draft they thought they had sent.
  const [issueNow, setIssueNow] = useState(true);

  const outgoing = direction === "OUTGOING";
  const needsReview = reasons.find((r) => r.code === reasonCode)?.props.reviewCycle === true;
  const choices = useMemo(() => {
    const pool = outgoing ? revisions.filter((r) => r.released) : revisions;
    const words = find.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const found = words.length ? pool.filter((r) => words.every((word) => r.label.toLowerCase().includes(word))) : pool;
    // What is already chosen stays at the top, so it is never scrolled away from.
    return [...found.filter((r) => chosen.includes(r.id)), ...found.filter((r) => !chosen.includes(r.id))];
  }, [outgoing, revisions, find, chosen]);
  const picked = useMemo(() => {
    const byId = new Map(revisions.map((r) => [r.id, r] as const));
    return chosen.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
  }, [chosen, revisions]);

  // What each step needs answered before the next one makes sense.
  const askedFirst = Boolean(reasonCode) && (outgoing || party.trim().length > 0);
  // A transmittal may carry a message alone — a clarification, a notice, an
  // answer — so enclosures are optional, but it may not be empty of both.
  const saysSomething = chosen.length > 0 || (outgoing ? subject.trim().length > 0 : message.trim().length > 0);
  const may = (n: number) => n === 1 || (askedFirst && (n === 2 || saysSomething));
  const toggle = (id: string) => setChosen((ids) => (ids.includes(id) ? ids.filter((one) => one !== id) : [...ids, id]));
  const reasonLabel = reasons.find((r) => r.code === reasonCode)?.label;

  // The strip that closes each sheet: back on the left, what is missing and
  // the way on at the right.
  const foot = (back: number | null, next: React.ReactNode, missing?: string | null) => (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-tint-soft px-5 py-3 sm:px-6">
      {back ? (
        <button type="button" onClick={() => setStep(back)} className="text-xs font-semibold text-slate-500 hover:text-slate-800">&larr; Back</button>
      ) : (
        <Link href="/transmittals" className="text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel</Link>
      )}
      <div className="flex items-center gap-3">
        {missing ? <span className="text-[11px] text-slate-400">{missing}</span> : null}
        {next}
      </div>
    </div>
  );
  const band = (n: number, sentence: string, extra?: React.ReactNode) => (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2 sm:px-6">
      <span className="stencil mr-1 text-slate-400">{n} &middot; {STEPS[n - 1]}</span>
      <span className="text-[11px] text-slate-400">{sentence}</span>
      {extra ? <span className="ml-auto">{extra}</span> : null}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Where you are: the three steps as one instrument. A step can be opened
          once what comes before it is answered. */}
      <nav aria-label="Steps" className="seg w-fit max-w-full">
        {STEPS.map((label, i) => {
          const n = i + 1;
          return (
            <button
              key={label}
              type="button"
              onClick={() => may(n) && setStep(n)}
              aria-current={step === n ? "page" : undefined}
              disabled={!may(n)}
              className="segment disabled:opacity-45"
            >
              <span className="segment-n">{n}</span> {label}
            </button>
          );
        })}
      </nav>

      <ActionForm action={createTransmittalAction} hideSubmit className="space-y-0">
        {/* What this answers, where it answers something. The thread is kept by
            the record rather than by whoever remembers it. */}
        {prefill?.answering ? (
          <>
            <input type="hidden" name="inReplyTo" value={prefill.answering.id} />
            <p className="mb-4 rounded-lg border border-line bg-tint-soft px-4 py-2.5 text-xs text-slate-600">
              Answering <Link href={`/transmittals/${prefill.answering.id}`} className="font-mono font-semibold text-link hover:underline">{prefill.answering.number}</Link>
              {prefill.answering.subject ? <> &mdash; {prefill.answering.subject}</> : null}.
              {" "}The people it was sent to and copied in are carried over; change any of them in step 3.
            </p>
          </>
        ) : null}

        {/* ── 1 · Which way, and why ───────────────────────────────────────── */}
        <section className={cn("register register-sheet register-sheet-open", step !== 1 && "hidden")}>
          {band(1, "whether it leaves us or has reached us, and what it is for")}
          <div className="space-y-5 px-5 py-5 sm:px-6">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2" role="radiogroup" aria-label="Which way">
              {(["OUTGOING", "INCOMING"] as const).map((d) => {
                const way = WAYS[d];
                const on = direction === d;
                return (
                  <label
                    key={d}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors",
                      on ? "border-brand-line bg-tint" : "border-line hover:border-line-strong hover:bg-tint-soft",
                    )}
                  >
                    <input type="radio" name="direction" value={d} checked={on} onChange={() => setDirection(d)} className="sr-only" />
                    <span className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md", on ? "bg-brand text-white" : "bg-canvas-deep text-slate-500")}>
                      <way.Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className={cn("block text-sm font-semibold", on ? "text-brand-ink" : "text-slate-800")}>{way.title}</span>
                      <span className="mt-0.5 block text-[11.5px] leading-4 text-slate-500">{way.says}</span>
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="asking grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
              {outgoing ? (
                <div className="min-w-0">
                  <span className="stencil mb-1.5 block text-slate-500">Sent by</span>
                  <p className="py-1.5 text-[13px] font-medium text-slate-700">{ourOrganization}</p>
                </div>
              ) : (
                <Ask label="Received from" required>
                  <input name="issuingParty" required className={field} placeholder="Company name" value={party} onChange={(e) => setParty(e.target.value)} />
                </Ask>
              )}
              <Ask label="Why" required hint={outgoing ? "what they should do with it" : "what they sent it for"} className="lg:col-span-2">
                <select name="reasonForIssue" required className={field} value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
                  <option value="" disabled>Choose…</option>
                  {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                </select>
              </Ask>
              <Ask label={outgoing ? "Date sent" : "Date received"} required>
                <input type="date" name="dateOfIssue" required className={field} defaultValue={new Date().toISOString().slice(0, 10)} />
              </Ask>
              {outgoing ? null : (
                <Ask label="Note" hint="optional" className="sm:col-span-2 lg:col-span-4">
                  <input name="notes" className={field} placeholder="Anything worth writing down about how it arrived" />
                </Ask>
              )}
            </div>

            {needsReview && !outgoing ? (
              <p className="text-[11px] text-slate-500">Once accepted, each document is sent down a review route, whose last step gives the binding verdict.</p>
            ) : null}
          </div>
          {foot(null,
            <button type="button" onClick={() => setStep(2)} disabled={!askedFirst} data-on={askedFirst ? "true" : undefined} className="ask disabled:cursor-not-allowed disabled:opacity-50">Continue</button>,
            askedFirst ? null : outgoing ? "Say why it is sent." : "Say who sent it and why.",
          )}
        </section>

        {/* ── 2 · What goes with it ────────────────────────────────────────── */}
        <section className={cn("register register-sheet register-sheet-open", step !== 2 && "hidden")}>
          {band(2,
            outgoing ? "only released revisions can be sent — tick what goes, or send a letter alone" : "tick what arrived, or record a message alone",
            <span className="font-mono text-[11px] tabular-nums text-slate-500">{chosen.length} chosen</span>,
          )}
          <div className="asking flex items-center gap-2 border-b border-line px-5 py-2.5 sm:px-6">
            <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <label className="min-w-0 flex-1">
              <span className="sr-only">Find a document</span>
              <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find by number, title or revision" className="plain w-full" />
            </label>
            {find ? <button type="button" onClick={() => setFind("")} className="text-[11px] font-semibold text-link hover:underline">Clear</button> : null}
          </div>
          {choices.length === 0 ? (
            <p className="px-5 py-6 text-center text-xs text-slate-400 sm:px-6">Nothing matches that.</p>
          ) : (
            <ul className="divide-y divide-line">
              {choices.map((r) => {
                const on = chosen.includes(r.id);
                return (
                  <li key={r.id}>
                    <label className={cn("grid cursor-pointer grid-cols-[auto_minmax(0,14rem)_2.5rem_4rem_minmax(0,1fr)] items-center gap-x-3 px-5 py-2 text-[12.5px] transition-colors sm:px-6", on ? "bg-tint-soft" : "hover:bg-tint-soft")}>
                      <input type="checkbox" name="revisionIds" value={r.id} checked={on} onChange={() => toggle(r.id)} />
                      <span className="truncate font-mono font-semibold text-slate-900">{r.number}</span>
                      <span className="font-mono text-slate-600">{r.rev}</span>
                      <span>{r.status ? <span className="code-chip">{r.status}</span> : null}</span>
                      <span className="truncate text-slate-500">{r.title}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          {/* A revision chosen from a link, then filtered out of the visible
              list, is still enclosed — so it travels in a field of its own. */}
          {chosen.filter((id) => !choices.some((r) => r.id === id)).map((id) => (
            <input key={id} type="hidden" name="revisionIds" value={id} />
          ))}

          <div className="asking grid grid-cols-1 gap-y-4 border-t border-line px-5 py-5 sm:px-6">
            {outgoing ? (
              <>
                <Ask label="Subject" required hint="what the recipient reads first">
                  <input name="subject" required className={field} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Pump house — ventilation layout, rev B for construction" />
                </Ask>
                <Ask label="Message" hint="optional — anything they should know about these documents">
                  <textarea name="message" rows={4} className={field} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Please find enclosed…" />
                </Ask>
              </>
            ) : (
              <Ask label="Message" hint="optional — what they say it is for, in their words">
                <textarea name="message" rows={3} className={field} value={message} onChange={(e) => setMessage(e.target.value)} />
              </Ask>
            )}
          </div>
          {foot(1,
            <button type="button" onClick={() => setStep(3)} disabled={!saysSomething} data-on={saysSomething ? "true" : undefined} className="ask disabled:cursor-not-allowed disabled:opacity-50">Continue</button>,
            saysSomething ? null : `Enclose a document, or write ${outgoing ? "a subject" : "a message"}.`,
          )}
        </section>

        {/* ── 3 · Who gets it ──────────────────────────────────────────────── */}
        <section className={cn("register register-sheet register-sheet-open", step !== 3 && "hidden")}>
          {band(3, outgoing ? "a person at a company — or copy somebody in to keep them informed, without asking anything of them" : "which of our people it is for")}
          <div className="asking space-y-5 px-5 py-5 sm:px-6">
            <RecipientPicker
              companies={companies}
              preselected={prefill?.userIds ?? []}
              preselectedCopies={prefill?.copyIds ?? []}
              label={outgoing ? "Sent to" : "For"}
            />

            {outgoing ? (
              <label className="flex items-start gap-2.5 rounded-lg border border-line bg-tint-soft px-4 py-3 text-xs text-slate-700">
                <input type="checkbox" name="issueNow" checked={issueNow} onChange={(e) => setIssueNow(e.target.checked)} className="mt-0.5" />
                <span>
                  <strong className="font-semibold">Send it as soon as it is created.</strong> Leave this off to keep it as a draft — a draft has been sent to nobody.
                </span>
              </label>
            ) : (
              <p className="text-[11px] text-slate-500">You will check and accept it on the next screen; any reply period starts from acceptance.</p>
            )}
          </div>
          {foot(2,
            <button type="submit" data-on="true" className="ask">
              {outgoing ? (issueNow ? "Create and send it" : "Create it as a draft") : "Record receipt"}
            </button>,
            // What is about to happen, in one line, beside the button that does it.
            `${picked.length ? `${picked.length} document${picked.length === 1 ? "" : "s"}` : "A letter, no documents"} · ${reasonLabel ?? "no reason chosen"} · ${outgoing ? `from ${ourOrganization}` : `from ${party.trim() || "an unnamed party"}`}`,
          )}
        </section>
      </ActionForm>
    </div>
  );
}
