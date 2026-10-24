"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

/**
 * "Dark page" (owner: the browser's reader, darkened whole, turned its own bar and side panel light): the PDF drawn by
 * the page itself (pdf.js, nothing in the file runs), each page on the app's own surface, only the pages darkened,
 * their hues kept (a stamp stays green or red). Pages are drawn as they come into view. The file itself never changes;
 * the download is the PDF as it is.
 */
export function PdfDarkView({ fileId, name, zoom = 1, height, src }: {
  fileId: string; name: string; zoom?: number; height: string;
  /** Where the PDF is read from, when not the file itself (an office file's PDF, `/api/files/<id>/as-pdf`). */
  src?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([]);
  const [state, setState] = useState<"loading" | "ready" | string>("loading");
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let gone = false;
    let opened: PDFDocumentProxy | null = null;
    (async () => {
      const answer = await fetch(src ?? `/api/files/${fileId}`).catch(() => null);
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
        setDoc(opened);
        setState("ready");
      } catch {
        if (!gone) setState("The PDF could not be drawn here: switch Dark page off, or download it.");
      }
    })();
    return () => { gone = true; opened?.destroy(); };
  }, [fileId, src]);

  // The pages fit the width at 100%, then follow the bar's zoom.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const watch = new ResizeObserver(() => setWidth(el.clientWidth));
    watch.observe(el);
    setWidth(el.clientWidth);
    return () => watch.disconnect();
  }, []);

  const widest = Math.max(1, ...sizes.map((s) => s.w));
  const fit = Math.min(1.6, Math.max(0.2, (width - 32) / widest)) * zoom;

  return (
    <div ref={box} className={`w-full overflow-auto bg-surface ${height}`}>
      {state !== "ready" ? (
        <p className="grid h-full place-items-center p-6 text-center text-xs text-slate-500">{state === "loading" ? `Opening ${name}…` : state}</p>
      ) : (
        <div className="flex flex-col items-center gap-4 p-4">
          {sizes.map((size, i) => <Page key={i} doc={doc!} number={i + 1} w={size.w * fit} h={size.h * fit} scale={fit} />)}
        </div>
      )}
    </div>
  );
}

/** One page, drawn once it comes near the view, again when the zoom changes. */
function Page({ doc, number, w, h, scale }: { doc: PDFDocumentProxy; number: number; w: number; h: number; scale: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const watch = new IntersectionObserver(([one]) => { if (one.isIntersecting) setNear(true); }, { rootMargin: "800px" });
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  useEffect(() => {
    if (!near || !canvas.current) return;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    let gone = false;
    (async () => {
      const page = await doc.getPage(number);
      if (gone || !canvas.current) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const view = page.getViewport({ scale: scale * ratio });
      const el = canvas.current;
      el.width = Math.floor(view.width);
      el.height = Math.floor(view.height);
      task = page.render({ canvasContext: el.getContext("2d")!, viewport: view });
      await task.promise.catch(() => {});
    })();
    return () => { gone = true; task?.cancel(); };
  }, [doc, number, scale, near]);
  return (
    <canvas ref={canvas} aria-label={`Page ${number}`} className="block shadow-md"
      style={{ width: `${w}px`, height: `${h}px`, filter: "invert(0.9) hue-rotate(180deg)" }} />
  );
}
