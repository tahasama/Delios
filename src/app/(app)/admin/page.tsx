import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { isAdmin } from "@/lib/auth";
import { PageHeader, Banner } from "@/components/ui";
import { SETUP_PAGES, SETUP_GROUPS } from "./setup-pages";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function AdminPage() {
  const { user } = await requireScope();
  if (!isAdmin(user)) {
    return (
      <div>
        <PageHeader title="Settings" />
        <Banner tone="danger" title="Administrators only">Ask an administrator for configuration changes.</Banner>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" subtitle="Set once for the organization; every project uses it." />
      <div className="space-y-5">
        {SETUP_GROUPS.map((group) => {
          const pages = SETUP_PAGES.filter((p) => p.group === group);
          if (!pages.length) return null;
          return (
            <section key={group}>
              <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">{group}</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {pages.map((page) => (
                  <Link key={page.href} href={page.href} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-[#2d5480]/40 hover:shadow">
                    <p className="text-sm font-semibold text-slate-800">{page.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">{page.text}</p>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
