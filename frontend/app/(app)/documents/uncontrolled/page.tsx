import Link from "next/link";
import { notFound } from "next/navigation";
import { Search } from "lucide-react";
import { requireScope } from "@/lib/core/scope";
import { DataTable, Th, Td } from "@/components/ui";
import { fmtDate } from "@/lib/core/utils";
import { notYours } from "@/lib/client";
import { uncontrolled, UNCONTROLLED_TYPES } from "@/lib/documents/uncontrolled";
import { RegisterPlate } from "../register-plate";

export const metadata = { title: "Uncontrolled documents" };

const size = (n: number | null) => (n == null ? "" : n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/**
 * The uncontrolled documents (owner: "we will just keep them if we receive in a transmittal… clearly marked
 * uncontrolled"): every file the project keeps outside the register, each with how it came, where (a link to it), who
 * sent it and when. Nothing here is numbered, revised or reviewed. Our people only.
 */
export default async function UncontrolledPage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string }> }) {
  const ctx = await requireScope();
  if (!ctx.user.isInternal) notFound();
  const sp = await searchParams;
  const all = await uncontrolled(ctx).catch((e) => { if (notYours(e)) notFound(); throw e; });
  const words = (sp.q ?? "").trim().toLowerCase();
  const type = UNCONTROLLED_TYPES.some((t) => t.code === sp.type) ? sp.type : undefined;
  const found = words ? all.filter((r) => [r.name, r.came, r.from, r.by, r.note].some((v) => v?.toLowerCase().includes(words))) : all;
  const rows = type ? found.filter((r) => r.type === type) : found;
  const label = (code: string) => UNCONTROLLED_TYPES.find((t) => t.code === code)?.label ?? code;
  const href = (t?: string) => {
    const next = new URLSearchParams(Object.entries({ q: sp.q, type: t }).filter((e): e is [string, string] => !!e[1]));
    return `/documents/uncontrolled${next.size ? `?${next}` : ""}`;
  };

  return (
    <section data-dt-frame className="register register-sheet">
      <RegisterPlate project={{ code: ctx.project.code, name: ctx.project.name }} canCreate={false} showing="uncontrolled" ours />
      <p className="border-b border-line bg-amber-50 px-5 py-2.5 text-[12.5px] text-amber-900 sm:px-6 dark:bg-amber-950 dark:text-amber-100">
        <strong>Uncontrolled.</strong> Kept as they came: no number, no revision, no review. Nobody may rely on them as the
        project&apos;s documents; one that matters is registered from its transmittal, and becomes controlled.
      </p>
      <form className="asking flex flex-wrap items-end gap-3 border-b border-line px-5 py-3 sm:px-6">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Find</span>
          <Search className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input name="q" defaultValue={sp.q} placeholder="Find a file, a transmittal, who sent it" className="plain w-full !pl-7" />
        </label>
        {type ? <input type="hidden" name="type" value={type} /> : null}
        <button type="submit" className="ask">Find</button>
      </form>
      <nav aria-label="How it came" className="border-b border-line px-5 py-2.5 sm:px-6">
        <div className="seg w-fit max-w-full">
          <Link href={href()} scroll={false} aria-current={!type ? "page" : undefined} className="segment">All <span className="segment-n">{found.length}</span></Link>
          {UNCONTROLLED_TYPES.map((t) => {
            const n = found.filter((r) => r.type === t.code).length;
            return n || type === t.code ? (
              <Link key={t.code} href={href(t.code)} scroll={false} title={t.said} aria-current={type === t.code ? "page" : undefined} className="segment">
                {t.label} <span className="segment-n">{n}</span>
              </Link>
            ) : null;
          })}
        </div>
      </nav>
      {rows.length ? (
        <DataTable className="rounded-none border-0 shadow-none" id="uncontrolled" exportName="uncontrolled-documents"
          head={<tr><Th>File</Th><Th>Type</Th><Th>Came on</Th><Th>From</Th><Th>By</Th><Th>When</Th><Th>Note</Th></tr>}>
          {rows.map((r, i) => (
            <tr key={`${r.fileId ?? r.name}-${i}`}>
              <Td className="rail rail-none">
                <span className="stamp mr-1.5 text-amber-700">uncontrolled</span>
                {r.fileId ? <a href={`/api/files/${r.fileId}`} className="text-link hover:underline">{r.name}</a> : <span>{r.name}</span>}
                {r.size != null ? <span className="ml-1.5 text-[11px] text-slate-400">{size(r.size)}</span> : null}
              </Td>
              <Td><span title={UNCONTROLLED_TYPES.find((t) => t.code === r.type)?.said}>{label(r.type)}</span></Td>
              <Td><Link href={r.href} className="text-link hover:underline">{r.came}</Link></Td>
              <Td>{r.from ?? <span className="text-slate-400">us</span>}</Td>
              <Td>{r.by ?? ""}</Td>
              <Td className="whitespace-nowrap">{fmtDate(new Date(r.at))}</Td>
              <Td className="text-[12px] text-slate-600">{r.note ?? ""}</Td>
            </tr>
          ))}
        </DataTable>
      ) : (
        <div className="px-6 py-16 text-center">
          <p className="text-sm text-slate-700">
            {words || type ? "Nothing uncontrolled matches that." : "Nothing uncontrolled is kept yet. Files that come on a transmittal and are not registered are listed here."}
          </p>
          {words || type ? <Link href="/documents/uncontrolled" className="mt-3 inline-block text-xs font-semibold text-link hover:underline">Clear →</Link> : null}
        </div>
      )}
    </section>
  );
}
