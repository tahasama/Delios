import { ToneChip } from "@/components/ui";
import { fmtDate } from "@/lib/core/utils";

type Worked = {
  id: string; code: string; name: string; status: string; role: string | null; active: boolean; contractNumber: string | null;
  joinedAt: string; startDate: string | null; endDate: string | null; lastSeenAt?: string | null;
};

/**
 * An organization's card, opened under its line on Organizations (owner: in place, no page of its own). Its dates are
 * per project (owner), so it is one line per project it worked on with us: its role and contract there, when it joined
 * (the earliest of being put on it and its people first coming), its people's last act there, and the project's own
 * start and planned end. Nothing is summed across projects.
 */
export function PartyCard({ worked, linkedAt, roleLabel }: {
  worked: Worked[]; linkedAt: string | null; roleLabel: (code: string | null) => string | null;
}) {
  const cell = "px-5 py-2.5 sm:first:pl-6 sm:last:pr-6";
  const stands = (w: Worked) =>
    !w.active ? <ToneChip tone="idle">left it</ToneChip>
      : w.status === "ARCHIVED" ? <ToneChip tone="idle">archived</ToneChip>
      : w.status === "ON_HOLD" ? <ToneChip tone="waiting">suspended</ToneChip>
      : <ToneChip tone="done">active</ToneChip>;

  return (
    <div className="border-t border-line">
      {linkedAt ? <p className="px-5 pt-3 text-[11px] text-slate-500 sm:px-6">Works from its own DELIOS since {fmtDate(linkedAt)}.</p> : null}
      {worked.length ? (
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-slate-500">
              {["Project", "Role here", "Contract", "Joined", "Last active", "Project start → planned end", ""].map((h, i) => (
                <th key={i} className={`stencil font-normal ${cell}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line border-t border-line bg-surface">
            {worked.map((w) => (
              <tr key={w.id} className={w.active ? undefined : "opacity-60"}>
                <td className={cell}><code className="code-chip mr-1.5">{w.code}</code><span className="font-medium text-slate-800">{w.name}</span></td>
                <td className={cell}>{roleLabel(w.role) ?? <span className="text-slate-500">not stated</span>}</td>
                <td className={`${cell} font-mono`}>{w.contractNumber ?? <span className="font-sans text-slate-500">—</span>}</td>
                <td className={`${cell} whitespace-nowrap`}>{fmtDate(w.joinedAt)}</td>
                <td className={`${cell} whitespace-nowrap`}>{w.lastSeenAt ? fmtDate(w.lastSeenAt) : <span className="text-slate-500">nothing done yet</span>}</td>
                <td className={`${cell} whitespace-nowrap text-slate-600`}>
                  {w.startDate ? fmtDate(w.startDate) : "not set"} <span className="text-slate-400">→</span> {w.endDate ? fmtDate(w.endDate) : "not set"}
                </td>
                <td className={`${cell} text-right`}>{stands(w)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="px-5 py-3 text-xs text-slate-500 sm:px-6">Not on a project of ours yet.</p>}
    </div>
  );
}
