import Link from "next/link";
import { requireOrgAdmin } from "@/lib/core/org-scope";
import { ActionForm } from "@/components/form";
import { DataTable, Th, Td, Chip, Field, inputCls } from "@/components/ui";
import { adminParties, adminProjects, adminUsers } from "@/lib/settings/api-admin";
import { organizationLinks, joinedProjects, guestAccounts, ownIdentity, claims, merges } from "@/lib/organization/api";
import { WhoWeAre } from "./identity";
import { projectDefaults } from "@/lib/organization/defaults";
import { acceptLinkAction, refuseLinkAction, endLinkAction, joinPersonAction, bringOverAction, switchOrganizationAction } from "@/lib/organization/forms";
import { switchProjectAction } from "@/lib/settings/forms-project-switch";
import { POLICIES, effectiveAnswer } from "@/lib/settings/control-activities";
import { liberty } from "@/lib/organization/liberty";
import { TrackingSheet } from "./tracking";
import { orgSettings } from "@/lib/settings/api";
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
  const [links, joined, projects, users, parties, defaults, roles, answers, own, claimable, mergeList] = await Promise.all([
    organizationLinks(),
    joinedProjects(),
    adminProjects().catch(() => []),
    adminUsers().catch(() => []),
    adminParties().catch(() => []),
    projectDefaults(),
    contractRoleOptions(),
    orgSettings().catch(() => new Map<string, string>()),
    ownIdentity(), claims(), merges(),
  ]);
  const switches = await liberty();
  const freeCount = switches.filter((one) => one.free).length;
  const roleLabel = (code: string | null) => (code ? roles.find((r) => r.code === code)?.label ?? code : null);
  const received = links.filter((one) => one.side === "GUEST" && one.state === "INVITED");
  const ours = users.filter((one) => one.internal).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  const outside = parties.filter((one) => !one.isInternal).sort((a, b) => a.name.localeCompare(b.name));
  const kindLabel = (kind: string | null | undefined) =>
    PARTY_KINDS.find((k) => k.value === (kind === "NOT_ON_DELIOS" ? "OFFLINE" : kind))?.label ?? "—";
  /** Where each of our people works elsewhere: the projects of other organizations' they are on. */
  const elsewhereOf = (userId: string) => joined.filter((p) => p.ourPeople.some((one) => one.userId === userId && one.active));
  /** I am on this project of ours: opening it is one click. */
  const onIt = (projectId: string) => users.some((one) => one.id === scope.user.id && one.memberships.some((m) => m.active && m.projectId === projectId));
  const changedCount = Object.entries(defaults?.values ?? {}).filter(([key, value]) => value !== effectiveAnswer(key, null)).length;
  const history = links.filter((one) => one.state === "REFUSED" || one.state === "ENDED");
  // Guest accounts other organizations made for our people before we linked: brought over, they sign in here.
  const linkedAsGuest = links.filter((one) => one.side === "GUEST" && one.state === "LINKED");
  const guestsThere = new Map(await Promise.all(linkedAsGuest.map(async (one) => [one.id, await guestAccounts(one.id)] as const)));

  const activePeople = ours.filter((one) => one.active).length;
  const linkTo = (href: string, label: string) => <Link href={href} className="text-[11.5px] font-semibold text-link hover:underline">{label}</Link>;

  return (
    <>
      <header className="register register-sheet register-sheet-open">
        <div className="flex flex-col gap-3 px-5 pt-5 pb-4 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            {own ? <p className="font-mono text-[12.5px] font-semibold tracking-tight text-slate-500">{own.code}</p> : null}
            <h1 className="plate-name mt-1 min-w-0">{scope.organization.name}</h1>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
              The organization: its projects and those of others it works on, its people, the organizations it works with, and how every project starts.
            </p>
          </div>
          <Link href="/organization/projects?new=1" className="ask shrink-0 self-start">Open a new project</Link>
        </div>
        <dl className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4 [&>div]:bg-surface">
          <div className="px-5 py-3 sm:px-6">
            <dt className="stencil text-slate-500">Our projects</dt>
            <dd className="mt-1 text-[13px] font-medium tabular-nums text-slate-900">{projects.filter((p) => p.status === "ACTIVE").length} open</dd>
            <dd className="text-[11px] text-slate-500">{projects.filter((p) => p.status !== "ACTIVE").length} archived</dd>
          </div>
          <div className="px-5 py-3 sm:px-6">
            <dt className="stencil text-slate-500">Others&rsquo; projects</dt>
            <dd className="mt-1 text-[13px] font-medium tabular-nums text-slate-900">{joined.length}</dd>
            <dd className="text-[11px] text-slate-500">we take part in</dd>
          </div>
          <div className="px-5 py-3 sm:px-6">
            <dt className="stencil text-slate-500">People</dt>
            <dd className="mt-1 text-[13px] font-medium tabular-nums text-slate-900">{activePeople}</dd>
            <dd className="text-[11px] text-slate-500">{ours.length - activePeople ? `${ours.length - activePeople} switched off` : "all can sign in"}</dd>
          </div>
          <div className="px-5 py-3 sm:px-6">
            <dt className="stencil text-slate-500">We work with</dt>
            <dd className="mt-1 text-[13px] font-medium tabular-nums text-slate-900">{outside.filter((p) => p.active).length} organizations</dd>
            <dd className="text-[11px] text-slate-500">{received.length ? `${received.length} invitation${received.length === 1 ? "" : "s"} to answer` : "no invitation waiting"}</dd>
          </div>
        </dl>
      </header>

      {received.length ? (
        <Sheet title={`Invitations waiting for your answer (${received.length})`} note="another organization asks us to work on its projects" tone="waiting">
          <ul className="divide-y divide-line [&>li]:px-5 sm:[&>li]:px-6">
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
        </Sheet>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          <Sheet id="projects" title="Projects" note="ours, and those of other organizations we take part in" act={linkTo("/organization/projects", "Open, change or archive")}>
          <DataTable className="rounded-none border-0 shadow-none" head={<tr><Th>Project</Th><Th>Whose</Th><Th>Our role</Th><Th>Status</Th><Th>Our people on it</Th></tr>}>
            {projects.map((p) => (
              <tr key={p.id} id={`project-${p.id}`} className="scroll-mt-4 target:bg-tint-soft">
                <Td>
                  {onIt(p.id) ? (
                    <form action={switchProjectAction}>
                      <input type="hidden" name="projectId" value={p.id} />
                      <button type="submit" className="text-left hover:underline" title={`Open ${p.code}`}>
                        <span className="font-mono text-xs font-semibold text-link">{p.code}</span> <span className="text-xs text-slate-600">{p.name}</span>
                      </button>
                    </form>
                  ) : (
                    <><span className="font-mono text-xs font-semibold">{p.code}</span> <span className="text-xs text-slate-600">{p.name}</span>
                      <span className="block text-[11px] text-slate-400">you are not on it</span></>
                  )}
                </Td>
                <Td className="text-xs">ours</Td>
                <Td className="text-xs">{roleLabel(p.contractRole === "GENERIC" ? null : p.contractRole) ?? <span className="text-slate-400">not stated</span>}</Td>
                <Td className="text-xs">{p.status.toLowerCase()}</Td>
                <Td className="tabular-nums text-xs">{scope.projectCount ? <Link href={`/settings/users?project=${p.id}`} className="text-link hover:underline">{p.members}</Link> : p.members}</Td>
              </tr>
            ))}
            {joined.map((p) => (
              <tr key={`${p.linkId}-${p.projectId}`} id={`project-${p.projectId}`} className="scroll-mt-4 align-top target:bg-tint-soft">
                <Td>
                  {p.ourPeople.some((one) => one.userId === scope.user.id && one.active) ? (
                    <form action={switchOrganizationAction}>
                      <input type="hidden" name="tenantId" value={p.hostTenantId} />
                      <input type="hidden" name="projectId" value={p.projectId} />
                      <button type="submit" className="text-left hover:underline" title={`Open ${p.code} at ${p.hostOrganization}`}>
                        <span className="font-mono text-xs font-semibold text-link">{p.code}</span> <span className="text-xs text-slate-600">{p.name}</span>
                      </button>
                    </form>
                  ) : (
                    <><span className="font-mono text-xs font-semibold">{p.code}</span> <span className="text-xs text-slate-600">{p.name}</span>
                      <span className="block text-[11px] text-slate-400">you are not on it</span></>
                  )}
                </Td>
                <Td className="text-xs">{p.hostOrganization}</Td>
                <Td className="text-xs">{roleLabel(p.role) ?? <span className="text-slate-400">not stated</span>}</Td>
                <Td className="text-xs">{p.status.toLowerCase()}</Td>
                <Td className="text-xs">
                  {p.ourPeople.length ? (
                    <ul className="space-y-1">
                      {p.ourPeople.map((person) => (
                        <li key={person.userId} className="flex flex-wrap items-center gap-2">
                          <a href={`#person-${person.userId}`} className={person.active ? "text-slate-700 hover:underline" : "text-slate-400 line-through"}>{person.name}</a>
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
            {!projects.length && !joined.length ? <p className="px-5 py-3 text-xs text-slate-500 sm:px-6">No project yet.</p> : null}
          </Sheet>

          <Sheet id="people" title={`People (${activePeople})`} note="everyone of ours, and the projects each is on"
            foot={scope.projectCount ? <>Add, switch off or unlock people in <Link href="/settings/users" className="font-semibold text-link hover:underline">People &amp; access</Link>. Switching someone off here stops them on other organizations&rsquo; projects too.</> : undefined}>
          <DataTable className="rounded-none border-0 shadow-none" head={<tr><Th>Name</Th><Th>Email</Th><Th>Our projects</Th><Th>Other organizations&rsquo; projects</Th><Th>Two-step sign-in</Th><Th>Access</Th></tr>}>
            {ours.map((u) => (
              <tr key={u.id} id={`person-${u.id}`} className={u.active ? "scroll-mt-4 align-top target:bg-tint-soft" : "scroll-mt-4 align-top opacity-60 target:bg-tint-soft"}>
                <Td className="text-xs font-semibold text-slate-800">
                  {scope.projectCount ? <Link href={`/settings/users#person-${u.id}`} className="text-link hover:underline">{u.name}</Link> : u.name}{u.isAdmin ? <span className="ml-1 font-normal text-slate-400">· administrator</span> : null}</Td>
                <Td className="text-xs text-slate-500">{u.email}</Td>
                <Td className="text-xs">{u.memberships.filter((m) => m.active).map((m, i) => (
                  <span key={m.projectId}>{i ? ", " : ""}<a href={`#project-${m.projectId}`} className="hover:underline">{m.projectCode}</a> ({m.functionName})</span>
                ))}{u.memberships.some((m) => m.active) ? null : <span className="text-slate-400">—</span>}</Td>
                <Td className="text-xs">{elsewhereOf(u.id).map((p, i) => (
                  <span key={`${p.linkId}-${p.projectId}`}>{i ? ", " : ""}<a href={`#project-${p.projectId}`} className="hover:underline">{p.code}</a> at {p.hostOrganization}</span>
                ))}{elsewhereOf(u.id).length ? null : <span className="text-slate-400">—</span>}</Td>
                <Td className="text-xs">{u.mfa ? "on" : <span className="text-slate-400">off</span>}</Td>
                <Td className="text-xs">{u.active ? (u.lockedUntil ? <span className="text-amber-700">locked</span> : "active") : "switched off"}</Td>
              </tr>
            ))}
          </DataTable>
          </Sheet>

          <Sheet id="organizations" title="Organizations we work with" note="how each works with us, and whether its DELIOS is linked to ours"
            act={linkTo("/organization/organizations", "Add, create or change")}
            foot={<>Each project says which of them work on it.</>}>
          <DataTable className="rounded-none border-0 shadow-none" head={<tr><Th>Organization</Th><Th>How they work with us</Th><Th>Their DELIOS</Th></tr>}>
            {outside.map((p) => (
              <tr key={p.id} className={p.active ? "" : "opacity-60"}>
                <Td>
                  {scope.projectCount ? (
                    <Link href={`/organization/organizations?edit=${p.id}#party-${p.id}`} className="hover:underline">
                      <span className="font-mono text-xs font-semibold text-link">{p.code}</span> <span className="text-xs text-slate-600">{p.name}</span>
                    </Link>
                  ) : <><span className="font-mono text-xs font-semibold">{p.code}</span> <span className="text-xs text-slate-600">{p.name}</span></>}
                  {scope.projectCount ? <Link href={`/settings/users?org=${p.id}`} className="ml-2 text-[11px] text-slate-400 hover:underline">their people</Link> : null}
                </Td>
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
                    <div className="mt-2 rounded-md bg-tint-soft p-2 ring-1 ring-line">
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
            <details className="border-t border-line px-5 py-2.5 sm:px-6"><summary className="cursor-pointer text-xs font-semibold text-link">Refused and ended ({history.length})</summary>
              <ul className="mt-2 space-y-1.5 text-xs text-slate-600">
                {history.map((one) => (
                  <li key={one.id}>
                    <Chip className="bg-slate-50/40 text-slate-600 ring-slate-300">{one.state.toLowerCase()}</Chip>{" "}
                    {one.side === "HOST" ? `${one.partyName} (${one.organization})` : one.organization}
                    {one.state === "REFUSED"
                      ? <> · refused {fmtDate(one.answeredAt)} by {one.answeredBy}{one.answerNote ? <>: {one.answerNote}</> : null}</>
                      : <> · ended {fmtDate(one.endedAt)} by {one.endedBy}: {one.endReason}</>}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          </Sheet>

          <WhoWeAre own={own} claimable={claimable} mergeList={mergeList} />
        </div>

        <aside className="space-y-4 xl:sticky xl:top-5">
          <section className="register register-sheet register-sheet-open">
            <div className="flex items-center justify-between gap-2 border-b border-line bg-tint-soft px-4 py-2.5">
              <span className="stencil text-slate-500">How every project starts</span>
            </div>
            <dl className="divide-y divide-line">
              <div className="px-4 py-3">
                <dt className="flex items-center justify-between gap-2 text-[11.5px] font-semibold text-slate-800">Settings {linkTo("/organization/settings", "Open")}</dt>
                <dd className="mt-0.5 text-[11.5px] leading-[1.45] text-slate-600">{switches.length - freeCount} fixed for every project · {freeCount} a project may change</dd>
              </div>
              <div className="px-4 py-3">
                <dt className="flex items-center justify-between gap-2 text-[11.5px] font-semibold text-slate-800">Defaults for new projects {linkTo("/organization/defaults", "Change")}</dt>
                <dd className="mt-0.5 text-[11.5px] leading-[1.45] text-slate-600">
                  {defaults
                    ? <>{defaults.fromProject ? <>Taken from {defaults.fromProject}{defaults.edited ? ", then changed" : ""}</> : "Set here"}, {fmtDate(defaults.at)}. {changedCount} answer{changedCount === 1 ? "" : "s"} differ from the app&rsquo;s own.</>
                    : "The app's own: nothing set yet."}
                </dd>
                <ul className="mt-2 space-y-1">
                  {POLICIES.map((one) => {
                    const value = defaults?.values[one.key] ?? one.options[0].value;
                    return (
                      <li key={one.key} className="text-[11px] leading-4">
                        <span className="block text-slate-500">{one.title}</span>
                        <span className="text-slate-800">{one.options.find((o) => o.value === value)?.label ?? value}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </dl>
          </section>
          <TrackingSheet reading={answers.get("TRACK_READING") !== "OFF"} signIns={answers.get("TRACK_SIGN_INS") === "ON"} />
        </aside>
      </div>
    </>
  );
}

/** A sheet of the organization's page: its band (what it is, the sentence about it, its way to where it is changed), then its body. */
function Sheet({ id, title, note, act, tone, children, foot }: {
  id?: string; title: string; note?: React.ReactNode; act?: React.ReactNode; tone?: "waiting"; children: React.ReactNode; foot?: React.ReactNode;
}) {
  return (
    <section id={id} className={`register register-sheet register-sheet-open scroll-mt-24 ${tone === "waiting" ? "ring-1 ring-amber-200" : ""}`}>
      <div className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 border-b border-line px-5 py-2.5 sm:px-6 ${tone === "waiting" ? "bg-amber-50" : "bg-tint-soft"}`}>
        <span className={`stencil mr-1 ${tone === "waiting" ? "text-amber-900" : "text-slate-500"}`}>{title}</span>
        {note ? <span className="text-[11px] text-slate-500">{note}</span> : null}
        {act ? <span className="ml-auto">{act}</span> : null}
      </div>
      {children}
      {foot ? <p className="border-t border-line px-5 py-2.5 text-[11px] text-slate-500 sm:px-6">{foot}</p> : null}
    </section>
  );
}
