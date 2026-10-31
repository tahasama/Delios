import { APP_NAME } from "@/lib/core/standard";
import { LegalLinks } from "@/app/(public)/legal/frame";
import { SandboxNotice } from "@/components/sandbox-band";

/** The sign-in pages' frame: the brand panel, and the form beside it. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      {/* Brand panel */}
      <div className="relative hidden flex-1 flex-col justify-between bg-brand p-10 text-white lg:flex">
        <div>
          <div className="flex items-center gap-2 text-lg font-semibold tracking-wide">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 font-bold">D</span>
            DELIOS
          </div>
          <p className="mt-2 text-sm text-white/60">Controlled Project Information</p>
        </div>
        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight">Electronic Document Management System</h1>
          <p className="mt-4 text-sm leading-relaxed text-white/70">
            One controlled register: identity, description, revisions, states, approval, review, issue, obsolescence and retention — each one checked against the records it leaves.
          </p>
          <div className="mt-6 flex gap-2 text-[11px] font-medium uppercase tracking-widest text-white/50">
            <span className="rounded-full bg-white/10 px-3 py-1">Layer I · Rules</span>
            <span className="rounded-full bg-emerald-400/20 px-3 py-1 text-emerald-200">Layer II · Routes</span>
            <span className="rounded-full bg-orange-400/20 px-3 py-1 text-orange-200">Layer III · Checks</span>
          </div>
        </div>
        <p className="text-xs text-white/40">{APP_NAME} — internal use only</p>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center bg-slate-50 px-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-2 text-lg font-semibold text-brand-ink">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand font-bold text-white">D</span>
              DELIOS · EDMS
            </div>
          </div>
          <SandboxNotice />
          {children}
          <LegalLinks />
        </div>
      </div>
    </div>
  );
}
