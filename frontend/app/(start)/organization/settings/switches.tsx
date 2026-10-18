import { Switch } from "@/components/switch";
import { setLibertyAction } from "@/lib/organization/forms";
import { fmtDate } from "@/lib/core/utils";
import type { LibertyItem } from "@/lib/organization/liberty";

/**
 * The switches of one card of the organization's Settings, on the card itself: may projects change it? Fixed (every
 * project uses the organization's as it is) or Free (a project may take its own copy). Worked out by the backend
 * (`Settings/Liberty.cs`); moving one never undoes what a project already changed.
 */
export function ProjectSwitches({ items, title = "Projects may change it" }: { items: LibertyItem[]; title?: string }) {
  if (!items.length) return null;
  return (
    <section className="register register-sheet register-sheet-open">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
        <span className="stencil mr-1 text-slate-500">{title}</span>
        <span className="text-[11px] text-slate-500">
          fixed: every project uses the organization&rsquo;s as it is · free: a project may take its own copy, which changes here never touch
        </span>
      </div>
      <ul className="divide-y divide-line">
        {items.map((one) => (
          <li key={one.key} className="flex items-center gap-4 px-5 py-2.5 sm:px-6">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-slate-800">{one.title}</p>
              <p className="text-[11.5px] leading-4 text-slate-500">
                {one.locked ?? one.why}
                {one.changedAt
                  ? <> · changed {fmtDate(one.changedAt)} by {one.changedBy}{one.free === one.freeByDefault ? "" : `, the app starts it ${one.freeByDefault ? "free" : "fixed"}`}</>
                  : null}
              </p>
            </div>
            <form action={setLibertyAction}>
              <input type="hidden" name="key" value={one.key} />
              <input type="hidden" name="free" value={one.free ? "0" : "1"} />
              <Switch on={one.free} words={["Free", "Fixed"]} disabled={!!one.locked} label={one.free ? `Fix ${one.title} for every project` : `Let projects change ${one.title}`} />
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
