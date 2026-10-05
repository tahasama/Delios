import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { hasVerb } from "@/lib/auth";
import { PageHeader, Banner, Chip } from "@/components/ui";
import { SETUP_PAGES, SETUP_GROUPS, maySetup, type SetupPage } from "./setup-pages";
import { families } from "@/lib/families";
import {
  FolderKanban, Building2, Gauge, Tags, FileDigit, BadgeCheck, Users, FileUp, Workflow, ScrollText, Layers, Route, ClipboardList, ArrowRight,
  type LucideIcon,
} from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

const ICON: Record<string, LucideIcon> = {
  "/settings/projects": FolderKanban,
  "/settings/parties": Building2,
  "/settings/dmp": Gauge,
  "/settings/config": Tags,
  "/settings/families": Layers,
  "/settings/fields": ClipboardList,
  "/settings/numbering": FileDigit,
  "/settings/flow": Route,
  "/settings/workflow-templates": Workflow,
  "/settings/functions": BadgeCheck,
  "/settings/users": Users,
  "/settings/controlled": FileUp,
  "/settings/audit": ScrollText,
};

const TONE: Record<SetupPage["group"], string> = {
  Organization: "bg-tint text-brand-ink",
  Classification: "bg-violet-50 text-violet-700",
  "How work flows": "bg-sky-50 text-sky-700",
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
  const [projects, parties, sets, schemes, functions, people, rules, pending, routes, events, acts, fieldsSet] = await Promise.all([
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
    db.controlSetting.count(),
    db.fieldPolicy.count(),
  ]);
  const familyList = await families(ctx);
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const figure: Record<string, { text: string; attention?: boolean }> = {
    "/settings/projects": { text: plural(projects, "active project") },
    "/settings/parties": { text: plural(parties, "party", "parties") },
    "/settings/dmp": { text: "readiness checklist" },
    "/settings/config": { text: plural(sets, "value set") },
    "/settings/families": { text: plural(familyList.length, "family", "families") },
    "/settings/flow": { text: acts ? "set by an administrator" : "read from the project" },
    "/settings/fields": { text: fieldsSet ? plural(fieldsSet, "field") + " changed" : "as it comes" },
    "/settings/numbering": { text: plural(schemes, "scheme") },
    "/settings/functions": { text: plural(functions, "function") },
    "/settings/users": { text: `${plural(people, "person", "people")} on ${ctx.project.code}` },
    "/settings/controlled": { text: pending ? `${plural(pending, "change")} waiting` : "nothing waiting", attention: pending > 0 },
    "/settings/workflow-templates": { text: plural(routes, "route") },
    "/settings/audit": { text: `${events} event${events === 1 ? "" : "s"} this week` },
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        subtitle="Set once for the organization, and used by every project. Where a project needs its own answer — who carries an act out, what is in scope, who is on it — it is given one here and nowhere else."
      />
      <div className="space-y-5">
        {SETUP_GROUPS.map((group) => {
          const pages = open.filter((p) => p.group === group);
          if (!pages.length) return null;
          return (
            <section key={group}>
              <h2 className="stencil mb-2 text-slate-400">{group}</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {pages.map((page) => {
                  const Icon = ICON[page.href] ?? Tags;
                  const f = figure[page.href];
                  return (
                    <Link
                      key={page.href}
                      href={page.href}
                      className="register register-sheet group flex gap-3 px-4 py-3.5 transition hover:border-brand-line/50"
                    >
                      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${TONE[group]}`}>
                        <Icon className="h-4.5 w-4.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-semibold leading-5 text-slate-900">{page.title}</span>
                          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-300 transition group-hover:text-link" />
                        </span>
                        <span className="mt-0.5 block text-[11.5px] leading-[1.45] text-slate-500">{page.text}</span>
                        {f ? (
                          <Chip className={`mt-2 ${f.attention ? "bg-amber-100 text-amber-900 ring-amber-300" : "bg-slate-100 text-slate-600 ring-slate-300"}`}>
                            {f.text}
                          </Chip>
                        ) : null}
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
