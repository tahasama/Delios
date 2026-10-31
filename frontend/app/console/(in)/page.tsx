import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { consoleApi } from "@/lib/console/client";
import { bytes, STATE_WORDS } from "@/lib/console/types";
import { Plate, Sheet } from "./parts";

export const metadata = { title: "Overview" };

type Overview = {
  organizations: number; byState: Record<string, number>; users: number; people: number; projects: number; storage: number;
  productRequests: number; mergesToCarryOut: number; claimsWaiting: number; supportOpen: number; legalMustOpen: number; legalMust: number;
  renewingSoon: number;
};

/** Where DELIOS stands, across every organization, and what waits on the team. */
export default async function ConsoleOverview() {
  const o = await consoleApi<Overview>("/api/console/overview");
  const waits = [
    { n: o.legalMustOpen, href: "/console/legal", said: `of ${o.legalMust} legal matters that must be settled before the first paying customer are still open`, red: true },
    { n: o.mergesToCarryOut, href: "/console/requests#merges", said: "merges every side agreed to, to carry out" },
    { n: o.claimsWaiting, href: "/console/requests#claims", said: "claims on an organization's entry, waiting on its guest or whoever recorded it" },
    { n: o.byState.READ_ONLY ?? 0, href: "/console/organizations?state=READ_ONLY", said: "organizations reading only (not paid, trial ended)" },
    { n: o.renewingSoon, href: "/console/organizations", said: "yearly renewals in the next 30 days: told 30 days before, as promised" },
    { n: o.supportOpen, href: "/console/support", said: "organizations letting us in to help right now" },
    { n: o.productRequests, href: "/console/requests#products", said: "asks for something the app does not carry yet" },
  ];
  return (
    <>
      <Plate
        title="DELIOS, across every organization"
        meta="What each organization has with us, what they ask, and what the law asks of us. Their documents are never read here: only counted."
        figures={[
          { term: "Organizations", value: o.organizations, said: Object.entries(o.byState).filter(([, n]) => n).map(([s, n]) => `${n} ${STATE_WORDS[s]?.toLowerCase() ?? s}`).join(" · ") || "none yet" },
          { term: "Paid users", value: o.users, said: `of ${o.people} accounts; guests are free` },
          { term: "Projects", value: o.projects, said: "open, suspended and archived" },
          { term: "Storage", value: bytes(o.storage), said: "files kept, every revision's" },
        ]}
      />
      <Sheet title="What waits on us" said="each line opens where it is answered">
        <ul className="divide-y divide-line">
          {waits.map((w) => (
            <li key={w.href + w.said}>
              <Link href={w.href} className="group flex items-center gap-3 px-5 py-3 hover:bg-tint-soft sm:px-6">
                <span className={`w-10 text-right text-base font-semibold tabular-nums ${w.n && w.red ? "text-red-700" : w.n ? "text-slate-900" : "text-slate-400"}`}>{w.n}</span>
                <span className="flex-1 text-[13px] text-slate-700">{w.said}</span>
                <ArrowRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-link" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  );
}
