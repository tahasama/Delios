import Link from "next/link";
import { consoleApi } from "@/lib/console/client";
import { cn, fmtDateTime } from "@/lib/core/utils";
import { Nothing, Plate, Sheet } from "../parts";

export const metadata = { title: "Support access" };

type Row = { id: string; tenantId: string; organization: string | null; grantedByName: string; why: string; from: string; until: string; endedAt: string | null; endedByName: string | null; open: boolean };

/**
 * We never read an organization's documents by default. One of its administrators lets us in, for 1 to 30 days, with
 * why, from its Settings → Contract & plan; it ends early whenever they say. What we read meanwhile is in its audit trail.
 */
export default async function Support() {
  const rows = await consoleApi<Row[]>("/api/console/support");
  const open = rows.filter((r) => r.open);
  return (
    <>
      <Plate
        title="Support access"
        meta="Granted by an organization's administrator, for a set time, with why. Without it we see only counts and who answers for it."
        figures={[{ term: "Open now", value: open.length }, { term: "Granted, ever", value: rows.length }, { term: "Ended early", value: rows.filter((r) => r.endedAt).length }]}
      />
      <Sheet title="Every access granted" said="newest first">
        {rows.length ? (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className={cn("px-5 py-3 text-[13px] sm:px-6", !r.open && "opacity-70")}>
                <Link href={`/console/organizations/${r.tenantId}`} className="font-medium text-slate-900 hover:text-link hover:underline">{r.organization ?? "An organization"}</Link>
                <span className={cn("ml-2 text-[11px] font-semibold", r.open ? "text-sky-700" : "text-slate-500")}>{r.open ? "open" : r.endedAt ? "ended early" : "over"}</span>
                <span className="block text-[12px] text-slate-600">
                  {r.grantedByName}, {fmtDateTime(r.from)} → {fmtDateTime(r.until)}{r.endedAt ? ` · ended ${fmtDateTime(r.endedAt)} by ${r.endedByName}` : ""} · {r.why}
                </span>
              </li>
            ))}
          </ul>
        ) : <Nothing>No organization let us in yet.</Nothing>}
      </Sheet>
    </>
  );
}
