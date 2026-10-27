import { cn } from "@/lib/core/utils";

/**
 * What a page looks like while it is read (owner, "skeleton loaders"): its outline in quiet grey, in the place and
 * size of what will come, so the page never stands blank and nothing jumps once it arrives. Drawn by each area's
 * `loading.tsx`; it says it is reading for screen readers, and holds still for whoever asked for less motion.
 */
function Bone({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block rounded bg-slate-200/70 animate-pulse motion-reduce:animate-none dark:bg-slate-700/40", className)} />;
}

/** The plate every page opens with: its title, the line under it, its figures. */
function Plate({ figures = 4 }: { figures?: number }) {
  return (
    <div className="register register-sheet register-sheet-open px-5 py-5 sm:px-6">
      <Bone className="h-7 w-56" />
      <Bone className="mt-3 h-3.5 w-full max-w-xl" />
      {figures ? (
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: figures }, (_, i) => (
            <div key={i}>
              <Bone className="h-6 w-12" />
              <Bone className="mt-2 h-3 w-24" />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Reading({ what, children }: { what: string; children: React.ReactNode }) {
  return (
    <div aria-busy="true" className="space-y-4">
      <span className="sr-only" role="status">Reading {what}…</span>
      {children}
    </div>
  );
}

/** A register: its plate, its filters, then lines of the table. */
export function RegisterSkeleton({ what = "the list", lines = 10 }: { what?: string; lines?: number }) {
  return (
    <Reading what={what}>
      <Plate />
      <div className="register register-sheet register-sheet-open overflow-hidden">
        <div className="flex flex-wrap gap-3 border-b border-line px-4 py-3">
          {[16, 9, 9, 7].map((rem, i) => (
            <span key={i} style={{ width: `${rem}rem` }}><Bone className="h-(--control-h)" /></span>
          ))}
        </div>
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-line px-4 py-3 last:border-b-0">
            <Bone className="h-3.5 w-28 shrink-0" />
            <Bone className="h-3.5 flex-1" />
            <Bone className="hidden h-3.5 w-24 shrink-0 sm:block" />
            <Bone className="hidden h-3.5 w-20 shrink-0 md:block" />
          </div>
        ))}
      </div>
    </Reading>
  );
}

/** One thing's own page (a document, an action, a package): its plate, its tabs, then its cards. */
export function DetailSkeleton({ what = "the page" }: { what?: string }) {
  return (
    <Reading what={what}>
      <Plate figures={0} />
      <div className="flex gap-5 px-1">
        {[5, 6, 5, 4].map((w, i) => <span key={i} style={{ width: `${w}rem` }}><Bone className="h-4" /></span>)}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="register register-sheet register-sheet-open space-y-3 px-5 py-5">
          {Array.from({ length: 6 }, (_, i) => <Bone key={i} className={cn("h-3.5", i % 3 === 2 ? "w-2/3" : "w-full")} />)}
        </div>
        <div className="register register-sheet register-sheet-open space-y-3 px-5 py-5">
          {Array.from({ length: 4 }, (_, i) => <Bone key={i} className="h-3.5 w-full" />)}
        </div>
      </div>
    </Reading>
  );
}

/** Any other page: its plate and two cards. */
export function PageSkeleton({ what = "the page" }: { what?: string }) {
  return (
    <Reading what={what}>
      <Plate />
      {Array.from({ length: 2 }, (_, i) => (
        <div key={i} className="register register-sheet register-sheet-open space-y-3 px-5 py-5">
          <Bone className="h-4 w-48" />
          <Bone className="h-3.5 w-full" />
          <Bone className="h-3.5 w-5/6" />
        </div>
      ))}
    </Reading>
  );
}
