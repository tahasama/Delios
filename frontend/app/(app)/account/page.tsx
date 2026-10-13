import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { PageHeader, ToneChip } from "@/components/ui";
import { api } from "@/lib/api/client";
import { TwoStep } from "./two-step";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your sign-in" };

/** The signed-in person's own sign-in: two-step sign-in on or off, and how to change the password. */
export default async function AccountPage() {
  const ctx = await requireScope();
  const mfa = await api<{ on: boolean; required: boolean }>("/api/me/mfa").catch(() => ({ on: false, required: false }));
  return (
    <div className="space-y-4">
      <PageHeader title="Your sign-in" subtitle={`${ctx.user.name} · ${ctx.user.email}`} />

      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil mr-1 text-slate-500">Two-step sign-in</span>
          <span className="text-[11px] text-slate-500">a code from an authenticator app after your password</span>
        </div>
        <ul className="divide-y divide-line">
          <li className="space-y-3 px-5 py-4 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="text-sm font-semibold text-slate-800">
                Your second step{mfa.required ? <span className="ml-1.5 text-xs font-normal text-slate-500">your organization requires it</span> : null}
              </p>
              <ToneChip tone={mfa.on ? "done" : "idle"}>{mfa.on ? "On" : "Off"}</ToneChip>
            </div>
            <TwoStep on={mfa.on} required={mfa.required} />
          </li>
        </ul>
      </section>

      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil mr-1 text-slate-500">Password</span>
          <span className="text-[11px] text-slate-500">changed by email, so only whoever reads your mail can change it</span>
        </div>
        <p className="px-5 py-4 text-xs leading-5 text-slate-600 sm:px-6">
          Sign out, then use <Link href="/forgot-password" className="font-semibold text-link hover:underline">Forgot your password?</Link> on the sign-in page.
          The link comes by email and works once, within 30 minutes. Choosing the new password signs you out everywhere.
        </p>
      </section>
    </div>
  );
}
