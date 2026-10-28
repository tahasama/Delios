import { requireInternalScope } from "@/lib/core/scope";
import { controlDoes } from "@/lib/settings/control-activities";
import { SettingsNav } from "@/components/settings-nav";
import { SETUP_GROUPS, SETUP_PAGES, maySetup } from "./setup-pages";
import { SettingsCrumb } from "./crumb";

/**
 * Every settings screen sits under Settings, with the side menu beside it (owner: a side menu rather than cards): the
 * overview, then every page this person opens, by group. A screen deeper than a page still says its way back.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Settings are our own organization's; another organization never reaches them.
  const ctx = await requireInternalScope();
  const managementAddsPeople = await controlDoes(ctx, "PROJECT_PEOPLE").then((dc) => !dc).catch(() => false);
  const items = SETUP_PAGES.filter((p) => maySetup(ctx.user, p, managementAddsPeople))
    .map((p) => ({ href: p.href, title: p.title, text: p.text, group: p.group }));
  return (
    <div className="lg:flex lg:items-start lg:gap-5">
      <SettingsNav home="/settings" items={items} groups={SETUP_GROUPS} label="Settings" />
      <div className="min-w-0 flex-1 space-y-3">
        <SettingsCrumb pages={SETUP_PAGES.map((p) => ({ href: p.href, title: p.title }))} />
        {children}
      </div>
    </div>
  );
}
