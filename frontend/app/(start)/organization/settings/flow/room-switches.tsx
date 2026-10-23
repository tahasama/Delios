import { LibertyRow } from "../liberty-row";
import type { LibertyItem } from "@/lib/organization/liberty";

/**
 * On the organization's Control room, under a step's answers: whether projects may change them (owner, two levels),
 * each switch beside what it covers. Fixed: every project uses the organization's; Free: a project may change its own.
 */
export function RoomSwitches({ items }: { items: LibertyItem[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className="stencil mb-2 text-slate-500">Projects may change it</h3>
      <ul className="divide-y divide-line">
        {items.map((one) => (
          <LibertyRow key={one.key} item={one} className="py-3 first:pt-0 last:pb-0">
            <span className="block text-[13px] font-medium text-slate-900">{one.title}</span>
            <span className="block text-xs leading-5 text-slate-600">
              {one.locked ?? (one.free ? "Free: a project may change its own; changes here never touch it." : "Fixed: every project uses the organization's as it is.")}
            </span>
          </LibertyRow>
        ))}
      </ul>
    </div>
  );
}
