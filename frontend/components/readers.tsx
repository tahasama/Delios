import { ToneChip } from "@/components/ui";
import type { Reader, ReaderCost } from "@/lib/settings/viewers";

const COST: Record<ReaderCost, { words: string; tone: "idle" | "waiting" | "moving" }> = {
  FREE: { words: "Free", tone: "idle" },
  HEAVY: { words: "Heavy on the server", tone: "waiting" },
  PAID: { words: "Paid", tone: "moving" },
};

/** One reader's line (organization's and project's Viewing files): what it shows and what it costs, its switch on the right. */
export function ReaderLine({ reader, children, under }: { reader: Pick<Reader, "title" | "shows" | "said" | "cost">; children: React.ReactNode; under?: React.ReactNode }) {
  const cost = COST[reader.cost];
  return (
    <li className="px-5 py-3 sm:px-6">
      <div className="grid grid-cols-1 items-center gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
            {reader.title}
            <span className="text-xs font-normal text-slate-500">{reader.shows}</span>
            {reader.cost !== "FREE" ? <ToneChip tone={cost.tone}>{cost.words}</ToneChip> : null}
          </p>
          <p className="text-xs leading-5 text-slate-600">{reader.said}</p>
        </div>
        <div className="justify-self-start sm:justify-self-end">{children}</div>
      </div>
      {under}
    </li>
  );
}
