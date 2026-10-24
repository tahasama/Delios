"use client";

import { useState } from "react";
import { Download, Minus, Plus } from "lucide-react";
import { WorkbookView } from "@/components/workbook-view";
import { ScheduleFileView } from "@/components/schedule-file-view";
import { TextView } from "@/components/text-view";
import { OfficeView } from "@/components/office-view";
import { DrawingView } from "@/components/drawing-view";
import { ModelView } from "@/components/model-view";

type PreviewFile = { id: string; name: string; mime?: string };

/** What the browser shows by itself: the pictures it reads (SVG, which can carry code, stays a download). */
const IMAGE = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;
const WORKBOOK = /\.(xlsx|xlsm|xls|csv)$/i;
const SCHEDULE = /\.xer$/i;
const TEXT = /\.(txt|log|json|xml|md|ini|cfg|conf|ya?ml|tsv)$/i;
const OFFICE = /\.(docx?|docm|odt|rtf|pptx?|pptm|ppsx?|odp|vsdx?|odg)$/i;
const DRAWING = /\.(dwg|dxf)$/i;
const MODEL = /\.(ifc|glb|gltf|obj|stl)$/i;

type SourceKind = "image" | "workbook" | "schedule" | "text" | "office" | "drawing" | "model";

/**
 * How a source file is shown in the page, if it can be: a picture, a workbook (an old .xls and a CSV too), a P6
 * schedule, text, an office file (as the PDF made of it), a drawing (DXF, a DWG converted), a 3D model (IFC, glTF,
 * OBJ, STL), or not at all.
 */
export function sourceView(file: PreviewFile | null | undefined): SourceKind | null {
  if (!file) return null;
  if (IMAGE.test(file.name) || /^image\/(png|jpeg|gif|webp|avif|bmp)$/i.test(file.mime ?? "")) return "image";
  if (WORKBOOK.test(file.name)) return "workbook";
  if (SCHEDULE.test(file.name)) return "schedule";
  if (TEXT.test(file.name)) return "text";
  if (OFFICE.test(file.name)) return "office";
  if (DRAWING.test(file.name)) return "drawing";
  if (MODEL.test(file.name)) return "model";
  return null;
}

/** The reader that draws a source file (Settings → Viewing files), by what it is. */
function readerOf(file: PreviewFile | null | undefined): string | null {
  const kind = sourceView(file);
  if (!kind) return null;
  if (kind === "drawing") return /\.dxf$/i.test(file!.name) ? "DXF" : "DWG";
  return ({ image: "PICTURES", workbook: "WORKBOOKS", schedule: "SCHEDULES", text: "TEXT", office: "OFFICE", model: "MODELS" } as const)[kind];
}

/** What the source file is, in words, on the choice above the preview. */
function kindWords(file: PreviewFile): string {
  const kind = sourceView(file);
  if (kind === "workbook") return /\.csv$/i.test(file.name) ? "table" : "workbook";
  if (kind === "schedule") return "P6 schedule";
  if (kind === "image") return "picture";
  if (kind === "text") return "text";
  if (kind === "office") return /\.(pptx?|pptm|ppsx?|odp)$/i.test(file.name) ? "slides" : /\.(vsdx?|odg)$/i.test(file.name) ? "diagram" : "document";
  if (kind === "drawing") return "drawing";
  if (kind === "model") return /\.ifc$/i.test(file.name) ? "BIM model" : "3D model";
  const ext = file.name.match(/\.([a-z0-9]+)$/i)?.[1];
  return ext ? `.${ext.toLowerCase()}` : "file";
}

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

/**
 * The Preview (owner: images, Excel workbooks, CSV and P6 exports too): the revision's PDF as it stands (stamped,
 * returned…), and its source file. With both, a choice above them, the PDF first (owner: "i have no way to visualize one
 * or the other"); a source the page cannot draw is offered to download. A zoom for whatever is shown (owner: "some
 * control like a zoom"): − percentage + (the percentage puts it back to 100%).
 */
