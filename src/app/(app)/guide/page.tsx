import Link from "next/link";
import { requireScope } from "@/lib/scope";
import {
  ArrowLeftRight, ArrowRight, Boxes, CalendarRange, ChartNoAxesCombined,
  ClipboardCheck, FilePlus2, FileText, FolderKanban, Import, ListChecks,
  Network, Search, Settings, ShieldCheck, Tags, Users, Workflow,
} from "lucide-react";
import { mayCreateDocument } from "@/lib/auth";
import { Chip } from "@/components/ui";
import { isAdmin, isController } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Explore DELIOS" };

type CapabilityItem = {
  href: string;
  title: string;
  text: string;
  icon: React.ComponentType<{ className?: string }>;
  action?: string;
};

const DAILY: CapabilityItem[] = [
  { href: "/documents", title: "Find, select and act on documents", text: "Search the register, switch metadata views, export, or select several documents to route and transmit together.", icon: FileText, action: "Open document register" },
  { href: "/reviews", title: "Review and approve", text: "See assignments, comments, workflow steps and decisions that need a response.", icon: ClipboardCheck, action: "Open reviews" },
  { href: "/actions", title: "Know if scheduled work is ready", text: "Connect action codes and dates to the documents required for execution, use or handover.", icon: CalendarRange, action: "Open schedule readiness" },
  { href: "/transmittals", title: "Issue and receive information", text: "Raise outgoing or incoming transmittals and follow notified, opened and acknowledged evidence.", icon: ArrowLeftRight, action: "Open transmittals" },
  { href: "/packages", title: "Assemble handover packages", text: "Define a package, track required status, assess shortfalls and close with evidence.", icon: FolderKanban, action: "Open packages" },
  { href: "/assets", title: "Retrieve by equipment or area", text: "See every document associated with an asset, system, equipment tag or project area.", icon: Boxes, action: "Open assets" },
];

const CONTROL: CapabilityItem[] = [
  { href: "/pipeline/submission", title: "Submission pipeline", text: "Planned versus arrived documents, lateness, resubmissions and supply backlog.", icon: ChartNoAxesCombined },
  { href: "/pipeline/review", title: "Review pipeline", text: "Our queue, pending contractor work, review timeliness, outcomes and revision rate.", icon: Workflow },
  { href: "/conformance", title: "Assurance and defects", text: "Run the Standard's checks, inspect integrity and coverage, correct or accept findings.", icon: ShieldCheck },
  { href: "/reports", title: "Evidence questions", text: "Answer who approved, who received, what changed, what is current and what work is exposed.", icon: ListChecks },
  { href: "/exposures", title: "Use and copy exposure", text: "Find obsolete copies, affected recipients and unresolved use consequences.", icon: Network },
  { href: "/import", title: "Bulk import and export", text: "Load deliverable lists and controlled data through dry-run validation and downloadable templates.", icon: Import },
];

const SETUP: CapabilityItem[] = [
  { href: "/admin/dmp", title: "DMP readiness guide", text: "Build a working baseline step by step even when the organization does not yet have a finished Document Management Plan.", icon: Settings },
  { href: "/admin/config", title: "Disciplines, types and sets", text: "Define the codes and behavior that belong to your organization—not to the software vendor.", icon: Tags },
  { href: "/admin/workflow-templates", title: "Review routes", text: "Build review and approval routes, participant modes and applicable document classes.", icon: Workflow },
  { href: "/admin/numbering", title: "Numbering", text: "Define schemes, fields, routing and issued number ranges.", icon: FileText },
  { href: "/admin/parties", title: "Organizations and suppliers", text: "Separate your organization from external parties and group people correctly.", icon: Network },
  { href: "/admin/users", title: "People and access", text: "Assign accountability and access without confusing job title with workflow action.", icon: Users },
];

export default async function GuidePage() {
  const { user, db } = await requireScope();
  const canControl = isController(user);
  const canConfigure = isAdmin(user);
  const [documents, reviews, actions, transmittals] = await Promise.all([
    db.document.count(),
    db.reviewCycle.count({ where: { status: "OPEN" } }),
    db.action.count(),
    db.transmittal.count(),
  ]);

  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-3xl bg-brand-strong text-white shadow-[0_24px_70px_-35px_rgba(15,42,67,0.8)]">
        <div className="grid grid-cols-[minmax(0,1fr)_340px]">
          <div className="p-8">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-[#9fb8cc]"><Search className="h-4 w-4" /> Product map</div>
            <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-[-0.03em]">Everything in DELIOS, in the language of the work.</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#c7d7e5]">Start with what you need to achieve. Each area below explains what it controls, why it exists and where to continue.</p>
            <div className="mt-6 flex gap-2">
              {mayCreateDocument(user) ? <Link href="/documents/new" className="inline-flex items-center gap-2 rounded-xl bg-[#d9a441] px-4 py-2.5 text-sm font-bold text-[#102a43]"><FilePlus2 className="h-4 w-4" /> Create a document</Link> : null}
              <Link href="/" className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-4 py-2.5 text-sm font-semibold text-white">Return home</Link>
            </div>
          </div>
          <div className="border-l border-white/10 bg-white/[0.04] p-7">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#91acc2]">Workspace now</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Metric label="Documents" value={documents} />
              <Metric label="Open reviews" value={reviews} />
              <Metric label="Actions" value={actions} />
              <Metric label="Transmittals" value={transmittals} />
            </div>
            <p className="mt-5 text-xs leading-5 text-[#a9c0d2]">Signed in as <strong className="text-white">{user.name}</strong>. The map only shows control and setup areas when your role may use them.</p>
          </div>
        </div>
      </section>

      <CapabilitySection title="Do the work" description="The areas every project participant uses to find, create, review, issue and assemble information." items={DAILY} />
      {canControl ? <CapabilitySection title="See the whole flow" description="Operational control, performance evidence and exceptions across the project." items={CONTROL} /> : null}
      {canConfigure ? <CapabilitySection title="Adapt DELIOS to your DMP" description="These studios define your disciplines, types, sets, schemas, organizations and responsibilities." items={SETUP} /> : null}
    </div>
  );
}

function CapabilitySection({ title, description, items }: { title: string; description: string; items: CapabilityItem[] }) {
  return <section><div className="mb-4 flex items-end justify-between gap-5"><div><h2 className="mt-1 text-xl font-semibold text-slate-900">{title}</h2><p className="mt-1 text-sm text-slate-500">{description}</p></div><Chip>{items.length} areas</Chip></div><div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">{items.map((item) => <CapabilityCard key={item.href} {...item} />)}</div></section>;
}

function CapabilityCard({ href, title, text, icon: Icon, action }: { href: string; title: string; text: string; icon: React.ComponentType<{ className?: string }>; action?: string }) {
  return <Link href={href} className="group flex min-h-44 flex-col rounded-2xl border border-slate-200 bg-surface p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-line/40 hover:shadow-md"><span className="grid h-10 w-10 place-items-center rounded-xl bg-tint text-brand-ink"><Icon className="h-5 w-5" /></span><h3 className="mt-4 text-sm font-semibold text-slate-900">{title}</h3><p className="mt-1.5 flex-1 text-xs leading-5 text-slate-500">{text}</p><span className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-link">{action ?? "Open this area"}<ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" /></span></Link>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-3"><p className="text-xl font-semibold tabular-nums">{value}</p><p className="mt-0.5 text-[10px] uppercase tracking-wide text-[#91acc2]">{label}</p></div>;
}
