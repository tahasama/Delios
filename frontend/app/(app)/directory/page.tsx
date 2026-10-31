import Link from "next/link";
import { requireScope } from "@/lib/core/scope";
import { api, projectPath } from "@/lib/client";
import { getActiveSet } from "@/lib/settings/config";
import { contractRoleOptions } from "@/lib/settings/contract-roles";
import { DataTable, Th, Td, ToneChip } from "@/components/ui";
import { SomeoneJoins } from "@/app/(app)/settings/users/join-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Project directory" };

type Directory = {
  organizations: { id: string; code: string; name: string; role: string | null; kind: "OURS" | "COLLABORATOR" | "GUEST" | "OFFLINE"; contact: string | null; contactEmail: string | null; people: number }[];
  people: { id: string; name: string; email: string | null; partyId: string | null; organization: string | null; function: string; department: string | null; control: boolean; actsAsControl: boolean; manages: boolean }[];
  mayNameControl: boolean;
};

type Options = {
  functions: { id: string; name: string }[];
  ours: { id: string; name: string }[];
  guests: { id: string; name: string }[];
  people: { id: string; name: string; organization: string | null }[];
  confirmers: { id: string; name: string; function: string; manager: boolean }[];
  asks: boolean;
  mayAdd: boolean;
  everyone: boolean;
  mayKeepProof: boolean;
};

const KIND: Record<Directory["organizations"][number]["kind"], string> = {
  OURS: "ours",
  COLLABORATOR: "works from its own DELIOS",
  GUEST: "guest: accounts we make",
  OFFLINE: "not on DELIOS: we record for them",
};

/**
 * The project directory: everyone on the project reads who takes part, the organizations and their people. Its only
 * act is "Ask for someone to join" (someone new, an information transmittal); "Add someone" with an account shows
 * here only where the project lets everyone add, and is otherwise the control function's, in People & access.
 */
