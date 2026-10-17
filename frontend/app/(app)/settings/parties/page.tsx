import { Fragment } from "react";
import Link from "next/link";
import { Pencil, X } from "lucide-react";
import { SETUP_PAGES, maySetup } from "../setup-pages";
import { requireScope } from "@/lib/core/scope";
import { DataTable, Th, Td, Field, ToneChip } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { formPolicy } from "@/lib/settings/field-policy";
import { savePartyAction, askMergeAction } from "@/lib/settings/forms-parties";
import { PartyKindFields } from "./party-fields";
import { OrganizationJoins } from "./organization-joins";
import { PARTY_KINDS } from "@/lib/settings/party-kinds";
import { adminFunctions, adminUsers, partiesWithAnswers } from "@/lib/settings/api-admin";
import { projectOrganizations } from "@/lib/organization/api";
import { inviteOrganizationAction, endLinkAction, setProjectOrganizationAction } from "@/lib/organization/forms";
import { contractRoleOptions } from "@/lib/settings/contract-roles";
import { COUNTRIES, IDENTIFIER_KINDS, countryName } from "@/lib/organization/countries";
import { cn, fmtDate } from "@/lib/core/utils";
import { NoAccess } from "../no-access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organizations" };

/** A field as on the new-document form: grey, no box, inside the sheet's `asking` body. */
const field = "plain w-full";
const icon = "inline-flex rounded-sm p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800";

type Search = { edit?: string; part?: string; take?: string };

/**
 * Organizations, People & access's way: the plate (collaborators, guests, not on DELIOS, taking part here); "An
 * organization works with us" (add one on DELIOS as it is, or create one with its identifier, look-alikes named first);
 * every organization, a pencil opening its line as the form (name, code, identifier and how it works with us, each
 * changed once; its domain; who answers for it here; linking; "the same as another?"); and who takes part in this
 * project, each line opened the same way (role, contract number, the function its people start with). The list is the
 * organization's; who takes part and who answers for each are the project's.
 */
