"use client";

import { useState } from "react";
import { WorkbookView } from "@/components/workbook-view";

type PreviewFile = { id: string; name: string; mime?: string };

/** What the browser shows by itself: the pictures it reads (SVG, which can carry code, stays a download). */
const IMAGE = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;
const WORKBOOK = /\.(xlsx|xlsm)$/i;

/** How a source file is shown in the page, if it can be: a picture, a workbook, or not at all (download it). */
export function sourceView(file: PreviewFile | null | undefined): "image" | "workbook" | null {
  if (!file) return null;
  if (IMAGE.test(file.name) || /^image\/(png|jpeg|gif|webp|avif|bmp)$/i.test(file.mime ?? "")) return "image";
  if (WORKBOOK.test(file.name)) return "workbook";
  return null;
}

/**
 * The Preview (owner: images and Excel workbooks too): the revision's PDF as it stands (stamped, returned…), and its
 * source file where the page can show it, a picture or a workbook. With both, a choice above them, the PDF first.
 */
export function FilePreview({ pdf, source, title, empty, height = "h-[70vh] min-h-120" }: {
  pdf: PreviewFile | null; source: PreviewFile | null; title: string; empty: React.ReactNode; height?: string;
}) {
  const kind = sourceView(source);
  const [showing, setShowing] = useState<"pdf" | "source">(pdf ? "pdf" : "source");
  if (!pdf && !kind) return <>{empty}</>;
  const both = !!pdf && !!kind;
  return (
    <>
      {both ? (
        <div className="flex items-center gap-2 border-b border-line bg-tint-soft px-3 py-1.5">
          <div className="seg w-fit" role="group" aria-label="What is shown">
            <button type="button" className="segment" aria-pressed={showing === "pdf"} onClick={() => setShowing("pdf")}>The PDF</button>
            <button type="button" className="segment" aria-pressed={showing === "source"} onClick={() => setShowing("source")}>
              The source file · {kind === "workbook" ? "workbook" : "picture"}
            </button>
          </div>
          <span className="truncate text-[11px] text-slate-500">{showing === "source" ? source!.name : pdf!.name}</span>
        </div>
      ) : null}
      {pdf && (showing === "pdf" || !kind) ? (
        <iframe src={`/api/files/${pdf.id}`} title={title} className={`block w-full bg-slate-100 ${height}`} />
      ) : kind === "image" ? (
        <div className={`grid w-full place-items-center overflow-auto bg-slate-100 p-4 ${height}`}>
          {/* A picture uploaded as the source, served by the app's own file route (no outside address). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/files/${source!.id}`} alt={`${title} — ${source!.name}`} className="max-h-full max-w-full object-contain shadow-sm" />
        </div>
      ) : (
        <WorkbookView fileId={source!.id} name={source!.name} />
      )}
    </>
  );
}
