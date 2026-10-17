import { requireScope } from "@/lib/core/scope";
import { isAdmin, isController } from "@/lib/core/auth";
import { PageHeader } from "@/components/ui";
import { AssuranceTabs } from "@/app/(app)/conformance/tabs";
import { PrintButton } from "@/app/(app)/conformance/statement/print-button";
import { DocumentManagementPlan } from "./plan";

export const dynamic = "force-dynamic";
export const metadata = { title: "The plan" };

/**
 * The project's document management plan: a document, not a setting. It is written from what the project is set
 * up to do, so nothing on it is typed. It is read from the settings an administrator and the control function keep.
 */
export default async function PlanPage() {
  const { user } = await requireScope();
  const reads = isAdmin(user) || isController(user);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="no-print">
        <PageHeader
          title="The plan"
          subtitle="This project's document management plan, written from how the project is set up. Change a numbering, a route or a list and the plan changes with it."
          actions={reads ? <PrintButton /> : undefined}
        />
        <AssuranceTabs current="/conformance/plan" />
      </div>
      {reads ? (
        <DocumentManagementPlan />
      ) : (
        <p className="register register-sheet px-5 py-4 text-[13px] text-slate-600 sm:px-6">
          The plan is written from the project&rsquo;s settings, which an administrator and the control function read. Ask one of them for a printed copy.
        </p>
      )}
    </div>
  );
}
