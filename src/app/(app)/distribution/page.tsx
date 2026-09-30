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
  { verb: "APPROVE", letter: "A", label: "Approves", tone: "bg-brand text-white" },
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

type Search = { discipline?: string; type?: string; all?: string };

export default async function AdminDistributionPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const ctx = await requireScope();
  const { user: me, db } = ctx;
  // Everyone who may read the register may read the matrix: it says who reviews
  // and approves their documents. Changing it stays with administrators.
  if (!ctx.can("READ")) return <PageHeader title="Distribution matrix" subtitle={ctx.why("READ")} />;
  const mayEdit = isAdmin(me);

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

  // Rows are disciplines: that is how an engineering organization distributes
  // (the electrical lead approves electrical documents). Disciplines in use —
  // documents or rules — by default; every published one on request.
  const showAll = sp.all === "1";
  const one = sp.discipline && disciplines.some((d) => d.code === sp.discipline) ? sp.discipline : null;
  const rows = (one ? disciplines.filter((d) => d.code === one) : showAll ? disciplines : disciplines.filter((d) => usedDisciplines.has(d.code)));

  // A rule narrowed to a document type still shows when that type is asked about.
  const docType = sp.type && docTypes.some((t) => t.code === sp.type) ? sp.type : null;

  const actors = await Promise.all(functions.map((f) => loadActor(ctx, f.id)));
  const grid = rows.map((row) => ({
    type: row,
    cells: actors.map((actor) =>
      codeFor(verbsFor(actor, { discipline: row.code, docType, confidentiality: "INTERNAL" })),
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
        subtitle="Who reviews, approves and receives each discipline's documents. Agreed before any document is sent, so nobody has to ask."
      />
      <p className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        Rows are disciplines, columns are functions; the letter says what that function does with that discipline's documents.
        {mayEdit ? <Link href="/admin/functions" className="font-semibold text-link hover:underline">Change who does what →</Link> : <span className="text-slate-400">Read only — an administrator changes it.</span>}
      </p>

      <Card
        title="Who gets what"
        description={`${rows.length} discipline${rows.length === 1 ? "" : "s"} × ${functions.length} functions · ${docType ? `document type ${docType}` : "any document type"} · internal classification`}
      >
        <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-xl bg-slate-50 px-3 py-3">
          <label className="text-xs">
            <span className="mb-1 block font-medium text-slate-700">Discipline</span>
            <select name="discipline" defaultValue={one ?? ""} className={`${inputCls} py-1.5 text-xs`}>
              <option value="">Every discipline</option>
              {disciplines.map((d) => <option key={d.code} value={d.code}>{d.code} — {d.label}</option>)}
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-medium text-slate-700">Document type <span className="font-normal text-slate-400">— optional</span></span>
            <select name="type" defaultValue={docType ?? ""} className={`${inputCls} py-1.5 text-xs`}>
              <option value="">Any type</option>
              {docTypes.map((t) => <option key={t.code} value={t.code}>{t.code} — {t.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 pb-2 text-xs text-slate-600">
            <input type="checkbox" name="all" value="1" defaultChecked={showAll} />
            Show every published discipline ({disciplines.length})
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
            <span className="grid h-5 w-5 place-items-center rounded bg-surface ring-1 ring-slate-200">—</span>
            Not distributed
          </span>
        </div>

        <DataTable
          id="distribution-matrix"
          head={
            <tr>
              <Th className="sticky left-0 z-4 min-w-55 align-bottom">Discipline</Th>
              {functions.map((f) => (
                <Th key={f.id} label={f.name} className="px-1.5 text-center align-bottom normal-case tracking-normal">
                  <span className="mx-auto block whitespace-nowrap pb-1 text-[11px] font-semibold text-slate-600 [text-orientation:mixed] [writing-mode:vertical-rl] rotate-180">{f.name}</span>
                  <span className="block text-[10px] font-normal text-slate-400" title="people holding this function">{holderCount.get(f.id) ?? 0}</span>
                </Th>
              ))}
            </tr>
          }
        >
          {grid.map(({ type, cells }) => (
            <tr key={type.code}>
              <Td className="sticky left-0 z-1 whitespace-nowrap bg-surface py-1.5 text-xs">
                <span className="font-mono text-[11px] font-semibold text-slate-700">{type.code}</span>{" "}
                <span className="text-slate-500">{type.label}</span>
              </Td>
              {cells.map((cell, i) => (
                <Td key={functions[i].id} className="px-1.5 py-1.5 text-center">
                  {cell ? (
                    <span title={`${functions[i].name} — ${cell.label} (${type.label})`} className={`inline-grid h-6 w-6 place-items-center rounded-md text-[11px] font-bold ${cell.tone}`}>
                      {cell.letter}
                    </span>
                  ) : (
                    <span className="text-slate-200">·</span>
                  )}
                </Td>
              ))}
            </tr>
          ))}
        </DataTable>
        {rows.length === 0 ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            No discipline is in use yet. Tick “Show every published discipline” to see the matrix against the whole list.
          </p>
        ) : null}
      </Card>

    </div>
  );
}
