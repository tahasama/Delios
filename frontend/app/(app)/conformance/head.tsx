import { requireScope } from "@/lib/core/scope";
import { isAdmin, isController } from "@/lib/core/auth";
import { PageHeader } from "@/components/ui";
import { AssuranceTabs } from "@/app/(app)/conformance/tabs";
import { AssuranceFigure } from "@/app/(app)/conformance/figure";
import { RunChecksButton } from "@/app/(app)/conformance/run-button";
import { PrintButton } from "@/app/(app)/conformance/statement/print-button";

/**
 * The one top every Assurance tab shares (owner: the tabs must not jump): the same plate, the same figure, the same
 * acts, the tabs on the same line, so a click changes only what is under them. The tabs, the line saying what the tab
 * is and what it sets (its measure, its filters) are one sheet.
 */
export async function AssuranceHead({ current, lead, print = false, internal = true, children }: {
  current: string;
  /** What this tab is, in one line under the tabs. */
  lead: string;
  /** The tab prints as a document (Conformance, The plan). */
  print?: boolean;
  internal?: boolean;
  /** What the tab sets under its line (its measure, its filters), in the same sheet as the tabs (owner: no skinny
   * cards one under another). */
  children?: React.ReactNode;
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
      <section className="register register-sheet register-sheet-open">
        <AssuranceTabs current={current} internal={internal} />
        <p className="plate-meta border-t border-line px-5 py-2.5 font-normal sm:px-6">{lead}</p>
        {children}
      </section>
    </div>
  );
}
