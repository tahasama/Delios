import { Switch } from "@/components/switch";
import { setLibertyAction } from "@/lib/organization/forms";
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
          <li key={one.key} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-slate-900">{one.title}</span>
              <span className="block text-xs leading-5 text-slate-600">
                {one.locked ?? (one.free ? "Free: a project may change its own; changes here never touch it." : "Fixed: every project uses the organization's as it is.")}
              </span>
            </span>
            <form action={setLibertyAction} className="shrink-0">
              <input type="hidden" name="key" value={one.key} />
              <input type="hidden" name="free" value={one.free ? "0" : "1"} />
              <Switch on={one.free} words={["Free", "Fixed"]} disabled={!!one.locked} label={one.free ? `Fix ${one.title} for every project` : `Let projects change ${one.title}`} />
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
