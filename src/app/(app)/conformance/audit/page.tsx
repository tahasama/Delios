import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { PageHeader } from "@/components/ui";
import { AssuranceTabs } from "../tabs";
import { ArrowRight, ClipboardList, ListChecks, Network, FileText } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "For auditors" };

/**
 * The Standard's instruments, explained before they are opened. Nobody needs
 * these to run a project; an auditor, a client assessment or a change to the
 * Standard does.
 */
export default async function AuditToolsPage() {
  const ctx = await requireScope();
  const tools = [
    {
      href: "/conformance/defects", icon: ClipboardList, title: "Problem register",
      what: "Every problem the checks found, including those already fixed, with when it was first and last seen.",
      when: "When you must accept a problem you cannot fix (with a reason and a review date), or show an auditor the history.",
    },
    {
      href: "/conformance/checks", icon: ListChecks, title: "Check catalogue",
      what: "The 274 checks of the Document Management Standard, how each one is performed, and its latest result.",
      when: "When an auditor asks how a figure was produced, or which checks could not run on your data.",
    },
    {
      href: "/conformance/statement", icon: FileText, title: "Conformance statement",
      what: "A one-page, printable statement of scope, the measured result and the open problems.",
      when: "At handover, for a client assessment, or when a contract asks for evidence of document control.",
    },
    ...(ctx.can("CONFIGURE") ? [{
      href: "/conformance/traceability", icon: Network, title: "Traceability",
      what: "How each rule of the Standard is linked to the check that verifies it and the route step that applies it.",
      when: "Only when the Standard itself is updated: review what changed, then release a new baseline to record that the app follows the new edition. Nothing to do day to day.",
    }] : []),
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="For auditors" subtitle="The Standard's own instruments. You do not need them to run the project — they prove, when asked, how the register is controlled." />
      <AssuranceTabs current="/conformance/audit" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {tools.map((t) => (
          <Link key={t.href} href={t.href} className="group flex gap-3 rounded-2xl border border-slate-200 bg-surface p-4 shadow-sm transition hover:border-brand-line/40 hover:shadow-md">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600"><t.icon className="h-5 w-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between text-sm font-semibold text-slate-800">{t.title}<ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-link" /></span>
              <span className="mt-1 block text-xs text-slate-600">{t.what}</span>
              <span className="mt-2 block text-[11px] text-slate-400"><span className="font-semibold text-slate-500">When: </span>{t.when}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
