import { ToneChip } from "@/components/ui";
import { fmtDate } from "@/lib/core/utils";

type Worked = {
  id: string; code: string; name: string; status: string; role: string | null; active: boolean; contractNumber: string | null;
  joinedAt: string; startDate: string | null; endDate: string | null; lastSeenAt?: string | null;
};

/**
 * An organization's card, opened under its line on Organizations (owner: in place, no page of its own): when it joined
 * us, when its work with us starts and finishes (its projects' own dates), and every project it worked on with us.
 */
export function PartyCard({ worked, linkedAt, kind, roleLabel, ours }: {
  worked: Worked[]; linkedAt: string | null; kind: string | null; roleLabel: (code: string | null) => string | null; ours: boolean;
}) {
  const joined = worked.length ? worked.reduce((a, b) => (a.joinedAt < b.joinedAt ? a : b)).joinedAt : null;
  const starts = worked.map((w) => w.startDate).filter((d): d is string => !!d).sort();
  const ends = worked.map((w) => w.endDate).filter((d): d is string => !!d).sort();
  const stillOpen = worked.some((w) => !w.endDate);
  const lastSeen = worked.map((w) => w.lastSeenAt).filter((d): d is string => !!d).sort().pop() ?? null;
  const fact = (term: string, value: React.ReactNode, said?: string) => (
    <div className="px-5 py-3 sm:px-6">
      <dt className="stencil text-slate-500">{term}</dt>
      <dd className="mt-1 text-[13px] font-medium text-slate-900">{value}</dd>
      {said ? <dd className="text-[11px] text-slate-500">{said}</dd> : null}
    </div>
  );

  return (
    <div className="border-t border-line">
      <dl className="grid grid-cols-1 divide-y divide-line sm:grid-cols-5 sm:divide-x sm:divide-y-0">
        {fact("Joined", joined ? fmtDate(joined) : "—", ours ? "on our first project" : linkedAt ? `from its own DELIOS since ${fmtDate(linkedAt)}` : kind ?? undefined)}
        {fact("Start", starts.length ? fmtDate(starts[0]) : "—", "its first project's start")}
        {fact("Finish", ends.length && !stillOpen ? fmtDate(ends[ends.length - 1]) : stillOpen && worked.length ? "Not set" : "—",
          stillOpen && worked.length ? "a project has no planned end" : "its last project's planned end")}
        {fact("Last active", lastSeen ? fmtDate(lastSeen) : ours ? "—" : "Not yet", "its people's last act on a project of ours")}
        {fact("Projects", worked.length ? `${worked.length}` : "None yet", worked.length ? `${worked.filter((w) => w.status !== "ARCHIVED").length} open` : "not on a project of ours")}
      </dl>
      {worked.length ? (
        <table className="w-full border-t border-line text-left text-xs">
          <thead>
            <tr className="text-slate-500">
              {["Project", "Role here", "Contract", "From (joined)", "Until (last act)", "Project's dates", ""].map((h, i) => (
                <th key={i} className="stencil px-5 py-2 font-normal sm:first:pl-6">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line border-t border-line bg-surface">
            {worked.map((w) => (
              <tr key={w.id} className={w.active ? undefined : "opacity-60"}>
                <td className="px-5 py-2 sm:pl-6"><code className="code-chip mr-1.5">{w.code}</code><span className="font-medium text-slate-800">{w.name}</span></td>
                <td className="px-5 py-2">{roleLabel(w.role) ?? <span className="text-slate-500">not stated</span>}</td>
                <td className="px-5 py-2 font-mono">{w.contractNumber ?? <span className="font-sans text-slate-500">—</span>}</td>
                <td className="px-5 py-2 whitespace-nowrap">{fmtDate(w.joinedAt)}</td>
                <td className="px-5 py-2 whitespace-nowrap">{w.lastSeenAt ? fmtDate(w.lastSeenAt) : <span className="text-slate-500">nothing done yet</span>}</td>
                <td className="px-5 py-2 whitespace-nowrap text-slate-600">
                  {w.startDate ? fmtDate(w.startDate) : "—"} <span className="text-slate-400">→</span> {w.endDate ? fmtDate(w.endDate) : "no end set"}
                </td>
                <td className="px-5 py-2 text-right">
                  {!w.active ? <ToneChip tone="idle">left it</ToneChip> : w.status === "ARCHIVED" ? <ToneChip tone="idle">archived</ToneChip> : <ToneChip tone="done">open</ToneChip>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
