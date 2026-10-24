"use client";

import { useRef, useState } from "react";
import { ActionForm } from "@/components/form";
import { placeStampAction } from "@/lib/reviews/forms";
import { fmtDate } from "@/lib/core/utils";
import type { StampPlan } from "@/lib/reviews/api";

/** From half to twice the stamp's normal size (backend STAMP_SIZE). */
const SMALLEST = 0.5, LARGEST = 2;

/**
 * Where the stamp goes (owner: the usual corner may be filled; "the stamp is automatic to prevent falsification"; "move
 * it around and/or resize it"): the first page as it is, with the stamp's frame where and at the size the app found room
 * for it. Before the release or the send-back, the control function may drag it elsewhere, make it larger or smaller by
 * its corner, and save; only its place and size change, never what it says, and each change is recorded. Once the
 * stamp is made it is fixed.
 */
export function StampPlacer({ reviewId, plan }: {
  reviewId: string;
  plan: StampPlan & Required<Pick<StampPlan, "fileId" | "page" | "stamp" | "found">>;
}) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: "move" | "size"; dx: number; dy: number } | null>(null);
  // At its normal size, as a share of the page.
  const w1 = plan.stamp.w / plan.page.w, h1 = plan.stamp.h / plan.page.h;
  const start = plan.placed ?? plan.found;
  const [at, setAt] = useState({ x: start.x, y: start.y, scale: start.scale });
  const moved = Math.abs(at.x - start.x) > 0.001 || Math.abs(at.y - start.y) > 0.001 || Math.abs(at.scale - start.scale) > 0.005;

  const point = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const onDown = (kind: "move" | "size") => (e: React.PointerEvent) => {
    e.stopPropagation();
    const p = point(e);
    drag.current = { kind, dx: p.x - at.x, dy: p.y - at.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const p = point(e);
    if (drag.current.kind === "move") {
      setAt((was) => ({ ...was, x: Math.min(Math.max(p.x - drag.current!.dx, 0), 1 - w1 * was.scale), y: Math.min(Math.max(p.y - drag.current!.dy, 0), 1 - h1 * was.scale) }));
    } else {
      // The corner follows the pointer; the size keeps the stamp's own shape, within the page and the limits.
      setAt((was) => {
        const wanted = Math.max((p.x - was.x) / w1, (p.y - was.y) / h1);
        const fits = Math.min((1 - was.x) / w1, (1 - was.y) / h1);
        return { ...was, scale: Math.round(Math.min(Math.max(wanted, SMALLEST), LARGEST, fits) * 100) / 100 };
      });
    }
  };
  const tone = plan.returned ? "border-rose-600 bg-rose-50/70 text-rose-800" : "border-emerald-600 bg-emerald-50/70 text-emerald-800";
  const handle = plan.returned ? "bg-rose-600" : "bg-emerald-600";
  const shrunk = !plan.placed && plan.found.scale < (plan.projectScale ?? 1) - 0.001;

  return (
    <div className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] sm:px-6">
      <div ref={box} onPointerMove={onMove} onPointerUp={() => { drag.current = null; }}
        className="relative w-full overflow-hidden rounded-sm bg-white shadow-sm ring-1 ring-line select-none touch-none"
        style={{ aspectRatio: `${plan.page.w} / ${plan.page.h}` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/files/${plan.fileId}/page`} alt="The first page" draggable={false} className="absolute inset-0 h-full w-full object-contain" />
        <div role="slider" aria-label="The stamp: drag it where it should go" aria-valuetext={`${Math.round(at.x * 100)}% across, ${Math.round(at.y * 100)}% down, ${Math.round(at.scale * 100)}% of its size`}
          onPointerDown={onDown("move")}
          className={`absolute grid cursor-grab place-items-center rounded-[3px] border-2 border-dashed text-[10px] font-semibold active:cursor-grabbing ${tone}`}
          style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%`, width: `${w1 * at.scale * 100}%`, height: `${h1 * at.scale * 100}%` }}>
          Stamp
          <span role="slider" aria-label="Make the stamp larger or smaller" aria-valuenow={Math.round(at.scale * 100)} aria-valuemin={50} aria-valuemax={200}
            onPointerDown={onDown("size")} title="Drag to make it larger or smaller"
            className={`absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm ring-2 ring-white ${handle}`} />
        </div>
      </div>
      <div className="space-y-3 text-[13px] leading-5 text-slate-700">
        <p>
          {plan.placed
            ? <>Put here by hand{plan.placed.by ? <> by {plan.placed.by}</> : null}{plan.placed.at ? <>, {fmtDate(plan.placed.at)}</> : null}, at {Math.round(plan.placed.scale * 100)}% of its size: the stamp goes there on every page.</>
            : shrunk
              ? <>The page is crowded: the app found room for it here at {Math.round(plan.found.scale * 100)}% of its size. On every other page it finds its own room the same way.</>
              : <>The app found room for it here. On every other page it finds its own room the same way, a little smaller if it must, and always on the page.</>}
        </p>
        <p className="text-xs text-slate-500">
          Drag it to move it; drag its corner to make it larger or smaller ({Math.round(at.scale * 100)}%). Only its place and size change, never what it says.
          Each change is recorded; once the stamp is made, it stays as it is.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <ActionForm action={placeStampAction} submitLabel="Put the stamp here" hidden={{ reviewId, x: String(at.x), y: String(at.y), scale: String(at.scale) }}
            className={moved ? "" : "pointer-events-none opacity-50"} />
          {plan.placed ? (
            <ActionForm action={placeStampAction} submitLabel="Back to the app's place" variant="secondary" hidden={{ reviewId, back: "1" }} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
