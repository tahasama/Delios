import { APP_NAME } from "@/lib/standard";
import { SignInForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

/** The sign-in page: the brand panel, and the form that talks to the backend. */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const raw = (await searchParams).next ?? "/";
  // Only same-site paths, or ?next becomes an open redirect.
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
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

      <div className="flex flex-1 items-center justify-center bg-slate-50 px-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-2 text-lg font-semibold text-brand-ink">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand font-bold text-white">D</span>
              DELIOS · EDMS
            </div>
          </div>
          <h2 className="text-xl font-semibold text-slate-900">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">Use the account your administrator created for you.</p>
          <SignInForm next={next} demo={process.env.NODE_ENV !== "production"} />
        </div>
      </div>
    </div>
  );
}
