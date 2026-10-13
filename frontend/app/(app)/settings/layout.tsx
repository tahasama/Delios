import { requireInternalScope } from "@/lib/scope";
import { SETUP_PAGES } from "./setup-pages";
import { SettingsCrumb } from "./crumb";

/**
 * Every settings screen sits under Settings, and says so. Written once, here,
 * so a new screen cannot be added without its way back — which is how people
 * ended up several clicks deep with nothing but the browser's back button.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Settings are our own organization's; another organization never reaches them.
  await requireInternalScope();
  return (
    <div className="space-y-3">
      <SettingsCrumb pages={SETUP_PAGES.map((p) => ({ href: p.href, title: p.title }))} />
      {children}
    </div>
  );
}
