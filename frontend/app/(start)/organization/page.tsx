import Link from "next/link";
import { requireOrgAdmin } from "@/lib/core/org-scope";
import { logoutAction } from "@/lib/account/forms-sign-in";
import { ActionForm } from "@/components/form";
import { Card, DataTable, Th, Td, Chip, Field, inputCls, btn } from "@/components/ui";
import { ArrowLeft, LogOut } from "lucide-react";
import { adminParties, adminProjects, adminUsers } from "@/lib/settings/api-admin";
import { organizationLinks, joinedProjects, guestAccounts } from "@/lib/organization/api";
import { projectDefaults } from "@/lib/organization/defaults";
import { acceptLinkAction, refuseLinkAction, endLinkAction, joinPersonAction, makeDefaultsAction, bringOverAction } from "@/lib/organization/forms";
import { PARTY_KINDS } from "@/lib/settings/party-kinds";
import { contractRoleOptions } from "@/lib/settings/contract-roles";
import { fmtDate } from "@/lib/core/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organization" };

/**
 * The organization's own page (docs/ORGANIZATIONS.md): its projects, ours and those of others we take part in; its
 * people; the organizations it works with and the invitations between them; the configuration a new project of ours
 * starts with; and the way to its sign-in rules and audit trail. Its administrators only. It needs no project: an
 * organization that only works on others' projects has it too.
 */
