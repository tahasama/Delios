import Link from "next/link";
import { ArrowUpLeft, ChevronRight, FolderTree, Trash2 } from "lucide-react";
import { Field, inputCls, ToneChip } from "@/components/ui";
import { Select } from "@/components/select";
import { ActionForm } from "@/components/form";
import { IconAct } from "@/components/icon-act";
import { deletePackageAction, movePackageAction } from "@/lib/packages/forms";
import type { PackageTally, PackageView } from "@/lib/types";

/*
 * The arborescence of packages (owner: "a lot of organizations, especially clients, ask for an arborescence"): a package
 * may hold packages of its own kind (a supplier's, only that supplier's), as deep as wanted, beside its own documents.
 * Two ways to read it, both opening the same package page: drilling down (a package's "Packages in it"), and the tree on
 * Packages. Each package keeps its own number and delivers alone; its counts add up what is under it (backend
 * `PackageService.PlaceAsync`).
 */

/** What a tally says, in the kind's words: ready at its status for a delivery, released for a supplier's. */
export function tallyWords(kind: PackageView["kind"], t: PackageTally): string {
  const docs = kind === "DELIVERY" ? `${t.ready} of ${t.documents} ready` : `${t.released} of ${t.documents} released`;
  if (!t.packages) return docs;
  const packages = `${t.packages} package${t.packages === 1 ? "" : "s"} below`;
  return kind === "DELIVERY" && t.open ? `${docs} · ${packages}, ${t.open} still open` : `${docs} · ${packages}`;
}

/** The line above a package's name: the packages it sits in, top first, each opening its page, then its own number. */
export function PackagePath({ pkg }: { pkg: PackageView }) {
  const path = pkg.place?.path ?? [];
  return (
    <p className="flex flex-wrap items-center gap-x-1 font-mono text-[12.5px] font-semibold tracking-tight text-slate-500">
      {path.map((up) => (
        <span key={up.id} className="inline-flex items-center gap-x-1">
          <Link href={`/packages/${encodeURIComponent(up.number)}`} title={up.title} className="text-link hover:underline">{up.number}</Link>
          <ChevronRight aria-hidden className="h-3 w-3 text-slate-400" />
        </span>
      ))}
      <span>{pkg.number}</span>
    </p>
  );
}

/** A package's state in the list's words. */
function stateWord(state: string): { word: string; tone: "done" | "moving" | "idle" } {
  return state === "ACCEPTED" ? { word: "accepted", tone: "done" } : state === "DELIVERED" || state === "CLOSED" ? { word: "delivered", tone: "moving" } : { word: "open", tone: "idle" };
}

/**
 * "Packages in it": the packages sitting directly in this one, each with everything under it counted, opening its page
 * (drilling down). The whole, this package and every package under it, heads it. "New package in it" for whoever may.
 */
