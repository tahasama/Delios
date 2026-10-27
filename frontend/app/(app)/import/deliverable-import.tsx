"use client";

import { startTransition, useActionState, useMemo, useState, useTransition } from "react";
import {
  readDeliverableListAction, checkDeliverableLinesAction, writeDeliverableLinesAction,
  type ListLine, type ListView, type LineView,
} from "@/lib/documents/forms-deliverables";
import type { DeliverableFields, DocumentField } from "@/lib/documents/deliverable-fields";
import { btn, DataTable, Th, Td } from "@/components/ui";
import { InSlot } from "@/components/slot";
import { Select } from "@/components/select";
import { FileSpreadsheet, Pencil, Undo2, X } from "lucide-react";

/** What a line does, in words and the app's colours (coloured text inside a register, never a pill). */
const OUTCOME: Record<LineView["outcome"], { word: string; ink: string }> = {
  NEW: { word: "New document", ink: "text-sky-700" },
  UPDATE: { word: "Update", ink: "text-amber-800" },
  SAME: { word: "No change", ink: "text-slate-500" },
  PROBLEM: { word: "Problem", ink: "text-red-700" },
};

/** The register's dock: its first act in the brand's gold, the others light on the dark bar. */
const DOCK_FIRST = "inline-flex items-center gap-1.5 rounded-sm bg-gold px-3 py-2 text-xs font-semibold text-brand-ink";
const DOCK_ACT = "inline-flex items-center gap-1.5 rounded-sm bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/15";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Correcting a line is the document form itself (owner): the same fields, in the same order, called the same, each
 * list offering only the values offered for the deliverable type, a field the backend names outlined. On an update,
 * what the number is made of is shown and never changed. For several lines at once (`many`), every field starts empty
 * and only what is filled in changes, on each line.
 */
