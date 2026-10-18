import { requireScope } from "@/lib/core/scope";
import { isAdmin, isController } from "@/lib/core/auth";
import { PageHeader } from "@/components/ui";
import { AssuranceTabs } from "@/app/(app)/conformance/tabs";
import { AssuranceFigure } from "@/app/(app)/conformance/figure";
import { RunChecksButton } from "@/app/(app)/conformance/run-button";
import { PrintButton } from "@/app/(app)/conformance/statement/print-button";

/**
 * The one top every Assurance tab shares (owner: the tabs must not jump): the same plate, the same figure, the same
 * acts, the tabs on the same line, so a click changes only what is under them. What the tab is says one line under
 * the tabs.
 */
export async function AssuranceHead({ current, lead, print = false, internal = true }: {
  current: string;
  /** What this tab is, in one line under the tabs. */
  lead: string;
  /** The tab prints as a document (Conformance, The plan). */
  print?: boolean;
  internal?: boolean;
}) {
  const { user } = await requireScope();
  const controller = isController(user) || isAdmin(user);
  return (
    <div className="no-print space-y-3">
      <PageHeader
        title="Assurance"
        subtitle="How the register is controlled on this project, and how we know: what is checked and found, what the app refuses, and the plan."
        actions={
          <>
            {print ? <PrintButton /> : null}
            {controller && internal ? <RunChecksButton /> : null}
          </>
        }
      >
        {internal ? <AssuranceFigure /> : null}
      </PageHeader>
      <AssuranceTabs current={current} internal={internal} />
      <p className="plate-meta max-w-3xl font-normal">{lead}</p>
    </div>
  );
}