export function Branches({ pkg, newHref, manage = false }: {
  pkg: PackageView;
  newHref: string | null;
  /** Whoever looks after it: each open package in it may be moved out of it, or removed (owner: "I might not want them anymore"). */
  manage?: boolean;
}) {
  const place = pkg.place;
  const branches = place?.branches ?? [];
  if (!branches.length && !newHref) return null;
  return (
    <section className="register register-sheet register-sheet-open">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
        <FolderTree aria-hidden className="h-3.5 w-3.5 text-slate-500" />
        <span className="stencil mr-1 text-slate-500">Packages in it</span>
        {branches.length && place ? <span className="text-[11px] text-slate-500">all of it, with this one: {tallyWords(pkg.kind, place.whole)}</span> : null}
        {newHref ? <Link href={newHref} className="ask ml-auto py-1! text-xs!">New package in it</Link> : null}
      </div>
      {branches.length ? (
        <ul className="divide-y divide-line">
          {branches.map((b) => {
            const s = stateWord(b.state);
            return (
              <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 sm:px-6">
                <Link href={`/packages/${encodeURIComponent(b.number)}`} className="min-w-0 flex-1">
                  <span className="font-mono text-[13px] font-semibold text-brand-ink hover:underline">{b.number}</span>
                  <span className="ml-2 text-[13px] text-slate-800">{b.title}</span>
                </Link>
                <span className="text-xs text-slate-600">{tallyWords(pkg.kind, b.tally)}</span>
                {pkg.kind === "DELIVERY" ? <ToneChip inRegister tone={s.tone}>{s.word}</ToneChip> : null}
                {manage && b.state === "OPEN" ? (
                  <span className="flex items-center gap-1">
                    <IconAct action={movePackageAction} icon={ArrowUpLeft} hidden={{ packageId: b.id, parentId: place?.parentId ?? "TOP" }}
                      label={place?.parentId ? `Move ${b.number} out, beside ${pkg.number}` : `Move ${b.number} out, to the top`} />
                    <IconAct action={deletePackageAction} icon={Trash2} danger hidden={{ packageId: b.id, back: `/packages/${encodeURIComponent(pkg.number)}` }}
                      label={`Remove ${b.number}`}
                      confirm={`${b.number} is removed. Its documents and the packages in it come back into ${pkg.number}. Continue?`} />
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-5 py-3 text-xs text-slate-500 sm:px-6">None yet. A package may hold packages of its own, as deep as wanted, beside its own documents; each keeps its number and goes alone, and the counts here add them up.</p>
      )}
    </section>
  );
}

/**
 * The packages this one may be moved into: of its kind, open, a supplier's of the same supplier, never itself nor one
 * of its own branches (the backend refuses those too).
 */
export function moveTargets(pkg: PackageView, all: PackageView[]): PackageView[] {
  const under = new Set<string>([pkg.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const one of all) if (one.place?.parentId && under.has(one.place.parentId) && !under.has(one.id)) { under.add(one.id); grew = true; }
  }
  return all.filter((one) => !under.has(one.id) && one.kind === pkg.kind && one.state === "OPEN"
    && (pkg.kind !== "SUPPLY" || one.supplierPartyId === pkg.supplierPartyId));
}

/** "Where it sits", folded: move it inside another package, or to the top, while it is open (the control function). */
export function MovePackage({ pkg, targets }: { pkg: PackageView; targets: PackageView[] }) {
  const parentId = pkg.place?.parentId ?? null;
  return (
    <details className="register register-sheet register-sheet-open">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 sm:px-6 [&::-webkit-details-marker]:hidden">
        <span className="text-[13px] text-slate-600">{parentId ? `It sits in ${pkg.place?.path.at(-1)?.number ?? "another package"}. Move it?` : "It sits at the top. Put it inside another package?"}</span>
        <span className="ask">Where it sits</span>
      </summary>
      <div className="border-t border-line px-5 py-4 sm:px-6">
        <ActionForm action={movePackageAction} submitLabel="Move it" size="sm" hidden={{ packageId: pkg.id }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Inside" hint="its number stays; what is under it comes along">
              <Select name="parentId" defaultValue={parentId ?? "TOP"} className={inputCls}>
                <option value="TOP">At the top</option>
                {targets.map((one) => <option key={one.id} value={one.id}>{`${one.number} · ${one.title}`}</option>)}
              </Select>
            </Field>
            <Field label="Why" hint="optional; kept in the record">
              <input name="reason" className={inputCls} />
            </Field>
          </div>
        </ActionForm>
      </div>
    </details>
  );
}

type Node = { pkg: PackageView; children: Node[] };

/** The packages as a tree: those at the top first (none above them that the reader sees), their branches under them. */
export function treeOf(all: PackageView[]): Node[] {
  const ids = new Set(all.map((one) => one.id));
  const byParent = new Map<string, PackageView[]>();
  for (const one of all) {
    const up = one.place?.parentId;
    if (up && ids.has(up)) byParent.set(up, [...(byParent.get(up) ?? []), one]);
  }
  const grow = (pkg: PackageView, seen: Set<string>): Node => ({
    pkg,
    children: (byParent.get(pkg.id) ?? []).filter((one) => !seen.has(one.id)).sort((a, b) => a.number.localeCompare(b.number))
      .map((one) => grow(one, new Set([...seen, one.id]))),
  });
  return all.filter((one) => !one.place?.parentId || !ids.has(one.place.parentId)).sort((a, b) => a.number.localeCompare(b.number))
    .map((one) => grow(one, new Set([one.id])));
}

/**
 * The tree (owner: "the tree where I can see the origin then the branches and click on any"): every package under the
 * one it sits in, folded open, each line opening the same package page; each counts everything under it.
 */
export function PackageTree({ nodes }: { nodes: Node[] }) {
  return <ul className="py-1.5">{nodes.map((node) => <TreeLine key={node.pkg.id} node={node} depth={0} />)}</ul>;
}

function TreeLine({ node, depth }: { node: Node; depth: number }) {
  const { pkg } = node;
  const tally = pkg.place?.whole;
  const s = stateWord(pkg.state);
  const line = (
    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5">
      <Link href={`/packages/${encodeURIComponent(pkg.number)}`} className="min-w-0">
        <span className="font-mono text-[13px] font-semibold text-brand-ink hover:underline">{pkg.number}</span>
        <span className="ml-2 text-[13px] text-slate-800">{pkg.title}</span>
      </Link>
      {tally ? <span className="text-xs text-slate-500">{tallyWords(pkg.kind, tally)}</span> : null}
      {pkg.kind === "DELIVERY" ? <span className="ml-auto"><ToneChip inRegister tone={s.tone}>{s.word}</ToneChip></span> : null}
    </span>
  );
  const pad = { paddingLeft: `${1.25 + depth * 1.5}rem` };
  return (
    <li>
      {node.children.length ? (
        <details open className="group">
          <summary style={pad} className="flex cursor-pointer list-none items-center gap-2 py-1.5 pr-5 hover:bg-tint-soft sm:pr-6 [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform group-open:rotate-90" />
            {line}
          </summary>
          <ul className="border-l border-line" style={{ marginLeft: `${1.7 + depth * 1.5}rem` }}>
            {node.children.map((child) => <TreeLine key={child.pkg.id} node={child} depth={0} />)}
          </ul>
        </details>
      ) : (
        <div style={pad} className="flex items-center gap-2 py-1.5 pr-5 sm:pr-6">
          <span aria-hidden className="h-3.5 w-3.5 shrink-0" />
          {line}
        </div>
      )}
    </li>
  );
}
