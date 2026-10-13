"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, ExternalLink, Printer, Search } from "lucide-react";
import { DataTable, Th, Td, Info } from "@/components/ui";
import { useCardHeight } from "@/components/card-height";

/**
 * What the transmittal carries.
 *
 * A transmittal is the act of sending named documents to named people, so this
 * table answers the four things somebody asks of it: which document and at what
 * revision, what was actually attached and can be opened, what became of it
 * once it arrived, and whether this document has been round this way before.
 *
 * Drawn in the detail style — the plate and the narrowing in the sheet above,
 * this table at the width of the page, its height a ceiling rather than a
 * height, so three documents draw three rows and stop there.
 */
export type CarriedRow = {
  id: string;
  documentId: string;
  docNumber: string;
  title: string;
  revision: string;
  status: string;
  /** Needed at, and by when, where these documents answer scheduled work. */
  neededFor: { code: string; name: string }[];
  /** What was attached: the rendition people read, and the file it came from. */
  pdfId: string | null;
  nativeId: string | null;
  nativeName: string | null;
  /** A revision issued after this one — what the reader should be holding now. */
  supersededSince: boolean;
  currentRevision: string | null;
  /** How many times this document has gone out before this transmittal. */
  sentBefore: number;
  /** The review this transmittal opened on it, where it opened one. */
  reviewId: string | null;
  reviewOpen: boolean;
};

