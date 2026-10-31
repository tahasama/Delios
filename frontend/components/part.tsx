"use client";

import { Component, Suspense, startTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { reportError } from "@/components/report-error";
import { PartSkeleton } from "@/components/skeleton";

/**
 * One part of a page that reads on its own (owner, the ten states: "a failing part of a page", "a tab or panel that
 * loads on its own"): while it reads, its own outline in grey, the rest of the page already there; if it fails, its own
 * short line in its place, with Try again, the rest of the page standing. What it holds is an async server component;
 * its failure is reported to us like any other (never the server's words on the screen).
 */
export function Part({ name, outline, failed, children }: {
  name: string;
  outline?: ReactNode;
  /** What still stands when it fails (the part drawn without what it reads), its failure said under it. */
  failed?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Boundary name={name} failed={failed}>
      <Suspense fallback={outline ?? <PartSkeleton what={name} />}>{children}</Suspense>
    </Boundary>
  );
}

class Boundary extends Component<{ name: string; failed?: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { reportError(error); }
  render() {
    return this.state.failed
      ? <>{this.props.failed}<Failed name={this.props.name} again={() => this.setState({ failed: false })} /></>
      : this.props.children;
  }
}

function Failed({ name, again }: { name: string; again: () => void }) {
  const router = useRouter();
  return (
    <div role="alert" className="register register-sheet register-sheet-open px-4 py-3 text-[12.5px] text-slate-600">
      <p><span className="font-semibold text-slate-800">{name[0]?.toUpperCase() + name.slice(1)} could not be shown.</span> The rest of the page is fine, and nothing was lost.</p>
      <button type="button" onClick={() => startTransition(() => { router.refresh(); again(); })} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-link hover:underline">
        <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Try again
      </button>
    </div>
  );
}