export default async function DirectoryPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const ctx = await requireScope();
  const { project, user } = ctx;
  const sp = await searchParams;
  const [directory, options, disciplines, roles] = await Promise.all([
    api<Directory>(projectPath(ctx, "/people/directory"), { keep: { areas: [] } }).catch(() => null),
    user.isInternal ? api<Options>(projectPath(ctx, "/people/join-options"), { keep: { areas: [] } }).catch(() => null) : Promise.resolve(null),
    getActiveSet("DISCIPLINES").then((all) => all.map((one) => ({ value: one.code, label: one.label })).sort((x, y) => x.label.localeCompare(y.label))).catch(() => []),
    contractRoleOptions().catch(() => []),
  ]);
  const roleLabel = (code: string | null) => (code ? roles.find((r) => r.code === code)?.label ?? code : null);
  const deptLabel = (code: string | null) => (code ? disciplines.find((d) => d.value === code)?.label ?? code : null);
  const shownOrg = sp.org ? directory?.organizations.find((o) => o.id === sp.org) ?? null : null;
  const people = (directory?.people ?? []).filter((p) => !shownOrg || p.partyId === shownOrg.id || (shownOrg.kind === "OURS" && p.partyId === null));
  const control = (directory?.people ?? []).filter((p) => p.control);
  const confirmers = (options?.confirmers ?? []).map((c) => ({ id: c.id, name: c.name, detail: c.function, note: c.manager ? "recommended" : null }));

  const plate = (
    <>
      <h1 className="plate-title text-slate-950">Project directory</h1>
      <p className="plate-meta mt-2">
        {project.code} · {directory ? `${directory.organizations.length} organization${directory.organizations.length === 1 ? "" : "s"} · ${directory.people.length} ${directory.people.length === 1 ? "person" : "people"}` : "—"}
      </p>
      <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
        Who takes part in {project.code}, and who is on it.
        {control.length ? ` The control function: ${control.map((p) => p.name).join(", ")}.` : ""}
      </p>
      {!directory ? (
        <p role="alert" className="mt-2 w-fit rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-800 ring-1 ring-red-200">The directory could not be read just now. Try again in a moment.</p>
      ) : null}
    </>
  );

  return (
    <div className="space-y-4">
      {/* The plate: who takes part, and the one way to ask for someone new, on its right (owner: "a button in the title
          card"); the form opens under it. */}
      {options ? (
        <SomeoneJoins
          projectCode={project.code}
          projectName={project.name}
          plate={plate}
          sentence={options.asks ? "it goes as a request; once confirmed they are put on and told, and you read the answer on the same thread" : "they are put on at once, and told"}
          mayAdd={options.everyone && options.mayAdd}
          people={options.people.map((p) => ({ id: p.id, name: p.name, detail: p.organization }))}
          ourParties={options.ours.map((p) => ({ value: p.id, label: p.name }))}
          guestParties={options.guests.map((p) => ({ value: p.id, label: p.name }))}
          functions={options.functions.map((f) => ({ value: f.id, label: f.name }))}
          disciplines={disciplines}
          confirmers={confirmers}
          asks={options.asks}
          mayKeepProof={false}
        />
      ) : (
        <section className="register register-sheet register-sheet-open"><div className="px-5 pt-6 pb-4 sm:px-6">{plate}</div></section>
      )}

      {directory ? (
        <>
          <section className="register register-sheet register-sheet-open" aria-labelledby="orgs-head">
            <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
              <span id="orgs-head" className="stencil mr-1 text-slate-500">Organizations taking part</span>
              <span className="text-[11px] text-slate-500">{directory.organizations.length} · a name shows only its people</span>
            </div>
            <DataTable empty={"No other organization takes part yet. The control function adds them in Settings → Organizations."} className="rounded-none border-0 shadow-none" toolbar={false}
              head={<tr><Th>Organization</Th><Th>Role on {project.code}</Th><Th>How it works with us</Th><Th>Answers for it</Th><Th>People</Th></tr>}>
              {directory.organizations.map((o) => (
                <tr key={o.id} className="align-top">
                  <Td>
                    <Link href={shownOrg?.id === o.id ? "/directory" : `/directory?org=${o.id}`} className="font-medium text-link hover:underline">{o.name}</Link>
                    <code className="code-chip ml-1.5">{o.code}</code>
                  </Td>
                  <Td className="text-xs">{roleLabel(o.role) ?? "—"}</Td>
                  <Td className="text-xs">{KIND[o.kind]}</Td>
                  <Td className="text-xs">
                    {o.contact ?? "—"}
                    {o.contactEmail ? <span className="block text-[11px] text-slate-500">transmittals by email: {o.contactEmail}</span> : null}
                  </Td>
                  <Td className="text-xs tabular-nums">{o.kind === "OFFLINE" ? "—" : o.people}</Td>
                </tr>
              ))}
            </DataTable>
          </section>

          <section className="register register-sheet register-sheet-open" aria-labelledby="people-head">
            <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
              <span id="people-head" className="stencil mr-1 text-slate-500">{shownOrg ? `People of ${shownOrg.name}` : "People on the project"}</span>
              <span className="text-[11px] text-slate-500">{people.length}</span>
              {shownOrg ? <Link href="/directory" className="ml-1 text-[11px] font-semibold text-link hover:underline">only {shownOrg.name} ×</Link> : null}
            </div>
            <DataTable empty={shownOrg ? `Nobody of ${shownOrg.name} is on the project yet.` : "Nobody is on the project yet. Ask for someone to join, above."} className="rounded-none border-0 shadow-none" toolbar={false}
              head={<tr><Th>Person</Th><Th>Organization</Th><Th>Function</Th><Th>Department</Th><Th></Th></tr>}>
              {people.map((p) => (
                <tr key={p.id} className="align-top">
                  <Td>
                    <span className="font-medium text-slate-800">{p.name}</span>{p.id === user.id ? <span className="ml-1 text-xs text-slate-500">(you)</span> : null}
                    {p.email ? <a href={`mailto:${p.email}`} className="block text-[11px] text-slate-500 hover:text-link">{p.email}</a> : null}
                  </Td>
                  <Td className="text-xs">{p.organization ?? "—"}</Td>
                  <Td className="text-xs">{p.function}</Td>
                  <Td className="text-xs">{deptLabel(p.department) ?? "—"}</Td>
                  <Td className="text-xs">
                    <span className="flex flex-wrap gap-1">
                      {p.control ? <ToneChip tone="moving" title={p.actsAsControl ? "Named on this project to act as the control function" : "Their function carries the control function"}>control function</ToneChip> : null}
                      {p.manages ? <ToneChip tone="idle" title="Holds Manage: confirms who joins, and requests that ask for it">confirms</ToneChip> : null}
                    </span>
                  </Td>
                </tr>
              ))}
            </DataTable>
            {directory.mayNameControl ? (
              <p className="border-t border-line px-5 py-2.5 text-xs text-slate-500 sm:px-6">
                Who acts as the control function is named in the <Link href="/settings/flow#control-people" className="font-semibold text-link hover:underline">Control room</Link>.
              </p>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
