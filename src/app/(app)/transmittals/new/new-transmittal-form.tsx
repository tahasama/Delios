"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ActionForm } from "@/components/form";
import { Field, inputCls, btn, Card } from "@/components/ui";
import { createTransmittalAction } from "@/lib/actions/transmittals";
import { RecipientPicker, type Company } from "./recipient-picker";
import { cn } from "@/lib/utils";
import { Check, Search } from "lucide-react";

type Opt = { code: string; label: string; props: Record<string, unknown> };
type RevOpt = { id: string; label: string; released: boolean };
type UserOpt = { id: string; name: string; role: string };
/** Anything the form can start filled in with — from a link such as "Send rev B to them". */
export type Prefill = { revisionIds?: string[]; userIds?: string[]; outsiders?: string; reason?: string; party?: string; subject?: string; message?: string };

const STEPS = ["Which way, and why", "What goes with it", "Who gets it"];

/**
 * Three short steps, in the order a person thinks: which way it travels and
 * why, what it carries, then who is told. Each step fits on one screen, so a
 * choice is never made with half of it scrolled away — the same shape as the
 * new-document wizard.
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
    if (!words.length) return pool;
    return pool.filter((r) => words.every((word) => r.label.toLowerCase().includes(word)));
  }, [outgoing, revisions, find]);
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

  return (
    <Card className="max-w-3xl">
      {/* Where you are. */}
      <ol className="mb-5 flex flex-wrap items-center gap-3">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const done = step > n;
          return (
            <li key={label} className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => may(n) && setStep(n)}
                className={cn(
                  "flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-xs font-semibold transition",
                  step === n ? "bg-brand text-white" : done ? "text-emerald-700 hover:bg-emerald-50" : "text-slate-400",
                )}
              >
                <span className={cn("grid h-6 w-6 place-items-center rounded-full text-[11px]", step === n ? "bg-white/20" : done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400")}>
                  {done ? <Check className="h-3.5 w-3.5" /> : n}
                </span>
                {label}
              </button>
              {i < STEPS.length - 1 ? <span className="h-px w-8 bg-slate-200" /> : null}
            </li>
          );
        })}
      </ol>

      <ActionForm action={createTransmittalAction} hideSubmit>
        {/* ── Step 1 — which way, and why ───────────────────────────────────── */}
        <div className={cn("space-y-4", step !== 1 && "hidden")}>
          <div className="flex gap-2">
            {(["OUTGOING", "INCOMING"] as const).map((d) => (
              <label key={d} className={`cursor-pointer rounded-lg border px-3 py-2 text-xs font-medium ${direction === d ? "border-brand-line bg-tint text-brand-ink" : "border-slate-300 text-slate-500"}`}>
                <input type="radio" name="direction" value={d} checked={direction === d} onChange={() => setDirection(d)} className="mr-1.5" />
                {d === "OUTGOING" ? "We are sending" : "We received"}
              </label>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {outgoing ? (
              <Field label="Sent by">
                <p className="pt-1 text-sm font-medium text-slate-700">{ourOrganization}</p>
              </Field>
            ) : (
              <Field label="Received from" required>
                <input name="issuingParty" required className={inputCls} placeholder="Company name" value={party} onChange={(e) => setParty(e.target.value)} />
              </Field>
            )}
            <Field label="Why" required hint="what the recipient should do with it">
              <select name="reasonForIssue" required className={inputCls} value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
                <option value="" disabled>Choose…</option>
                {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
              </select>
            </Field>
            <Field label={outgoing ? "Date sent" : "Date received"} required>
              <input type="date" name="dateOfIssue" required className={inputCls} defaultValue={new Date().toISOString().slice(0, 10)} />
            </Field>
            {outgoing ? null : (
              <Field label="Note">
                <input name="notes" className={inputCls} placeholder="optional" />
              </Field>
            )}
          </div>

          {needsReview && !outgoing ? (
            <p className="text-[11px] text-slate-500">Once accepted, each document is sent down a review route, whose last step gives the binding verdict.</p>
          ) : null}

          <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <Link href="/transmittals" className={btn("ghost", "sm")}>Cancel</Link>
            <button type="button" onClick={() => setStep(2)} disabled={!askedFirst} className={btn("primary", "sm")}>Continue</button>
          </div>
        </div>

        {/* ── Step 2 — what goes with it ────────────────────────────────────── */}
        <div className={cn("space-y-4", step !== 2 && "hidden")}>
          <Field
            label="Documents"
            hint={outgoing
              ? "only released revisions can be sent — tick as many as you need, or send a message alone"
              : "tick as many as arrived, or record a message alone"}
          >
            <div className="rounded-xl border border-slate-200">
              <div className="flex items-center gap-2 border-b border-slate-100 px-2.5 py-2">
                <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <input
                  value={find}
                  onChange={(e) => setFind(e.target.value)}
                  placeholder="Find by number, title or revision"
                  className="w-full bg-transparent text-xs outline-none placeholder:text-slate-400"
                />
                <span className="shrink-0 text-[11px] tabular-nums text-slate-400">{chosen.length} chosen</span>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {choices.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-slate-500">Nothing matches that.</p>
                ) : choices.map((r) => (
                  <label key={r.id} className="flex cursor-pointer items-start gap-2 border-b border-slate-50 px-3 py-2 text-xs last:border-0 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      name="revisionIds"
                      value={r.id}
                      checked={chosen.includes(r.id)}
                      onChange={() => toggle(r.id)}
                      className="mt-0.5"
                    />
                    <span className="text-slate-700">{r.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </Field>

          {/* A revision chosen from a link, then filtered out of the visible
              list, is still enclosed — so it travels in a field of its own. */}
          {chosen.filter((id) => !choices.some((r) => r.id === id)).map((id) => (
            <input key={id} type="hidden" name="revisionIds" value={id} />
          ))}

          {outgoing ? (
            <>
              <Field label="Subject" required hint="what the recipient reads first">
                <input name="subject" required className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Pump house — ventilation layout, rev B for construction" />
              </Field>
              <Field label="Message" hint="optional — anything the recipients should know about these documents">
                <textarea name="message" rows={4} className={inputCls} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Please find enclosed…" />
              </Field>
            </>
          ) : (
            <Field label="Message" hint="optional — what they say it is for, in their words">
              <textarea name="message" rows={3} className={inputCls} value={message} onChange={(e) => setMessage(e.target.value)} />
            </Field>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <button type="button" onClick={() => setStep(1)} className={btn("ghost", "sm")}>Back</button>
            <div className="flex items-center gap-3">
              {saysSomething ? null : <span className="hidden text-[11px] text-slate-500 sm:block">Enclose a document, or write {outgoing ? "a subject" : "a message"}.</span>}
              <button type="button" onClick={() => setStep(3)} disabled={!saysSomething} className={btn("primary", "sm")}>Continue</button>
            </div>
          </div>
        </div>

        {/* ── Step 3 — who gets it ──────────────────────────────────────────── */}
        <div className={cn("space-y-4", step !== 3 && "hidden")}>
          <RecipientPicker companies={companies} preselected={prefill?.userIds ?? []} />

          {outgoing ? (
            <label className="flex items-start gap-2 rounded-lg bg-tint-soft px-3 py-2.5 text-xs text-slate-700">
              <input type="checkbox" name="issueNow" checked={issueNow} onChange={(e) => setIssueNow(e.target.checked)} className="mt-0.5" />
              <span>
                <strong>Send it as soon as it is created.</strong> Leave this off to keep it as a draft — a draft has been sent to nobody.
              </span>
            </label>
          ) : (
            <p className="text-[11px] text-slate-500">You will check and accept it on the next screen; any reply period starts from acceptance.</p>
          )}

          {/* What is about to happen, in one line, above the button that does it. */}
          <p className="rounded-lg bg-canvas px-3 py-2 text-[11px] text-slate-600">
            {picked.length ? `${picked.length} revision${picked.length === 1 ? "" : "s"}` : "No documents"}
            {" · "}
            {reasons.find((r) => r.code === reasonCode)?.label ?? "no reason chosen"}
            {" · "}
            {outgoing ? `from ${ourOrganization}` : `from ${party.trim() || "an unnamed party"}`}
          </p>

          <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <button type="button" onClick={() => setStep(2)} className={btn("ghost", "sm")}>Back</button>
            <button type="submit" className={btn("primary", "sm")}>
              {outgoing ? (issueNow ? "Create and send it" : "Create it as a draft") : "Record receipt"}
            </button>
          </div>
        </div>
      </ActionForm>
    </Card>
  );
}