export function CarriedTable({ plate, rows, exportHref }: {
  plate: React.ReactNode;
  rows: CarriedRow[];
  exportHref: string;
}) {
  const cardHeight = useCardHeight();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const found = needle
      ? rows.filter((row) => `${row.docNumber} ${row.title} ${row.neededFor.map((one) => one.code).join(" ")}`.toLowerCase().includes(needle))
      : rows;
    if (!sort) return found;
    const by = (row: CarriedRow) =>
      sort.key === "document" ? row.docNumber
      : sort.key === "revision" ? row.revision
      : sort.key === "status" ? row.status
      : sort.key === "needed" ? row.neededFor.map((one) => one.code).join(",")
      : sort.key === "before" ? String(row.sentBefore).padStart(4, "0")
      : row.reviewId ? (row.reviewOpen ? "1" : "2") : "3";
    return [...found].sort((a, b) => {
      const cmp = by(a).localeCompare(by(b), "en-GB");
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [rows, q, sort]);

  const sortBy = (key: string) => setSort((was) =>
    was?.key !== key ? { key, dir: "asc" } : was.dir === "asc" ? { key, dir: "desc" } : null);

  const attached = rows.filter((row) => row.pdfId || row.nativeId).length;

  return <>
    <section className="register register-sheet register-sheet-open mb-4">
      {plate}
      {rows.length > 4 ? (
        <div className="asking flex flex-wrap items-center gap-3 px-5 py-3.5 sm:px-6">
          <label className="search-field relative min-w-0 flex-1">
            <span className="sr-only">Search what this carries</span>
            <Search className="absolute top-1/2 left-0 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Document number, title, or the activity it answers" className="plain w-full pl-6" />
          </label>
        </div>
      ) : null}
    </section>

    <section
      data-dt-frame
      className={`register register-sheet ${cardHeight ? "flex flex-col" : ""}`}
      style={cardHeight ? { maxHeight: cardHeight } : undefined}
    >
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2 sm:px-6">
        <span className="stencil mr-1 text-slate-400">What it carries</span>
        <span className="text-[11px] text-slate-400">
          {attached === rows.length ? "every document has its file" : `${attached} of ${rows.length} have a file attached`}
        </span>
        <span className="ml-auto font-mono text-[11px] tabular-nums text-slate-500">
          {shown.length === rows.length ? `${rows.length} document${rows.length === 1 ? "" : "s"}` : `${shown.length} of ${rows.length}`}
        </span>
      </div>

      <div className={cardHeight ? "flex min-h-0 flex-1 flex-col" : undefined}>
        {shown.length ? (
          <DataTable
            id="transmittal-carried"
            className="rounded-none border-0 shadow-none"
            defaultHidden={["Sent before"]}
            fill
            stretch={!!cardHeight}
            tools={<>
              <button type="button" onClick={() => window.print()} className="dt-tool" title="Print this transmittal as a note to file or send on">
                <Printer className="h-3.5 w-3.5" /> Print
              </button>
              <a href={exportHref} className="dt-tool" title="This transmittal, who it went to and what came back, as CSV">
                <Download className="h-3.5 w-3.5" /> Export
              </a>
            </>}
            head={
              <tr>
                <Th className="rail-head min-w-60" label="Document" sorted={sort?.key === "document" ? sort.dir : null}>
                  <SortButton label="Document" on={sort?.key === "document" ? sort.dir : null} onClick={() => sortBy("document")} />
                </Th>
                <Th label="Revision" sorted={sort?.key === "revision" ? sort.dir : null}>
                  <SortButton label="Revision" on={sort?.key === "revision" ? sort.dir : null} onClick={() => sortBy("revision")} />
                </Th>
                <Th label="Status" sorted={sort?.key === "status" ? sort.dir : null}>
                  <SortButton label="Status" on={sort?.key === "status" ? sort.dir : null} onClick={() => sortBy("status")} />
                </Th>
                <Th label="File">
                  <span className="inline-flex items-center gap-1">
                    File
                    <Info>What was actually attached: the copy people read, and the file it was made from.</Info>
                  </span>
                </Th>
                <Th label="Needed for" sorted={sort?.key === "needed" ? sort.dir : null}>
                  <span className="inline-flex items-center gap-1">
                    <SortButton label="Needed for" on={sort?.key === "needed" ? sort.dir : null} onClick={() => sortBy("needed")} />
                    <Info>The scheduled work this document answers. It is why it was sent.</Info>
                  </span>
                </Th>
                <Th label="Sent before" sorted={sort?.key === "before" ? sort.dir : null}>
                  <span className="inline-flex items-center gap-1">
                    <SortButton label="Sent before" on={sort?.key === "before" ? sort.dir : null} onClick={() => sortBy("before")} />
                    <Info>How many times this document went out before this transmittal.</Info>
                  </span>
                </Th>
                <Th label="Review" sorted={sort?.key === "review" ? sort.dir : null}>
                  <SortButton label="Review" on={sort?.key === "review" ? sort.dir : null} onClick={() => sortBy("review")} />
                </Th>
              </tr>
            }
          >
            {shown.map((row) => (
              <tr key={row.id}>
                <Td className={`rail ${row.supersededSince ? "rail-superseded" : row.reviewId ? "rail-review" : "rail-released"}`}>
                  <Link href={`/documents/${row.documentId}`} className="doc-number">{row.docNumber}</Link>
                  <span className="doc-title block max-w-72 truncate" title={row.title}>{row.title}</span>
                </Td>
                <Td className="whitespace-nowrap font-mono text-xs">
                  {row.revision}
                  {row.supersededSince ? (
                    <Link href={`/documents/${row.documentId}`} className="ml-2 font-sans text-[11px] font-semibold text-violet-700 hover:underline">
                      now {row.currentRevision ?? "later"} &rarr;
                    </Link>
                  ) : null}
                </Td>
                <Td className="text-xs">{row.status}</Td>
                <Td className="whitespace-nowrap text-xs">
                  {row.pdfId ? (
                    <a href={`/api/files/${row.pdfId}`} target="_blank" className="inline-flex items-center gap-1 font-semibold text-link hover:underline">
                      <ExternalLink className="h-3 w-3" /> open
                    </a>
                  ) : null}
                  {row.nativeId ? (
                    <a href={`/api/files/${row.nativeId}?dl=1`} className="ml-2 inline-flex items-center gap-1 text-slate-500 hover:text-brand-ink hover:underline" title={row.nativeName ?? "the file it was made from"}>
                      <Download className="h-3 w-3" /> source
                    </a>
                  ) : null}
                  {!row.pdfId && !row.nativeId ? <span className="text-amber-700">nothing attached</span> : null}
                </Td>
                <Td className="text-xs">
                  {row.neededFor.length ? (
                    <span className="flex flex-wrap gap-1">
                      {row.neededFor.slice(0, 3).map((one) => (
                        <Link key={one.code} href={`/actions/${one.code}`} title={one.name} className="whitespace-nowrap rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-slate-600 hover:bg-slate-200 hover:text-brand-ink">
                          {one.code}
                        </Link>
                      ))}
                      {row.neededFor.length > 3 ? <span className="text-[11px] text-slate-400">+{row.neededFor.length - 3}</span> : null}
                    </span>
                  ) : <span className="text-slate-300">&mdash;</span>}
                </Td>
                <Td className="whitespace-nowrap text-xs tabular-nums">
                  {row.sentBefore
                    ? <Link href={`/transmittals?q=${encodeURIComponent(row.docNumber)}`} className="font-semibold text-link hover:underline">{row.sentBefore}&times; before</Link>
                    : <span className="text-slate-400">first time</span>}
                </Td>
                <Td className="text-xs">
                  {row.reviewId
                    ? <Link href={`/reviews/${row.reviewId}`} className="font-semibold text-brand-ink hover:underline">{row.reviewOpen ? "in review" : "reviewed"} &rarr;</Link>
                    : <span className="text-slate-300">&mdash;</span>}
                </Td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <p className="px-5 py-6 text-xs text-slate-400 sm:px-6">
            {rows.length ? "No document here answers to that." : "This transmittal encloses nothing — it is correspondence, and what it says is above."}
          </p>
        )}
      </div>

      {rows.length ? (
        <div data-dt-foot className="flex items-center gap-3 border-t border-line px-5 py-2.5 sm:px-6">
          <p className="font-mono text-[11px] tabular-nums text-slate-500">
            1&ndash;{shown.length}
            <span className="ml-1.5 font-sans text-slate-400">of {rows.length}</span>
          </p>
          <p className="ml-auto text-[11px] text-slate-400">A document sent more than once has been round this way before — the count says how often.</p>
        </div>
      ) : null}
    </section>
  </>;
}

function SortButton({ label, on, onClick }: { label: string; on: "asc" | "desc" | null; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 uppercase tracking-[inherit] transition-colors hover:text-brand-ink"
      title={on ? (on === "asc" ? "Sorted first to last. Click to reverse." : "Sorted last to first. Click to clear.") : `Sort by ${label.toLowerCase()}`}
    >
      {label}
      <span className="sort-mark" data-on={on ? "true" : "false"}>
        {on === "asc" ? <ArrowUp className="h-3 w-3 text-brand-ink" /> : on === "desc" ? <ArrowDown className="h-3 w-3 text-brand-ink" /> : <ArrowUpDown className="h-3 w-3" />}
      </span>
    </button>
  );
}
