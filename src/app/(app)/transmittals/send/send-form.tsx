"use client";

import { useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { FileUpload } from "@/components/file-upload";
import { btn, Field, FormSection, inputCls } from "@/components/ui";
import { sendIncomingAction } from "@/lib/actions/transmittal-acts";

type Pick = { code: string; label: string };
type Row = { id: string; number: string; title: string; plannedDate: string | null; note: string };
type Uploaded = { ids: string[]; names: string[] };
type Other = { key: string; title: string; docType: string; reference: string; files: Uploaded | null };

/**
 * The send form: tick a document, upload its files and say what it is sent
 * for; add anything unplanned with its own files; then send it all on one
 * transmittal. Files go straight to storage as they are chosen; nothing is
 * sent to us until "Send".
 */
export function SendForm({ rows, chosen, onBehalf, fromPartyId, reasons, statuses, docTypes }: {
  rows: Row[]; chosen: string[]; onBehalf: boolean; fromPartyId?: string; reasons: Pick[]; statuses: Pick[]; docTypes: Pick[];
}) {
  const [formKey] = useState(() => crypto.randomUUID());
  const [picked, setPicked] = useState<Set<string>>(new Set(chosen));
  const [files, setFiles] = useState<Record<string, Uploaded>>({});
  const [status, setStatus] = useState<Record<string, string>>({});
  const [others, setOthers] = useState<Other[]>([]);
  const [proof, setProof] = useState<Uploaded | null>(null);
  const [reason, setReason] = useState(reasons[0]?.code ?? "");
  const [theirReference, setTheirReference] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "");

  const toggle = (id: string) => setPicked((now) => { const next = new Set(now); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const change = (key: string, patch: Partial<Other>) => setOthers((all) => all.map((o) => (o.key === key ? { ...o, ...patch } : o)));

  function send() {
    setError(null);
    const planned = [...picked].map((id) => ({ documentId: id, fileIds: files[id]?.ids ?? [], status: status[id] ?? "" }));
    const missing = planned.find((p) => !p.fileIds.length || !p.status);
    if (missing) {
      const row = rows.find((r) => r.id === missing.documentId);
      setError(`${row?.number}: upload its files and say what it is sent for.`);
      return;
    }
    const unplanned = others.map((o) => ({ title: o.title.trim(), docType: o.docType, reference: o.reference.trim(), fileIds: o.files?.ids ?? [] }));
    if (unplanned.some((u) => !u.title || !u.fileIds.length)) { setError("Each unplanned item needs a title and its files."); return; }
    if (!planned.length && !unplanned.length) { setError("Choose what to send."); return; }
    start(async () => {
      const result = await sendIncomingAction({
        reason, subject, message, theirReference, fromPartyId, proofFileId: proof?.ids[0], planned, unplanned, formKey,
      });
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="max-w-4xl space-y-4">
      <FormSection title="Placeholders" help="Each document ticked goes with its files, at the status it is sent for.">
        {rows.length === 0 ? <p className="text-sm text-slate-500">Nothing to send: no placeholder waits, and nothing was returned.</p> : (
          <ul className="divide-y divide-line rounded border border-line">
            {rows.map((r) => (
              <li key={r.id} className="space-y-2 px-3 py-2">
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} className="mt-1" />
                  <span><span className="font-semibold">{r.number}</span> · {r.title}
                    <span className="block text-xs text-slate-500">{r.note}{r.plannedDate ? ` · due ${day(r.plannedDate)}` : ""}</span></span>
                </label>
                {picked.has(r.id) ? (
                  <div className="grid gap-3 pl-6 sm:grid-cols-2">
                    <div>
                      {files[r.id] ? <p className="text-xs text-emerald-700">Uploaded: {files[r.id].names.join(", ")} <button type="button" className="ml-1 text-slate-500 underline" onClick={() => setFiles(({ [r.id]: _, ...rest }) => rest)}>change</button></p>
                        : <FileUpload target={{ documentId: r.id }} label="Upload its files" onUploaded={async (ids, names) => { setFiles((all) => ({ ...all, [r.id]: { ids, names } })); return null; }} />}
                    </div>
                    <Field label="Sent for" required>
                      <select value={status[r.id] ?? ""} onChange={(e) => setStatus((all) => ({ ...all, [r.id]: e.target.value }))} className={inputCls} aria-label={`Status for ${r.number}`}>
                        <option value="" disabled>Choose…</option>
                        {statuses.map((s) => <option key={s.code} value={s.code}>{s.code} · {s.label}</option>)}
                      </select>
                    </Field>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </FormSection>

      <FormSection title="Anything else" help="Not planned: an RFI, an NCR, minutes… It stays on the transmittal until Document Control registers it.">
        <div className="space-y-3">
          {others.map((o, i) => (
            <div key={o.key} className="space-y-2 rounded border border-line px-3 py-2">
              <div className="flex items-center justify-between"><span className="stencil text-slate-500">Item {i + 1}</span>
                <button type="button" onClick={() => setOthers((all) => all.filter((x) => x.key !== o.key))} className="text-slate-400 hover:text-slate-700" aria-label="Remove"><X className="h-4 w-4" /></button></div>
              <div className="grid gap-2 sm:grid-cols-3">
                <input value={o.title} onChange={(e) => change(o.key, { title: e.target.value })} placeholder="What it is" className={`${inputCls} sm:col-span-3`} aria-label="Title" />
                <select value={o.docType} onChange={(e) => change(o.key, { docType: e.target.value })} className={inputCls} aria-label="Type">
                  <option value="">Type…</option>
                  {docTypes.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
                </select>
                <input value={o.reference} onChange={(e) => change(o.key, { reference: e.target.value })} placeholder="Your reference" className={`${inputCls} sm:col-span-2`} aria-label="Reference" />
              </div>
              {o.files ? <p className="text-xs text-emerald-700">Uploaded: {o.files.names.join(", ")}</p>
                : <FileUpload target={{ loose: true }} label="Upload its files" onUploaded={async (ids, names) => { change(o.key, { files: { ids, names } }); return null; }} />}
            </div>
          ))}
          <button type="button" onClick={() => setOthers((all) => [...all, { key: crypto.randomUUID(), title: "", docType: "", reference: "", files: null }])} className={btn("secondary", "sm")}><Plus className="h-4 w-4" /> Add an item</button>
        </div>
      </FormSection>

      <FormSection title="The transmittal">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Why" required>
            <select value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls}>
              {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
          </Field>
          <Field label={onBehalf ? "Their reference" : "Your reference"} hint="optional"><input value={theirReference} onChange={(e) => setTheirReference(e.target.value)} className={inputCls} /></Field>
        </div>
        <Field label="Subject" hint="Empty: the document, or the number of items."><input value={subject} onChange={(e) => setSubject(e.target.value)} className={inputCls} /></Field>
        <Field label="Message"><textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} className={inputCls} /></Field>
        {onBehalf ? (
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-600">Their covering letter or e-mail</p>
            {proof ? <p className="text-xs text-emerald-700">Uploaded: {proof.names.join(", ")}</p>
              : <FileUpload target={{ loose: true, proof: true }} multiple={false} label="Upload it" onUploaded={async (ids, names) => { setProof({ ids, names }); return null; }} />}
          </div>
        ) : null}
      </FormSection>

      {error ? <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      <button type="button" onClick={send} disabled={pending} className={btn("primary")}>{pending ? "Sending…" : "Send"}</button>
    </div>
  );
}
