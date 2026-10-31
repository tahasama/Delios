import { ActionForm } from "@/components/form";
import { setScheduleDaysAction } from "@/lib/settings/forms-how-it-works";

/** Under the project's own days around an action: follow the organization's again, asked first. */
export function FollowOrganizationDays({ lead, risk }: { lead: number; risk: number }) {
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <ActionForm action={setScheduleDaysAction} hidden={{ follow: "1" }} submitLabel="Follow the organization's days again" size="sm" variant="secondary"
        confirmText={`From now on: needed ${lead} days before an action and at risk from ${risk} days before, the organization's, with its later changes. Instead of: this project's own. Go ahead?`}
        className="flex flex-wrap items-center gap-3 space-y-0">
        <span className="text-xs text-slate-600">This project changed its days; the organization&rsquo;s are {lead} and {risk}.</span>
      </ActionForm>
    </li>
  );
}
