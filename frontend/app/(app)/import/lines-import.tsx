"use client";

import { startTransition, useActionState, useMemo, useState, useTransition } from "react";
import { readLinesAction, checkLinesAction, writeLinesAction, type Line, type LineCheck, type LineField, type LinesKind } from "@/lib/documents/forms-lines";
import { btn, DataTable, Th, Td } from "@/components/ui";
import { InSlot } from "@/components/slot";
import { Select } from "@/components/select";
import { FileSpreadsheet, Pencil, Undo2, X } from "lucide-react";

/** What a line does, in words and the app's colours (coloured text inside a register, never a pill). */
const OUTCOME: Record<LineCheck["outcome"], { word: string; ink: string }> = {
  NEW: { word: "New", ink: "text-sky-700" },
  UPDATE: { word: "Update", ink: "text-amber-800" },
  SAME: { word: "No change", ink: "text-slate-500" },
  PROBLEM: { word: "Problem", ink: "text-red-700" },
};
const NEW_SAID: Record<LinesKind, string> = {
  people: "Gets an account and joins the project; they are emailed a link to choose their password.",
  matrix: "",
  sets: "Added to the list as written.",
  "org-sets": "Added to the organization's list as written: every project reading it gets it.",
};
const WHAT: Record<LinesKind, { file: string; hint: string; accept: string; line: string }> = {
  people: { file: "The filled-in team list", hint: "a CSV with the template's headings", accept: ".csv,text/csv", line: "Person" },
  matrix: { file: "The filled-in matrix", hint: "the matrix as downloaded (.csv)", accept: ".csv,text/csv", line: "Documents it is for" },
  sets: { file: "The filled-in workbook", hint: "the workbook (.xlsx) as downloaded", accept: ".xlsx", line: "Value" },
  "org-sets": { file: "The filled-in workbook", hint: "the organization's lists as downloaded (.xlsx)", accept: ".xlsx", line: "Value" },
};

/** The register's dock: its first act in the brand's gold, the others light on the dark bar. */
const DOCK_FIRST = "inline-flex items-center gap-1.5 rounded-sm bg-gold px-3 py-2 text-xs font-semibold text-brand-ink";
const DOCK_ACT = "inline-flex items-center gap-1.5 rounded-sm bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/15";
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

/**
 * Correcting a line in place: the fields its form asks, each list offering what applies, what identifies the line shown
 * and never changed. For several lines at once (`many`), every field starts empty and only what is filled in changes.
 */
