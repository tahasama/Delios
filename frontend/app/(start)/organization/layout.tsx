import { requireOrgAdmin } from "@/lib/core/org-scope";
import { OrgHeader } from "./org-header";
import { OrgNav } from "./org-nav";

/**
 * The organization's space (its administrators): one band, then the menu on the left and the page beside it, so every
 * page of the organization (its overview, its Settings and their cards, its projects, the organizations it works with,
 * the defaults for new projects) is one click from every other.
 */
export default async function OrganizationLayout({ children }: { children: React.ReactNode }) {
  const scope = await requireOrgAdmin();
  return (
    <div className="min-h-screen bg-canvas">
      <OrgHeader scope={scope} />
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:items-start lg:gap-6">
        <OrgNav inProjects={scope.projectCount > 0} />
        <main className="min-w-0 space-y-4">{children}</main>
      </div>
    </div>
  );
}
