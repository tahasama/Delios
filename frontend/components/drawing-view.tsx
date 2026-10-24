"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import type { DxfViewer, LayerInfo } from "dxf-viewer";

/**
 * A drawing shown in the page (owner: "the dwg workaround"): a DXF as it is, a DWG once the backend turned it into DXF
 * (LibreDWG, the free route: its reading depends on the drawing's version and content, and says so when it fails).
 * Dragged to move, the wheel to zoom, its layers switched on and off; text drawn in DejaVu Sans.
 */
export function DrawingView({ fileId, name, zoom = 1, height, admin = false, note = true }: {
  fileId: string; name: string; zoom?: number; height: string; admin?: boolean;
  /** "For viewing only" shown above it, until closed (kept in a cookie, for every drawing). */
  note?: boolean;
}) {
  const [noted, setNoted] = useState(note);
  const box = useRef<HTMLDivElement>(null);
  const viewer = useRef<DxfViewer | null>(null);
  const base = useRef(1);
  const [layers, setLayers] = useState<LayerInfo[]>([]);
  const [state, setState] = useState<"loading" | "ready" | string>("loading");

  useEffect(() => {
    let gone = false;
    (async () => {
      const dwg = /\.dwg$/i.test(name);
      // The DXF asked of the backend (a refusal said in its own words), then drawn; a DWG whose full DXF the viewer
      // cannot draw is asked again in its minimal form (only its entities), once, before saying why it failed.
      const fetchDxf = async (minimal: boolean): Promise<string | { error: string }> => {
        const answer = await fetch(`/api/files/${fileId}/as-dxf${minimal ? "?minimal=1" : ""}`).catch(() => null);
        if (!answer?.ok) {
          const body = answer ? await answer.json().catch(() => ({})) : {};
          return { error: body.error ?? "The drawing could not be shown." };
        }
        return URL.createObjectURL(await answer.blob());
      };
      const [{ DxfViewer: Viewer }, three] = await Promise.all([import("dxf-viewer"), import("three")]);
      if (gone || !box.current) return;
      const made = new Viewer(box.current, { clearColor: new three.Color("#ffffff"), autoResize: true, colorCorrection: true });
      viewer.current = made;
      let failure = "";
      for (const minimal of dwg ? [false, true] : [false]) {
        const url = await fetchDxf(minimal);
        if (gone) return;
        if (typeof url !== "string") { setState(url.error); return; }
        try {
          await made.Load({ url, fonts: ["/vendor/fonts/DejaVuSans.ttf"] });
          if (gone) return;
          // Read, but nothing to draw (owner's sample: only 3D solids, which no free reader draws): said, never a blank page.
          if (!made.GetBounds()) {
            setState(`Nothing in ${name} can be drawn here: it holds only 3D solids or objects this reader does not draw. Download it to open it.`);
            return;
          }
          base.current = made.GetCamera().zoom;
          setLayers([...made.GetLayers(true)].sort((a, b) => a.displayName.localeCompare(b.displayName)));
          setState("ready");
          return;
        } catch (e) {
          failure = e instanceof Error ? e.message : String(e);
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      if (!gone) setState(`The drawing could not be drawn${failure ? ` (${failure})` : ""}: download it to open it.`);
    })();
    return () => { gone = true; viewer.current?.Destroy(); viewer.current = null; };
  }, [fileId, name]);

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
    <div className={`flex w-full flex-col bg-white ${height}`}>
      {/* Said above every drawing (owner: a warning that it is only for viewing; then "too long"). */}
      {noted ? (
        <p className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1 text-[11px] text-amber-900">
          <span><span className="font-semibold">For viewing only</span> · the revision&apos;s PDF is the reference.</span>
          <button type="button" title="Close" aria-label="Close" className="ml-auto grid h-5 w-5 place-items-center rounded text-amber-900/70 hover:text-amber-950"
            onClick={() => {
              setNoted(false);
              try { document.cookie = "viewing-note=0; path=/; max-age=31536000; samesite=lax"; } catch { /* closed for this visit only */ }
            }}>
            <X className="h-3.5 w-3.5" />
          </button>
        </p>
      ) : null}
      <div className="relative flex min-h-0 w-full flex-1">
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
          <span>
            {state === "loading" ? `Opening ${name}… (a DWG is read the first time it is opened)` : state}
            {/* Only to those who decide (owner): a certified reader, paid, opens what the free one does not. */}
            {admin && state !== "loading" && /\.dwg$/i.test(name) ? (
              <span className="mt-2 block">
                A certified reader opens these: see <Link href="/organization/settings/viewers" className="font-semibold text-link hover:underline">Settings → Viewing files</Link>.
              </span>
            ) : null}
          </span>
        </p>
      ) : null}
      </div>
    </div>
  );
}
