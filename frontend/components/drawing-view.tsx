"use client";

import { useEffect, useRef, useState } from "react";
import type { DxfViewer, LayerInfo } from "dxf-viewer";

/**
 * A drawing shown in the page (owner: "the dwg workaround"): a DXF as it is, a DWG once the backend turned it into DXF
 * (LibreDWG, the free route: its reading depends on the drawing's version and content, and says so when it fails).
 * Dragged to move, the wheel to zoom, its layers switched on and off; text drawn in DejaVu Sans.
 */
export function DrawingView({ fileId, name, zoom = 1, height }: { fileId: string; name: string; zoom?: number; height: string }) {
  const box = useRef<HTMLDivElement>(null);
  const viewer = useRef<DxfViewer | null>(null);
  const base = useRef(1);
  const [layers, setLayers] = useState<LayerInfo[]>([]);
  const [state, setState] = useState<"loading" | "ready" | string>("loading");

  useEffect(() => {
    let gone = false;
    (async () => {
      // Asked first, so a refusal (not a drawing, the converter missing or failing) is said in its own words.
      const answer = await fetch(`/api/files/${fileId}/as-dxf`).catch(() => null);
      if (gone) return;
      if (!answer?.ok) {
        const body = answer ? await answer.json().catch(() => ({})) : {};
        setState(body.error ?? "The drawing could not be shown.");
        return;
      }
      const url = URL.createObjectURL(await answer.blob());
      const [{ DxfViewer: Viewer }, three] = await Promise.all([import("dxf-viewer"), import("three")]);
      if (gone || !box.current) { URL.revokeObjectURL(url); return; }
      const made = new Viewer(box.current, { clearColor: new three.Color("#ffffff"), autoResize: true, colorCorrection: true });
      viewer.current = made;
      try {
        await made.Load({ url, fonts: ["/vendor/fonts/DejaVuSans.ttf"] });
        if (gone) return;
        base.current = made.GetCamera().zoom;
        setLayers([...made.GetLayers(true)].sort((a, b) => a.displayName.localeCompare(b.displayName)));
        setState("ready");
      } catch {
        if (!gone) setState("The drawing could not be read: download it to open it.");
      } finally {
        URL.revokeObjectURL(url);
      }
    })();
    return () => { gone = true; viewer.current?.Destroy(); viewer.current = null; };
  }, [fileId]);

  // The bar's zoom scales the view the drawing opened on.
  useEffect(() => {
    const v = viewer.current;
    if (!v || state !== "ready") return;
    const camera = v.GetCamera();
    camera.zoom = base.current * zoom;
    camera.updateProjectionMatrix();
    v.Render();
  }, [zoom, state]);

  const toggle = (layer: LayerInfo) => {
    viewer.current?.ShowLayer(layer.name, !layer.visible);
    setLayers((all) => all.map((one) => (one.name === layer.name ? { ...one, visible: !one.visible } : one)));
  };

  return (
    <div className={`relative flex w-full bg-white ${height}`}>
      <div ref={box} className="min-w-0 flex-1" />
      {state === "ready" && layers.length > 1 ? (
        <aside className="scroll-thin w-52 shrink-0 overflow-y-auto border-l border-line bg-tint-soft p-2 text-[11px]">
          <p className="stencil mb-1 text-slate-500">Layers</p>
          {layers.map((layer) => (
            <label key={layer.name} className="flex cursor-pointer items-center gap-1.5 py-0.5 text-slate-700">
              <input type="checkbox" checked={layer.visible} onChange={() => toggle(layer)} />
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm ring-1 ring-line" style={{ backgroundColor: `#${layer.color.toString(16).padStart(6, "0")}` }} />
              <span className="truncate" title={layer.displayName}>{layer.displayName}</span>
            </label>
          ))}
        </aside>
      ) : null}
      {state !== "ready" ? (
        <p className="absolute inset-0 grid place-items-center p-6 text-center text-xs text-slate-500">
          {state === "loading" ? `Opening ${name}… (a DWG is read the first time it is opened)` : state}
        </p>
      ) : null}
    </div>
  );
}
