import Link from "next/link";
import { switchOrganizationAction } from "@/lib/organization/forms";
import { elsewhere, organizationLinks } from "@/lib/organization/api";

/**
 * Before a project of our own exists: the projects of other organizations' this person works on with their own
 * sign-in, and, for an administrator, invitations from other organizations waiting for an answer.
 */
export async function ElsewhereCard({ admin }: { admin: boolean }) {
  const [others, links] = await Promise.all([elsewhere(), admin ? organizationLinks() : Promise.resolve([])]);
  const waiting = links.filter((one) => one.side === "GUEST" && one.state === "INVITED");
  const projects = others.filter((one) => !one.home && one.projects.length);
  if (!projects.length && !waiting.length) return null;
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      {waiting.length ? (
        <p className="text-sm text-slate-700">
          {waiting.map((one) => one.organization).join(", ")} {waiting.length === 1 ? "invites" : "invite"} you to work on their projects.{" "}
          <Link href="/organization" className="font-semibold text-link hover:underline">Answer on your organization&rsquo;s page</Link>
        </p>
      ) : null}
      {projects.length ? (
        <div className={waiting.length ? "mt-4 border-t border-line pt-4" : undefined}>
          <h2 className="text-sm font-semibold text-slate-900">Projects you work on in other organizations</h2>
          <ul className="mt-2 divide-y divide-line">
            {projects.flatMap((other) => other.projects.map((project) => (
              <li key={project.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 text-xs">
                  <span className="font-semibold text-slate-800">{project.name}</span>
                  <span className="block text-[11px] text-slate-400">{project.code} · {other.organization}</span>
                </span>
                <form action={switchOrganizationAction}>
                  <input type="hidden" name="tenantId" value={other.tenantId} />
                  <input type="hidden" name="projectId" value={project.id} />
                  <button type="submit" className="ask">Open</button>
                </form>
              </li>
            )))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
