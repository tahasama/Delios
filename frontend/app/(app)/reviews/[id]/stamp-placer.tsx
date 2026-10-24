"use client";

import { useRef, useState } from "react";
import { ActionForm } from "@/components/form";
import { placeStampAction } from "@/lib/reviews/forms";
import { fmtDate } from "@/lib/core/utils";
import type { StampPlan } from "@/lib/reviews/api";

/**
 * Where the stamp goes (owner: the usual corner may be filled; "the stamp is automatic to prevent falsification"): the
 * first page as it is, with the stamp's frame where the app found room for it. Before the release or the send-back,
 * the control function may drag it elsewhere and save; only the place changes, never what the stamp says, and each
 * move is recorded. Once the stamp is made it is fixed.
 */
export function StampPlacer({ reviewId, plan }: { reviewId: string; plan: Required<Pick<StampPlan, "fileId" | "page" | "stamp">> & StampPlan }) {
  const box = useRef<HTMLDivElement>(null);
  const grab = useRef<{ dx: number; dy: number } | null>(null);
  const w = plan.stamp.w / plan.page.w, h = plan.stamp.h / plan.page.h;
  // Where it is shown: placed by hand, else the app's spot; no room anywhere: the chosen corner, faded, to drag from.
  const start = plan.placed ?? plan.found ?? { x: Math.max(0, 1 - w - 18 / plan.page.w), y: 18 / plan.page.h };
  const [at, setAt] = useState(start);
  const moved = Math.abs(at.x - start.x) > 0.001 || Math.abs(at.y - start.y) > 0.001;
  const noRoom = !plan.placed && !plan.found;

  const point = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const onDown = (e: React.PointerEvent) => {
    const p = point(e);
    grab.current = { dx: p.x - at.x, dy: p.y - at.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!grab.current) return;
    const p = point(e);
    setAt({ x: Math.min(Math.max(p.x - grab.current.dx, 0), 1 - w), y: Math.min(Math.max(p.y - grab.current.dy, 0), 1 - h) });
  };
  const tone = plan.returned ? "border-rose-600 bg-rose-50/70 text-rose-800" : "border-emerald-600 bg-emerald-50/70 text-emerald-800";

  return (
    <div className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] sm:px-6">
      <div ref={box} className="relative w-full overflow-hidden rounded-sm bg-white shadow-sm ring-1 ring-line select-none touch-none"
        style={{ aspectRatio: `${plan.page.w} / ${plan.page.h}` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/files/${plan.fileId}/page`} alt="The first page" draggable={false} className="absolute inset-0 h-full w-full object-contain" />
        <div role="slider" aria-label="The stamp: drag it where it should go" aria-valuetext={`${Math.round(at.x * 100)}% across, ${Math.round(at.y * 100)}% down`}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => { grab.current = null; }}
          className={`absolute grid cursor-grab place-items-center rounded-[3px] border-2 border-dashed text-[10px] font-semibold active:cursor-grabbing ${tone} ${noRoom && !moved ? "opacity-60" : ""}`}
          style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}>
          Stamp
        </div>
      </div>
      <div className="space-y-3 text-[13px] leading-5 text-slate-700">
        <p>
          {plan.placed
            ? <>Put here by hand{plan.placed.by ? <> by {plan.placed.by}</> : null}{plan.placed.at ? <>, {fmtDate(plan.placed.at)}</> : null}: the stamp goes there on every page.</>
            : plan.found
              ? <>The app found room for it here, on every page where there is room; a page without room gets a small mark, the stamp itself on a page added at the end.</>
              : <>The first page has no clear spot: the stamp goes on a page added at the end, a small mark on the page saying so. Drag it onto the page to put it there instead.</>}
        </p>
        <p className="text-xs text-slate-500">Only its place changes, never what it says. Each move is recorded; once the stamp is made, it stays where it is.</p>
        <div className="flex flex-wrap items-center gap-3">
          <ActionForm action={placeStampAction} submitLabel="Put the stamp here" hidden={{ reviewId, x: String(at.x), y: String(at.y) }}
            className={moved ? "" : "pointer-events-none opacity-50"} />
          {plan.placed ? (
            <ActionForm action={placeStampAction} submitLabel="Back to the app's place" variant="secondary" hidden={{ reviewId, back: "1" }} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
