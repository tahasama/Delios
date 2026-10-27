"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { applyListAction, checkListAction, type ListCheck, type ListChangeLine, type ListRow } from "@/lib/actions/forms-lists";
import { btn, DataTable, Field, inputCls, Th, Td } from "@/components/ui";
import { toCsv } from "@/lib/core/csv";
import { Pencil, Undo2, X } from "lucide-react";

type Outcome = ListChangeLine["outcome"] | ListRow["outcome"];
const OUTCOME: Record<Outcome, { word: string; ink: string }> = {
  NEW: { word: "New", ink: "text-sky-700" },
  UPDATE: { word: "Changed", ink: "text-amber-800" },
  REMOVED: { word: "Removed", ink: "text-red-700" },
  SAME: { word: "No change", ink: "text-slate-500" },
  PROBLEM: { word: "Problem", ink: "text-red-700" },
  PENDING: { word: "Waits", ink: "text-slate-500" },
};
const plural = (n: number, word: string) => `${n.toLocaleString("en-GB")} ${word}${n === 1 ? "" : "s"}`;

/** The register's dock: its first act in the brand's gold, the others light on the dark bar. */
const DOCK_FIRST = "inline-flex items-center gap-1.5 rounded-sm bg-gold px-3 py-2 text-xs font-semibold text-brand-ink";
const DOCK_ACT = "inline-flex items-center gap-1.5 rounded-sm bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/15";

/** Which lines show: every one, or those of one outcome (the segmented choice, with counts). */
function Shown<T extends string>({ choices, show, onShow }: { choices: { key: T; word: string; count: number }[]; show: T; onShow: (key: T) => void }) {
  return (
    <div role="tablist" className="tabs w-full" aria-label="Which lines">
      {choices.map((one) => (
        <button key={one.key} type="button" role="tab" aria-selected={show === one.key} className="tab" onClick={() => onShow(one.key)}>
          {one.word} <span className="tab-n">{one.count.toLocaleString("en-GB")}</span>
        </button>
      ))}
    </div>
  );
}

/** A row of the file corrected in place: one field per heading. For several rows (`many`), only what is filled in changes. */
function RowForm({ headings, cells, many, onSave, onCancel }: {
  headings: string[]; cells: string[]; many?: number; onSave: (cells: Record<number, string>) => void; onCancel: () => void;
}) {
  const [now, setNow] = useState<Record<number, string>>(many ? {} : Object.fromEntries(cells.map((c, i) => [i, c])));
  return (
    <div className="space-y-3 border-t border-line bg-surface px-3 py-3">
      {many ? <p className="text-xs text-slate-600">Fill in only what should change on the {many} rows ticked; what you leave empty stays as each row has it.</p> : null}
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-3">
        {headings.map((heading, i) => heading.trim() ? (
          <label key={i} className="block min-w-0">
            <span className="mb-1.5 flex h-4 items-baseline leading-4"><span className="truncate text-xs font-medium text-slate-700">{heading}</span></span>
            <input type="text" value={now[i] ?? ""} onChange={(e) => setNow((b) => ({ ...b, [i]: e.target.value }))} aria-label={heading}
              placeholder={many ? "Leave each row's own" : undefined} className="plain w-full" />
          </label>
        ) : null)}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <button type="button" className={btn("secondary")} onClick={onCancel}>Cancel</button>
        <button type="button" className={btn("primary")} onClick={() => onSave(many ? Object.fromEntries(Object.entries(now).filter(([, v]) => v.trim())) : now)}>
          {many ? `Change the ${many} rows` : "Save this row"}
        </button>
      </div>
    </div>
  );
}

/**
 * A schedule list sent in two steps (owner: every import shows what it would do before anything is written): the form
 * is first checked, the list read exactly as applying it would and undone, and every line it would change is listed;
 * then "Apply it" sends it. The schedule's lines are not corrected or taken off here: the planner's file is the
 * planner's word, corrected in the file and sent again (owner: kept so). The disciplines per action and the document
 * requirements are ours: each row of the file is listed with what it does, corrected in place (its pencil), taken off
 * (its ×), ticked all or some for the dock, checked again at once; applied, the list as corrected is what is kept, and
 * saying why it differs from the file is asked.
 */