function LineForm({ fields, values, faulty, many, onSave, onCancel }: {
  fields: LineField[]; values: Record<string, string>; faulty?: boolean; many?: number;
  onSave: (values: Record<string, string>) => void; onCancel: () => void;
}) {
  const [now, setNow] = useState<Record<string, string>>(many ? {} : values);
  const set = (key: string, value: string) => setNow((before) => ({ ...before, [key]: value }));
  const asked = fields.filter((f) => (!f.forSet || f.forSet === values.set) && !(many && f.locked));
  return (
    <div className="space-y-3 border-t border-line bg-surface px-3 py-3">
      {many ? <p className="text-xs text-slate-600">Fill in only what should change on the {many} lines ticked; what you leave empty stays as each line has it.</p> : null}
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-3">
        {asked.map((field) => {
          const value = now[field.key] ?? "";
          const offered = field.values ?? [];
          const unknown = value && field.kind === "choice" && !offered.some((v) => v.code === value) ? [{ code: value, label: `${value} (not offered)` }] : [];
          return (
            <label key={field.key} className="block min-w-0" data-missing={faulty && field.required && !value ? "" : undefined}>
              <span className="mb-1.5 flex h-4 min-w-0 items-baseline gap-2 overflow-hidden leading-4">
                <span className="shrink-0 text-xs font-medium text-slate-700">{field.label}{field.required && !many ? " *" : ""}</span>
                <span className="truncate text-[11px] text-slate-500" title={field.locked ? "What identifies the line: it never changes here." : field.note}>
                  {field.locked ? "identifies the line" : field.note ?? ""}
                </span>
              </span>
              {field.kind === "choice" ? (
                <Select className="plain w-full" value={value} disabled={field.locked} onChange={(e) => set(field.key, e.target.value)} aria-label={field.label}>
                  <option value="">{many ? "Leave each line's own" : "—"}</option>
                  {[...unknown, ...offered].map((v) => <option key={v.code} value={v.code}>{v.label === v.code ? v.code : `${v.code} — ${v.label}`}</option>)}
                </Select>
              ) : (
                <input type="text" value={value} disabled={field.locked} onChange={(e) => set(field.key, e.target.value)}
                  placeholder={many ? "Leave each line's own" : undefined} aria-label={field.label} className="plain w-full" />
              )}
            </label>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <button type="button" className={btn("secondary")} onClick={onCancel}>Cancel</button>
        <button type="button" className={btn("primary")} onClick={() => onSave(many ? Object.fromEntries(Object.entries(now).filter(([, v]) => v.trim())) : now)}>
          {many ? `Change the ${many} lines` : "Save this line"}
        </button>
      </div>
    </div>
  );
}

/**
 * The team list, the distribution matrix or the Settings lists, brought in on two pages (owner: as the deliverable
 * list): the file (or its register document's released revision) is read and checked, then every line says what it
 * would do before anything is written. A line is corrected in place (its pencil) or taken off the list (its ×, put back
 * from "Taken off"); lines ticked are changed together or taken off together. Every change is checked again at once.
 * Then one act writes the whole list, or nothing.
 */
export function LinesImport({ kind, fromDocument }: { kind: LinesKind; fromDocument?: { label: string } | null }) {
  const [read, readFile, reading] = useActionState(readLinesAction, undefined);
  const [file, setFile] = useState<File | null>(null);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [checks, setChecks] = useState<LineCheck[]>([]);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ summary: string; checks: LineCheck[] } | null>(null);
  const [busy, run] = useTransition();
  // Which lines show (owner: as the Schedule's check): all, or those of one outcome.
  const [only, setOnly] = useState<string>("ALL");
  const [seenRead, setSeenRead] = useState<typeof read>(undefined);
  const what = WHAT[kind];

  // A new reading of the file starts the second page afresh.
  if (read !== seenRead) {
    setSeenRead(read);
    if (read?.lines && read.checks) {
      setLines(read.lines); setChecks(read.checks); setOff(new Set()); setTicked(new Set()); setEditing(null); setError(null); setDone(null);
    }
  }

  const fields = read?.fields ?? [];
  const said = useMemo(() => new Map(checks.map((c) => [c.at, c] as const)), [checks]);
  // Every line of the list is shown, those that change nothing too (owner): the person sees the whole file.
  const listed = (lines ?? []).filter((l) => !off.has(l.at));
  const shown = listed.filter((l) => only === "ALL" || said.get(l.at)?.outcome === only);
  const count = (outcome: LineCheck["outcome"]) => listed.filter((l) => said.get(l.at)?.outcome === outcome).length;
  const problems = listed.filter((l) => said.get(l.at)?.outcome === "PROBLEM");
  const changing = count("NEW") + count("UPDATE");
  const tickedLines = shown.filter((l) => ticked.has(l.at));
  const tickedSets = new Set(tickedLines.map((l) => l.values.set ?? ""));

  const send = (data: FormData) => { data.set("kind", kind); startTransition(() => readFile(data)); };
  /** Check what is on the list as it now stands: nothing is written. */
  const recheck = (next: Line[], away: Set<string>) => run(async () => {
    const keep = next.filter((l) => !away.has(l.at));
    if (!keep.length) { setError(null); return; }
    const answer = await checkLinesAction(kind, keep);
    if (answer.error) { setError(answer.error); return; }
    setChecks(answer.checks ?? []); setError(null);
  });
  const correct = (ats: string[], values: Record<string, string>) => {
    const next = (lines ?? []).map((l) => ats.includes(l.at) ? { ...l, values: { ...l.values, ...values } } : l);
    setLines(next); setEditing(null); setTicked(new Set());
    recheck(next, off);
  };
  const takeOff = (ats: string[]) => { const away = new Set([...off, ...ats]); setOff(away); setTicked(new Set()); setEditing(null); recheck(lines ?? [], away); };
  const putBack = (at: string) => { const away = new Set([...off].filter((one) => one !== at)); setOff(away); recheck(lines ?? [], away); };
  const write = () => run(async () => {
    const answer = await writeLinesAction(kind, listed, read?.from ?? null);
    if (answer.checks) setChecks(answer.checks);
    if (answer.error || !answer.written) { setError(answer.error ?? "Nothing was written."); return; }
    setDone({ summary: answer.summary ?? "Written.", checks: answer.checks ?? [] }); setError(null);
  });
  const toggle = (at: string) => setTicked((before) => { const next = new Set(before); if (next.has(at)) next.delete(at); else next.add(at); return next; });

  if (done) {
    const passes = done.checks.filter((c) => c.pass);
    return (
      <div className="space-y-3 px-5 py-4 sm:px-6" aria-live="polite">
        <p className="text-sm font-semibold text-slate-800">Done: {done.summary}</p>
        {passes.length ? (
          <div className="rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 ring-1 ring-amber-200">
            <p className="font-semibold">Email is off on this installation: give each their link to choose their password (it works once, for 7 days). Leaving the page loses them.</p>
            <ul className="mt-1 space-y-0.5">{passes.map((c) => <li key={c.at}>{c.title}: <span className="font-mono break-all">{c.pass}</span></li>)}</ul>
          </div>
        ) : null}
        <button type="button" className={btn("secondary")} onClick={() => { setDone(null); setLines(null); setChecks([]); setFile(null); }}>Bring in another list</button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-3 px-5 py-4 sm:px-6">
        <div className="max-w-xl">
          <div className="mb-1.5 flex h-4 min-w-0 items-baseline gap-2 overflow-hidden leading-4">
            <span className="text-xs font-medium text-slate-700">{what.file}</span>
            <span className="truncate text-[11px] text-slate-500">{what.hint}</span>
          </div>
          {file ? (
            <div className="flex h-(--control-h) items-center gap-2 rounded-md px-2.5 text-[13px] ring-1 ring-line">
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
              <span className="min-w-0 truncate font-medium text-slate-800" title={file.name}>{file.name}</span>
              <button type="button" onClick={() => { setFile(null); setLines(null); setChecks([]); }} className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-link hover:underline" disabled={reading}>
                <X className="h-3.5 w-3.5" aria-hidden="true" /> Remove
              </button>
            </div>
          ) : (
            <input type="file" accept={what.accept} aria-label={what.file} className="w-full" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={!file || reading} onClick={() => { if (!file) return; const data = new FormData(); data.set("file", file); send(data); }} className={btn("primary")}>
            {reading ? "Checking…" : "Check the list"}
          </button>
          {fromDocument ? (
            <button type="button" disabled={reading} className={btn("secondary")} onClick={() => { const data = new FormData(); data.set("fromDocument", "1"); setFile(null); send(data); }}>
              Bring in {fromDocument.label}
            </button>
          ) : null}
          <span className="text-xs text-slate-500">Nothing is written yet: you see every line first.</span>
        </div>
        {read?.from ? <p className="text-xs text-slate-600">Read from {read.from.label}, as released.</p> : null}
        {read?.error ? <p role="alert" className="rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-800 ring-1 ring-red-200">{read.error}</p> : null}
      </div>

      {lines ? (
        // The lines take the page's whole width, in a card of their own under the upload (owner).
        <InSlot id="import-results">
        <div className="space-y-3 border-t border-line px-5 py-4 first:border-t-0 sm:px-6" aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-800">What this list will do</h2>
            <div role="tablist" className="seg w-fit max-w-full" aria-label="Which lines">
              {([["ALL", "All", listed.length], ["NEW", "New", count("NEW")], ["UPDATE", "Update", count("UPDATE")], ["SAME", "No change", count("SAME")], ["PROBLEM", "Problem", count("PROBLEM")]] as const).map(([key, word, n]) => (
                <button key={key} type="button" role="tab" aria-selected={only === key} className="segment" onClick={() => setOnly(key)}>
                  {word} <span className="segment-n">{n.toLocaleString("en-GB")}</span>
                </button>
              ))}
              {busy ? <span className="ml-2 self-center text-xs text-slate-500">checking…</span> : null}
            </div>
          </div>

          <DataTable
            id={`lines-import-${kind}`}
            toolbar={false}
            head={
              <tr>
                <Th className="w-10">
                  <input type="checkbox" aria-label={`Tick all ${shown.length} lines`} checked={!!shown.length && shown.every((l) => ticked.has(l.at))}
                    onChange={(e) => setTicked(e.target.checked ? new Set(shown.map((l) => l.at)) : new Set())} />
                </Th>
                <Th label="It will be">It will be</Th>
                <Th label={what.line} className="min-w-60">{what.line}</Th>
                <Th label="What changes, or what is wrong">What changes, or what is wrong</Th>
                <Th label="Where in the file">Where in the file</Th>
                <Th className="w-16"><span className="sr-only">Correct or take off</span></Th>
              </tr>
            }
          >
            {shown.map((line) => {
              const one = said.get(line.at);
              return [
                <tr key={line.at}>
                  <Td><input type="checkbox" aria-label={`Tick ${line.at}`} checked={ticked.has(line.at)} onChange={() => toggle(line.at)} /></Td>
                  <Td className={`whitespace-nowrap text-xs font-semibold ${one ? OUTCOME[one.outcome].ink : "text-slate-500"}`}>{one ? OUTCOME[one.outcome].word : "—"}</Td>
                  <Td className="text-xs leading-5 whitespace-normal">{one?.title ?? line.at}</Td>
                  <Td className="text-xs leading-5 whitespace-normal">
                    {one?.problems.length ? <span className="block text-red-700">{one.problems.join(" ")}</span> : null}
                    {one?.changes.map((c) => <span key={c.field} className="block">{c.field}: {c.was ?? "—"} → {c.now ?? "—"}</span>)}
                    {one?.outcome === "NEW" && !one.changes.length ? <span className="text-slate-500">{NEW_SAID[kind]}</span> : null}
                    {one?.outcome === "SAME" ? <span className="text-slate-500">Already reads so: nothing to write.</span> : null}
                  </Td>
                  <Td className="whitespace-nowrap text-[11px] text-slate-500">{line.at}</Td>
                  <Td>
                    <span className="flex items-center gap-2">
                      <button type="button" title="Correct this line" aria-label={`Correct ${line.at}`} onClick={() => setEditing(editing === line.at ? null : line.at)} className="text-slate-500 hover:text-brand-ink">
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      <button type="button" title="Take this line off the list: it is not brought in" aria-label={`Take ${line.at} off the list`} onClick={() => takeOff([line.at])} className="text-red-600 hover:text-red-800">
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </span>
                  </Td>
                </tr>,
                editing === line.at ? (
                  <tr key={`${line.at}-form`}>
                    <td colSpan={6} className="p-0">
                      <LineForm fields={fields} values={line.values} faulty={one?.outcome === "PROBLEM"} onCancel={() => setEditing(null)} onSave={(values) => correct([line.at], values)} />
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </DataTable>

          {editing === "many" && tickedLines.length ? (
            <div className="overflow-hidden rounded-md ring-1 ring-line">
              <LineForm fields={fields} values={{ set: tickedLines[0].values.set ?? "" }} many={tickedLines.length}
                onCancel={() => setEditing(null)} onSave={(values) => correct(tickedLines.map((l) => l.at), values)} />
            </div>
          ) : null}
          {tickedLines.length ? (
            <div className="dock palette-light sticky bottom-4 z-30 mx-auto flex w-fit max-w-full flex-wrap items-center gap-2 rounded-sm border border-white/10 bg-brand-strong p-2.5 text-white shadow-[0_8px_30px_rgb(0_0_0/0.18)]">
              <span className="px-2 font-mono text-sm tabular-nums">{tickedLines.length}<span className="ml-1.5 text-[11px] uppercase tracking-[0.12em] text-white/60">ticked</span></span>
              {kind !== "sets" || tickedSets.size === 1 ? (
                <button type="button" className={DOCK_FIRST} onClick={() => setEditing("many")}><Pencil className="h-4 w-4" aria-hidden="true" /> Change them together</button>
              ) : <span className="px-1 text-[11px] text-white/60">To change them together, tick values of one list</span>}
              <button type="button" className={DOCK_ACT} onClick={() => takeOff(tickedLines.map((l) => l.at))}><X className="h-4 w-4" aria-hidden="true" /> Take them off the list</button>
              {problems.length ? (
                <button type="button" className={DOCK_ACT} onClick={() => setTicked(new Set(problems.map((l) => l.at)))}>Tick the {plural(problems.length, "problem")}</button>
              ) : null}
              <button type="button" onClick={() => setTicked(new Set())} className="ml-auto rounded-sm p-2 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Clear the ticks" title="Clear the ticks">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ) : null}

          {off.size ? (
            <details className="rounded-md ring-1 ring-line">
              <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-700">Taken off the list ({off.size}): not brought in</summary>
              <ul className="divide-y divide-line border-t border-line">
                {(lines ?? []).filter((l) => off.has(l.at)).map((line) => (
                  <li key={line.at} className="flex items-baseline gap-3 px-3 py-1.5 text-xs">
                    <span className="min-w-0 flex-1 truncate text-slate-700">{said.get(line.at)?.title ?? line.at} <span className="text-slate-500">({line.at})</span></span>
                    <button type="button" className="inline-flex items-center gap-1 font-semibold text-link hover:underline" onClick={() => putBack(line.at)}>
                      <Undo2 className="h-3.5 w-3.5" aria-hidden="true" /> Put back
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {error ? <p role="alert" className="rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-800 ring-1 ring-red-200">{error}</p> : null}

          <div className="flex flex-wrap items-center gap-3 rounded-md bg-tint-soft px-3 py-2.5 text-xs ring-1 ring-line">
            {problems.length ? (
              <>
                <span className="text-slate-700">{plural(problems.length, "line")} {problems.length === 1 ? "has a problem" : "have problems"}: correct {problems.length === 1 ? "it" : "them"} with the pencil, or take {problems.length === 1 ? "it" : "them"} off the list.</span>
                <button type="button" disabled={busy} className={btn("secondary")} onClick={() => takeOff(problems.map((l) => l.at))}>Take every line with a problem off</button>
              </>
            ) : changing ? (
              <>
                <span className="text-slate-700">Nothing is written until you press it; then the whole list is, or nothing.</span>
                <button type="button" disabled={busy} className={btn("primary")} onClick={write}>{busy ? "Working…" : `Write ${plural(changing, "line")}`}</button>
              </>
            ) : <span className="text-slate-700">Nothing to bring in: every line already reads so.</span>}
          </div>
        </div>
        </InSlot>
      ) : null}
    </div>
  );
}
