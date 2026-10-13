import { Fragment } from "react";
import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { isAdmin } from "@/lib/auth";
import { PageHeader, Card, DataTable, Th, Td, btn, inputCls } from "@/components/ui";
import { getActiveSet } from "@/lib/config";
import { MATRIX_CODES as CODE, buildSheet } from "@/lib/matrix-sheet";
import { roleFor } from "@/lib/profiles/roles";
import { adminFunctions, adminUsers, orEmpty } from "@/lib/api/admin";
import { getMe } from "@/lib/api/me";

export const dynamic = "force-dynamic";
export const metadata = { title: "Distribution matrix" };

/**
 * The conventional document distribution matrix: deliverables down the side,
 * functions across the top, a code in each cell. Engineers read this shape
 * without being taught it, which is why it is the shape here — even though the
 * underlying data is the permission matrix rather than a separate list.
 *
 * The codes themselves live in `lib/matrix-sheet`, with the sheet people
 * download: the page and the file have to say the same thing.
 */

type Search = { discipline?: string; type?: string; producer?: string; inuse?: string };

export default async function AdminDistributionPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const ctx = await requireScope();
  const { user: me } = ctx;
  // Everyone who may read the register may read the matrix: it says who reviews
  // and approves their documents. Changing it stays with administrators.
  if (!ctx.can("READ")) return <PageHeader title="Distribution matrix" subtitle={ctx.why("READ")} />;
  const mayEdit = isAdmin(me);

  const project = await getMe().then((who) => {
    const one = who?.projects.find((p) => p.id === ctx.projectId);
    return one ? { code: one.code, role: one.contractRole } : null;
  });
  const role = roleFor(project?.role);
  const [docTypes, disciplines, producers, functions] = await Promise.all([
    getActiveSet("DOCUMENT_TYPES"),
    getActiveSet("DISCIPLINES"),
    getActiveSet("DELIVERABLE_TYPES"),
    // Only Document Control and administrators may read the functions; anybody else sees no columns.
    orEmpty(adminFunctions).then((rows) => rows.filter((f) => f.active)),
  ]);

  // The matrix is agreed before the documents exist, so it shows every
  // discipline by default: a row hidden because nothing has landed in it yet is
  // a row nobody agrees, and that is the one the argument is about later.
  const inUseOnly = sp.inuse === "1";
  const one = sp.discipline && disciplines.some((d) => d.code === sp.discipline) ? sp.discipline : null;
  const docType = sp.type && docTypes.some((t) => t.code === sp.type) ? sp.type : null;
  // Who produced it is a view on the grid, not a row axis: crossing it with
  // discipline made hundreds of rows that said the same thing.
  const producer = sp.producer && producers.some((p) => p.code === sp.producer) ? sp.producer : null;

  // The page reads the same sheet as the file people download and the reader
  // that takes it back. It used to build its own grid, keyed on discipline
  // alone — so a row written for "internal engineering, civil" existed in the
  // rules and showed nowhere, because the page never asked who produced it.
  const sheet = await buildSheet(ctx, { allDisciplines: !inUseOnly || Boolean(one), deliverableType: producer, docType });
  const visible = sheet.rows.filter((row) => !one || row.discipline === one);
  const toneOf = (letter: string) => CODE.find((c) => c.letter === letter) ?? null;
  // "Civil — quality, inspection and certification" is built from two names;
  // nested, each half is printed where it belongs.
  const disciplineLabel = (row: { label: string }) => row.label.split(" — ")[0];
  const familyLabel = (row: { label: string }) => row.label.split(" — ").slice(1).join(" — ");

  // How many people actually sit behind each function on this project.
  const holders = (await orEmpty(adminUsers)).flatMap((u) => u.memberships.filter((m) => m.projectId === ctx.projectId && m.active && u.active));
  const holderCount = new Map<string, number>();
  for (const h of holders) holderCount.set(h.functionId, (holderCount.get(h.functionId) ?? 0) + 1);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Distribution matrix"
        subtitle="Who reviews, approves and receives each discipline's documents. Agreed before any document is sent, so nobody has to ask."
      />
      <p className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        Rows are disciplines in their groups, columns are functions. Who produced it and which document type it is are views on the same grid — change them and the letters change.
        <a href={`/api/export/matrix?${new URLSearchParams({ ...(producer ? { producer } : {}), ...(docType ? { type: docType } : {}), ...(inUseOnly ? {} : { all: "1" }) })}`} className="font-semibold text-link hover:underline">Download this view, filled in (CSV) →</a>
        {mayEdit ? <Link href="/import?kind=matrix" className="font-semibold text-link hover:underline">Upload a filled-in one →</Link> : null}
        {mayEdit ? <Link href="/settings/functions" className="font-semibold text-link hover:underline">Change who does what →</Link> : <span className="text-slate-400">Read only — an administrator changes it.</span>}
      </p>
      {role && role.code !== "GENERIC" ? (
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          On this project we are <span className="font-semibold text-slate-800">{role.label}</span>. {role.approval} Rows written for this role apply here and on no other kind of project.
        </p>
      ) : (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
          This project does not say what we are contracted to do on it, so the matrix applies as published, with no role-specific rows.
          {mayEdit ? <> <Link href="/settings/projects" className="font-semibold underline">State it in Projects</Link> and the starting matrix for that role is published with it.</> : null}
        </p>
      )}

      <Card
        title="Who gets what"
        description={`${visible.length} discipline${visible.length === 1 ? "" : "s"} × ${sheet.columns.length} functions · ${producer ? producers.find((p) => p.code === producer)!.label.toLowerCase() : "any producer"} · ${docType ? `document type ${docType}` : "any document type"} · internal classification`}
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
            <span className="mb-1 block font-medium text-slate-700">Who produced it</span>
            <select name="producer" defaultValue={producer ?? ""} className={`${inputCls} py-1.5 text-xs`}>
              <option value="">Any producer</option>
              {producers.map((p) => <option key={p.code} value={p.code}>{p.code} — {p.label}</option>)}
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
            <input type="checkbox" name="inuse" value="1" defaultChecked={inUseOnly} />
            Only the disciplines this project already works in
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
              {sheet.columns.map((column, i) => {
                const fn = functions.find((f) => f.code === column.code);
                return (
                  <Th key={column.code} label={column.name} className="px-1.5 text-center align-bottom normal-case tracking-normal">
                    <span className="mx-auto block whitespace-nowrap pb-1 text-[11px] font-semibold text-slate-600 [text-orientation:mixed] [writing-mode:vertical-rl] rotate-180">{column.name}</span>
                    <span className="block text-[10px] font-normal text-slate-400" title="people holding this function">{fn ? holderCount.get(fn.id) ?? 0 : 0}</span>
                  </Th>
                );
              })}
            </tr>
          }
        >
          {visible.map((row, index) => (
            <Fragment key={`${row.discipline}|${row.family}`}>
              {/* A discipline heads its families; without them it is the row itself. */}
              {row.family && row.discipline !== visible[index - 1]?.discipline ? (
                <tr>
                  <Td colSpan={1 + sheet.columns.length} className="sticky left-0 bg-slate-50 py-1 pl-4 text-xs font-semibold text-slate-700">
                    <span className="font-mono text-[11px] text-slate-400">{row.discipline}</span> {disciplineLabel(row)}
                  </Td>
                </tr>
              ) : null}
            <tr>
              <Td className={`sticky left-0 z-1 whitespace-nowrap bg-surface py-1.5 text-xs ${row.family ? "pl-8" : ""}`}>
                <span className="font-mono text-[11px] font-semibold text-slate-700">{row.family || row.discipline}</span>{" "}
                <span className="text-slate-500">{row.family ? familyLabel(row) : row.label}</span>
              </Td>
              {row.cells.map((letter, i) => {
                const cell = toneOf(letter);
                return (
                  <Td key={sheet.columns[i].code} className="px-1.5 py-1.5 text-center">
                    {cell ? (
                      <span title={`${sheet.columns[i].name} — ${cell.label} (${row.label})`} className={`inline-grid h-6 w-6 place-items-center rounded-md text-[11px] font-bold ${cell.tone}`}>
                        {cell.letter}
                      </span>
                    ) : (
                      <span className="text-slate-200" title={`${sheet.columns[i].name} — not distributed`}>–</span>
                    )}
                  </Td>
                );
              })}
            </tr>
            </Fragment>
          ))}
        </DataTable>
        {visible.length === 0 ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Nothing to show. Untick “Only the disciplines this project already works in” to see every published discipline.
          </p>
        ) : null}
      </Card>

    </div>
  );
}
