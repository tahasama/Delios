import { Fragment } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Pencil, X } from "lucide-react";
import { requireOrgAdmin } from "@/lib/core/org-scope";
import { DataTable, Th, Td, Field, ToneChip } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { formPolicy } from "@/lib/settings/field-policy";
import { savePartyAction, askMergeAction } from "@/lib/settings/forms-parties";
import { PartyKindFields } from "@/app/(app)/settings/parties/party-fields";
import { OrganizationJoins } from "@/app/(app)/settings/parties/organization-joins";
import { IdentifierFields } from "@/app/(app)/settings/parties/identifier-fields";
import { PARTY_KINDS } from "@/lib/settings/party-kinds";
import { adminProjects, adminUsers, partiesWithAnswers } from "@/lib/settings/api-admin";
import { endLinkAction, setPartyActiveAction } from "@/lib/organization/forms";
import { Switch } from "@/components/switch";
import { IDENTIFIER_KINDS, countryName } from "@/lib/organization/countries";
import { cn, fmtDate } from "@/lib/core/utils";
import { organizationLinks, guestAccounts } from "@/lib/organization/api";
import { contractRoleOptions } from "@/lib/settings/contract-roles";
import { TheirProjectsLinks } from "../their-projects";
import { PartyCard } from "./party-card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organizations" };

/** A field as on the new-document form: grey, no box, inside the sheet's `asking` body. */
const field = "plain w-full";
const icon = "inline-flex rounded-sm p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800";

type Search = { edit?: string; open?: string };

/**
 * The organization's list of the organizations it works with (organization level, administrators), People & access's
 * way: the plate; "Organizations we work with" (add one DELIOS knows as it is, or create one with its identifier,
 * look-alikes named first); every organization, a pencil opening its line as the form (name, code, identifier and how
 * it works with us, each changed once; its domain; who of ours works for one not on DELIOS; linking; "the same as
 * another?"). One with its own DELIOS is its own: its line is read only, we see it and link with it, nothing more. Who
 * works on which project is each project's (Settings → Organizations).
 */
