import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { isAdmin } from "@/lib/auth";
import { PageHeader, Card, DataTable, Th, Td, Chip, Field, btn, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { saveDistributionRuleAction, deleteDistributionRuleAction } from "@/lib/actions/retention";
import { getActiveSet } from "@/lib/config";
import { loadActor, verbsFor, type Verb } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Distribution matrix" };

/**
 * The conventional document distribution matrix: deliverables down the side,
 * functions across the top, a code in each cell. Engineers read this shape
 * without being taught it, which is why it is the shape here — even though the
 * underlying data is the permission matrix rather than a separate list.
 */
const CODE: { verb: Verb; letter: string; label: string; tone: string }[] = [
  { verb: "APPROVE", letter: "A", label: "Approves", tone: "bg-[#1e3a5f] text-white" },
  { verb: "REVIEW", letter: "R", label: "Reviews", tone: "bg-[#3d6b99] text-white" },
  { verb: "CONTROL", letter: "C", label: "Controls (custody, release)", tone: "bg-violet-600 text-white" },
  { verb: "TRANSMIT", letter: "T", label: "Issues to other parties", tone: "bg-amber-500 text-white" },
  { verb: "RECEIVE", letter: "I", label: "Receives for information", tone: "bg-emerald-100 text-emerald-900" },
  { verb: "READ", letter: "·", label: "May read if they go looking", tone: "bg-slate-100 text-slate-500" },
];

/** The strongest code a function holds for a class — one letter, as a DDM does. */
function codeFor(verbs: Verb[]): (typeof CODE)[number] | null {
  for (const c of CODE) if (verbs.includes(c.verb)) return c;
  return null;
}

type Search = { discipline?: string; all?: string };

export default async function AdminDistributionPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const ctx = await requireScope();
  const { user: me, db } = ctx;
  if (!isAdmin(me)) return <PageHeader title="Distribution matrix" subtitle={ctx.why("CONFIGURE")} />;

  const [rules, deliverables, confs, docTypes, disciplines, users, functions, inRegister] = await Promise.all([
    db.distributionRule.findMany({ orderBy: [{ deliverableType: "asc" }, { confidentiality: "asc" }] }),
    getActiveSet("DELIVERABLE_TYPES"),
    getActiveSet("CONFIDENTIALITY"),
    getActiveSet("DOCUMENT_TYPES"),
    getActiveSet("DISCIPLINES"),
    db.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.function.findMany({ where: { active: true }, orderBy: { sort: "asc" } }),
    // Which document types this project actually holds. An organization may
    // publish hundreds; showing all of them by default is a wall, not a matrix.
    db.document.groupBy({ by: ["docType", "discipline"], _count: true }),
  ]);
  const usedDisciplines = new Set(inRegister.map((r) => r.discipline));
  // Disciplines named by a rule must stay choosable, or its effect cannot be seen.
  for (const r of await db.permissionRule.findMany({ where: { discipline: { not: null } }, select: { discipline: true } })) if (r.discipline) usedDisciplines.add(r.discipline);
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? id;

  const used = new Set(inRegister.map((r) => r.docType));
  const showAll = sp.all === "1";
  const rowTypes = showAll ? docTypes : docTypes.filter((t) => used.has(t.code));

  // A rule narrowed to a discipline is invisible unless the question names
  // one, so the matrix asks about a discipline rather than pretending the
  // answer is discipline-free.
  const discipline = sp.discipline && disciplines.some((d) => d.code === sp.discipline) ? sp.discipline : null;

  const actors = await Promise.all(functions.map((f) => loadActor(ctx, f.id)));
  const grid = rowTypes.map((type) => ({
    type,
    cells: actors.map((actor) =>
      codeFor(verbsFor(actor, { docType: type.code, discipline, confidentiality: "INTERNAL" })),
    ),
  }));

  // How many people actually sit behind each function on this project.
  const holders = await db.projectMembership.groupBy({
    by: ["functionId"],
    where: { projectId: ctx.projectId, active: true },
    _count: true,
  });
  const holderCount = new Map(holders.map((h) => [h.functionId, h._count]));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Distribution matrix"
        subtitle="Who receives which information, and in what capacity — settled before any transmittal is raised."
      />
      <p className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        Rows are document types, columns are functions; the letter says what that function does with it.
        <Link href="/admin/controlled" className="font-semibold text-[#315f83] hover:underline">Change it by upload →</Link>
      </p>

      <Card
        title="Who gets what"
        description={`${rowTypes.length} document type${rowTypes.length === 1 ? "" : "s"} × ${functions.length} functions · internal classification`}
      >
        <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-xl bg-slate-50 px-3 py-3">
          <label className="text-xs">
            <span className="mb-1 block font-medium text-slate-700">Discipline</span>
            <select name="discipline" defaultValue={discipline ?? ""} className={`${inputCls} py-1.5 text-xs`}>
              <option value="">Any discipline</option>
              {disciplines.filter((d) => usedDisciplines.has(d.code) || d.code === discipline).map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 pb-2 text-xs text-slate-600">
            <input type="checkbox" name="all" value="1" defaultChecked={showAll} />
            Show every published type ({docTypes.length})
          </label>
          <button type="submit" className={btn("secondary", "sm")}>Apply</button>
        </form>

        <div className="mb-3 flex flex-wrap gap-2">
          {CODE.map((c) => (
            <span key={c.letter} className="inline-flex items-center gap-1.5 text-[11px] text-slate-600">
              <span className={`grid h-5 w-5 place-items-center rounded font-bold ${c.tone}`}>{c.letter}</span>
              {c.label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="grid h-5 w-5 place-items-center rounded bg-white ring-1 ring-slate-200">—</span>
            Not distributed
          </span>
        </div>

        <div className="scroll-thin overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 border-b border-slate-200 bg-white px-3 py-2 text-left font-semibold uppercase tracking-wide text-slate-400">
                  Document type
                </th>
                {functions.map((f) => (
                  <th key={f.id} className="border-b border-slate-200 px-1.5 py-2 text-center align-bottom">
                    <span className="block whitespace-nowrap [writing-mode:vertical-rl] [text-orientation:mixed] rotate-180 pb-1 font-semibold text-slate-600">
                      {f.name}
                    </span>
                    <span className="block text-[10px] font-normal text-slate-400">{holderCount.get(f.id) ?? 0}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.map(({ type, cells }) => (
                <tr key={type.code} className="hover:bg-slate-50/60">
                  <td className="sticky left-0 z-10 border-b border-slate-100 bg-white px-3 py-1.5">
                    <span className="font-mono text-[11px] font-semibold text-slate-700">{type.code}</span>{" "}
                    <span className="text-slate-500">{type.label}</span>
                  </td>
                  {cells.map((cell, i) => (
                    <td key={functions[i].id} className="border-b border-slate-100 px-1.5 py-1.5 text-center">
                      {cell ? (
                        <span
                          title={`${functions[i].name} — ${cell.label} (${type.label})`}
                          className={`inline-grid h-5 w-5 place-items-center rounded text-[11px] font-bold ${cell.tone}`}
                        >
                          {cell.letter}
                        </span>
                      ) : (
                        <span className="text-slate-200">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rowTypes.length === 0 ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            This project holds no documents yet, so there is nothing to show. Tick “Show every published type”
            to see the matrix against your whole type list.
          </p>
        ) : null}
      </Card>

      <Card
        title={`External parties (${rules.length})`}
        description="Organizations with no account here that must still receive certain documents."
      >
        <div className="space-y-3">
          <div>
            {rules.length === 0 ? (
              <p className="text-xs text-slate-400">
                None.
              </p>
            ) : (
              <DataTable head={<tr><Th>Deliverable type</Th><Th>Confidentiality</Th><Th>Internal</Th><Th>External parties</Th><Th></Th></tr>}>
                {rules.map((r) => {
                  const ids = JSON.parse(r.userIds) as string[];
                  const parties = r.partyNames ? (JSON.parse(r.partyNames) as string[]) : [];
                  return (
                    <tr key={r.id}>
                      <Td className="font-mono text-xs">{r.deliverableType}</Td>
                      <Td><Chip>{r.confidentiality}</Chip></Td>
                      <Td className="text-xs">{ids.map(nameOf).join(", ") || "—"}</Td>
                      <Td className="text-xs">{parties.join(", ") || "—"}</Td>
                      <Td>
                        <form action={deleteDistributionRuleAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <button className="text-xs text-slate-400 hover:text-red-600">remove</button>
                        </form>
                      </Td>
                    </tr>
                  );
                })}
              </DataTable>
            )}
          </div>

          <details className="max-w-xl">
            <summary className="cursor-pointer text-xs font-semibold text-[#315f83]">+ Add an external party</summary>
            <div className="mt-3">
            <ActionForm action={saveDistributionRuleAction} submitLabel="Add" size="sm">
              <Field label="Deliverable type" required>
                <select name="deliverableType" required className={inputCls} defaultValue="">
                  <option value="" disabled>Choose…</option>
                  {deliverables.map((d) => <option key={d.code} value={d.code}>{d.code} — {d.label}</option>)}
                </select>
              </Field>
              <Field label="Confidentiality" required>
                <select name="confidentiality" className={inputCls} defaultValue="INTERNAL">
                  {confs.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
              </Field>
              <Field label="External parties" hint="One per line — organizations without accounts here">
                <textarea name="partyNames" rows={3} className={inputCls} placeholder={"Client engineering\nCertifying authority"} />
              </Field>
              <Field label="Also these people" hint="Only if someone needs it outside their function">
                <select name="userIds" multiple size={4} className={`${inputCls} h-auto py-1.5`}>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </Field>
            </ActionForm>
            </div>
          </details>
        </div>
      </Card>
    </div>
  );
}
