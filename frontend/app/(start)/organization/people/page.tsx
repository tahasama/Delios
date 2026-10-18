import Link from "next/link";
import { requireOrgAdmin } from "@/lib/core/org-scope";
import { DataTable, Th, Td } from "@/components/ui";
import { adminUsers } from "@/lib/settings/api-admin";
import { joinedProjects } from "@/lib/organization/api";
import { Sheet } from "../sheet";

export const dynamic = "force-dynamic";
export const metadata = { title: "People" };

/**
 * Everyone of ours: the projects each is on (ours, and other organizations'), two-step sign-in, and whether they may
 * sign in. Added, switched off and unlocked in a project's People & access.
 */
export default async function OrganizationPeoplePage() {
  const scope = await requireOrgAdmin();
  const [users, joined] = await Promise.all([adminUsers().catch(() => []), joinedProjects()]);
  const ours = users.filter((one) => one.internal).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  const elsewhereOf = (userId: string) => joined.filter((p) => p.ourPeople.some((one) => one.userId === userId && one.active));
  const activePeople = ours.filter((one) => one.active).length;

  return (
    <>
      <header className="register register-sheet register-sheet-open">
        <div className="px-5 pt-5 pb-4 sm:px-6">
          <h1 className="plate-title text-slate-950">People</h1>
          <p className="plate-meta mt-1.5 font-normal">
            {activePeople} of ours can sign in{ours.length - activePeople ? ` · ${ours.length - activePeople} switched off` : ""} · {ours.filter((u) => u.mfa).length} with two-step sign-in
          </p>
        </div>
      </header>
      <Sheet id="people" title="Everyone of ours" note="the projects each is on, ours and other organizations'"
        foot={scope.projectCount ? <>Add, switch off or unlock people in <Link href="/settings/users" className="font-semibold text-link hover:underline">People &amp; access</Link>. Switching someone off stops them on other organizations&rsquo; projects too.</> : undefined}>
          <DataTable className="rounded-none border-0 shadow-none" head={<tr><Th>Name</Th><Th>Email</Th><Th>Our projects</Th><Th>Other organizations&rsquo; projects</Th><Th>Two-step sign-in</Th><Th>Access</Th></tr>}>
            {ours.map((u) => (
              <tr key={u.id} id={`person-${u.id}`} className={u.active ? "scroll-mt-4 align-top target:bg-tint-soft" : "scroll-mt-4 align-top opacity-60 target:bg-tint-soft"}>
                <Td className="text-xs font-semibold text-slate-800">
                  {scope.projectCount ? <Link href={`/settings/users#person-${u.id}`} className="text-link hover:underline">{u.name}</Link> : u.name}{u.isAdmin ? <span className="ml-1 font-normal text-slate-400">· administrator</span> : null}</Td>
                <Td className="text-xs text-slate-500">{u.email}</Td>
                <Td className="text-xs">{u.memberships.filter((m) => m.active).map((m, i) => (
                  <span key={m.projectId}>{i ? ", " : ""}<a href={`/organization/projects#project-${m.projectId}`} className="hover:underline">{m.projectCode}</a> ({m.functionName})</span>
                ))}{u.memberships.some((m) => m.active) ? null : <span className="text-slate-400">—</span>}</Td>
                <Td className="text-xs">{elsewhereOf(u.id).map((p, i) => (
                  <span key={`${p.linkId}-${p.projectId}`}>{i ? ", " : ""}<a href={`/organization/projects#joined`} className="hover:underline">{p.code}</a> at {p.hostOrganization}</span>
                ))}{elsewhereOf(u.id).length ? null : <span className="text-slate-400">—</span>}</Td>
                <Td className="text-xs">{u.mfa ? "on" : <span className="text-slate-400">off</span>}</Td>
                <Td className="text-xs">{u.active ? (u.lockedUntil ? <span className="text-amber-700">locked</span> : "active") : "switched off"}</Td>
              </tr>
            ))}
          </DataTable>
      </Sheet>
    </>
  );
}