function LineForm({ form, values, update, faulty, many, onSave, onCancel }: {
  form: DeliverableFields[]; values: Record<string, string>; update: boolean; faulty: string[]; many?: number;
  onSave: (values: Record<string, string>) => void; onCancel: () => void;
}) {
  const [now, setNow] = useState<Record<string, string>>(many ? {} : values);
  const type = form.find((one) => one.code === (now.deliverableType ?? values.deliverableType)) ?? null;
  const set = (key: string, value: string) => setNow((before) => ({ ...before, [key]: value }));
  const fields: DocumentField[] = (type?.fields ?? []).filter((f) => !(many && update && f.inNumber) && !(many && f.key === "title"));
  const control = (field: DocumentField) => {
    const locked = update && !!field.inNumber;
    const value = now[field.key] ?? "";
    if (field.kind === "choice") {
      const values = field.values ?? [];
      // A value the file gave that is not offered stays visible, so the person sees what is wrong with it.
      const unknown = value && !values.some((v) => v.code === value) ? [{ code: value, label: `${value} (not offered for this type)` }] : [];
      return (
        <Select className="plain w-full" value={value} disabled={locked} onChange={(e) => set(field.key, e.target.value)} aria-label={field.label}>
          <option value="">{many ? "Leave each line's own" : "—"}</option>
          {[...unknown, ...values].map((v) => <option key={v.code} value={v.code}>{v.label === v.code ? v.code : `${v.code} — ${v.label}`}</option>)}
        </Select>
      );
    }
    return (
      <input type={field.kind === "date" ? "date" : "text"} value={value} disabled={locked} onChange={(e) => set(field.key, e.target.value)}
        placeholder={many ? "Leave each line's own" : undefined} aria-label={field.label} className="plain w-full" />
    );
  };
  return (
    <div className="space-y-3 border-t border-line bg-surface px-3 py-3">
      {many ? <p className="text-xs text-slate-600">Fill in only what should change on the {many} lines ticked; what you leave empty stays as each line has it.</p> : null}
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-3">
        {!many ? (
          <label className="block min-w-0">
            <span className="mb-1.5 flex h-4 items-baseline gap-2 leading-4"><span className="text-xs font-medium text-slate-700">Deliverable type</span>
              {update ? <span className="truncate text-[11px] text-slate-500">part of the number</span> : null}</span>
            <Select className="plain w-full" value={now.deliverableType ?? ""} disabled={update} onChange={(e) => set("deliverableType", e.target.value)} aria-label="Deliverable type">
              <option value="">—</option>
              {form.map((one) => <option key={one.code} value={one.code}>{one.label}</option>)}
            </Select>
          </label>
        ) : null}
        {fields.map((field) => (
          <label key={field.key} className={`block min-w-0 ${field.key === "title" ? "sm:col-span-2" : ""}`} data-missing={faulty.includes(field.key) ? "" : undefined}>
            <span className="mb-1.5 flex h-4 min-w-0 items-baseline gap-2 overflow-hidden leading-4">
              <span className="shrink-0 text-xs font-medium text-slate-700">{field.label}{field.required && !many ? " *" : ""}</span>
              <span className="truncate text-[11px] text-slate-500" title={update && field.inNumber ? "Part of the number: it never changes." : field.note}>
                {update && field.inNumber ? "part of the number" : field.note ?? ""}
              </span>
            </span>
            {control(field)}
          </label>
        ))}
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
 * The deliverable list, brought in on two pages (owner): the file is read and checked, then every line says what it
 * would do (a new document, an update with each change "was → now", or a problem with why) before anything is written.
 * A line is corrected with the document form (its pencil) or taken off the list (its ×, put back from "Taken off");
 * several lines ticked are changed together or taken off together. Every change is checked again at once. Then one
 * act writes the whole list, or nothing.
 */
export function DeliverableImport({ fromDocument }: { fromDocument?: { label: string } | null } = {}) {
  const [read, readFile, reading] = useActionState(readDeliverableListAction, undefined);
  const [file, setFile] = useState<File | null>(null);
  const [lines, setLines] = useState<ListLine[] | null>(null);
  const [view, setView] = useState<ListView | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ListView | null>(null);
  const [busy, run] = useTransition();
  // Which lines show (owner: as the Schedule's check): all, or those of one outcome.
  const [only, setOnly] = useState<string>("ALL");
  const [seenRead, setSeenRead] = useState<typeof read>(undefined);

  // A new reading of the file starts the second page afresh.
  if (read !== seenRead) {
    setSeenRead(read);
    if (read?.lines && read.view) {
      setLines(read.lines); setView(read.view); setOff(new Set()); setTicked(new Set()); setEditing(null); setError(null); setDone(null);
    }
  }

  const form = read?.form ?? [];
  const said = useMemo(() => new Map((view?.lines ?? []).map((l) => [l.at, l] as const)), [view]);
  const nameOf = (key: string) => form.flatMap((t) => t.fields).find((f) => f.key === key)?.label ?? key;
  const onList = (lines ?? []).filter((l) => !off.has(l.at));
  // Every line of the list is shown, those that change nothing too (owner): the person sees the whole file.
  const shown = onList.filter((l) => only === "ALL" || said.get(l.at)?.outcome === only);
  const same = onList.filter((l) => said.get(l.at)?.outcome === "SAME").length;
  const problems = onList.filter((l) => said.get(l.at)?.outcome === "PROBLEM");
  const registering = onList.filter((l) => said.get(l.at)?.outcome === "NEW").length;
  const updating = onList.filter((l) => said.get(l.at)?.outcome === "UPDATE").length;
  const tickedLines = shown.filter((l) => ticked.has(l.at));
  const tickedTypes = new Set(tickedLines.map((l) => l.values.deliverableType ?? ""));

  /** Check what is on the list as it now stands: every change is checked at once, nothing is written. */
  const recheck = (next: ListLine[], away: Set<string>) => run(async () => {
    const keep = next.filter((l) => !away.has(l.at));
    if (!keep.length) { setError(null); return; }
    const answer = await checkDeliverableLinesAction(read?.project ?? null, keep);
    if (answer.error) { setError(answer.error); return; }
    setView((before) => ({ ...answer.view!, lines: [...(before?.lines ?? []).filter((l) => away.has(l.at)), ...answer.view!.lines] }));
    setError(null);
  });
  // What the form gave is laid over the line: a field emptied is emptied, one the form does not ask stays as the file had it.
  const correct = (ats: string[], values: Record<string, string>) => {
    const next = (lines ?? []).map((l) => {
      if (!ats.includes(l.at)) return l;
      const merged = { ...l.values, ...values };
      for (const key of Object.keys(merged)) if (!merged[key]?.trim()) delete merged[key];
      return { ...l, values: merged };
    });
    setLines(next); setEditing(null); setTicked(new Set());
    recheck(next, off);
  };
  const takeOff = (ats: string[]) => { const away = new Set([...off, ...ats]); setOff(away); setTicked(new Set()); setEditing(null); recheck(lines ?? [], away); };
  const putBack = (at: string) => { const away = new Set([...off].filter((one) => one !== at)); setOff(away); recheck(lines ?? [], away); };
  const write = () => run(async () => {
    const answer = await writeDeliverableLinesAction(read?.project ?? null, onList.filter((l) => said.get(l.at)?.outcome !== "SAME"), read?.from ?? null);
    if (answer.view && !answer.view.written) setView(answer.view);
    if (answer.error) { setError(answer.error); return; }
    setDone(answer.view ?? null); setError(null);
  });
  const toggle = (at: string) => setTicked((before) => { const next = new Set(before); if (next.has(at)) next.delete(at); else next.add(at); return next; });

  if (done) {
    return (
      <div className="space-y-3 px-5 py-4 sm:px-6" aria-live="polite">
        <p className="text-sm font-semibold text-slate-800">Done: {plural(done.new, "document")} registered, {plural(done.updates, "document")} updated.</p>
        <ul className="divide-y divide-line rounded-md ring-1 ring-line">
          {done.lines.filter((l) => l.outcome !== "SAME").map((l) => (
            <li key={l.at} className="flex flex-wrap items-baseline gap-x-3 px-3 py-1.5 text-xs">
              <span className={`w-20 font-semibold ${OUTCOME[l.outcome].ink}`}>{l.outcome === "NEW" ? "Registered" : "Updated"}</span>
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
          <button type="button" disabled={!file || reading} onClick={() => { if (!file) return; const data = new FormData(); data.set("file", file); startTransition(() => readFile(data)); }} className={btn("primary")}>
            {reading ? "Checking…" : "Check the list"}
          </button>
          {fromDocument ? (
            <button type="button" disabled={reading} className={btn("secondary")} onClick={() => { const data = new FormData(); data.set("fromDocument", "1"); setFile(null); startTransition(() => readFile(data)); }}>
              Bring in {fromDocument.label}
            </button>
          ) : null}
          <span className="text-xs text-slate-500">Nothing is written yet: you see every line first.</span>
        </div>
        {read?.from ? <p className="text-xs text-slate-600">Read from {read.from.label}, as released.</p> : null}
        {read?.error ? <p role="alert" className="rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-800 ring-1 ring-red-200">{read.error}</p> : null}
      </div>

      {lines && view ? (
        // The lines take the page's whole width, in a card of their own under the upload (owner).
        <InSlot id="import-results">
        <div className="space-y-3 border-t border-line px-5 py-4 first:border-t-0 sm:px-6" aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-800">What this list will do</h2>
            <div className="seg" aria-label="Which lines">
              {([["ALL", "All", onList.length], ["NEW", "New document", registering], ["UPDATE", "Update", updating], ["SAME", "No change", same], ["PROBLEM", "Problem", problems.length]] as const).map(([key, word, n]) => (
                <button key={key} type="button" aria-pressed={only === key} className="segment" onClick={() => setOnly(key)}>
                  {word} <span className="tabular-nums text-slate-500">{n.toLocaleString("en-GB")}</span>
                </button>
              ))}
              {busy ? <span className="ml-2 self-center text-xs text-slate-500">checking…</span> : null}
            </div>
          </div>


          <DataTable
            id="deliverable-import"
            toolbar={false}
            head={
              <tr>
                <Th className="w-10">
                  <input type="checkbox" aria-label={`Tick all ${shown.length} lines`} checked={!!shown.length && shown.every((l) => ticked.has(l.at))}
                    onChange={(e) => setTicked(e.target.checked ? new Set(shown.map((l) => l.at)) : new Set())} />
                </Th>
                <Th label="It will be">It will be</Th>
                <Th label="Document" className="min-w-60">Document</Th>
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
                  <Td>
                    {one?.documentId ? <a href={`/documents/${one.documentId}`} className="doc-number">{one.number}</a>
                      : <span className="doc-number">{one?.number ?? line.number ?? "number given when registered"}</span>}
                    <span className="doc-title block max-w-80 truncate" title={line.values.title ?? one?.title ?? ""}>{line.values.title ?? one?.title ?? ""}</span>
                  </Td>
                  <Td className="text-xs leading-5 whitespace-normal">
                    {one?.problems.length ? <span className="block text-red-700">{one.problems.join(" ")}</span> : null}
                    {one?.changes.map((c) => <span key={c.field} className="block">{nameOf(c.field)}: {c.was ?? "—"} → {c.now ?? "—"}</span>)}
                    {one?.outcome === "NEW" ? <span className="text-slate-500">Registered as listed, given its number.</span> : null}
                    {one?.outcome === "SAME" ? <span className="text-slate-500">Already reads so in the register: nothing to write.</span> : null}
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
                      <LineForm form={form} values={line.values} update={!!(one?.number ?? line.number)} faulty={one?.fields ?? []}
                        onCancel={() => setEditing(null)} onSave={(values) => correct([line.at], values)} />
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </DataTable>

          {editing === "many" && tickedLines.length ? (
            <div className="overflow-hidden rounded-md ring-1 ring-line">
              <LineForm form={form} values={{ deliverableType: tickedLines[0].values.deliverableType ?? "" }} update={tickedLines.some((l) => said.get(l.at)?.outcome !== "NEW")}
                faulty={[]} many={tickedLines.length} onCancel={() => setEditing(null)} onSave={(values) => correct(tickedLines.map((l) => l.at), values)} />
            </div>
          ) : null}
          {/* What can be done with the ticked lines: the register's dock, while something is ticked. */}
          {tickedLines.length ? (
            <div className="dock palette-light sticky bottom-4 z-30 mx-auto flex w-fit max-w-full flex-wrap items-center gap-2 rounded-sm border border-white/10 bg-brand-strong p-2.5 text-white shadow-[0_8px_30px_rgb(0_0_0/0.18)]">
              <span className="px-2 font-mono text-sm tabular-nums">{tickedLines.length}<span className="ml-1.5 text-[11px] uppercase tracking-[0.12em] text-white/60">ticked</span></span>
              {tickedTypes.size === 1 ? (
                <button type="button" className={DOCK_FIRST} onClick={() => setEditing("many")}><Pencil className="h-4 w-4" aria-hidden="true" /> Change them together</button>
              ) : <span className="px-1 text-[11px] text-white/60">To change them together, tick lines of one deliverable type</span>}
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
                    <span className="min-w-0 flex-1 truncate text-slate-700">{line.number ?? "new"} · {line.values.title ?? ""} <span className="text-slate-500">({line.at})</span></span>
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
            ) : registering + updating ? (
              <>
                <span className="text-slate-700">Nothing is written until you press it; then the whole list is, or nothing.</span>
                <button type="button" disabled={busy} className={btn("primary")} onClick={write}>
                  {busy ? "Working…" : [registering ? `Register ${plural(registering, "document")}` : "", updating ? `${registering ? "update" : "Update"} ${plural(updating, "document")}` : ""].filter(Boolean).join(", ")}
                </button>
              </>
            ) : <span className="text-slate-700">Nothing to bring in: every line on the list already reads as in the register.</span>}
          </div>
        </div>
        </InSlot>
      ) : null}
    </div>
  );
}
