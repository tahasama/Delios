import Link from "next/link";
import { DataTable, Th, Td } from "@/components/ui";
import { consoleApi } from "@/lib/console/client";
import { bytes, STATE_TONE, STATE_WORDS, type OrgRow } from "@/lib/console/types";
import { cn, fmtDate } from "@/lib/core/utils";
import { Plate, Sheet } from "../parts";

export const metadata = { title: "Organizations" };

/** Every organization on DELIOS: where it stands with us, what it uses, and whether it lets us in. */
export default async function Organizations({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { state } = await searchParams;
  const all = await consoleApi<OrgRow[]>("/api/console/organizations");
  const shown = state ? all.filter((o) => o.state === state) : all;
  const count = (s: string) => all.filter((o) => o.state === s).length;
  return (
    <>
      <Plate
        title="Organizations"
        meta="Each organization's space on DELIOS. Its plan and contract are set here; its people and projects stay its own."
        figures={["TRIAL", "ACTIVE", "READ_ONLY", "ENDED"].map((s) => ({ term: STATE_WORDS[s], value: count(s), tone: STATE_TONE[s] }))}
      />
      <Sheet
        title="Every organization"
        said={`${shown.length} of ${all.length}`}
        acts={
          <span className="seg">
            {[["", "All"], ["TRIAL", "Trying"], ["ACTIVE", "Active"], ["READ_ONLY", "Reads only"], ["ENDED", "Ended"]].map(([code, label]) => (
              <Link key={code} href={code ? `/console/organizations?state=${code}` : "/console/organizations"} aria-current={(state ?? "") === code ? "page" : undefined} className="segment">
                {label}
              </Link>
            ))}
          </span>
        }
      >
        <DataTable className="rounded-none border-0 shadow-none" toolbar={false}
          head={<tr><Th>Organization</Th><Th>With us</Th><Th>Plan</Th><Th>Paid until</Th><Th>Paid users</Th><Th>Projects</Th><Th>Storage</Th><Th>Last active</Th><Th>Since</Th></tr>}>
          {shown.map((o) => (
            <tr key={o.id} className={cn(!o.active && "opacity-60")}>
              <Td>
                <Link href={`/console/organizations/${o.id}`} className="font-medium text-slate-900 hover:text-link hover:underline">{o.name}</Link>
                <span className="ml-1.5 text-[11px] text-slate-400">{o.slug}</span>
                {!o.active ? <span className="ml-1.5 text-[11px] font-semibold text-red-700">switched off</span> : null}
                {o.supportOpen ? <span className="ml-1.5 text-[11px] font-semibold text-sky-700">lets us in</span> : null}
                {o.termsToAccept ? <span className="ml-1.5 text-[11px] text-amber-700">terms to accept</span> : null}
              </Td>
              <Td><span className={cn("font-semibold", STATE_TONE[o.state])} title={o.why}>{STATE_WORDS[o.state] ?? o.state}</span></Td>
              <Td>{o.plan ?? <span className="text-slate-400">none</span>}</Td>
              <Td>{o.state === "TRIAL" ? (o.trialEndsAt ? `trial to ${fmtDate(o.trialEndsAt)}` : "no end set") : fmtDate(o.paidUntil)}{o.cancelledAt ? <span className="ml-1 text-[11px] text-amber-700">cancelled</span> : null}</Td>
              <Td className="tabular-nums">{o.users}<span className="text-[11px] text-slate-400"> / {o.people}</span></Td>
              <Td className="tabular-nums">{o.projects}</Td>
              <Td className="tabular-nums">{bytes(o.storage)}</Td>
              <Td>{fmtDate(o.lastSeen)}</Td>
              <Td>{fmtDate(o.createdAt)}</Td>
            </tr>
          ))}
        </DataTable>
      </Sheet>
    </>
  );
}