export default async function OrganizationPage() {
  const scope = await requireOrgAdmin();
  const [links, joined, projects, users, parties, defaults, roles] = await Promise.all([
    organizationLinks(),
    joinedProjects(),
    adminProjects().catch(() => []),
    adminUsers().catch(() => []),
    adminParties().catch(() => []),
    projectDefaults(),
    contractRoleOptions(),
  ]);
  const roleLabel = (code: string | null) => (code ? roles.find((r) => r.code === code)?.label ?? code : null);
  const received = links.filter((one) => one.side === "GUEST" && one.state === "INVITED");
  const ours = users.filter((one) => one.internal).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  const outside = parties.filter((one) => !one.isInternal).sort((a, b) => a.name.localeCompare(b.name));
  const kindLabel = (kind: string | null | undefined) =>
    PARTY_KINDS.find((k) => k.value === (kind === "NOT_ON_DELIOS" ? "OFFLINE" : kind))?.label ?? "—";
  /** Where each of our people works elsewhere: the projects of other organizations' they are on. */
  const elsewhereOf = (userId: string) => joined.filter((p) => p.ourPeople.some((one) => one.userId === userId && one.active));
  const history = links.filter((one) => one.state === "REFUSED" || one.state === "ENDED");
  // Guest accounts other organizations made for our people before we linked: brought over, they sign in here.
  const linkedAsGuest = links.filter((one) => one.side === "GUEST" && one.state === "LINKED");
  const guestsThere = new Map(await Promise.all(linkedAsGuest.map(async (one) => [one.id, await guestAccounts(one.id)] as const)));

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-4">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand text-sm font-black text-white">D</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-slate-900">{scope.organization.name}</p>
            <p className="text-[11px] text-slate-400">Organization · {scope.user.name}</p>
          </div>
          {scope.projectCount ? (
            <Link href="/" className={btn("ghost", "sm")}><ArrowLeft className="h-4 w-4" /> Back to projects</Link>
          ) : <Link href="/setup" className={btn("ghost", "sm")}><ArrowLeft className="h-4 w-4" /> Set up</Link>}
          <form action={logoutAction}><button type="submit" className={btn("ghost", "sm")}><LogOut className="h-4 w-4" /> Sign out</button></form>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-6 py-6">
        {received.length ? (
          <Card title={`Invitations waiting for your answer (${received.length})`}>
            <ul className="divide-y divide-line">
              {received.map((one) => (
                <li key={one.id} className="space-y-2 py-3">
                  <p className="text-sm text-slate-700">
                    <strong>{one.organization}</strong> invites us to work on its projects, with our own accounts. They know us as {one.partyName} ({one.partyCode}).
                    <span className="block text-[11px] text-slate-400">Sent {fmtDate(one.invitedAt)} by {one.invitedBy}</span>
                  </p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <ActionForm action={acceptLinkAction} submitLabel="Accept" size="sm" hidden={{ linkId: one.id }}>
                      <Field label="A note for them" hint="optional"><input name="note" className={inputCls} /></Field>
                    </ActionForm>
                    <ActionForm action={refuseLinkAction} submitLabel="Refuse" size="sm" variant="secondary" hidden={{ linkId: one.id }}>
                      <Field label="Why" required><input name="note" required className={inputCls} /></Field>
                    </ActionForm>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Card title="Projects">
          <p className="mb-3 text-xs text-slate-500">Ours, opened by us, and those of other organizations we take part in.</p>
          <DataTable head={<tr><Th>Project</Th><Th>Whose</Th><Th>Our role</Th><Th>Status</Th><Th>Our people on it</Th></tr>}>
            {projects.map((p) => (
              <tr key={p.id}>
                <Td><span className="font-mono text-xs font-semibold">{p.code}</span> <span className="text-xs text-slate-600">{p.name}</span></Td>
                <Td className="text-xs">ours</Td>
                <Td className="text-xs">{roleLabel(p.contractRole === "GENERIC" ? null : p.contractRole) ?? <span className="text-slate-400">not stated</span>}</Td>
                <Td className="text-xs">{p.status.toLowerCase()}</Td>
                <Td className="tabular-nums text-xs">{p.members}</Td>
              </tr>
            ))}
            {joined.map((p) => (
              <tr key={`${p.linkId}-${p.projectId}`} className="align-top">
                <Td><span className="font-mono text-xs font-semibold">{p.code}</span> <span className="text-xs text-slate-600">{p.name}</span></Td>
                <Td className="text-xs">{p.hostOrganization}</Td>
                <Td className="text-xs">{roleLabel(p.role) ?? <span className="text-slate-400">not stated</span>}</Td>
                <Td className="text-xs">{p.status.toLowerCase()}</Td>
                <Td className="text-xs">
                  {p.ourPeople.length ? (
                    <ul className="space-y-1">
                      {p.ourPeople.map((person) => (
                        <li key={person.userId} className="flex flex-wrap items-center gap-2">
                          <span className={person.active ? "text-slate-700" : "text-slate-400 line-through"}>{person.name}</span>
                          <span className="text-[11px] text-slate-400">{person.function}</span>
                          {person.active ? (
                            <ActionForm action={joinPersonAction} hideSubmit hidden={{ linkId: p.linkId, projectId: p.projectId, userId: person.userId, active: "off" }} className="space-y-0">
                              <button className="text-[11px] font-semibold text-link hover:underline">take off</button>
                            </ActionForm>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : <span className="text-slate-400">nobody yet</span>}
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[11px] font-semibold text-link">+ Put someone of ours on it</summary>
                    <div className="mt-2 w-72">
                      {p.startFunction ? (
                        <ActionForm action={joinPersonAction} submitLabel="Put on the project" size="sm" hidden={{ linkId: p.linkId, projectId: p.projectId }}>
                          <Field label="Who" required>
                            <select name="userId" required defaultValue="" className={inputCls}>
                              <option value="" disabled>Choose…</option>
                              {ours.filter((u) => u.active && !p.ourPeople.some((one) => one.userId === u.id && one.active)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                            </select>
                          </Field>
                          <p className="text-[11px] text-slate-400">They work there as {p.startFunction}, signing in here as usual. {p.hostOrganization} may change it.</p>
                        </ActionForm>
                      ) : <p className="text-[11px] text-amber-700">{p.hostOrganization} has not said yet which function our people hold there.</p>}
                    </div>
                  </details>
                </Td>
              </tr>
            ))}
          </DataTable>
          {!projects.length && !joined.length ? <p className="text-xs text-slate-500">No project yet.</p> : null}
        </Card>

        <Card title={`People (${ours.filter((one) => one.active).length})`}>
          <DataTable head={<tr><Th>Name</Th><Th>Email</Th><Th>Our projects</Th><Th>Other organizations&rsquo; projects</Th><Th>Two-step sign-in</Th><Th>Access</Th></tr>}>
            {ours.map((u) => (
              <tr key={u.id} className={u.active ? "align-top" : "align-top opacity-60"}>
                <Td className="text-xs font-semibold text-slate-800">{u.name}{u.isAdmin ? <span className="ml-1 font-normal text-slate-400">· administrator</span> : null}</Td>
                <Td className="text-xs text-slate-500">{u.email}</Td>
                <Td className="text-xs">{u.memberships.filter((m) => m.active).map((m) => `${m.projectCode} (${m.functionName})`).join(", ") || <span className="text-slate-400">—</span>}</Td>
                <Td className="text-xs">{elsewhereOf(u.id).map((p) => `${p.code} at ${p.hostOrganization}`).join(", ") || <span className="text-slate-400">—</span>}</Td>
                <Td className="text-xs">{u.mfa ? "on" : <span className="text-slate-400">off</span>}</Td>
                <Td className="text-xs">{u.active ? (u.lockedUntil ? <span className="text-amber-700">locked</span> : "active") : "switched off"}</Td>
              </tr>
            ))}
          </DataTable>
          {scope.projectCount ? <p className="mt-2 text-[11px] text-slate-400">Add, switch off or unlock people in <Link href="/settings/users" className="font-semibold text-link hover:underline">People &amp; access</Link>. Switching someone off here stops them on other organizations&rsquo; projects too.</p> : null}
        </Card>

        <Card title="Organizations we work with">
          <DataTable head={<tr><Th>Organization</Th><Th>How they work with us</Th><Th>Their DELIOS</Th></tr>}>
            {outside.map((p) => (
              <tr key={p.id} className={p.active ? "" : "opacity-60"}>
                <Td><span className="font-mono text-xs font-semibold">{p.code}</span> <span className="text-xs text-slate-600">{p.name}</span></Td>
                <Td className="text-xs">{kindLabel(p.kind)}</Td>
                <Td className="text-xs">{p.link ? (p.link.state === "LINKED" ? `linked to ${p.link.organization}` : `invited; ${p.link.organization} has not answered`) : <span className="text-slate-400">not linked</span>}</Td>
              </tr>
            ))}
            {links.filter((one) => one.side === "GUEST" && one.state === "LINKED").map((one) => (
              <tr key={one.id}>
                <Td className="text-xs text-slate-600">{one.organization}</Td>
                <Td className="text-xs">we work on their projects</Td>
                <Td className="text-xs">
                  linked since {fmtDate(one.answeredAt)}
                  {guestsThere.get(one.id)?.length ? (
                    <div className="mt-2 rounded-lg bg-tint-soft p-2">
                      <p className="text-[11px] text-slate-600">Guest accounts {one.organization} made for our people before we linked. Brought over, they sign in here with the same password and keep their projects there.</p>
                      <ul className="mt-1 space-y-1">
                        {guestsThere.get(one.id)!.map((guest) => (
                          <li key={guest.id} className="flex items-center justify-between gap-2">
                            <span className="text-[11px] text-slate-700">{guest.name} <span className="text-slate-400">{guest.email}</span></span>
                            <ActionForm action={bringOverAction} hideSubmit hidden={{ linkId: one.id, guestId: guest.id }} className="space-y-0">
                              <button className="text-[11px] font-semibold text-link hover:underline">bring over</button>
                            </ActionForm>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <details className="mt-1"><summary className="cursor-pointer text-[11px] font-semibold text-link">End the link</summary>
                    <div className="mt-2 w-72">
                      <ActionForm action={endLinkAction} submitLabel="End the link" size="sm" variant="secondary" hidden={{ linkId: one.id }}>
                        <p className="text-[11px] text-slate-500">Our people stop working on {one.organization}&rsquo;s projects. Everything they did there stays there.</p>
                        <Field label="Why" required><input name="note" required className={inputCls} /></Field>
                      </ActionForm>
                    </div>
                  </details>
                </Td>
              </tr>
            ))}
          </DataTable>
          {history.length ? (
            <details className="mt-3"><summary className="cursor-pointer text-xs font-semibold text-link">Refused and ended ({history.length})</summary>
              <ul className="mt-2 space-y-1.5 text-xs text-slate-600">
                {history.map((one) => (
                  <li key={one.id}>
                    <Chip className="bg-slate-100 text-slate-600 ring-slate-200">{one.state.toLowerCase()}</Chip>{" "}
                    {one.side === "HOST" ? `${one.partyName} (${one.organization})` : one.organization}
                    {one.state === "REFUSED"
                      ? <> · refused {fmtDate(one.answeredAt)} by {one.answeredBy}{one.answerNote ? <>: {one.answerNote}</> : null}</>
                      : <> · ended {fmtDate(one.endedAt)} by {one.endedBy}: {one.endReason}</>}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {scope.projectCount ? <p className="mt-2 text-[11px] text-slate-400">Add organizations, invite them to link, and say which take part in each project in <Link href="/settings/parties" className="font-semibold text-link hover:underline">Organizations</Link>.</p> : null}
        </Card>

        <Card title="Defaults for new projects">
          <p className="text-xs text-slate-600">
            {defaults
              ? <>New projects start with {defaults.fromProject}&rsquo;s choices (who does what, how the project works), set {fmtDate(defaults.at)} by {defaults.by}: {Object.keys(defaults.values).length} answers.</>
              : "No defaults yet: a new project starts with the app's own."}
            {" "}Each project then changes them freely; changing the defaults never changes a project already open. A project of another organization&rsquo;s follows its owner.
          </p>
          {projects.length ? (
            <div className="mt-3 max-w-md">
              <ActionForm action={makeDefaultsAction} submitLabel="Make its choices the defaults" size="sm">
                <Field label="Project" required>
                  <select name="projectId" required defaultValue="" className={inputCls}>
                    <option value="" disabled>Choose…</option>
                    {projects.filter((p) => p.status === "ACTIVE").map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                  </select>
                </Field>
              </ActionForm>
            </div>
          ) : null}
        </Card>

        {scope.projectCount ? (
          <Card title="Sign-in and audit">
            <p className="text-xs text-slate-600">
              <Link href="/settings/security" className="font-semibold text-link hover:underline">Sign-in &amp; security</Link> — the rules for everyone in {scope.organization.name}.{" "}
              <Link href="/settings/audit" className="font-semibold text-link hover:underline">Audit trail</Link> — every recorded act, across our projects.
            </p>
          </Card>
        ) : null}
      </main>
    </div>
  );
}
