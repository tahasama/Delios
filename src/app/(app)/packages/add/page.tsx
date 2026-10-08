import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/api/client";
import type { PackageSummary, RegisterPage } from "@/lib/api/types";
import { requireSession, projectPath } from "@/lib/session";
import { packageLists } from "../lists";
import { AddForm } from "../forms";
import { day } from "../states";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add to package" };

/** The documents chosen in the register, into one open package. */
export default async function AddToPackagePage({ searchParams }: { searchParams: Promise<{ docs?: string }> }) {
  const session = await requireSession();
  const docs = ((await searchParams).docs ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  const [register, packages, lists] = await Promise.all([
    docs.length ? api<RegisterPage>(projectPath(session, "/register"), { query: { ids: docs.join(","), per: 250, sort: "docNumber", dir: "asc" } }) : null,
    api<PackageSummary[]>(projectPath(session, "/packages")),
    packageLists(session),
  ]);
  const rows = register?.rows ?? [];
  const open = packages.filter((p) => p.state === "OPEN");

  return (
    <div className="space-y-4">
      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-col-reverse gap-3 px-5 pt-6 pb-4 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <h1 className="plate-name min-w-0">Add to a package</h1>
            <p className="plate-meta mt-2">{rows.length} document{rows.length === 1 ? "" : "s"}</p>
          </div>
          <Link href="/documents" className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /> Documents</Link>
        </div>
      </section>
      <section className="register register-sheet register-sheet-open">
        <div className="px-5 py-4 sm:px-6">
          <ul className="mb-4 space-y-1 text-xs">
            {rows.map((d) => <li key={d.id}><Link href={`/documents/${d.id}`} className="font-mono font-semibold text-brand-ink hover:underline">{d.number}</Link> <span className="text-slate-500">{d.title}</span></li>)}
          </ul>
          {!rows.length ? <p className="text-sm text-slate-500">Select documents in the register first.</p>
            : !open.length ? <p className="text-sm text-amber-800">No package is open. <Link href="/packages" className="font-semibold underline">Create one</Link> first.</p>
            : <AddForm documentIds={rows.map((d) => d.id)} statuses={lists.statuses}
                packages={open.map((p) => ({ id: p.id, name: `${p.number} — ${p.title}${p.completionDate ? `, due ${day(p.completionDate)}` : ""}` }))} />}
        </div>
      </section>
    </div>
  );
}
