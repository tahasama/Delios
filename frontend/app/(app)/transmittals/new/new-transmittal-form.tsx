"use client";

import { TRANSMITTAL_KINDS, kind, kindOf, type TransmittalKind } from "@/lib/transmittals/kinds";
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ActionForm } from "@/components/form";
import { SearchPick } from "@/components/search-pick";
import { createTransmittalAction } from "@/lib/transmittals/forms";
import { RecipientPicker, type Company } from "./recipient-picker";
import type { OwnField } from "@/lib/settings/field-policy";
import { OwnFields } from "@/app/(app)/documents/new/own-fields";
import { cn } from "@/lib/core/utils";
import { Plus, X } from "lucide-react";

type Opt = { code: string; label: string; props: Record<string, unknown> };
type RevOpt = { id: string; documentId: string; label: string; released: boolean; number: string; rev: string; status: string | null; title: string };
type UserOpt = { id: string; name: string; role: string };
/** Anything the form can start filled in with — from a link such as "Send rev B to them". */
type Prefill = {
  revisionIds?: string[];
  userIds?: string[];
  /** People copied in on the question, copied in on the answer. */
  copyIds?: string[];
  outsiders?: string; reason?: string; party?: string; subject?: string; message?: string;
  /** Back from the register with documents ticked: the step it reopens on, and the answer asked as it was. */
  step?: number; answer?: boolean; due?: string;
  /** The transmittal being answered: its id, and what to call it on screen. */
  answering?: { id: string; number: string; subject: string | null };
  /** The sent transmittal this one completes (a supplement) or corrects (it replaces one they rejected). */
  following?: { id: string; number: string; kind: "SUPPLEMENT" | "REPLACES"; rejection: string | null };
  /** The schedule action it asks a document to be added to: the control function answers it there. */
  activity?: { id: string; code: string; ask: "DOCUMENT" | "DISCIPLINE" };
};

const STEPS = ["Which way, and why", "What goes with it", "Who gets it"];

/**
 * The two kinds of transmittal, chosen first; each lists its own reasons. Data carries documents (for review, for
 * approval, for execution…); information carries a request, an answer, a confirmation sought, an RFI. A reason says
 * its kind on its published value (Settings: "Kind of transmittal"); one that says nothing is data.
 */
const familyOf = kindOf;

