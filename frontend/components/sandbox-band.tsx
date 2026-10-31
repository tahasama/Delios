import { FlaskConical } from "lucide-react";
import { SANDBOX, SANDBOX_LINE } from "@/lib/core/sandbox";

/**
 * Said on every page of a sandbox, without taking any room from it (the menu and the top bar keep their height): a
 * small band fixed at the foot of the window's middle, never in the way of a click (it lets them through).
 */
export function SandboxBand() {
  if (!SANDBOX) return null;
  return (
    <p role="note" className="pointer-events-none fixed inset-x-0 bottom-1.5 z-[60] flex justify-center px-4 print:hidden">
      <span className="flex max-w-full items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-[11px] font-semibold text-amber-900 shadow-sm ring-1 ring-amber-300 dark:bg-amber-950 dark:text-amber-100 dark:ring-amber-700">
        <FlaskConical className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">{SANDBOX_LINE}</span>
      </span>
    </p>
  );
}

/** On sign-in and sign-up, said in full before anyone types a company or a name. */
export function SandboxNotice() {
  if (!SANDBOX) return null;
  return (
    <div role="note" className="mb-6 rounded-md bg-amber-50 px-3 py-2.5 text-[12px] leading-5 text-amber-900 ring-1 ring-amber-300">
      <p className="flex items-center gap-1.5 font-semibold"><FlaskConical className="h-3.5 w-3.5" aria-hidden /> This is the DELIOS sandbox</p>
      <p className="mt-1">
        A testing area for trying DELIOS out. Make up your company, its people and its files: nothing here is checked or
        kept for real, and everything may be wiped without warning. Never add real documents or personal data.
      </p>
    </div>
  );
}
