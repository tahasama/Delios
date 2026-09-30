import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { hasVerb } from "@/lib/auth";
import { PageHeader, Banner } from "@/components/ui";
import { SETUP_PAGES, SETUP_GROUPS, maySetup, type SetupPage } from "./setup-pages";
import {
  FolderKanban, Building2, Gauge, Tags, FileDigit, BadgeCheck, Users, Grid3x3, FileUp, Workflow, ScrollText, ArrowRight,
  type LucideIcon,
} from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

const ICON: Record<string, LucideIcon> = {
  "/admin/projects": FolderKanban,
  "/admin/parties": Building2,
  "/admin/dmp": Gauge,
  "/admin/config": Tags,
  "/admin/numbering": FileDigit,
  "/admin/functions": BadgeCheck,
  "/admin/users": Users,
  "/admin/controlled": FileUp,
  "/admin/workflow-templates": Workflow,
  "/admin/audit": ScrollText,
};

const TONE: Record<SetupPage["group"], string> = {
  Organization: "bg-tint text-brand-ink",
  Classification: "bg-violet-50 text-violet-700",
  Access: "bg-emerald-50 text-emerald-700",
  "Change & evidence": "bg-amber-50 text-amber-700",
};

export default async function AdminPage() {
  const ctx = await requireScope();
  const { user, db } = ctx;
  // Administrators see every page; someone granted a single verb sees the page it opens.
  const open = SETUP_PAGES.filter((p) => maySetup(user, p));
  if (!open.length) {
    return (
      <div>
        <PageHeader title="Settings" />
        <Banner tone="danger" title="Administrators only">Ask an administrator for configuration changes.</Banner>
      </div>
    );
  }

  // One live figure per card, so the hub says what is there, not just where to go.
  const [projects, parties, sets, schemes, functions, people, rules, pending, routes, events] = await Promise.all([
    db.project.count({ where: { orgId: ctx.orgId, status: "ACTIVE" } }),
    db.party.count({ where: { active: true } }),
    db.configSet.count(),
    db.scheme.count({ where: { active: true } }),
    db.function.count({ where: { active: true } }),
    db.projectMembership.count({ where: { projectId: ctx.projectId, active: true } }),
    db.permissionRule.count(),
    db.controlledVersion.count({ where: { state: { in: ["DRAFT", "SUBMITTED"] }, set: { orgId: ctx.orgId } } }),
    db.workflowTemplate.count({ where: { active: true } }),
    db.auditEvent.count({ where: { ts: { gte: new Date(Date.now() - 7 * 86_400_000) } } }),
  ]);
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const figure: Record<string, { text: string; attention?: boolean }> = {
    "/admin/projects": { text: plural(projects, "active project") },
    "/admin/parties": { text: plural(parties, "party", "parties") },
    "/admin/dmp": { text: "readiness checklist" },
    "/admin/config": { text: plural(sets, "value set") },
    "/admin/numbering": { text: plural(schemes, "scheme") },
    "/admin/functions": { text: plural(functions, "function") },
    "/admin/users": { text: `${plural(people, "person", "people")} on ${ctx.project.code}` },
    "/admin/controlled": { text: pending ? `${plural(pending, "change")} waiting` : "nothing waiting", attention: pending > 0 },
    "/admin/workflow-templates": { text: plural(routes, "route") },
    "/admin/audit": { text: `${events} event${events === 1 ? "" : "s"} this week` },
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" subtitle="Set once for the organization; every project uses it." />
      <div className="space-y-6">
        {SETUP_GROUPS.map((group) => {
          const pages = open.filter((p) => p.group === group);
          if (!pages.length) return null;
          return (
            <section key={group}>
              <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">{group}</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {pages.map((page) => {
                  const Icon = ICON[page.href] ?? Tags;
                  const f = figure[page.href];
                  return (
                    <Link key={page.href} href={page.href} className="group flex gap-3 rounded-xl border border-line bg-surface p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-line/40 hover:shadow-md">
                      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${TONE[group]}`}><Icon className="h-5 w-5" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-800">{page.title}</span>
                          <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-link" />
                        </span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{page.text}</span>
                        {f ? <span className={`mt-2 inline-block rounded-[0.3rem] px-1.5 py-0.5 text-[11px] font-semibold ${f.attention ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{f.text}</span> : null}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
