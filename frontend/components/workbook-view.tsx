"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/core/utils";

type Cell = { v: string; b: boolean; n: boolean } | null;
type Sheet = {
  name: string; hidden: boolean; rows: number; columns: number; cut: boolean; widths: number[]; cells: Cell[][];
  merges: { row: number; column: number; rows: number; columns: number }[];
};
type Book = { sheets: Sheet[]; sheetCount: number };

/** A column's letters, as Excel names it: A … Z, AA … */
const letters = (n: number) => {
  let s = "";
  for (let i = n; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
};

/**
 * An Excel workbook shown in the page (owner: "excel workbook view"): one tab per sheet, the cells as Excel shows them
 * (their last calculated values), bold kept, merged cells merged, numbers set right, with the column letters and row
 * numbers around them. Read by the backend; nothing in the file runs.
 */
export function WorkbookView({ fileId, name, zoom = 1 }: { fileId: string; name: string; zoom?: number }) {
  const [book, setBook] = useState<Book | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState(0);
  useEffect(() => {
    let gone = false;
    fetch(`/api/files/${fileId}/workbook`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (gone) return;
        if (!r.ok) setError(body.error ?? "The workbook could not be shown.");
        else {
          setBook(body as Book);
          setAt(Math.max(0, (body as Book).sheets.findIndex((s) => !s.hidden)));
        }
      })
      .catch(() => { if (!gone) setError("The workbook could not be shown."); });
    return () => { gone = true; };
  }, [fileId]);

  const sheet = book?.sheets[at] ?? null;
  // Where each merge starts, and which cells it covers.
  const { starts, covered } = useMemo(() => {
    const starts = new Map<string, { rows: number; columns: number }>();
    const covered = new Set<string>();
    for (const m of sheet?.merges ?? []) {
      starts.set(`${m.row}:${m.column}`, { rows: m.rows, columns: m.columns });
      for (let r = m.row; r < m.row + m.rows; r++)
        for (let c = m.column; c < m.column + m.columns; c++) if (r !== m.row || c !== m.column) covered.add(`${r}:${c}`);
    }
    return { starts, covered };
  }, [sheet]);

  if (error) return <p className="p-6 text-center text-xs text-slate-500">{error}</p>;
  if (!book) return <p className="p-6 text-center text-xs text-slate-500">Opening {name}…</p>;

  return (
    <div className="flex h-[70vh] min-h-120 flex-col bg-surface">
      <div className="min-h-0 flex-1 overflow-auto">
        {sheet && sheet.rows > 0 ? (
          <table style={zoom === 1 ? undefined : { zoom }} className="border-separate border-spacing-0 text-[12px] text-slate-800">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="sticky left-0 z-20 h-6 w-10 min-w-10 border-r border-b border-line bg-tint" />
                {sheet.widths.map((w, i) => (
                  <th key={i} style={{ width: Math.max(32, Math.round(w * 7 + 5)), minWidth: Math.max(32, Math.round(w * 7 + 5)) }}
                    className="h-6 border-r border-b border-line bg-tint text-center text-[11px] font-medium text-slate-500">{letters(i + 1)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.cells.map((line, r) => (
                <tr key={r}>
                  <th className="sticky left-0 h-6 border-r border-b border-line bg-tint px-1 text-right text-[11px] font-medium text-slate-500 tabular-nums">{r + 1}</th>
                  {line.map((cell, c) => {
                    const spot = `${r + 1}:${c + 1}`;
                    if (covered.has(spot)) return null;
                    const span = starts.get(spot);
                    return (
                      <td key={c} rowSpan={span?.rows} colSpan={span?.columns} title={cell && cell.v.length > 40 ? cell.v : undefined}
                        className={cn("h-6 max-w-[40rem] truncate border-r border-b border-line/70 px-1.5", cell?.b && "font-semibold", cell?.n && !span ? "text-right tabular-nums" : null)}>
                        {cell?.v ?? ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="p-6 text-center text-xs text-slate-500">{sheet ? `${sheet.name} is empty.` : "The workbook has no sheet."}</p>}
      </div>
      {sheet?.cut ? (
        <p className="border-t border-line bg-amber-50 px-3 py-1.5 text-[11px] text-amber-900">
          {sheet.name} goes on to row {sheet.rows.toLocaleString("en-GB")} and column {letters(sheet.columns)}: the first 2,000 rows and 100 columns are shown. Download the file for the rest.
        </p>
      ) : null}
      <nav role="tablist" aria-label="Sheets" className="scroll-thin flex shrink-0 gap-0.5 overflow-x-auto border-t border-line bg-tint-soft px-2">
        {book.sheets.map((s, i) => (
          <button key={i} type="button" role="tab" aria-selected={i === at} onClick={() => setAt(i)}
            className={cn("-mt-px whitespace-nowrap border-t-2 px-3 py-1.5 text-[11px] font-semibold transition",
              i === at ? "border-brand-line bg-surface text-brand-ink" : "border-transparent text-slate-500 hover:text-slate-800")}>
            {s.name}{s.hidden ? <span className="ml-1 font-normal text-slate-400">(hidden)</span> : null}
          </button>
        ))}
        {book.sheetCount > book.sheets.length ? (
          <span className="self-center px-2 text-[11px] text-slate-500">and {book.sheetCount - book.sheets.length} more sheets: download the file</span>
        ) : null}
      </nav>
    </div>
  );
}