/** A field in this form: its name in stencil above it, and a short hint beside the name. */
function Ask({ label, hint, required, children, className }: { label: string; hint?: string; required?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block min-w-0", className)}>
      {/* One line, whatever the hint: questions side by side keep level. The whole hint shows on hover. */}
      <span className="mb-1.5 flex h-4 min-w-0 items-baseline gap-2 leading-4 overflow-hidden">
        <span className="stencil shrink-0 text-slate-500">{label}{required ? <span className="ml-0.5 text-red-500">*</span> : null}</span>
        {hint ? <span className="min-w-0 truncate text-[11px] text-slate-400" title={hint}>{hint}</span> : null}
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
  reasons, revisions, companies, ourOrganization, parties = [], defaultDirection, preselectedRevisionIds, prefill, fields, labels, ownFields, placeholders, askingBack, mayRecordReceived, outsider = false, unsent,
}: {
  /** The organizations set up on the project, with their codes: who something was received from. */
  parties?: { id: string; code: string; name: string }[];
  /** Documents ticked in the register with nothing that can go (nothing released): named, not enclosed. */
  unsent?: string[];
  reasons: Opt[];
  revisions: RevOpt[];
  users: UserOpt[];
  reviewers: UserOpt[];
  /** Companies with people who can be sent something, for the recipient picker. */
  companies: Company[];
  ourOrganization: string;
  defaultDirection: "OUTGOING" | "INCOMING";
  /** the control function records what reached us outside the system: a tick, never the default. */
  mayRecordReceived?: boolean;
  /** Another organization's person: what they send comes to us, today; nobody asks them who sent it or when. */
  outsider?: boolean;
  preselectedRevisionIds?: string[];
  prefill?: Prefill;
  /**
   * A supplier's documents with nothing released, asked of that supplier: the one exception to "only released
   * revisions travel". Sent to that supplier alone. `mixed`: documents of several suppliers were chosen.
   */
  placeholders?: { to: string; items: { id: string; number: string; title: string }[]; mixed: boolean };
  /** A supplier's documents it holds, asked back for an update on this transmittal; the asks are raised when it is sent. */
  askingBack?: { to: string; items: { id: string; number: string; title: string }[] };
  /** What this organization asks for: must be filled, may be left, or not asked. */
  fields: Record<string, "REQUIRED" | "OPTIONAL" | "OFF">;
  /** Its own words for them. */
  labels: Record<string, string>;
  /** The fields it added for itself. */
  ownFields: OwnField[];
}) {
  const [step, setStep] = useState(prefill?.step === 2 ? 2 : 1);
  const [direction, setDirection] = useState(defaultDirection);
  const [reasonCode, setReasonCode] = useState(prefill?.reason && reasons.some((r) => r.code === prefill.reason) ? prefill.reason : "");
  // Data or information, chosen first; the reasons listed are that kind's.
  const [family, setFamily] = useState<TransmittalKind>(() => {
    const given = reasons.find((r) => r.code === prefill?.reason);
    return given ? familyOf(given.props) : "DATA";
  });
  const familyReasons = reasons.filter((r) => familyOf(r.props) === family);
  const [party, setParty] = useState(prefill?.party ?? "");
  const [subject, setSubject] = useState(prefill?.subject ?? "");
  const [message, setMessage] = useState(prefill?.message ?? "");
  // Already about something of ours going out: chosen in the register or a package, asked back, or followed up.
  const sendingOurs = !!placeholders || !!askingBack || !!preselectedRevisionIds?.length || !!prefill?.revisionIds?.length || !!prefill?.following;
  const fixedForPlaceholders = !!placeholders && !placeholders.mixed && reasons.some((r) => r.code === "IFU");
  const [chosen, setChosen] = useState<string[]>([...new Set([...(preselectedRevisionIds ?? []), ...(prefill?.revisionIds ?? [])])]);
  // Creating a transmittal sends nothing by itself. Saying so, and offering to
  // do both at once, is why people stopped finding a draft they thought they had sent.
  const [issueNow, setIssueNow] = useState(true);
  const [people, setPeople] = useState(0);
  const [files, setFiles] = useState(0);
  const countPeople = useCallback((n: number) => setPeople(n), []);

  /** Whether a field is asked at all here, and whether it is insisted on. */
  const asks = (key: string) => fields[key] !== "OFF";
  const must = (key: string) => fields[key] === "REQUIRED";
  const says = (key: string, fallback: string) => labels[key] ?? fallback;

  const outgoing = direction === "OUTGOING";
  // The control function recording what reached us outside the system: who sent it, and when, are asked.
  const recording = !outgoing && !outsider;
  const needsReview = reasons.find((r) => r.code === reasonCode)?.props.reviewCycle === true;
  const picked = useMemo(() => {
    const byId = new Map(revisions.map((r) => [r.id, r] as const));
    return chosen.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
  }, [chosen, revisions]);

  // What each step needs answered before the next one makes sense.
  // A transmittal may carry a message alone — a clarification, a notice, an
  // answer — so enclosures are optional, but it may not be empty of both.
  // A data transmittal carries a document (or, received, the file that came); words alone are information. The
  // backend checks it too (FILE_REQUIRED).
  // A letter (information, nothing enclosed) says something: its subject and its message (backend ITEMS_REQUIRED).
  const letter = outgoing && family === "INFO" && chosen.length === 0;
  const mustCarry = family === "DATA";
  const carries = chosen.length > 0 || (outgoing ? !!placeholders && !placeholders.mixed : files > 0);
  const saysSomething = mustCarry ? carries
    : chosen.length > 0 || (!outgoing && files > 0) || (outgoing ? subject.trim().length > 0 && message.trim().length > 0 : message.trim().length > 0);
  // Data with nothing in it: rather than refuse, ask whether it is a letter (an information transmittal).
  const [offerInfo, setOfferInfo] = useState(false);
  const infoReasons = reasons.filter((r) => kindOf(r.props) === "INFO");
  const [infoType, setInfoType] = useState("");
  const makeItInformation = () => {
    setFamily("INFO");
    setReasonCode(infoType);
    setOfferInfo(false);
    // A letter says something: on to who gets it when it does, else it stays here for its words.
    if (outgoing ? subject.trim() : message.trim()) setStep(3);
  };
  const may = (n: number) => n === 1 || (askedFirst && (n === 2 || saysSomething));
  const toggle = (id: string) => setChosen((ids) => (ids.includes(id) ? ids.filter((one) => one !== id) : [...ids, id]));
  // The register, opened for this form: what is enclosed starts ticked, and "Continue" comes back here, on this step,
  // with everything written so far.
  const searchParams = useSearchParams();
  const pickHref = () => {
    const q = new URLSearchParams(searchParams.toString());
    const put = (key: string, value: string | null | undefined) => (value ? q.set(key, value) : q.delete(key));
    put("step", "2");
    put("direction", direction);
    put("reason", reasonCode);
    put("party", party);
    put("subject", subject);
    put("message", message);
    put("answer", answerRequired ? "1" : "0");
    put("due", answerRequired ? due : "");
    q.delete("revisions");
    q.delete("doc");
    put("docs", [...new Set(picked.map((r) => r.documentId))].join(","));
    return `/documents?${new URLSearchParams({ pick: `tr:/transmittals/new?${q.toString()}` })}`;
  };
  const reasonLabel = reasons.find((r) => r.code === reasonCode)?.label;
  // Whether an answer is asked for is the sender's tick alone: never ticked by itself, whatever the reason.
  const suggestedDays = (() => { const days = reasons.find((r) => r.code === reasonCode)?.props.responseDays; return typeof days === "number" ? days : null; })();
  const [answerOwn, setAnswerOwn] = useState<boolean | null>(prefill?.answer ?? null);
  const [due, setDue] = useState(prefill?.due ?? "");
  const answerRequired = answerOwn ?? false;
  const setAnswerRequired = (on: boolean) => setAnswerOwn(on);
  // What the first step needs answered before the next one makes sense.
  const askedFirst = Boolean(reasonCode) && (!recording || party.trim().length > 0) && (!outgoing || !answerRequired || !!due);

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
              Follows <Link href={`/transmittals/${prefill.answering.id}`} className="font-mono font-semibold text-link hover:underline">{prefill.answering.number}</Link>
              {prefill.answering.subject ? <> &mdash; {prefill.answering.subject}</> : null}.
              {" "}The people it was sent to and copied in are carried over; change any of them in step 3.
            </p>
          </>
        ) : null}

        {/* A request to add a document to an action: the action travels with it, so the control function answers it there. */}
        {prefill?.activity ? (
          <>
            <input type="hidden" name="activityId" value={prefill.activity.id} />
            <input type="hidden" name="activityAsk" value={prefill.activity.ask} />
            <p className="mb-4 rounded-lg border border-line bg-tint-soft px-4 py-2.5 text-xs text-slate-600">
              {prefill.activity.ask === "DISCIPLINE" ? "Asks for a missing discipline to be added to " : "Asks for a document to be added to "}
              <Link href={`/actions/${prefill.activity.code}`} className="font-mono font-semibold text-link hover:underline">{prefill.activity.code}</Link>.
              {" "}{prefill.activity.ask === "DISCIPLINE"
                ? "Say which discipline, and why the action concerns it."
                : "Enclose it in step 2 if it is released, or name it in the message."}
              {" "}the control function answers on the action&rsquo;s page, and you are told.
            </p>
          </>
        ) : null}

        {/* What this completes or corrects. The first transmittal is never
            changed after it went; this one says which it follows. */}
        {prefill?.following ? (
          <>
            <input type="hidden" name="followsId" value={prefill.following.id} />
            <input type="hidden" name="followKind" value={prefill.following.kind} />
            <p className="mb-4 rounded-lg border border-line bg-tint-soft px-4 py-2.5 text-xs text-slate-600">
              {prefill.following.kind === "REPLACES" ? "Replaces " : "Follows "}
              <Link href={`/transmittals/${prefill.following.id}`} className="font-mono font-semibold text-link hover:underline">{prefill.following.number}</Link>
              {prefill.following.kind === "REPLACES"
                ? <>, which they rejected{prefill.following.rejection ? <> &mdash; &ldquo;{prefill.following.rejection}&rdquo;</> : null}. Its documents and people are carried over: swap in the corrected revisions in step 2.</>
                : <>. Its documents and people are carried over: add the person or the document that was left out, and remove what they already have.</>}
              {" "}{prefill.following.number} itself stays exactly as it was sent.
            </p>
          </>
        ) : null}

        {/* ── 1 · What kind, and why ───────────────────────────────────────── */}
        <section className={cn("register register-sheet register-sheet-open", step !== 1 && "hidden")}>
          {band(1, recording ? "what reached us outside the system, from whom, and what for" : "what kind of transmittal, and what it is for")}
          <div className="space-y-5 px-5 py-5 sm:px-6">
            {/* Sent by us, today: nobody is asked either. What reached us outside the system is the exception, ticked. */}
            <input type="hidden" name="direction" value={direction} />
            {recording ? null : <input type="hidden" name="dateOfIssue" value={new Date().toISOString().slice(0, 10)} />}
            {/* Something of ours being sent (chosen in the register or a package, asked back, followed up) is never
                something received: the tick is not offered. */}
            {mayRecordReceived && !sendingOurs ? (
              <label className="flex w-fit items-center gap-2 text-xs font-medium text-slate-700">
                <input type="checkbox" checked={!outgoing} onChange={(e) => setDirection(e.target.checked ? "INCOMING" : "OUTGOING")} />
                Received from outside the system
                <span className="font-normal text-slate-500">— by email, post or their own portal; recorded here, the control function accepts it</span>
              </label>
            ) : null}

            <div className="asking grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
              {/* The kind first, then its own types (Settings, Reasons for issue). Placeholders are data, by themselves. */}
              {fixedForPlaceholders ? null : (
                <Ask label="Kind" required hint={kind(family).says}>
                  <select name="family" className={field} value={family} onChange={(e) => { setFamily(e.target.value as TransmittalKind); setReasonCode(""); }}>
                    {TRANSMITTAL_KINDS.map((one) => <option key={one.code} value={one.code}>{one.label}</option>)}
                  </select>
                </Ask>
              )}
              {!recording ? null : (
                // One of the organizations set up on the project, with its code: what came is numbered in its series.
                <div className="min-w-0">
                  <SearchPick browse single name="issuingParty" required label="Received from" hint="an organization set up on the project" placeholder="Find the organization"
                    initial={party ? [parties.find((p) => p.name === party || p.code === party || p.id === party)?.id ?? ""].filter(Boolean) : []}
                    items={parties.map((p) => ({ id: p.id, name: p.name, detail: p.code }))}
                    onChange={(ids) => setParty(ids[0] ?? "")} />
                </div>
              )}
              <Ask label={fixedForPlaceholders ? says("reason", "Why") : kind(family).typeLabel} required hint={outgoing ? kind(family).typeHint : "what they sent it for"}>
                {/* Placeholders go for use: the reason is set by itself, never chosen. */}
                {outgoing && fixedForPlaceholders ? (
                  <>
                    <input type="hidden" name="reasonForIssue" value="IFU" />
                    <p className={cn(field, "flex items-center text-slate-700")}>{reasons.find((r) => r.code === "IFU")?.label ?? "For update"}<span className="ml-2 text-[11px] text-slate-400">set for placeholders</span></p>
                  </>
                ) : (
                  <select name="reasonForIssue" required className={field} value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
                    <option value="" disabled>{familyReasons.length ? "Choose…" : "None published for this kind (Settings, Reasons for issue)"}</option>
                    {familyReasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                  </select>
                )}
              </Ask>
              {/* An answer asked for: ticked by the sender (never by itself), and then by a day — the day says whether it
                  came in time. One row, level with the reason beside it. */}
              {outgoing ? (
                <div className="min-w-0 lg:col-span-2">
                  <span className="mb-1.5 flex h-4 min-w-0 items-baseline gap-2 leading-4 overflow-hidden">
                    <span className="stencil shrink-0 text-slate-500">Answer by{answerRequired ? <span className="ml-0.5 text-red-500">*</span> : null}</span>
                    <span className="min-w-0 truncate text-[11px] text-slate-400">{answerRequired ? (suggestedDays ? `the reason usually allows ${suggestedDays} working days` : "a late answer is flagged") : "no answer asked"}</span>
                  </span>
                  <div className="flex items-center gap-4">
                    <label className="flex shrink-0 items-center gap-2 text-[13px] text-slate-700">
                      <input type="checkbox" name="answerRequired" checked={answerRequired} onChange={(e) => setAnswerRequired(e.target.checked)} />
                      An answer is required
                    </label>
                    <input type="date" name="responseDue" required={answerRequired} disabled={!answerRequired} value={due} onChange={(e) => setDue(e.target.value)}
                      aria-label="Answer by" className={cn(field, "min-w-0 flex-1 disabled:opacity-40")} min={new Date().toISOString().slice(0, 10)} />
                  </div>
                </div>
              ) : null}
              {!recording ? null : (
                <Ask label="Date received" required>
                  <input type="date" name="dateOfIssue" required className={field} defaultValue={new Date().toISOString().slice(0, 10)} />
                </Ask>
              )}
              {!recording ? null : (
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
            askedFirst ? null : recording ? "Say who sent it and why." : !reasonCode ? "Say why it is sent." : "Say by when the answer is due.",
          )}
        </section>

        {/* ── 2 · What goes with it ────────────────────────────────────────── */}
        <section className={cn("register register-sheet register-sheet-open", step !== 2 && "hidden")}>
          {band(2,
            outgoing ? (mustCarry ? "only released revisions can be sent — a data transmittal carries at least one" : "only released revisions can be sent — or send a letter alone")
              : mustCarry ? "tick what arrived, or keep the file that came" : "tick what arrived, or record a message alone",
            <span className="font-mono text-[11px] tabular-nums text-slate-500">{chosen.length} chosen</span>,
          )}
          {outgoing && placeholders ? (
            placeholders.mixed ? (
              <p className="border-b border-line bg-amber-50 px-5 py-2.5 text-xs text-amber-900 sm:px-6">
                The placeholders chosen belong to several suppliers: send one supplier&rsquo;s at a time, from the register.
              </p>
            ) : (
              <div className="border-b border-line px-5 py-3 sm:px-6">
                <p className="text-xs leading-5 text-slate-600">
                  <span className="font-semibold text-slate-800">{placeholders.items.length === 1 ? "1 placeholder" : `${placeholders.items.length} placeholders`} asked of {placeholders.to}</span>
                  {" "}&mdash; nothing of them is released yet; {placeholders.to} fills them and sends them back on a transmittal of its own. It goes to {placeholders.to} alone.
                </p>
                <ul className="mt-1.5 space-y-0.5">
                  {placeholders.items.map((one) => (
                    <li key={one.id} className="flex gap-x-2 text-[12.5px]">
                      <input type="hidden" name="placeholderIds" value={one.id} />
                      <span className="font-mono font-semibold text-slate-900">{one.number}</span>
                      <span className="truncate text-slate-500">{one.title}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          ) : null}
          {outgoing && askingBack ? (
            <div className="border-b border-line px-5 py-3 sm:px-6">
              <p className="text-xs leading-5 text-slate-600">
                <span className="font-semibold text-slate-800">{askingBack.items.length === 1 ? "1 document" : `${askingBack.items.length} documents`} asked back from {askingBack.to} for an update</span>
                {" "}&mdash; {askingBack.to} holds {askingBack.items.length === 1 ? "it" : "them"} now. Say why in the message: they accept and hand {askingBack.items.length === 1 ? "it" : "them"} back, or refuse and say why. It is sent now, not kept as a draft.
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {askingBack.items.map((one) => (
                  <li key={one.id} className="flex gap-x-2 text-[12.5px]">
                    <input type="hidden" name="askBackIds" value={one.id} />
                    <span className="font-mono font-semibold text-slate-900">{one.number}</span>
                    <span className="truncate text-slate-500">{one.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {/* What is enclosed, each removable; "Add documents" opens the register, as for an action, and brings the
              ticks back here with everything written so far. */}
          <div className="flex flex-wrap items-start gap-2 border-b border-line px-5 py-3 sm:px-6">
            {picked.length ? (
              <ul className="w-full space-y-1">
                {picked.map((r) => (
                  <li key={r.id} className="flex items-center gap-x-3 text-[12.5px]">
                    <span className="font-mono font-semibold text-slate-900">{r.number}</span>
                    <span className="font-mono text-slate-600">{r.rev}</span>
                    {r.status ? <span className="code-chip">{r.status}</span> : null}
                    <span className="min-w-0 flex-1 truncate text-slate-500">{r.title}</span>
                    <button type="button" onClick={() => toggle(r.id)} className="rounded-sm p-0.5 text-slate-400 hover:text-red-700" aria-label={`Take ${r.number} out`}><X className="h-3.5 w-3.5" /></button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="w-full text-xs text-slate-500">No document enclosed yet{outgoing ? (mustCarry ? " — a data transmittal carries at least one" : " — a letter alone is fine too") : ""}.</p>
            )}
            {unsent?.length ? <p className="w-full text-[11px] text-amber-800">Not enclosed, nothing of {unsent.length === 1 ? "it" : "them"} released: {unsent.join(", ")}.</p> : null}
            <Link href={pickHref()} className="ask inline-flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" /> Add documents</Link>
          </div>
          {/* What is enclosed travels in fields of its own. */}
          {chosen.map((id) => <input key={id} type="hidden" name="revisionIds" value={id} />)}

          <div className="asking grid grid-cols-1 gap-y-4 border-t border-line px-5 py-5 sm:px-6">
            {outgoing ? (
              <>
                {asks("subject") ? (
                  <Ask label={says("subject", "Subject")} required={must("subject")} hint="what the recipient reads first">
                    <input name="subject" required={must("subject")} className={field} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Pump house — ventilation layout, rev B for construction" />
                  </Ask>
                ) : null}
                {asks("message") ? (
                  <Ask label={says("message", "Message")} required={must("message") || letter} hint={letter ? "what the letter says: it carries no document" : must("message") ? "what they should know about these documents" : "optional — anything they should know about these documents"}>
                    <textarea name="message" rows={4} required={must("message") || letter} className={field} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Please find enclosed…" />
                  </Ask>
                ) : null}
                <OwnFields fields={ownFields} />
              </>
            ) : (
              <>
              <Ask label="Files that came with it" hint="their letter, the email, what they attached — kept with it, not put in the register">
                <input
                  type="file"
                  name="attachments"
                  multiple
                  onChange={(e) => setFiles(e.target.files?.length ?? 0)}
                  className="w-full"
                />
              </Ask>
              {asks("message") ? (
                <Ask label={says("message", "Message")} required={must("message")} hint="what they say it is for, in their words">
                  <textarea name="message" rows={3} required={must("message")} className={field} value={message} onChange={(e) => setMessage(e.target.value)} />
                </Ask>
              ) : null}
              </>
            )}
          </div>
          {offerInfo && mustCarry && !carries ? (
            <div role="alert" className="flex flex-wrap items-end gap-x-4 gap-y-3 border-t border-amber-200 bg-amber-50 px-5 py-3 sm:px-6">
              <p className="min-w-60 flex-1 text-[13px] text-amber-900">
                <strong>Nothing is attached.</strong> A data transmittal carries a document.
                Do you want this to be an information transmittal (a letter) instead?
              </p>
              {infoReasons.length ? (
                <>
                  <label className="min-w-52">
                    <span className="sr-only">Type of information</span>
                    <select value={infoType} onChange={(e) => setInfoType(e.target.value)} className={field}>
                      <option value="" disabled>Type of information…</option>
                      {infoReasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                    </select>
                  </label>
                  <button type="button" onClick={makeItInformation} disabled={!infoType} data-on={infoType ? "true" : undefined} className="ask disabled:cursor-not-allowed disabled:opacity-50">Make it information</button>
                </>
              ) : <span className="text-[11px] text-amber-800">No information type is published (Settings, Reasons for issue).</span>}
              {outgoing ? <Link href={pickHref()} className="ask">Attach a document</Link>
                : <button type="button" onClick={() => setOfferInfo(false)} className="ask">Attach the file</button>}
            </div>
          ) : null}
          {foot(1,
            <button type="button" onClick={() => (mustCarry && !carries ? setOfferInfo(true) : setStep(3))} disabled={!saysSomething && !mustCarry}
              data-on={saysSomething ? "true" : undefined} className="ask disabled:cursor-not-allowed disabled:opacity-50">Continue</button>,
            saysSomething ? null : mustCarry ? null : outgoing ? "Write a subject and a message: the letter says something." : "Tick a document, keep a file, or write a message.",
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
              onCount={countPeople}
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
            <button type="submit" disabled={!people} data-on={people ? "true" : undefined} className="ask disabled:cursor-not-allowed disabled:opacity-50">
              {outgoing ? (issueNow ? "Create and send it" : "Create it as a draft") : outsider ? "Send it" : "Record receipt"}
            </button>,
            // What is about to happen, in one line, beside the button that does it.
            !people ? "Name at least one person it is addressed to." : `${picked.length ? `${picked.length} document${picked.length === 1 ? "" : "s"}` : "No documents"}${!outgoing && files ? ` + ${files} file${files === 1 ? "" : "s"}` : ""}${!outgoing && !picked.length && !files ? " — accepted as it is recorded" : ""} · ${reasonLabel ?? "no reason chosen"} · ${outgoing ? `from ${ourOrganization}` : outsider ? `to ${ourOrganization}` : `from ${party.trim() || "an unnamed party"}`}`,
          )}
        </section>
      </ActionForm>
    </div>
  );
}