export function CheckedListForm({ hidden, children, ask, className }: { hidden: Record<string, string>; children: React.ReactNode; ask: string; className?: string }) {
  const form = useRef<HTMLFormElement>(null);
  const [sent, setSent] = useState<FormData | null>(null);
  const [check, setCheck] = useState<ListCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ ok?: string; link?: { href: string; label: string } } | null>(null);
  const [show, setShow] = useState<string>("ALL");
  const [busy, start] = useTransition();
  // A disciplines or requirements file, row by row, as corrected here.
  const [cells, setCells] = useState<string[][] | null>(null);
  const [off, setOff] = useState<Set<number>>(new Set());
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<number | "many" | null>(null);
  const [changed, setChanged] = useState(false);
  const [why, setWhy] = useState("");
  const switching = hidden.mode === "switch";

  const sheet = check?.sheet ?? null;
  const rows = useMemo(() => (sheet?.rows ?? []).filter((r) => !off.has(r.line)), [sheet, off]);
  const shownRows = rows.filter((r) => show === "ALL" || r.outcome === show);
  const shownLines = (check?.lines ?? []).filter((l) => show === "ALL" || l.outcome === show);
  const problemRows = rows.filter((r) => r.outcome === "PROBLEM");
  const removed = (check?.lines ?? []).filter((l) => l.outcome === "REMOVED");
  const changing = check ? check.new + check.updates + check.removed : 0;
  const tickedRows = rows.filter((r) => ticked.has(r.line));

  const reset = () => { setCheck(null); setSent(null); setError(null); setShow("ALL"); setCells(null); setOff(new Set()); setTicked(new Set()); setEditing(null); setChanged(false); setWhy(""); };

  /** The file as corrected here, a row taken off left blank so every row keeps its line. */
  const corrected = (base: FormData, now: string[][], away: Set<number>) => {
    const data = new FormData();
    for (const [k, v] of base.entries()) if (k !== "file") data.append(k, v);
    // What a row inherits from the row above (the requirements' action and department) is written on it, so taking a row
    // off never moves the rows under it into another group.
    const carry = sheet?.inherited ?? [];
    const last: Record<number, string> = {};
    const written = now.map((row, i) => {
      if (i <= (sheet?.headerAt ?? -1) || row.every((c) => !c.trim())) return row;
      const filled = [...row];
      for (const column of carry) {
        if (column < 0) continue;
        if (filled[column]?.trim()) last[column] = filled[column]; else if (last[column]) filled[column] = last[column];
      }
      return filled;
    });
    const csv = toCsv(written.map((row, i) => (away.has(i + 1) ? row.map(() => "") : row)));
    const original = (base.get("file") as File | null)?.name ?? check?.source ?? "list";
    data.set("file", new File([csv], `${original.replace(/\.[^.]+$/, "")}.csv`, { type: "text/csv" }));
    return data;
  };
  const recheck = (now: string[][], away: Set<number>) => {
    if (!sent) return;
    start(async () => {
      const answer = await checkListAction(corrected(sent, now, away));
      setError(answer.error ?? null);
      if (answer.check) setCheck(answer.check);
    });
  };
  const correct = (lines: number[], values: Record<number, string>) => {
    const now = (cells ?? []).map((row, i) => (lines.includes(i + 1) ? row.map((c, j) => (j in values ? values[j] : c)) : row));
    setCells(now); setEditing(null); setTicked(new Set()); setChanged(true);
    recheck(now, off);
  };
  const takeOff = (lines: number[]) => { const away = new Set([...off, ...lines]); setOff(away); setTicked(new Set()); setEditing(null); setChanged(true); recheck(cells ?? [], away); };
  const putBack = (line: number) => { const away = new Set([...off].filter((one) => one !== line)); setOff(away); recheck(cells ?? [], away); };

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
      setCells(answer.check?.sheet ? answer.check.sheet.cells.map((row) => [...row]) : null);
      setOff(new Set()); setTicked(new Set()); setChanged(false);
    });
  };
  const onApply = () => {
    if (!sent) return;
    let data = sent;
    if (changed && cells) {
      if (!why.trim()) { setError("Say why the list differs from the file: it is kept with the list."); return; }
      data = corrected(sent, cells, off);
      // Corrected here, it is no longer the file as released: its uploader says so, and why.
      data.delete("confirmed");
      const before = String(sent.get("reason") ?? "").trim();
      data.set("reason", [before, `Corrected before applying: ${why.trim()}`].filter(Boolean).join(" "));
    }
    start(async () => {
      const answer = await applyListAction(data);
      if (answer.error) { setError(answer.error); return; }
      setDone(answer);
      reset();
      form.current?.reset();
    });
  };
  const toggle = (line: number) => setTicked((b) => { const n = new Set(b); if (n.has(line)) n.delete(line); else n.add(line); return n; });

  const rowChoices = [
    { key: "ALL", word: "All", count: rows.length },
    ...(["NEW", "UPDATE", "SAME", "PROBLEM", "PENDING"] as const).map((key) => ({ key, word: OUTCOME[key].word, count: rows.filter((r) => r.outcome === key).length })).filter((c) => c.count),
  ];
  const lineChoices = [
    { key: "ALL", word: "All", count: check?.lines.length ?? 0 },
    { key: "NEW", word: "New", count: check?.new ?? 0 },
    { key: "UPDATE", word: "Changed", count: check?.updates ?? 0 },
    { key: "REMOVED", word: "Removed", count: check?.removed ?? 0 },
    { key: "SAME", word: "No change", count: check?.same ?? 0 },
  ];

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

      {check ? (
        <div className="mt-4 space-y-3 border-t border-line pt-4" aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-800">What {check.source ?? "this file"} will change{busy ? <span className="ml-2 text-xs font-normal text-slate-500">checking…</span> : null}</h3>
            {sheet ? <Shown choices={rowChoices} show={show} onShow={setShow} /> : <Shown choices={lineChoices} show={show} onShow={setShow} />}
          </div>
          {check.problems.length ? (
            <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-xs leading-5 text-red-800 ring-1 ring-red-200">
              <p className="font-semibold">{sheet ? "The file as a whole cannot be read:" : "It cannot be applied as it is: correct the file and check it again."}</p>
              <ul className="mt-1 list-disc pl-4">{check.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </div>
          ) : null}

          {sheet && cells ? (
            <>
              {switching ? <p className="text-xs text-slate-600">Read again from its source as it is: to correct a row, upload the corrected file instead.</p> : null}
              <DataTable
                id={`list-rows-${check.kind}`}
                toolbar={false}
                capHeight={560}
                head={
                  <tr>
                    <Th className="w-10">
                      <input type="checkbox" aria-label={`Tick all ${shownRows.length} rows`} disabled={switching} checked={!!shownRows.length && shownRows.every((r) => ticked.has(r.line))}
                        onChange={(e) => setTicked(e.target.checked ? new Set(shownRows.map((r) => r.line)) : new Set())} />
                    </Th>
                    <Th label="It will be">It will be</Th>
                    <Th label={check.kind === "DOCUMENT_REQUIREMENTS" ? "Action — document" : "Action"} className="min-w-60">{check.kind === "DOCUMENT_REQUIREMENTS" ? "Action — document" : "Action"}</Th>
                    <Th label="What changes, or what is wrong">What changes, or what is wrong</Th>
                    <Th label="Where in the file">Where in the file</Th>
                    <Th className="w-16"><span className="sr-only">Correct or take off</span></Th>
                  </tr>
                }
              >
                {shownRows.map((row) => [
                  <tr key={row.line}>
                    <Td><input type="checkbox" aria-label={`Tick line ${row.line}`} disabled={switching} checked={ticked.has(row.line)} onChange={() => toggle(row.line)} /></Td>
                    <Td className={`whitespace-nowrap text-xs font-semibold ${OUTCOME[row.outcome].ink}`}>{OUTCOME[row.outcome].word}</Td>
                    <Td className="text-xs leading-5 whitespace-normal">{row.title}</Td>
                    <Td className="text-xs leading-5 whitespace-normal">
                      {row.problems.length ? <span className="block text-red-700">{row.problems.join(" ")}</span> : null}
                      {row.changes.map((c) => <span key={c.field} className="block">{c.field}: {c.was || "—"} → {c.now || "—"}</span>)}
                      {row.outcome === "NEW" && !row.changes.length ? <span className="text-slate-500">Added as listed.</span> : null}
                      {row.outcome === "SAME" ? <span className="text-slate-500">Reads so already.</span> : null}
                      {row.outcome === "PENDING" ? <span className="text-slate-500">Checked once the problems are corrected or taken off.</span> : null}
                    </Td>
                    <Td className="whitespace-nowrap text-[11px] text-slate-500">Line {row.line}</Td>
                    <Td>
                      {switching ? null : (
                        <span className="flex items-center gap-2">
                          <button type="button" title="Correct this row" aria-label={`Correct line ${row.line}`} onClick={() => setEditing(editing === row.line ? null : row.line)} className="text-slate-500 hover:text-brand-ink">
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <button type="button" title="Take this row off the list: it is not applied" aria-label={`Take line ${row.line} off the list`} onClick={() => takeOff([row.line])} className="text-red-600 hover:text-red-800">
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </span>
                      )}
                    </Td>
                  </tr>,
                  editing === row.line ? (
                    <tr key={`${row.line}-form`}>
                      <td colSpan={6} className="p-0">
                        <RowForm headings={sheet.headings} cells={cells[row.line - 1] ?? []} onCancel={() => setEditing(null)} onSave={(v) => correct([row.line], v)} />
                      </td>
                    </tr>
                  ) : null,
                ])}
              </DataTable>
              {editing === "many" && tickedRows.length ? (
                <div className="overflow-hidden rounded-md ring-1 ring-line">
                  <RowForm headings={sheet.headings} cells={[]} many={tickedRows.length} onCancel={() => setEditing(null)} onSave={(v) => correct(tickedRows.map((r) => r.line), v)} />
                </div>
              ) : null}
              {tickedRows.length ? (
                <div className="dock palette-light sticky bottom-4 z-30 mx-auto flex w-fit max-w-full flex-wrap items-center gap-2 rounded-sm border border-white/10 bg-brand-strong p-2.5 text-white shadow-[0_8px_30px_rgb(0_0_0/0.18)]">
                  <span className="px-2 font-mono text-sm tabular-nums">{tickedRows.length}<span className="ml-1.5 text-[11px] uppercase tracking-[0.12em] text-white/60">ticked</span></span>
                  <button type="button" className={DOCK_FIRST} onClick={() => setEditing("many")}><Pencil className="h-4 w-4" aria-hidden="true" /> Change them together</button>
                  <button type="button" className={DOCK_ACT} onClick={() => takeOff(tickedRows.map((r) => r.line))}><X className="h-4 w-4" aria-hidden="true" /> Take them off the list</button>
                  {problemRows.length ? <button type="button" className={DOCK_ACT} onClick={() => setTicked(new Set(problemRows.map((r) => r.line)))}>Tick the {plural(problemRows.length, "problem")}</button> : null}
                  <button type="button" onClick={() => setTicked(new Set())} className="ml-auto rounded-sm p-2 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Clear the ticks" title="Clear the ticks">
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              ) : null}
              {off.size ? (
                <details className="rounded-md ring-1 ring-line">
                  <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-700">Taken off the list ({off.size}): not applied</summary>
                  <ul className="divide-y divide-line border-t border-line">
                    {(sheet.rows ?? []).filter((r) => off.has(r.line)).map((r) => (
                      <li key={r.line} className="flex items-baseline gap-3 px-3 py-1.5 text-xs">
                        <span className="min-w-0 flex-1 truncate text-slate-700">{r.title} <span className="text-slate-500">(line {r.line})</span></span>
                        <button type="button" className="inline-flex items-center gap-1 font-semibold text-link hover:underline" onClick={() => putBack(r.line)}>
                          <Undo2 className="h-3.5 w-3.5" aria-hidden="true" /> Put back
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {removed.length ? (
                <div className="rounded-md px-3 py-2 text-xs leading-5 ring-1 ring-line">
                  <p className="font-semibold text-red-700">No longer listed, so taken off ({removed.length})</p>
                  <ul className="mt-1 space-y-0.5 text-slate-700">{removed.map((l) => <li key={l.key}>{l.title}</li>)}</ul>
                </div>
              ) : null}
            </>
          ) : check.lines.length ? (
            <DataTable
              id={`list-check-${check.kind}`}
              toolbar={false}
              capHeight={520}
              head={
                <tr>
                  <Th label="It will be">It will be</Th>
                  <Th label="Action" className="min-w-60">Action</Th>
                  <Th label="What changes">What changes</Th>
                </tr>
              }
            >
              {shownLines.map((line) => (
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

          {error ? <p role="alert" className="rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-800 ring-1 ring-red-200">{error}</p> : null}

          <div className="space-y-2 rounded-md bg-tint-soft px-3 py-2.5 text-xs ring-1 ring-line">
            {changed && !problemRows.length && !check.problems.length ? (
              <Field label="Why it differs from the file" required hint="kept with the list">
                <input value={why} onChange={(e) => setWhy(e.target.value)} className={inputCls} placeholder="e.g. Two actions named by their old codes; one requirement the discipline no longer needs" />
              </Field>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              {problemRows.length ? (
                <>
                  <span className="text-slate-700">{plural(problemRows.length, "row")} {problemRows.length === 1 ? "has a problem" : "have problems"}: correct {problemRows.length === 1 ? "it" : "them"} with the pencil, or take {problemRows.length === 1 ? "it" : "them"} off the list.</span>
                  <button type="button" disabled={busy} className={btn("secondary")} onClick={() => takeOff(problemRows.map((r) => r.line))}>Take every row with a problem off</button>
                </>
              ) : check.problems.length ? null : (
                <>
                  <span className="text-slate-700">
                    {changing ? `${plural(check.new, "new line")} · ${plural(check.updates, "change")} · ${check.removed.toLocaleString("en-GB")} removed` : "Nothing changes: the project already reads so."}
                    {check.summary ? <span className="block text-slate-500">{check.summary}</span> : null}
                  </span>
                  <button type="button" disabled={busy} className={btn("primary")} onClick={onApply}>{busy ? "Applying…" : "Apply it"}</button>
                </>
              )}
              <button type="button" disabled={busy} className={btn("secondary")} onClick={reset}>{check.problems.length || problemRows.length ? "Back to the file" : "Not now"}</button>
            </div>
          </div>
        </div>
      ) : error ? <p role="alert" className="mt-3 rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-800 ring-1 ring-red-200">{error}</p> : null}
    </div>
  );
}