export default async function OrganizationsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const scope = await requireOrgAdmin();
  const sp = await searchParams;
  const links = await organizationLinks();
  const guestsThere = new Map(await Promise.all(links.filter((one) => one.side === "GUEST" && one.state === "LINKED")
    .map(async (one) => [one.id, await guestAccounts(one.id)] as const)));
  const [parties, users, policy, projectList, roleOptions] = await Promise.all([
    partiesWithAnswers(), adminUsers().catch(() => []), formPolicy({ orgId: scope.orgId, projectId: "" }, "PARTY"), adminProjects().catch(() => []),
    contractRoleOptions(),
  ]);
  const roleLabel = (code: string | null) => (code ? roleOptions.find((r) => r.code === code)?.label ?? code : null);
  const projects = projectList.filter((p) => p.status !== "ARCHIVED").map((p) => ({ id: p.id, code: p.code, name: p.name }));
  // Who of ours may work for an organization nobody of which signs in; nobody chosen: the control function.
  const ours = users.filter((one) => one.active && one.internal).map((one) => ({ id: one.id, name: one.name, detail: one.email }));
  const control: string[] = [];
  const people = users.filter((one) => one.active).map((one) => ({ id: one.id, name: one.name, email: one.email, partyId: one.partyId }));
  const signingIn = (partyId: string) => people.filter((person) => person.partyId === partyId).length;
  const kindLabel = (kind: string) => PARTY_KINDS.find((k) => k.value === (kind === "NOT_ON_DELIOS" ? "OFFLINE" : kind))?.label ?? kind;
  const count = (kind: string) => parties.filter((p) => !p.isInternal && p.kind === kind).length;
  const href = (q: Search, anchor?: string) => {
    const next = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => !!e[1]));
    return `/organization/organizations${next.size ? `?${next}` : ""}${anchor ? `#${anchor}` : ""}`;
  };
  type Changed = NonNullable<(typeof parties)[number]["changed"]>;
  const fixedOf = (c: Changed | null | undefined, what: "code" | "name") => !!c?.theirs || !!c?.[what];
  const onceHint = (c: Changed | null | undefined, name: string, what: "code" | "name") => {
    const once = c?.[what];
    if (once) return `fixed: changed once, from ${once.was}, by ${once.by}, ${fmtDate(once.at)}`;
    if (c?.theirs) return `${name} is on DELIOS: only it changes its own ${what}`;
    return what === "code" ? "the same everywhere on DELIOS; changed once only (numbers already given keep it)" : "the same everywhere on DELIOS; changed once only";
  };
  const identifierShown = (c: Changed | null | undefined) => c?.identifier
    ? `${countryName(c.identifier.country)} · ${IDENTIFIER_KINDS.find((k) => k.value === c.identifier!.kind)?.label.toLowerCase() ?? c.identifier.kind} ${c.identifier.number}`
    : null;
  const band = (id: string, title: string, said: string, extra?: React.ReactNode) => (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
      <span id={id} className="stencil mr-1 text-slate-500">{title}</span>
      <span className="text-[11px] text-slate-500">{said}</span>
      {extra}
    </div>
  );
  const fold = "w-fit cursor-pointer list-none text-xs font-semibold text-slate-500 hover:text-slate-800 [&::-webkit-details-marker]:hidden";

  return (
    <>
      {/* The plate: who we work with, in the same shape as Projects and People. */}
      <header className="register register-sheet register-sheet-open">
        <div className="px-5 pt-5 pb-4 sm:px-6">
          <h1 className="plate-title text-slate-950">Organizations</h1>
          <p className="plate-meta mt-1.5 max-w-xl font-normal">
            Shared by every project; each project says which of them work on it. One with its own DELIOS keeps its own details.
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4">
          {[
            { term: "Their own DELIOS", value: count("COLLABORATOR"), said: "linked; they keep their details" },
            { term: "Accounts from us", value: count("GUEST"), said: "we made their people's accounts" },
            { term: "Worked for by us", value: count("OFFLINE"), said: "one of ours records for them" },
            { term: "Suspended", value: parties.filter((p) => !p.isInternal && !p.active).length, said: "their people cannot sign in" },
          ].map((f) => (
            <div key={f.term} className="bg-surface px-5 py-3 sm:px-6">
              <dt className="stencil text-slate-500">{f.term}</dt>
              <dd className="mt-1 text-[13px] font-medium tabular-nums text-slate-900">{f.value}</dd>
              <dd className="text-[11px] text-slate-500">{f.said}</dd>
            </div>
          ))}
        </dl>
      </header>

      <OrganizationJoins ours={ours} control={control} own={policy.own} projects={projects} />

      {/* Every organization: the pencil opens its line as the form. */}
      <section className="register register-sheet register-sheet-open" aria-labelledby="orgs-head">
        {band("orgs-head", "Every organization", `${parties.length} · its code, name, identifier and how it works with us change once each`)}
        <DataTable className="rounded-none border-0 shadow-none" toolbar={false}
          head={<tr><Th>Organization</Th><Th>How they work with us</Th><Th>Projects</Th><Th className="text-right">Active</Th><Th></Th></tr>}>
          {parties.map((p) => {
            const c = p.changed;
            const open = sp.edit === p.id;
            const shown = !open && sp.open === p.id;
            const others = parties.filter((o) => o.id !== p.id && o.changed?.id && o.changed.id !== c?.id);
            const worked = p.projects ?? [];
            const Chevron = shown ? ChevronDown : ChevronRight;
            return (
              <Fragment key={p.id}>
                <tr id={`party-${p.id}`} className={cn("scroll-mt-20 align-top target:bg-tint-soft", !p.active && "opacity-60", (open || shown) && "[&>td]:border-b-0", shown && "bg-tint-soft")}>
                  <Td>
                    {/* The name opens its card underneath, in place. */}
                    <Link href={href(shown ? {} : { open: p.id }, `party-${p.id}`)} scroll={false} aria-expanded={shown}
                      className="group inline-flex items-start gap-1 text-left">
                      <Chevron className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 group-hover:text-link" aria-hidden="true" />
                      <span>
                        <code className="code-chip mr-1.5">{p.code}</code><span className="font-medium text-slate-800 group-hover:text-link group-hover:underline">{p.name}</span>
                      </span>
                    </Link>
                    {p.isInternal ? <span className="ml-1.5"><ToneChip tone="moving">ours</ToneChip></span> : null}
                    <span className="block pl-5 text-[11px] text-slate-500">
                      {identifierShown(c) ?? (c?.noIdentifierReason ? `no identifier: ${c.noIdentifierReason}` : null)}
                      {c?.domain ? ` · ${c.domain}${c.domainConfirmed ? " (proven)" : ""}` : ""}
                    </span>
                    {p.active ? null : <span className="block pl-5 text-[11px] font-semibold text-red-700">suspended: its people no longer sign in</span>}
                  </Td>
                  <Td className="text-xs">
                    {p.isInternal ? <span className="text-slate-500">—</span> : (
                      <>
                        {kindLabel(p.kind)}
                        {p.link ? <span className="block text-[11px] text-slate-500">{p.link.state === "LINKED" ? `linked to ${p.link.organization}` : `invited: ${p.link.organization} has not answered yet`}</span> : null}
                      </>
                    )}
                  </Td>
                  <Td className="text-xs">
                    {p.isInternal ? <span className="text-slate-500">—</span> : worked.length ? (
                      <span className="flex flex-wrap gap-1">{worked.map((w) => <code key={w.id} className="code-chip" title={w.name}>{w.code}</code>)}</span>
                    ) : <span className="text-slate-500">none yet</span>}
                  </Td>
                  <Td className="w-px whitespace-nowrap text-right">
                    {p.isInternal ? <span className="text-[11px] text-slate-500">us</span> : (
                      <form action={setPartyActiveAction} className="inline-flex">
                        <input type="hidden" name="partyId" value={p.id} />
                        <input type="hidden" name="active" value={p.active ? "off" : "on"} />
                        <Switch on={p.active} label={p.active ? `${p.name} is active: switch off to suspend it` : `${p.name} is suspended: switch on to make it active`} />
                      </form>
                    )}
                  </Td>
                  <Td className="w-px whitespace-nowrap text-right">
                    {open
                      ? <Link href={href({}, `party-${p.id}`)} scroll={false} className={icon} title="Close"><X aria-label={`Close ${p.name}`} className="h-4 w-4" /></Link>
                      : <Link href={href({ edit: p.id }, `party-${p.id}`)} scroll={false} className={icon} title={`Change ${p.name}`}><Pencil aria-label={`Change ${p.name}`} className="h-4 w-4" /></Link>}
                  </Td>
                </tr>
                {shown ? (
                  // Its card, open under its line: since when we work with it, and every project it worked on with us.
                  <tr>
                    <td colSpan={5} className="border-b border-line bg-tint-soft p-0">
                      <PartyCard worked={worked} linkedAt={p.linkedAt ?? null} roleLabel={roleLabel} />
                    </td>
                  </tr>
                ) : null}
                {open ? (
                  // The line goes on as the form: grey fields, then the strip with Cancel and Save.
                  <tr>
                    <td colSpan={5} className="border-b border-line p-0">
                      {c?.theirs ? (
                        // Its own DELIOS: its details are its own; we see them, and switch it off for us if need be.
                        <ActionForm id={`party-form-${p.id}`} action={savePartyAction} hideSubmit
                          hidden={{ id: p.id, name: p.name, code: p.code, kind: p.kind === "COLLABORATOR" ? "COLLABORATOR" : "GUEST" }}
                          className="asking space-y-4 px-5 py-5 sm:px-6">
                          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-[160px_minmax(0,1fr)]">
                            <dt className="text-xs font-semibold text-slate-500">Name and code</dt><dd>{p.name} · <span className="font-mono">{p.code}</span></dd>
                            <dt className="text-xs font-semibold text-slate-500">Identifier</dt><dd>{identifierShown(c) ?? "none given"}</dd>
                            <dt className="text-xs font-semibold text-slate-500">Email domain</dt><dd>{c.domain ?? "—"}{c.domainConfirmed ? " (proven)" : ""}</dd>
                          </dl>
                          <p className="text-xs leading-5 text-slate-600">{p.name} has its own DELIOS: only {p.name} changes these. We see them, and link with it.</p>
                          <input type="hidden" name="active" value={p.active ? "on" : "off"} />
                        </ActionForm>
                      ) : (
                      <ActionForm id={`party-form-${p.id}`} action={savePartyAction} hideSubmit hidden={{ id: p.id }} className="asking space-y-5 px-5 py-5 sm:px-6">
                        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                          <Field label="Name" required hint={onceHint(c, p.name, "name")}>
                            <input name="name" required defaultValue={p.name} readOnly={fixedOf(c, "name")} className={cn(field, fixedOf(c, "name") && "text-slate-500")} />
                          </Field>
                          <Field label="Code" required hint={onceHint(c, p.name, "code")}>
                            <input name="code" required maxLength={20} defaultValue={p.code} readOnly={fixedOf(c, "code")}
                              className={cn(field, "font-mono uppercase", fixedOf(c, "code") && "text-slate-500")} />
                          </Field>
                          {c?.identifierWas ? (
                            <Field label="Identifier" className="sm:col-span-2"
                              hint={c.identifierWas ? `fixed: changed once, from ${c.identifierWas.was}, by ${c.identifierWas.by}` : `${p.name} is on DELIOS: only it gives its own`}>
                              <p className="flex h-(--control-h) items-center text-[13px] text-slate-600">{identifierShown(c) ?? "none given"}</p>
                            </Field>
                          ) : (
                            <IdentifierFields country={c?.identifier?.country} kind={c?.identifier?.kind} number={c?.identifier?.number}
                              noReason={c?.noIdentifierReason} allowNone={!c?.identifier} />
                          )}
                          {c?.domainConfirmed || c?.theirs ? null : (
                            <Field label="Email domain" hint="e.g. acme.com; it helps find it again">
                              <input name="domain" defaultValue={c?.domain ?? ""} className={field} />
                            </Field>
                          )}
                          {p.isInternal ? <input type="hidden" name="active" value="on" /> : (
                            <PartyKindFields kind={p.kind} contactId={p.contactId ?? ""} backupId={p.backupId ?? ""} carriedBy={p.carriedByUserId ?? ""}
                              contactEmail={p.contactEmail ?? ""} people={[]} ours={ours} control={control} askContact={false}
                              access={{ active: p.active, signingIn: signingIn(p.id), onTheLine: true }}
                              fixed={c?.participation ? `changed once, by ${c.participation.by}, ${fmtDate(c.participation.at)}: fixed now` : undefined} />
                          )}
                        </div>
                      </ActionForm>
                      )}
                      {/* Linking is never asked by hand (owner): it follows by itself once they prove, on DELIOS, that they are this
                          organization (their guest confirms, or we vouch); then every guest account moves to them. Only ending it is ours. */}
                      {!p.isInternal && p.link ? (
                        <details className="border-t border-line px-5 py-3 sm:px-6">
                          <summary className={fold}>{p.link.state === "LINKED" ? `End the link with ${p.link.organization}` : "Take back the invitation"}</summary>
                          <ActionForm action={endLinkAction} hideSubmit hidden={{ linkId: p.link.id }} className="asking mt-3 space-y-3">
                            <p className="text-xs leading-5 text-slate-600">
                              {p.link.state === "LINKED" ? `Their people stop working here with their own accounts. Everything they did stays under ${p.code}.` : `${p.link.organization} has not answered yet.`}
                            </p>
                            <Field label="Why" required><input name="note" required className={field} /></Field>
                            <button type="submit" className="ask">{p.link.state === "LINKED" ? "End the link" : "Take it back"}</button>
                          </ActionForm>
                        </details>
                      ) : !p.isInternal ? (
                        <p className="border-t border-line px-5 py-3 text-[11px] leading-5 text-slate-500 sm:px-6">
                          When {p.name} opens its own DELIOS and proves it is this organization, it is linked with us by itself, and the accounts we made
                          for its people move to it: they keep their projects, as collaborators.
                        </p>
                      ) : null}
                      {c?.id && others.length ? (
                        <details className="border-t border-line px-5 py-3 sm:px-6">
                          <summary className={fold}>Is it the same as another organization?</summary>
                          <ActionForm action={askMergeAction} hideSubmit hidden={{ mergeId: c.id }} className="asking mt-3 space-y-3">
                            <p className="text-xs leading-5 text-slate-600">
                              Two lines for one company: ask for {p.name} to be merged into the other. Each side agrees, then the app&rsquo;s owner merges
                              them. Nothing is deleted: {p.code} stays reserved and points to the one kept.
                            </p>
                            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                              <Field label="It is the same as" required>
                                <select name="keepId" required defaultValue="" className={field}>
                                  <option value="" disabled>Choose…</option>
                                  {others.map((o) => <option key={o.id} value={o.changed!.id}>{o.code} — {o.name}</option>)}
                                </select>
                              </Field>
                              <Field label="Why" required hint="how you know they are one company"><input name="why" required className={field} /></Field>
                            </div>
                            <button type="submit" className="ask">Ask for the merge</button>
                          </ActionForm>
                        </details>
                      ) : null}
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-tint-soft px-5 py-3 sm:px-6">
                        <Link href={href({}, `party-${p.id}`)} scroll={false} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel</Link>
                        {c?.theirs ? <span className="text-[11px] text-slate-500">Nothing here is ours to change; Active is on its line.</span>
                          : <button type="submit" form={`party-form-${p.id}`} data-on="true" className="ask">Save</button>}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </DataTable>
      </section>

      <TheirProjectsLinks links={links} guestsThere={guestsThere} />
      </>
  );
}
