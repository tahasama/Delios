import Link from "next/link";
import { consoleApi } from "@/lib/console/client";
import type { OperatorEvent } from "@/lib/console/types";
import { fmtDateTime } from "@/lib/core/utils";
import { Nothing, Plate, Sheet } from "../parts";

export const metadata = { title: "Log" };

/** Everything the team did in the console, kept for good, 100 at a time. */
export default async function Log({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const { before } = await searchParams;
  const events = await consoleApi<OperatorEvent[]>(`/api/console/log${before ? `?before=${encodeURIComponent(before)}` : ""}`);
  return (
    <>
      <Plate title="Log" meta="Every act of the team in the console: sign-ins, contracts changed, texts published, merges carried out, notices sent." />
      <Sheet title="Acts" said="newest first">
        {events.length ? (
          <ul className="divide-y divide-line">
            {events.map((e) => (
              <li key={e.id} className="px-5 py-2.5 text-[12px] text-slate-700 sm:px-6">
                <span className="font-medium text-slate-900">{e.action.replaceAll("_", " ").toLowerCase()}</span> · {e.operatorName} · {fmtDateTime(e.at)}
                {e.tenantId ? <> · <Link href={`/console/organizations/${e.tenantId}`} className="text-link hover:underline">the organization</Link></> : null}
                {e.detail ? <span className="block whitespace-pre-line text-slate-600">{e.detail}</span> : null}
              </li>
            ))}
          </ul>
        ) : <Nothing>Nothing yet.</Nothing>}
        {events.length === 100 ? (
          <div className="border-t border-line px-5 py-2.5 sm:px-6"><Link href={`/console/log?before=${encodeURIComponent(events[events.length - 1].at)}`} className="text-[13px] font-semibold text-link hover:underline">Earlier acts</Link></div>
        ) : null}
      </Sheet>
    </>
  );
}
