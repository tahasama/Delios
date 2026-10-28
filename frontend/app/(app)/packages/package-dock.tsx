"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowUpRight, Download, FolderInput, PackageCheck, Trash2, X } from "lucide-react";
import { ActionForm } from "@/components/form";
import { Select } from "@/components/select";
import { inputCls } from "@/components/ui";
import { startDownload } from "@/components/downloads";
import { deletePackagesAction, movePackagesAction } from "@/lib/packages/forms";

/*
 * The ticks on Packages and the bar they bring up, the register's way (owner: "a check box for every package that does
 * absolutely nothing: add the bottom bar and the options there"). The ticks are kept in one small store shared by each
 * line's box and the bar.
 */
let ticked: string[] = [];
const listeners = new Set<() => void>();
const set = (next: string[]) => { ticked = next; listeners.forEach((one) => one()); };
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const useTicked = () => useSyncExternalStore(subscribe, () => ticked, () => ticked);

/** One line's tick. */
export function PackageTick({ id, number }: { id: string; number: string }) {
  const now = useTicked();
  const on = now.includes(id);
  return <input type="checkbox" checked={on} aria-label={`Tick ${number}`} onChange={() => set(on ? now.filter((one) => one !== id) : [...now, id])} />;
}

/** Every line ticked, or none. */
export function PackageTickAll({ ids }: { ids: string[] }) {
  const now = useTicked();
  const all = ids.length > 0 && ids.every((id) => now.includes(id));
  return <input type="checkbox" checked={all} aria-label="Tick every package" onChange={() => set(all ? [] : ids)} />;
}

export type DockPackage = { id: string; number: string; title: string; open: boolean; inTree: boolean; members: number; sent: boolean; supplier: string | null };

/**
 * What can be done with the packages ticked: open one; deliver one (on its transmittal: what goes is worked out there);
 * download each one's list; and for whoever looks after them, move them inside another package or to the top, or remove
 * them (a package in another hands its documents and packages back up there; one at the top goes only empty).
 */
export function PackageDock({ packages, targets, manage, deliver }: {
  packages: DockPackage[];
  /** The open packages of this kind they may be moved into. */
  targets: { id: string; number: string; title: string; supplier: string | null }[];
  manage: boolean;
  deliver: boolean;
}) {
  const now = useTicked();
  const chosen = packages.filter((one) => now.includes(one.id));
  if (!chosen.length) return null;
  const one = chosen.length === 1 ? chosen[0] : null;
  const movable = chosen.filter((p) => p.open);
  // Removed while never delivered or shared with anyone (owner), filled or not: their documents stay in the register.
  const removable = chosen.filter((p) => !p.sent);
  const filled = removable.reduce((n, p) => n + p.members, 0);
  // Moved only where there is somewhere to go (owner: "what good does move do here?"): inside another open package of
  // the kind (a supplier's, of the same supplier), or to the top for one sitting in another.
  const into = targets.filter((t) => !chosen.some((p) => p.id === t.id) && movable.every((p) => p.supplier === t.supplier));
  const toTop = movable.some((p) => p.inTree);
  const act = "inline-flex items-center gap-1.5 rounded-sm bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/20";
  return (
    <div className="dock palette-light sticky bottom-4 z-30 mx-auto mt-4 flex w-fit max-w-full flex-wrap items-center gap-2 rounded-sm border border-white/10 bg-brand-strong p-2.5 text-white shadow-[0_8px_30px_rgb(0_0_0/0.18)]">
      <span className="px-2 font-mono text-sm tabular-nums">{chosen.length}<span className="ml-1.5 text-[10px] uppercase tracking-[0.12em] text-white/60">ticked</span></span>
      {one ? <Link href={`/packages/${encodeURIComponent(one.number)}`} className={act}><ArrowUpRight className="h-3.5 w-3.5" /> Open</Link> : null}
      {one && deliver ? <Link href={`/transmittals/new?${new URLSearchParams({ package: one.number })}`} className={act}><PackageCheck className="h-3.5 w-3.5" /> Deliver</Link> : null}
      <button type="button" className={act}
        onClick={() => chosen.forEach((p) => startDownload(`/api/export/packages?${new URLSearchParams({ number: p.number })}`, `${p.number}.csv`))}>
        <Download className="h-3.5 w-3.5" /> Export {chosen.length > 1 ? `(${chosen.length})` : ""}
      </button>
      {manage && movable.length && (into.length || toTop) ? (
        <details className="group relative">
          <summary className={`${act} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}><FolderInput className="h-3.5 w-3.5" /> Move{movable.length < chosen.length ? ` (${movable.length})` : ""}</summary>
          <div className="absolute bottom-full left-0 mb-2 w-80 rounded-md bg-surface p-3 text-slate-800 shadow-lg ring-1 ring-line">
            <ActionForm action={movePackagesAction} submitLabel="Move" size="sm" resetOnSuccess>
              {movable.map((p) => <input key={p.id} type="hidden" name="packageId" value={p.id} />)}
              <Select name="parentId" defaultValue={toTop ? "TOP" : into[0]?.id} className={inputCls}>
                {toTop ? <option value="TOP">To the top</option> : null}
                {into.map((t) => <option key={t.id} value={t.id}>{`Inside ${t.number} · ${t.title}`}</option>)}
              </Select>
            </ActionForm>
          </div>
        </details>
      ) : null}
      {manage && removable.length ? (
        <details className="group relative">
          <summary className={`${act} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}><Trash2 className="h-3.5 w-3.5" /> Remove{removable.length < chosen.length ? ` (${removable.length})` : ""}</summary>
          <div className="absolute bottom-full left-0 mb-2 w-80 rounded-md bg-surface p-3 text-slate-800 shadow-lg ring-1 ring-line">
            <ActionForm action={deletePackagesAction} submitLabel={`Remove ${removable.length}`} size="sm" variant="danger" resetOnSuccess
              confirmText={`${removable.map((p) => p.number).join(", ")} removed${filled ? `, with ${filled} document(s) in them` : ""}. Continue?`}>
              {removable.map((p) => <input key={p.id} type="hidden" name="packageId" value={p.id} />)}
              {filled ? (
                <p className="rounded-md bg-amber-50 px-2.5 py-2 text-xs leading-5 text-amber-900 ring-1 ring-amber-200">
                  {`They hold ${filled} document${filled === 1 ? "" : "s"}: those stay in the register: back into the package above for one sitting in another, a supplier's filed again with that supplier. Nothing of them is lost.`}
                </p>
              ) : <p className="text-xs leading-5 text-slate-600">They are empty. Their numbers are not given out again.</p>}
            </ActionForm>
          </div>
        </details>
      ) : null}
      <button type="button" onClick={() => set([])} className="ml-auto rounded-sm p-2 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Clear the ticks"><X className="h-4 w-4" /></button>
    </div>
  );
}