export default async function AdminPartiesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireScope();
  const { user: me } = ctx;
  if (!maySetup(me, SETUP_PAGES.find((p) => p.href === "/settings/parties")!)) return <NoAccess title="Organizations" who="control" />;
  const sp = await searchParams;
  const [parties, onProject, roles, functionList, users, policy] = await Promise.all([
    partiesWithAnswers(ctx.projectId), projectOrganizations(ctx), contractRoleOptions(), adminFunctions(), adminUsers(), formPolicy(ctx, "PARTY"),
  ]);
  const allFunctions = functionList.filter((one) => one.active).sort((a, b) => a.name.localeCompare(b.name));
  // A function is named on an organization by its code: the one that carries its exchange.
  const functions = functionList.map((one) => ({ id: one.code, name: one.name })).sort((a, b) => a.name.localeCompare(b.name));
  const people = users.filter((one) => one.active).map((one) => ({ id: one.id, name: one.name, email: one.email, partyId: one.partyId }));
  const signingIn = (partyId: string) => people.filter((person) => person.partyId === partyId).length;
  const kindLabel = (kind: string) => PARTY_KINDS.find((k) => k.value === (kind === "NOT_ON_DELIOS" ? "OFFLINE" : kind))?.label ?? kind;
  const count = (kind: string) => parties.filter((p) => !p.isInternal && p.kind === kind).length;
  const takingPart = onProject.filter((one) => one.active).length;
  const href = (q: Search, anchor?: string) => {
    const next = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => !!e[1]));
    return `/settings/parties${next.size ? `?${next}` : ""}${anchor ? `#${anchor}` : ""}`;
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
  const roleSelect = (value: string | null) => (
    <select name="role" defaultValue={value ?? ""} className={field}>
      <option value="">Not stated</option>
      {roles.filter((r) => r.code !== "GENERIC").map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
    </select>
  );
  const startSelect = (value: string | null) => (
    <select name="startFunctionId" defaultValue={value ?? ""} className={field}>
      <option value="">Not said</option>
      {allFunctions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
    </select>
  );
  const fold = "w-fit cursor-pointer list-none text-xs font-semibold text-slate-500 hover:text-slate-800 [&::-webkit-details-marker]:hidden";

  return (
    <div className="space-y-4">
      {/* The plate: who we work with. */}
      <section className="register register-sheet register-sheet-open">
        <div className="px-5 pt-6 pb-4 sm:px-6">
          <h1 className="plate-title text-slate-950">Organizations</h1>
          <p className="plate-meta mt-2">
            {count("COLLABORATOR")} collaborator{count("COLLABORATOR") === 1 ? "" : "s"} · {count("GUEST")} guest{count("GUEST") === 1 ? "" : "s"} ·{" "}
            {count("OFFLINE")} not on DELIOS · {takingPart} taking part in {ctx.project.code}
          </p>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
            Ours, and the others we exchange documents with. The list is the organization&rsquo;s, shared by every project; who
            takes part in {ctx.project.code}, and who answers for each here, is this project&rsquo;s. An organization has one code
            and one name everywhere on DELIOS, and its identifier keeps it one organization, whoever adds it.
          </p>
        </div>
      </section>

      <OrganizationJoins projectCode={ctx.project.code} functions={functions} own={policy.own} />

      {/* Every organization: the pencil opens its line as the form. */}
      <section className="register register-sheet register-sheet-open" aria-labelledby="orgs-head">
        {band("orgs-head", "Every organization", `${parties.length} · its code, name, identifier and how it works with us change once each`)}
        <DataTable className="rounded-none border-0 shadow-none" toolbar={false}
          head={<tr><Th>Organization</Th><Th>How they work with us</Th><Th>Who answers for it here</Th><Th>People</Th><Th></Th></tr>}>
          {parties.map((p) => {
            const c = p.changed;
            const open = sp.edit === p.id;
            const others = parties.filter((o) => o.id !== p.id && o.changed?.id && o.changed.id !== c?.id);
            return (
              <Fragment key={p.id}>
                <tr id={`party-${p.id}`} className={cn("scroll-mt-20 align-top target:bg-tint-soft", !p.active && "opacity-60", open && "[&>td]:border-b-0")}>
                  <Td>
                    <code className="code-chip mr-1.5">{p.code}</code><span className="font-medium text-slate-800">{p.name}</span>
                    {p.isInternal ? <span className="ml-1.5"><ToneChip tone="moving">ours</ToneChip></span> : null}
                    <span className="block text-[11px] text-slate-500">
                      {identifierShown(c) ?? (c?.noIdentifierReason ? `no identifier: ${c.noIdentifierReason}` : <span className="text-amber-800">no identifier yet</span>)}
                      {c?.domain ? ` · ${c.domain}${c.domainConfirmed ? " (proven)" : ""}` : ""}
                    </span>
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
                    {p.contact ? (
                      <>
                        <Link href={`/settings/users#person-${p.contact.id}`} className="font-semibold text-link hover:underline">{p.contact.name}</Link>
                        <span className="block text-[11px] text-slate-500">{p.backup ? `backup: ${p.backup.name}` : "no backup"}</span>
                      </>
                    ) : <span className="text-slate-500">—</span>}
                  </Td>
                  <Td className="text-xs tabular-nums">
                    {p._count.users ? <Link href={`/settings/users?org=${p.id}`} className="font-semibold text-link hover:underline">{p._count.users}</Link> : <span className="text-slate-500">0</span>}
                    {p.active ? null : <span className="block text-[11px] font-semibold text-red-700">switched off</span>}
                  </Td>
                  <Td className="w-px whitespace-nowrap text-right">
                    {open
                      ? <Link href={href({}, `party-${p.id}`)} scroll={false} className={icon} title="Close"><X aria-label={`Close ${p.name}`} className="h-4 w-4" /></Link>
                      : <Link href={href({ edit: p.id }, `party-${p.id}`)} scroll={false} className={icon} title={`Change ${p.name}`}><Pencil aria-label={`Change ${p.name}`} className="h-4 w-4" /></Link>}
                  </Td>
                </tr>
                {open ? (
                  // The line goes on as the form: grey fields, then the strip with Cancel and Save.
                  <tr>
                    <td colSpan={5} className="border-b border-line p-0">
                      <ActionForm id={`party-form-${p.id}`} action={savePartyAction} hideSubmit hidden={{ id: p.id }} className="asking space-y-5 px-5 py-5 sm:px-6">
                        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                          <Field label="Name" required hint={onceHint(c, p.name, "name")}>
                            <input name="name" required defaultValue={p.name} readOnly={fixedOf(c, "name")} className={cn(field, fixedOf(c, "name") && "text-slate-500")} />
                          </Field>
                          <Field label="Code" required hint={onceHint(c, p.name, "code")}>
                            <input name="code" required maxLength={20} defaultValue={p.code} readOnly={fixedOf(c, "code")}
                              className={cn(field, "font-mono uppercase", fixedOf(c, "code") && "text-slate-500")} />
                          </Field>
                          {c?.theirs || c?.identifierWas ? (
                            <Field label="Identifier" className="sm:col-span-2"
                              hint={c.identifierWas ? `fixed: changed once, from ${c.identifierWas.was}, by ${c.identifierWas.by}` : `${p.name} is on DELIOS: only it gives its own`}>
                              <p className="flex h-(--control-h) items-center text-[13px] text-slate-600">{identifierShown(c) ?? "none given"}</p>
                            </Field>
                          ) : (
                            <>
                              <Field label="Country" hint="where its identifier was given">
                                <select name="country" defaultValue={c?.identifier?.country ?? ""} className={field}>
                                  <option value="">Choose…</option>
                                  {COUNTRIES.map((one) => <option key={one.code} value={one.code}>{one.name}</option>)}
                                </select>
                              </Field>
                              <Field label="Identifier" hint={c?.identifier ? "changed once only, for a mistake" : "the best it has: company registration first"}>
                                <span className="flex gap-2">
                                  <select name="identifierKind" defaultValue={c?.identifier?.kind ?? "COMPANY"} className="plain w-auto" aria-label="Kind of identifier">
                                    {IDENTIFIER_KINDS.map((k) => <option key={k.value} value={k.value} title={k.hint}>{k.label}</option>)}
                                  </select>
                                  <input name="identifierNumber" defaultValue={c?.identifier?.number ?? ""} aria-label="Number" className={cn(field, "font-mono")} />
                                </span>
                              </Field>
                              {!c?.identifier ? (
                                <Field label="Or why it has none" hint="only when it has none of these" className="sm:col-span-2">
                                  <input name="noIdentifierReason" defaultValue={c?.noIdentifierReason ?? ""} className={field} />
                                </Field>
                              ) : null}
                            </>
                          )}
                          {c?.domainConfirmed || c?.theirs ? null : (
                            <Field label="Email domain" hint="e.g. acme.com; it helps find it again">
                              <input name="domain" defaultValue={c?.domain ?? ""} className={field} />
                            </Field>
                          )}
                          {p.isInternal ? <input type="hidden" name="active" value="on" /> : (
                            <PartyKindFields kind={p.kind} contactId={p.contactId ?? ""} backupId={p.backupId ?? ""} liaisonFunction={p.liaisonFunction ?? ""}
                              contactEmail={p.contactEmail ?? ""} people={people.filter((u) => u.partyId === p.id)} functions={functions}
                              access={{ active: p.active, signingIn: signingIn(p.id) }}
                              fixed={c?.participation ? `changed once, by ${c.participation.by}, ${fmtDate(c.participation.at)}: fixed now` : undefined} />
                          )}
                        </div>
                      </ActionForm>
                      {!p.isInternal && p.active ? (
                        <details className="border-t border-line px-5 py-3 sm:px-6">
                          <summary className={fold}>
                            {p.link ? (p.link.state === "LINKED" ? `End the link with ${p.link.organization}` : "Take back the invitation") : "Invite them to link"}
                          </summary>
                          {p.link ? (
                            <ActionForm action={endLinkAction} hideSubmit hidden={{ linkId: p.link.id }} className="asking mt-3 space-y-3">
                              <p className="text-xs leading-5 text-slate-600">
                                {p.link.state === "LINKED" ? `Their people stop working here with their own accounts. Everything they did stays under ${p.code}.` : `${p.link.organization} has not answered yet.`}
                              </p>
                              <Field label="Why" required><input name="note" required className={field} /></Field>
                              <button type="submit" className="ask">{p.link.state === "LINKED" ? "End the link" : "Take it back"}</button>
                            </ActionForm>
                          ) : (
                            <ActionForm action={inviteOrganizationAction} hideSubmit hidden={{ partyId: p.id }} className="asking mt-3 space-y-3">
                              <p className="text-xs leading-5 text-slate-600">
                                If {p.name} has its own DELIOS, its people can work here with their own accounts. Their administrator accepts. Nothing done until now is lost.
                              </p>
                              <Field label="Email of someone you know there" required><input type="email" name="email" required className={field} /></Field>
                              <button type="submit" className="ask">Invite them</button>
                            </ActionForm>
                          )}
                        </details>
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
                        <button type="submit" form={`party-form-${p.id}`} data-on="true" className="ask">Save</button>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </DataTable>
      </section>

      {/* Who takes part in this project: role, contract, the function their people start with. */}
      <section id="take" className="register register-sheet register-sheet-open scroll-mt-24" aria-labelledby="take-head">
        {band("take-head", `On ${ctx.project.code}: who takes part`, `${takingPart} · the contract is between ${ctx.project.code} and each of them`,
          sp.take ? null : <Link href={href({ take: "1" }, "take")} scroll={false} className="ask ml-auto">An organization takes part</Link>)}
        {sp.take ? (
          <>
            <ActionForm id="take-form" action={setProjectOrganizationAction} hideSubmit resetOnSuccess className="asking space-y-5 px-5 py-5 sm:px-6">
              <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                <Field label="Organization" required>
                  <select name="partyId" required defaultValue="" className={field}>
                    <option value="" disabled>Choose…</option>
                    {parties.filter((p) => !p.isInternal && p.active && !onProject.some((o) => o.partyId === p.id)).map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                  </select>
                </Field>
                <Field label="Role here" hint="optional">{roleSelect(null)}</Field>
                <Field label="Contract number" hint={`the contract between ${ctx.project.code} and them; unique on DELIOS, changed once`}>
                  <input name="contractNumber" maxLength={64} className={cn(field, "font-mono")} />
                </Field>
                <Field label="Their people start as" hint="for a collaborator: the function its people get here">{startSelect(null)}</Field>
              </div>
            </ActionForm>
            <div className="flex flex-wrap items-center justify-between gap-3 border-y border-line bg-tint-soft px-5 py-3 sm:px-6">
              <Link href={href({}, "take")} scroll={false} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel</Link>
              <button type="submit" form="take-form" data-on="true" className="ask">Add to {ctx.project.code}</button>
            </div>
          </>
        ) : null}
        {onProject.length ? (
          <DataTable className="rounded-none border-0 shadow-none" toolbar={false}
            head={<tr><Th>Organization</Th><Th>How they work with us</Th><Th>Role here</Th><Th>Contract</Th><Th>Their people start as</Th><Th>People here</Th><Th></Th></tr>}>
            {onProject.map((one) => {
              const open = sp.part === one.partyId;
              return (
                <Fragment key={one.partyId}>
                  <tr id={`part-${one.partyId}`} className={cn("scroll-mt-20 align-top target:bg-tint-soft", !one.active && "opacity-60", open && "[&>td]:border-b-0")}>
                    <Td><code className="code-chip mr-1.5">{one.code}</code><span className="text-slate-800">{one.name}</span></Td>
                    <Td className="text-xs">{kindLabel(one.kind)}{one.linkedOrganization ? <span className="block text-[11px] text-slate-500">{one.linkedOrganization}</span> : null}</Td>
                    <Td className="text-xs">{one.role ? roles.find((r) => r.code === one.role)?.label ?? one.role : <span className="text-slate-500">not stated</span>}</Td>
                    <Td className="text-xs">
                      {one.contractNumber ? <span className="font-mono">{one.contractNumber}</span> : <span className="text-slate-500">not given</span>}
                      {one.previousContractNumber ? <span className="block text-[11px] text-slate-500">was {one.previousContractNumber}</span> : null}
                    </Td>
                    <Td className="text-xs">{one.startFunction ?? (one.kind === "COLLABORATOR" ? <span className="font-semibold text-amber-700">not said yet</span> : <span className="text-slate-500">—</span>)}</Td>
                    <Td className="text-xs tabular-nums">{one.active ? one.people : <span className="text-slate-500">no longer takes part</span>}</Td>
                    <Td className="w-px whitespace-nowrap text-right">
                      {open
                        ? <Link href={href({}, `part-${one.partyId}`)} scroll={false} className={icon} title="Close"><X aria-label={`Close ${one.name}`} className="h-4 w-4" /></Link>
                        : <Link href={href({ part: one.partyId }, `part-${one.partyId}`)} scroll={false} className={icon} title={`Change ${one.name} on ${ctx.project.code}`}><Pencil aria-label={`Change ${one.name}`} className="h-4 w-4" /></Link>}
                    </Td>
                  </tr>
                  {open ? (
                    <tr>
                      <td colSpan={7} className="border-b border-line p-0">
                        <ActionForm id={`part-form-${one.partyId}`} action={setProjectOrganizationAction} hideSubmit hidden={{ partyId: one.partyId }}
                          className="asking space-y-5 px-5 py-5 sm:px-6">
                          <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                            <Field label="Role here" hint="optional">{roleSelect(one.role)}</Field>
                            <Field label="Contract number"
                              hint={one.contractChangedAt
                                ? `fixed: changed once, from ${one.previousContractNumber}, by ${one.contractChangedByName}, ${fmtDate(one.contractChangedAt)}`
                                : `between ${ctx.project.code} and them; unique on DELIOS, changed once only`}>
                              {one.contractChangedAt
                                ? <input defaultValue={one.contractNumber ?? ""} disabled className={cn(field, "font-mono text-slate-500")} aria-label="Contract number (fixed)" />
                                : <input name="contractNumber" defaultValue={one.contractNumber ?? ""} maxLength={64} className={cn(field, "font-mono")} />}
                            </Field>
                            <Field label="Their people start as" hint="a collaborator's administrator puts their people on; this is the function they get">{startSelect(one.startFunctionId)}</Field>
                            <Field label="Takes part">
                              <select name="active" defaultValue={one.active ? "on" : "off"} className={field}>
                                <option value="on">Yes</option>
                                <option value="off">No longer</option>
                              </select>
                            </Field>
                          </div>
                        </ActionForm>
                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-tint-soft px-5 py-3 sm:px-6">
                          <Link href={href({}, `part-${one.partyId}`)} scroll={false} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel</Link>
                          <button type="submit" form={`part-form-${one.partyId}`} data-on="true" className="ask">Save</button>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </DataTable>
        ) : <p className="px-5 py-4 text-xs text-slate-500 sm:px-6">No other organization takes part in {ctx.project.code} yet.</p>}
      </section>
    </div>
  );
}
