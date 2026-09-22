"use client";

import { useActionState } from "react";
import { btn, inputCls } from "@/components/ui";
import { previewSetUploadAction, applySetUploadAction, type SetUploadState } from "@/lib/actions/sets";

const TONE = { ADDED: "text-emerald-700", CHANGED: "text-amber-700", REMOVED: "text-red-700", UNCHANGED: "text-slate-400" } as const;

/** Replace a set from a spreadsheet: preview what it changes, then apply. */
export function SetUpload({ setKey, templateHref }: { setKey: string; templateHref: string }) {
  const [preview, previewAction, previewing] = useActionState<SetUploadState | undefined, FormData>(previewSetUploadAction, undefined);
  const [applied, applyAction, applying] = useActionState<SetUploadState | undefined, FormData>(applySetUploadAction, undefined);
  const shown = applied?.ok ? null : preview?.preview && preview.preview.setKey === setKey ? preview.preview : null;

  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-relaxed text-slate-500">
        Download the set as it is now, edit it in a spreadsheet, and upload it back. You see what it would add, change and retire before anything changes.
        Values left out are retired, never deleted — old documents keep them.
      </p>
      <form action={previewAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="setKey" value={setKey} />
        <input type="file" name="file" accept=".csv,text/csv" required className={`${inputCls} max-w-xs py-1.5 text-xs`} />
        <button type="submit" disabled={previewing} className={btn("secondary", "sm")}>{previewing ? "Reading…" : "Preview changes"}</button>
        <a href={templateHref} className="text-xs font-semibold text-link hover:underline">Download as it is now ↓</a>
      </form>
      {preview?.error ? (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
          <p className="font-semibold">{preview.error}</p>
          {preview.issues?.length ? <ul className="mt-1 space-y-0.5">{preview.issues.slice(0, 12).map((i) => <li key={`${i.line}-${i.message}`}>Line {i.line}: {i.message}</li>)}</ul> : null}
        </div>
      ) : null}
      {shown ? (
        <div className="rounded-lg border border-slate-200 bg-surface p-3">
          <p className="text-xs font-semibold text-slate-800">{shown.fileName}: {shown.summary}</p>
          {shown.diff.length ? (
            <ul className="scroll-thin mt-2 max-h-56 space-y-0.5 overflow-y-auto text-xs">
              {shown.diff.map((l, i) => (
                <li key={i}><span className={`font-semibold ${TONE[l.change]}`}>{l.change === "ADDED" ? "add" : l.change === "CHANGED" ? "change" : l.change.toLowerCase()}</span> <span className="font-mono">{l.subject}</span>{l.detail ? <span className="text-slate-500"> — {l.detail}</span> : null}</li>
              ))}
            </ul>
          ) : <p className="mt-1 text-xs text-slate-500">The file matches the set — nothing to change.</p>}
          {shown.diff.length ? (
            <form action={applyAction} className="mt-3">
              <input type="hidden" name="setKey" value={shown.setKey} />
              <input type="hidden" name="fileName" value={shown.fileName} />
              <input type="hidden" name="payload" value={shown.payload} />
              <button type="submit" disabled={applying} className={btn("primary", "sm")}>{applying ? "Applying…" : "Apply these changes"}</button>
            </form>
          ) : null}
        </div>
      ) : null}
      {applied?.ok ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{applied.ok}</p> : null}
      {applied?.error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{applied.error}</p> : null}
    </div>
  );
}