export function FilePreview({ pdf, source, title, empty, height = "h-[70vh] min-h-120", admin = false, readers, viewingNote = true }: {
  pdf: PreviewFile | null; source: PreviewFile | null; title: string; empty: React.ReactNode; height?: string;
  /** An administrator: a drawing the free reader cannot open points them to Settings → Viewing files. */
  admin?: boolean;
  /** The readers on for the project (Settings → Viewing files); a source whose reader is off is offered to download. */
  readers?: string[];
  /** "For viewing only" above a drawing, until closed. */
  viewingNote?: boolean;
}) {
  const reader = readerOf(source);
  const switchedOff = !!reader && !!readers && !readers.includes(reader);
  const kind = switchedOff ? null : sourceView(source);
  const [showing, setShowing] = useState<"pdf" | "source">(pdf ? "pdf" : "source");
  const [zoom, setZoom] = useState(1);
  if (!pdf && !source) return <>{empty}</>;
  // The choice made is kept while the files change under it (a new one uploaded, another still being checked): the
  // source shown only while there is one, else the PDF.
  const onSource = !!source && (!pdf || showing === "source");
  const shown = onSource ? source : pdf!;
  const at = ZOOMS.indexOf(zoom);
  const zoomable = !onSource || !!kind;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-tint-soft px-3 py-1.5">
        {pdf && source ? (
          <div className="seg w-fit" role="group" aria-label="What is shown">
            <button type="button" className="segment" aria-pressed={!onSource} onClick={() => setShowing("pdf")}>The PDF</button>
            <button type="button" className="segment" aria-pressed={onSource} onClick={() => setShowing("source")}>
              The source file · {kindWords(source)}
            </button>
          </div>
        ) : null}
        <span className="min-w-0 truncate text-[11px] text-slate-500" title={shown.name}>{shown.name}</span>
        <span className="ml-auto flex items-center gap-1">
          {zoomable ? (
            <span className="flex items-center rounded-md ring-1 ring-line" role="group" aria-label="Zoom">
              <button type="button" onClick={() => setZoom(ZOOMS[Math.max(0, at - 1)])} disabled={at <= 0}
                title="Zoom out" aria-label="Zoom out" className="grid h-6 w-6 place-items-center text-slate-600 hover:text-brand-ink disabled:opacity-40">
                <Minus className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => setZoom(1)} title="Back to 100%"
                className="min-w-11 border-x border-line px-1 text-[11px] font-semibold text-slate-700 tabular-nums hover:text-brand-ink">
                {Math.round(zoom * 100)}%
              </button>
              <button type="button" onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, at + 1)])} disabled={at >= ZOOMS.length - 1}
                title="Zoom in" aria-label="Zoom in" className="grid h-6 w-6 place-items-center text-slate-600 hover:text-brand-ink disabled:opacity-40">
                <Plus className="h-3.5 w-3.5" />
              </button>
            </span>
          ) : null}
          <a href={`/api/files/${shown.id}?dl=1`} title={`Download ${shown.name}`} aria-label={`Download ${shown.name}`}
            className="grid h-6 w-6 place-items-center text-slate-600 hover:text-brand-ink">
            <Download className="h-3.5 w-3.5" />
          </a>
        </span>
      </div>
      {!onSource ? (
        // The browser's own PDF viewer, opened at the zoom chosen.
        <iframe key={zoom} src={`/api/files/${pdf!.id}#zoom=${Math.round(zoom * 100)}`} title={title} className={`block w-full bg-slate-100 ${height}`} />
      ) : kind === "image" ? (
        <div className={`grid w-full place-items-center overflow-auto bg-slate-100 p-4 ${height}`}>
          {/* A picture uploaded as the source, served by the app's own file route (no outside address). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/files/${source!.id}`} alt={`${title} — ${source!.name}`} style={zoom === 1 ? undefined : { width: `${zoom * 100}%`, maxWidth: "none", maxHeight: "none" }}
            className="max-h-full max-w-full object-contain shadow-sm" />
        </div>
      ) : kind === "schedule" ? (
        <ScheduleFileView fileId={source!.id} name={source!.name} zoom={zoom} />
      ) : kind === "workbook" ? (
        <WorkbookView fileId={source!.id} name={source!.name} zoom={zoom} />
      ) : kind === "text" ? (
        <TextView fileId={source!.id} name={source!.name} zoom={zoom} />
      ) : kind === "office" ? (
        <OfficeView fileId={source!.id} name={source!.name} zoom={zoom} height={height} />
      ) : kind === "drawing" ? (
        <DrawingView fileId={source!.id} name={source!.name} zoom={zoom} height={height} admin={admin} note={viewingNote} />
      ) : kind === "model" ? (
        <ModelView fileId={source!.id} name={source!.name} zoom={zoom} height={height} />
      ) : (
        <div className={`grid w-full place-items-center bg-slate-100 p-6 text-center ${height}`}>
          <div>
            <p className="text-sm font-semibold text-slate-700">{source!.name} cannot be shown here</p>
            <p className="mt-1 text-xs text-slate-500">
              {switchedOff ? "Its reader is not on for this project (Settings → Viewing files)."
                : "The page shows PDFs, pictures, Excel and CSV, P6 exports, text, Word and PowerPoint, drawings (DWG, DXF) and 3D models (IFC, glTF, OBJ, STL)."}
            </p>
            <a href={`/api/files/${source!.id}?dl=1`} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-link hover:underline">
              <Download className="h-3.5 w-3.5" /> Download it to open it
            </a>
          </div>
        </div>
      )}
    </>
  );
}
