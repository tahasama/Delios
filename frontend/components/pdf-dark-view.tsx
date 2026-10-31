"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, MoveHorizontal, PanelLeft, Printer, RectangleVertical, RotateCw } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";

/** The page darkened, hues kept (a stamp stays green or red). */
const DARK = "invert(0.9) hue-rotate(180deg)";

/**
 * "Dark page" (owner: the browser's reader, darkened whole, turned its own bar and side panel light; then "where is the
 * bar?"): the PDF drawn by the page itself (pdf.js, nothing in the file runs), each page on the app's own surface, only
 * the pages darkened. Its own bar carries what the browser's reader gave: the pages' panel, page n of N, fit to the
 * width or the whole page, turn, and print (the PDF as it is). Zoom and download stay in the Preview's bar. Pages are
 * drawn as they come into view. The file itself never changes.
 */
export function PdfDarkView({ fileId, name, zoom = 1, height, src }: {
  fileId: string; name: string; zoom?: number; height: string;
  /** Where the PDF is read from, when not the file itself (an office file's PDF, `/api/files/<id>/as-pdf`). */
  src?: string;
}) {
  const url = src ?? `/api/files/${fileId}`;
  const box = useRef<HTMLDivElement>(null);
  const pages = useRef<(HTMLDivElement | null)[]>([]);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([]);
  const [state, setState] = useState<"loading" | "ready" | string>("loading");
  const [room, setRoom] = useState({ w: 0, h: 0 });
  const [panel, setPanel] = useState(false);
  const [fit, setFit] = useState<"width" | "page">("width");
  const [turn, setTurn] = useState(0);
  const [at, setAt] = useState(1);
  const [typed, setTyped] = useState("1");

  useEffect(() => {
    let gone = false;
    let opened: PDFDocumentProxy | null = null;
    (async () => {
      const answer = await fetch(url).catch(() => null);
      if (!answer?.ok) { if (!gone) setState("The PDF could not be fetched: download it to open it."); return; }
      const data = new Uint8Array(await answer.arrayBuffer());
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.mjs";
      try {
        opened = await pdfjs.getDocument({ data, isEvalSupported: false, enableXfa: false }).promise;
        const all = [];
        for (let i = 1; i <= opened.numPages; i++) {
          const view = (await opened.getPage(i)).getViewport({ scale: 1 });
          all.push({ w: view.width, h: view.height });
        }
        if (gone) return;
        setSizes(all);
        setPanel(all.length > 1);
        setDoc(opened);
        setState("ready");
      } catch {
        if (!gone) setState("The PDF could not be drawn here: switch Dark page off, or download it.");
      }
    })();
    return () => { gone = true; opened?.destroy(); };
  }, [url]);

  // The room the pages have, followed as the window or the panel changes.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const watch = new ResizeObserver(() => setRoom({ w: el.clientWidth, h: el.clientHeight }));
    watch.observe(el);
    return () => watch.disconnect();
  }, [state]);

  const sideways = turn % 180 !== 0;
  const shown = sizes.map((s) => (sideways ? { w: s.h, h: s.w } : s));
  const widest = Math.max(1, ...shown.map((s) => s.w));
  const tallest = Math.max(1, ...shown.map((s) => s.h));
  const base = fit === "width" ? (room.w - 32) / widest : Math.min((room.w - 32) / widest, (room.h - 32) / tallest);
  const scale = Math.min(4, Math.max(0.1, base)) * zoom;

  // The page in view: the one whose middle is nearest the top third of the box.
  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    const mark = el.getBoundingClientRect().top + el.clientHeight / 3;
    let best = 1, bestGap = Infinity;
    pages.current.forEach((p, i) => {
      if (!p) return;
      const r = p.getBoundingClientRect();
      const gap = r.top <= mark && r.bottom >= mark ? 0 : Math.min(Math.abs(r.top - mark), Math.abs(r.bottom - mark));
      if (gap < bestGap) { bestGap = gap; best = i + 1; }
    });
    if (best !== at) { setAt(best); setTyped(String(best)); }
  };
  const go = (n: number) => {
    const page = Math.min(Math.max(1, n), sizes.length);
    pages.current[page - 1]?.scrollIntoView({ block: "start" });
    setAt(page);
    setTyped(String(page));
  };
  // Print: the PDF as it is, through the browser's own printing (never the darkened pages).
  const print = () => {
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0";
    frame.src = url;
    frame.onload = () => { try { frame.contentWindow?.print(); } catch { window.open(url, "_blank", "noopener"); } setTimeout(() => frame.remove(), 60_000); };
    document.body.appendChild(frame);
  };

  const tool = "grid h-6 w-6 place-items-center rounded text-slate-500 hover:bg-slate-100 hover:text-brand-ink disabled:opacity-40 aria-pressed:bg-slate-200 aria-pressed:text-brand-ink";
  return (
    <div className={`flex w-full flex-col bg-surface ${height}`}>
      {state === "ready" ? (
        <div className="flex shrink-0 items-center gap-1 border-b border-line bg-tint-soft px-3 py-1 text-[11px] text-slate-600">
          <button type="button" className={tool} aria-pressed={panel} title="Pages" aria-label="Show the pages beside" onClick={() => setPanel((was) => !was)}>
            <PanelLeft className="h-3.5 w-3.5" />
          </button>
          <span className="mx-1 h-4 w-px bg-line" aria-hidden />
          <button type="button" className={tool} title="Previous page" aria-label="Previous page" disabled={at <= 1} onClick={() => go(at - 1)}><ChevronUp className="h-3.5 w-3.5" /></button>
          <button type="button" className={tool} title="Next page" aria-label="Next page" disabled={at >= sizes.length} onClick={() => go(at + 1)}><ChevronDown className="h-3.5 w-3.5" /></button>
          <input value={typed} inputMode="numeric" aria-label="Page" onChange={(e) => setTyped(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => { if (e.key === "Enter") go(Number(typed) || 1); }} onBlur={() => go(Number(typed) || at)}
            className="h-6 w-9 rounded border border-line bg-surface text-center tabular-nums text-slate-800" />
          <span className="tabular-nums">/ {sizes.length}</span>
          <span className="mx-1 h-4 w-px bg-line" aria-hidden />
          <button type="button" className={tool} aria-pressed={fit === "width"} title="Fit to the width" aria-label="Fit to the width" onClick={() => setFit("width")}><MoveHorizontal className="h-3.5 w-3.5" /></button>
          <button type="button" className={tool} aria-pressed={fit === "page"} title="Fit the whole page" aria-label="Fit the whole page" onClick={() => setFit("page")}><RectangleVertical className="h-3.5 w-3.5" /></button>
          <button type="button" className={tool} title="Turn the pages" aria-label="Turn the pages" onClick={() => setTurn((t) => (t + 90) % 360)}><RotateCw className="h-3.5 w-3.5" /></button>
          <button type="button" className={`${tool} ml-auto`} title="Print the PDF as it is" aria-label="Print the PDF as it is" onClick={print}><Printer className="h-3.5 w-3.5" /></button>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        {state === "ready" && panel ? (
          <aside className="scroll-thin w-40 shrink-0 space-y-3 overflow-y-auto border-r border-line bg-tint-soft p-3" aria-label="Pages">
            {sizes.map((size, i) => (
              <button key={i} type="button" onClick={() => go(i + 1)} aria-label={`Page ${i + 1}`}
                className={`block w-full rounded p-1 text-center text-[11px] ${at === i + 1 ? "bg-tint ring-2 ring-brand-line" : "hover:bg-slate-100"}`}>
                <PageCanvas doc={doc!} number={i + 1} turn={turn} scale={112 / (sideways ? size.h : size.w)} />
                <span className="mt-1 block text-slate-500">{i + 1}</span>
              </button>
            ))}
          </aside>
        ) : null}
        <div ref={box} onScroll={onScroll} className="min-w-0 flex-1 overflow-auto">
          {state !== "ready" ? (
            <p className="grid h-full place-items-center p-6 text-center text-xs text-slate-500">{state === "loading" ? `Opening ${name}…` : state}</p>
          ) : (
            <div className="flex min-w-fit flex-col items-center gap-4 p-4">
              {shown.map((_, i) => (
                <div key={i} ref={(el) => { pages.current[i] = el; }} className="scroll-mt-2">
                  <PageCanvas doc={doc!} number={i + 1} turn={turn} scale={scale} shadow />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** One page, darkened, drawn once it comes near the view and again when its size or turn changes. */
function PageCanvas({ doc, number, scale, turn, shadow }: { doc: PDFDocumentProxy; number: number; scale: number; turn: number; shadow?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const watch = new IntersectionObserver(([one]) => { if (one.isIntersecting) setNear(true); }, { rootMargin: "800px" });
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  useEffect(() => {
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    let gone = false;
    (async () => {
      const page = await doc.getPage(number);
      if (gone) return;
      const plain = page.getViewport({ scale, rotation: (page.rotate + turn) % 360 });
      setSize({ w: plain.width, h: plain.height });
      if (!near || !canvas.current) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const view = page.getViewport({ scale: scale * ratio, rotation: (page.rotate + turn) % 360 });
      const el = canvas.current;
      el.width = Math.floor(view.width);
      el.height = Math.floor(view.height);
      task = page.render({ canvasContext: el.getContext("2d")!, viewport: view });
      await task.promise.catch(() => {});
    })();
    return () => { gone = true; task?.cancel(); };
  }, [doc, number, scale, turn, near]);
  return (
    <canvas ref={canvas} aria-label={`Page ${number}`} className={`mx-auto block ${shadow ? "shadow-md" : "shadow-sm"}`}
      style={{ width: size ? `${size.w}px` : undefined, height: size ? `${size.h}px` : "8rem", filter: DARK }} />
  );
}
