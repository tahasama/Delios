"use client";

import { startTransition, useActionState, useMemo, useState, useTransition } from "react";
import {
  readDeliverableListAction, checkDeliverableLinesAction, writeDeliverableLinesAction,
  type ListLine, type ListView, type LineView,
} from "@/lib/documents/forms-deliverables";
import { btn, inputCls } from "@/components/ui";
import { Select } from "@/components/select";
import { Switch } from "@/components/switch";
import { Check, FileSpreadsheet, Pencil, X } from "lucide-react";

/** What a line does, in words and the app's colours (text, never a pill inside a register). */
const OUTCOME: Record<LineView["outcome"], { word: string; ink: string }> = {
  NEW: { word: "New", ink: "text-sky-700" },
  UPDATE: { word: "Update", ink: "text-amber-800" },
  SAME: { word: "Same", ink: "text-slate-500" },
  PROBLEM: { word: "Problem", ink: "text-red-700" },
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The deliverable list, brought in on two pages (owner): the file is read and checked, then every line shows what it
 * would do (new, an update with each field "was → now", the same, or a problem with why) before anything is written.
 * Lines are left out by their tick, one by one or all problems at once; a line is corrected in place, or a field set on
 * every ticked line at once; the list is checked again; then one act writes them all, or none.
 */
export function DeliverableImport() {
  const [read, readFile, reading] = useActionState(readDeliverableListAction, undefined);
  const [file, setFile] = useState<File | null>(null);
  // The lines as the person left them, keyed by where they are in the file; and what the backend said of them.
  const [lines, setLines] = useState<ListLine[] | null>(null);
  const [view, setView] = useState<ListView | null>(null);
  const [left, setLeft] = useState<Set<string>>(new Set());
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ListView | null>(null);
  const [busy, run] = useTransition();
  const [bulkField, setBulkField] = useState("");
  const [bulkValue, setBulkValue] = useState("");
  const [seenRead, setSeenRead] = useState<typeof read>(undefined);

  // A new reading of the file starts the second page afresh: problems left out, the rest kept.
  if (read !== seenRead) {
    setSeenRead(read);
    if (read?.lines && read.view) {
      setLines(read.lines);
      setView(read.view);
      setLeft(new Set(read.view.lines.filter((l) => l.outcome === "PROBLEM").map((l) => l.at)));
      setTicked(new Set());
      setStale(false);
      setError(null);
      setDone(null);
    }
  }

  const columns = read?.columns ?? {};
  const said = useMemo(() => new Map((view?.lines ?? []).map((l) => [l.at, l] as const)), [view]);
  const kept = (lines ?? []).filter((l) => !left.has(l.at));
  const keptViews = kept.map((l) => said.get(l.at)).filter((v): v is LineView => !!v);
  const registering = keptViews.filter((v) => v.outcome === "NEW").length;
  const updating = keptViews.filter((v) => v.outcome === "UPDATE").length;
  const blocking = keptViews.filter((v) => v.outcome === "PROBLEM").length;
  // Lines that change nothing are not sent: there is nothing to write for them.
  const toWrite = kept.filter((l) => said.get(l.at)?.outcome !== "SAME");
  // Every field a line may carry, for the corrections and the bulk change.
  const fields = useMemo(() => {
    const seen = new Set<string>();
    for (const l of lines ?? []) for (const k of Object.keys(l.values)) if (k !== "deliverableType") seen.add(k);
    return [...seen];
  }, [lines]);
  const nameOf = (key: string) => columns[key] ?? key;

  const choose = () => {
    if (!file) return;
    const data = new FormData();
    data.set("file", file);
    startTransition(() => readFile(data));
  };
  const checkAgain = () => run(async () => {
    const answer = await checkDeliverableLinesAction(read?.project ?? null, kept);
    if (answer.error) { setError(answer.error); return; }
    // What was left out stays as it was said before; what is kept is read anew.
    setView((before) => ({ ...answer.view!, lines: [...(before?.lines ?? []).filter((l) => left.has(l.at)), ...answer.view!.lines] }));
    setStale(false);
    setError(null);
  });
  const write = () => run(async () => {
    const answer = await writeDeliverableLinesAction(read?.project ?? null, toWrite);
    if (answer.view && !answer.view.written) setView(answer.view);
    if (answer.error) { setError(answer.error); return; }
    setDone(answer.view ?? null);
    setError(null);
  });
  const change = (at: string, key: string, value: string) => {
    setLines((all) => (all ?? []).map((l) => {
      if (l.at !== at) return l;
      const values = { ...l.values };
      if (value.trim()) values[key] = value.trim(); else delete values[key];
      return { ...l, values };
    }));
    setStale(true);
  };
  const setBulk = () => {
    if (!bulkField || !ticked.size) return;
    for (const at of ticked) change(at, bulkField, bulkValue);
    setBulkValue("");
  };
  const toggle = (set: Set<string>, at: string) => { const next = new Set(set); if (next.has(at)) next.delete(at); else next.add(at); return next; };

  if (done) {
    return (
      <div className="space-y-3 px-5 py-4 sm:px-6" aria-live="polite">
        <p className="text-sm font-semibold text-slate-800">
          Written: {plural(done.new, "document")} registered, {plural(done.updates, "document")} updated.
        </p>
        <ul className="divide-y divide-line rounded-md ring-1 ring-line">
          {done.lines.filter((l) => l.outcome !== "SAME").map((l) => (
            <li key={l.at} className="flex flex-wrap items-baseline gap-x-3 px-3 py-1.5 text-xs">
              <span className={`w-16 font-semibold ${OUTCOME[l.outcome].ink}`}>{l.outcome === "NEW" ? "Registered" : "Updated"}</span>
              {l.documentId ? <a href={`/documents/${l.documentId}`} className="font-mono text-link hover:underline">{l.number}</a> : <span className="font-mono">{l.number}</span>}
              <span className="min-w-0 flex-1 truncate text-slate-700">{l.title}</span>
            </li>
          ))}
        </ul>
        <button type="button" className={btn("secondary")} onClick={() => { setDone(null); setLines(null); setView(null); setFile(null); }}>Bring in another list</button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-3 px-5 py-4 sm:px-6">
        <div className="max-w-xl">
          <div className="mb-1.5 flex h-4 min-w-0 items-baseline gap-2 overflow-hidden leading-4">
            <span className="text-xs font-medium text-slate-700">The filled-in list</span>
            <span className="truncate text-[11px] text-slate-500">the workbook (.xlsx) as downloaded, or a CSV with the template&apos;s headings</span>
          </div>
          {file ? (
            <div className="flex h-(--control-h) items-center gap-2 rounded-md px-2.5 text-[13px] ring-1 ring-line">
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
              <span className="min-w-0 truncate font-medium text-slate-800" title={file.name}>{file.name}</span>
              <button type="button" onClick={() => { setFile(null); setLines(null); setView(null); }} className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-link hover:underline" disabled={reading}>
                <X className="h-3.5 w-3.5" aria-hidden="true" /> Remove
              </button>
            </div>
          ) : (
            <input type="file" accept=".xlsx,.csv,text/csv" aria-label="The filled-in list" className="w-full" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={!file || reading} onClick={choose} className={btn("primary")}>{reading ? "Checking…" : "Check the list"}</button>
          <span className="text-xs text-slate-500">Checking writes nothing: you see every line first.</span>
        </div>
        {read?.error ? <p role="alert" className="rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-800 ring-1 ring-red-200">{read.error}</p> : null}
      </div>

      {lines && view ? (
        <div className="space-y-3 border-t border-line px-5 py-4 sm:px-6" aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-800">What the list would do</h2>
            <p className="text-xs text-slate-600">
              {plural(view.new, "new document")} · {plural(view.updates, "update")} · {view.same} the same · {plural(view.problems, "problem")}
              {left.size ? ` · ${left.size} left out` : ""}
            </p>
          </div>

          {/* For many lines at once. */}
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-tint-soft px-3 py-2 text-xs ring-1 ring-line">
            <button type="button" className={btn("ghost", "sm")} onClick={() => setLeft(new Set([...left, ...view.lines.filter((l) => l.outcome === "PROBLEM").map((l) => l.at)]))}>Leave out every problem</button>
            <button type="button" className={btn("ghost", "sm")} onClick={() => setLeft(new Set())}>Keep every line</button>
            {ticked.size ? (
              <>
                <span className="ml-2 font-semibold text-slate-700">{ticked.size} ticked:</span>
                <button type="button" className={btn("ghost", "sm")} onClick={() => { setLeft(new Set([...left, ...ticked])); setTicked(new Set()); }}>Leave them out</button>
                <span className="w-44"><Select value={bulkField} onChange={(e) => setBulkField(e.target.value)} aria-label="The field to set">
                  <option value="">Set a field…</option>
                  {fields.map((key) => <option key={key} value={key}>{nameOf(key)}</option>)}
                </Select></span>
                <input value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} aria-label="Its value" placeholder="its value (empty: as the file had nothing)" className={`${inputCls} w-56`} />
                <button type="button" disabled={!bulkField} className={btn("secondary", "sm")} onClick={setBulk}>Set it</button>
              </>
            ) : <span className="ml-2 text-slate-500">Tick lines to leave them out or set a field on all of them.</span>}
          </div>

          <div className="overflow-x-auto rounded-md ring-1 ring-line">
            <table className="w-full table-fixed text-left text-xs">
              <thead className="bg-tint-soft text-[11px] text-slate-500">
                <tr>
                  <th scope="col" className="w-8 px-2 py-2"><span className="sr-only">Tick</span></th>
                  <th scope="col" className="w-20 px-2 py-2 font-semibold">Kept</th>
                  <th scope="col" className="w-36 px-2 py-2 font-semibold">Where in the file</th>
                  <th scope="col" className="w-20 px-2 py-2 font-semibold">It does</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Document, and what changes</th>
                  <th scope="col" className="w-10 px-2 py-2"><span className="sr-only">Correct</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {lines.map((line) => {
                  const one = said.get(line.at);
                  const out = left.has(line.at);
                  return (
                    <tr key={line.at} className={out ? "opacity-55" : one?.outcome === "PROBLEM" ? "bg-red-50/50" : ""}>
                      <td className="px-2 py-1.5 align-top">
                        <input type="checkbox" aria-label={`Tick ${line.at}`} checked={ticked.has(line.at)} onChange={() => setTicked(toggle(ticked, line.at))} />
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        <Switch on={!out} words={["In", "Out"]} label={`Keep ${line.at} in the list`} onToggle={() => setLeft(toggle(left, line.at))} />
                      </td>
                      <td className="px-2 py-1.5 align-top break-words text-slate-600 tabular-nums">{line.at}</td>
                      <td className={`px-2 py-1.5 align-top font-semibold ${one ? OUTCOME[one.outcome].ink : "text-slate-500"}`}>
                        {stale && !out ? "to check" : one ? OUTCOME[one.outcome].word : "—"}
                      </td>
                      <td className="max-w-0 px-2 py-1.5 align-top leading-5 break-words text-slate-700">
                        <span className="font-mono text-slate-800">{one?.number ?? line.number ?? "number given when registered"}</span>
                        {" · "}{line.values.title ?? one?.title ?? ""}
                        {one?.changes.length ? (
                          <span className="block text-slate-600">
                            {one.changes.map((c) => `${nameOf(c.field)}: ${c.was ?? "—"} → ${c.now ?? "—"}`).join("; ")}
                          </span>
                        ) : null}
                        {one?.problems.length ? <span className="block text-red-700">{one.problems.join(" ")}</span> : null}
                        {editing === line.at ? (
                          <div className="mt-2 grid gap-2 sm:grid-cols-3">
                            {[...new Set([...fields, ...(one?.fields ?? []).filter((f) => f !== "deliverableType")])].map((key) => (
                              <label key={key} className="block min-w-0" data-missing={one?.fields.includes(key) ? "" : undefined}>
                                <span className="mb-1 block truncate text-[11px] text-slate-500">{nameOf(key)}</span>
                                <input defaultValue={line.values[key] ?? ""} onBlur={(e) => change(line.at, key, e.target.value)} className={inputCls} />
                              </label>
                            ))}
                            <div className="sm:col-span-3">
                              <button type="button" className={btn("secondary", "sm")} onClick={() => setEditing(null)}><Check className="h-3.5 w-3.5" aria-hidden="true" /> Done</button>
                            </div>
                          </div>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        <button type="button" title="Correct this line" aria-label={`Correct ${line.at}`} onClick={() => setEditing(editing === line.at ? null : line.at)} className="text-slate-500 hover:text-brand-ink">
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {error ? <p role="alert" className="rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-800 ring-1 ring-red-200">{error}</p> : null}

          {/* The act, named with its count; only once what is kept has been checked as it stands and nothing in it is a problem. */}
          <div className="flex flex-wrap items-center gap-3 rounded-md bg-tint-soft px-3 py-2.5 text-xs ring-1 ring-line">
            {stale ? (
              <>
                <span className="text-slate-700">Lines were corrected: check them again before writing.</span>
                <button type="button" disabled={busy} className={btn("primary")} onClick={checkAgain}>{busy ? "Checking…" : "Check again"}</button>
              </>
            ) : blocking ? (
              <span className="text-slate-700">{plural(blocking, "line")} kept {blocking === 1 ? "has a problem" : "have problems"}: correct {blocking === 1 ? "it" : "them"} and check again, or leave {blocking === 1 ? "it" : "them"} out.</span>
            ) : toWrite.length ? (
              <>
                <span className="text-slate-700">Nothing is written until you press it; then all of it is, or none.</span>
                <button type="button" disabled={busy} className={btn("primary")} onClick={write}>
                  {busy ? "Writing…" : [registering ? `Register ${plural(registering, "document")}` : "", updating ? `${registering ? "update" : "Update"} ${plural(updating, "document")}` : ""].filter(Boolean).join(", ")}
                </button>
              </>
            ) : <span className="text-slate-700">Nothing to write: every line kept already reads so.</span>}
          </div>
        </div>
      ) : null}
    </div>
  );
}
