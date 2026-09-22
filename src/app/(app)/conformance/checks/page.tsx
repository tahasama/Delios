import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { PageHeader, DataTable, Th, Td, Chip, SeverityChip, ButtonLink } from "@/components/ui";
import { CATALOG, FAMILY_TITLES } from "@/lib/checks/catalog";
import { latestResults } from "@/lib/checks/engine";
import { cn } from "@/lib/utils";
import { FAMILIES } from "@/lib/checks/catalog";
import { AssuranceTabs } from "@/app/(app)/conformance/tabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Check catalogue" };

const RESULT_STYLE: Record<string, string> = {
  PASS: "bg-emerald-100 text-emerald-800 ring-emerald-300",
  FAIL: "bg-red-100 text-red-800 ring-red-300",
  NOT_CHECKED: "bg-slate-100 text-slate-500 ring-slate-300",
  NOT_EXECUTABLE: "bg-amber-100 text-amber-800 ring-amber-300",
  NOT_APPLICABLE: "bg-sky-100 text-sky-800 ring-sky-300",
};

export default async function ChecksPage({ searchParams }: { searchParams: Promise<{ family?: string; result?: string }> }) {
  const ctx = await requireScope();
  const { db } = ctx;
  const sp = await searchParams;
  const family = sp.family ?? "";
  const result = sp.result ?? "";
  const results = await latestResults(ctx);

  const rows = CATALOG.filter((c) => {
    if (family && c.id.split("-")[0] !== family) return false;
    if (result && results.get(c.id)?.result !== result) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Control check catalogue"
        subtitle="Browse every automated and manual control check, its severity, evidence source and latest result."
      />
      <AssuranceTabs current="/conformance/checks" />

      <div className="flex flex-wrap gap-1.5">
        <Link href="/conformance/checks" className={cn("rounded-full px-3 py-1.5 text-xs font-medium", !family ? "bg-brand text-white" : "bg-slate-100 text-slate-600")}>All</Link>
        {FAMILIES.map((f) => (
          <Link key={f} href={`/conformance/checks?family=${f}`} className={cn("rounded-full px-3 py-1.5 text-xs font-medium", family === f ? "bg-brand text-white" : "bg-slate-100 text-slate-600")}>
            {FAMILY_TITLES[f]?.replace(/^H\.\d+\s/, "") ?? f}
          </Link>
        ))}
      </div>

      <DataTable
        head={<tr><Th>ID</Th><Th>Condition · how it is checked</Th><Th>Evidence</Th><Th>Clause</Th><Th>Severity</Th><Th>Owner</Th><Th>Latest result</Th></tr>}
      >
        {rows.map((c) => {
          const r = results.get(c.id);
          return (
            <tr key={c.id}>
              <Td className="whitespace-nowrap font-mono text-xs font-semibold">
                {c.id}{c.contradiction ? <span className="ml-1 text-red-500" title="Structural contradiction">▲</span> : null}
              </Td>
              <Td className="max-w-96"><span className="text-[13px]">{c.condition}</span><span className="mt-0.5 block text-[11px] leading-snug text-slate-400">{c.method}</span></Td>
              <Td className="text-xs text-slate-400">{c.evidence}</Td>
              <Td className="whitespace-nowrap font-mono text-[11px] text-slate-400">{c.clause}</Td>
              <Td><SeverityChip severity={c.severity} /></Td>
              <Td><Chip>{c.owner}</Chip></Td>
              <Td>
                <Chip className={RESULT_STYLE[r?.result ?? ""] ?? ""}>
                  {r ? (r.result === "FAIL" ? `Fail — ${r.failingCount} item${r.failingCount === 1 ? "" : "s"}` : r.result.replaceAll("_", " ").toLowerCase()) : "never run"}
                </Chip>
              </Td>
            </tr>
          );
        })}
      </DataTable>
      <p className="text-xs text-slate-400">{rows.length} checks shown · {FAMILY_TITLES[family] ?? "all families"}</p>
    </div>
  );
}
