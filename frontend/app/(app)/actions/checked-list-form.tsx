"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { applyListAction, checkListAction, type ListCheck, type ListChangeLine } from "@/lib/actions/forms-lists";
import { btn, DataTable, Th, Td } from "@/components/ui";

const OUTCOME: Record<ListChangeLine["outcome"], { word: string; ink: string }> = {
  NEW: { word: "New", ink: "text-emerald-700" },
  UPDATE: { word: "Changed", ink: "text-amber-800" },
  REMOVED: { word: "Removed", ink: "text-red-700" },
  SAME: { word: "No change", ink: "text-slate-500" },
};
const SHOWN = ["ALL", "NEW", "UPDATE", "REMOVED", "SAME"] as const;
const plural = (n: number, word: string) => `${n.toLocaleString("en-GB")} ${word}${n === 1 ? "" : "s"}`;

/**
 * A schedule list sent in two steps (owner: every import shows what it would do before anything is written): the
 * form is first checked, the list read exactly as applying it would and undone, and every line it would change is
 * listed (new, changed field by field, removed, no change); then "Apply" sends the same form. Lines are not corrected
 * or taken off here: the planner's file is the planner's word, corrected in the file and sent again.
 */
export function CheckedListForm({ hidden, children, ask, className }: { hidden: Record<string, string>; children: React.ReactNode; ask: string; className?: string }) {
  const form = useRef<HTMLFormElement>(null);
  const [sent, setSent] = useState<FormData | null>(null);
  const [check, setCheck] = useState<ListCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ ok?: string; link?: { href: string; label: string } } | null>(null);
  const [show, setShow] = useState<(typeof SHOWN)[number]>("ALL");
  const [busy, start] = useTransition();

  const shown = useMemo(() => (check?.lines ?? []).filter((l) => show === "ALL" || l.outcome === show), [check, show]);
  const changing = check ? check.new + check.updates + check.removed : 0;

  const reset = () => { setCheck(null); setSent(null); setError(null); setShow("ALL"); };
  const onCheck = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    for (const [k, v] of Object.entries(hidden)) data.set(k, v);
    setDone(null);
    start(async () => {
      const answer = await checkListAction(data);
      setError(answer.error ?? null);
      setCheck(answer.check ?? null);
      setSent(answer.check ? data : null);
    });
  };
  const onApply = () => {
    if (!sent) return;
    start(async () => {
      const answer = await applyListAction(sent);
      if (answer.error) { setError(answer.error); return; }
      setDone(answer);
      reset();
      form.current?.reset();
    });
  };

  return (
    <div className={className}>
      <form ref={form} onSubmit={onCheck} className={`max-w-xl space-y-4 ${check ? "pointer-events-none opacity-60" : ""}`} aria-disabled={!!check}>
        {children}
        {check ? null : (
          <div className="flex flex-wrap items-center gap-3">
            <button className="ask" data-on="true" disabled={busy}>{busy ? "Checking…" : ask}</button>
            <span className="text-xs text-slate-500">Nothing is applied yet: you see what it changes first.</span>
          </div>
        )}
      </form>
      {done?.ok ? (
        <p role="status" className="mt-3 rounded-md bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-900 ring-1 ring-emerald-200">
          {done.ok} {done.link ? <Link href={done.link.href} className="font-semibold underline">{done.link.label}</Link> : null}
        </p>
      ) : null}
      {error ? <p role="alert" className="mt-3 rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-800 ring-1 ring-red-200">{error}</p> : null}

      {check ? (
        <div className="mt-4 space-y-3 border-t border-line pt-4" aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-800">What {check.source ?? "this file"} will change</h3>
            <div className="seg" aria-label="Which lines">
              {SHOWN.map((one) => {
                const count = one === "ALL" ? check.lines.length : one === "NEW" ? check.new : one === "UPDATE" ? check.updates : one === "REMOVED" ? check.removed : check.same;
                return (
                  <button key={one} type="button" aria-pressed={show === one} className="segment" onClick={() => setShow(one)}>
                    {one === "ALL" ? "All" : OUTCOME[one].word} <span className="tabular-nums text-slate-500">{count.toLocaleString("en-GB")}</span>
                  </button>
                );
              })}
            </div>
          </div>
          {check.problems.length ? (
            <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-xs leading-5 text-red-800 ring-1 ring-red-200">
              <p className="font-semibold">It cannot be applied as it is: correct the file and check it again.</p>
              <ul className="mt-1 list-disc pl-4">{check.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </div>
          ) : null}
          {check.lines.length ? (
            <DataTable
              id={`list-check-${check.kind}`}
              toolbar={false}
              capHeight={520}
              head={
                <tr>
                  <Th label="It will be">It will be</Th>
                  <Th label={check.kind === "DOCUMENT_REQUIREMENTS" ? "Action — document" : "Action"} className="min-w-60">{check.kind === "DOCUMENT_REQUIREMENTS" ? "Action — document" : "Action"}</Th>
                  <Th label="What changes">What changes</Th>
                </tr>
              }
            >
              {shown.map((line) => (
                <tr key={line.key}>
                  <Td className={`whitespace-nowrap text-xs font-semibold ${OUTCOME[line.outcome].ink}`}>{OUTCOME[line.outcome].word}</Td>
                  <Td className="text-xs leading-5 whitespace-normal">{line.title}</Td>
                  <Td className="text-xs leading-5 whitespace-normal">
                    {line.outcome === "REMOVED" ? <span className="text-slate-500">No longer in the list: taken off the schedule.</span>
                      : line.outcome === "SAME" ? <span className="text-slate-500">Reads so already.</span>
                      : line.changes.map((c) => <span key={c.field} className="block">{c.field}: {c.was || "—"} → {c.now || "—"}</span>)}
                  </Td>
                </tr>
              ))}
            </DataTable>
          ) : null}
          <div className="flex flex-wrap items-center gap-3 rounded-md bg-tint-soft px-3 py-2.5 text-xs ring-1 ring-line">
            {check.problems.length ? null : (
              <>
                <span className="text-slate-700">
                  {changing ? `${plural(check.new, "new line")} · ${plural(check.updates, "change")} · ${check.removed.toLocaleString("en-GB")} removed` : "Nothing changes: the project already reads so."}
                  {check.summary ? <span className="block text-slate-500">{check.summary}</span> : null}
                </span>
                <button type="button" disabled={busy} className={btn("primary")} onClick={onApply}>{busy ? "Applying…" : "Apply it"}</button>
              </>
            )}
            <button type="button" disabled={busy} className={btn("secondary")} onClick={reset}>{check.problems.length ? "Back to the file" : "Not now"}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
