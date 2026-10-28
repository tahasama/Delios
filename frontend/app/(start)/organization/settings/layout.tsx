import { SettingsNav } from "@/components/settings-nav";
import { SETUP_GROUPS, SETUP_PAGES } from "@/app/(app)/settings/setup-pages";
import { ORG_CARDS } from "./cards";

/** The organization's Settings with the same side menu as a project's: the overview, then every card, by group. */
export default function OrgSettingsLayout({ children }: { children: React.ReactNode }) {
  const groupOf = (card: (typeof ORG_CARDS)[number]) => card.group ?? SETUP_PAGES.find((p) => p.href === card.project)?.group ?? "Organization";
  const items = ORG_CARDS.map((card) => ({
    href: card.slug ? `/organization/settings/${card.slug}` : card.elsewhere!,
    title: card.title, text: card.text, group: groupOf(card), icon: card.project,
  }));
  return (
    <div className="min-[1440px]:flex min-[1440px]:items-start min-[1440px]:gap-5">
      <SettingsNav mode="column" top="none" home="/organization/settings" items={items} groups={SETUP_GROUPS} label="The organization's Settings" />
      <div className="min-w-0 flex-1 space-y-4">
        <SettingsNav mode="switcher" top="none" home="/organization/settings" items={items} groups={SETUP_GROUPS} label="The organization's Settings" />
        {children}
      </div>
    </div>
  );
}
