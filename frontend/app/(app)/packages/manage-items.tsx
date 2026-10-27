import { ActionForm } from "@/components/form";
import type { PackageView } from "@/lib/types";
import { Field, inputCls } from "@/components/ui";
import { SearchPick } from "@/components/search-pick";
import { updatePackageAction, deletePackageAction } from "@/lib/packages/forms";
import type { StepItem } from "@/app/(app)/documents/[id]/next-step";

/** What a delivery package's edit form chooses from: the statuses, the organizations, our people. */
export type DeliveryChoices = {
  statuses: { code: string; label: string }[];
  parties: { id: string; name: string; isInternal: boolean }[];
  people: { id: string; name: string; functionName: string }[];
};

/**
 * Editing and deleting a package — the same on a delivery and a supplier package. A delivery package edits every field
 * while it is open (date, what it needs, who it goes to, who puts it together, who accepts it).
 */
export function manageItems(pkg: PackageView, { mayEdit, mayDelete, mayRenumber = false, delivery }: { mayEdit: boolean; mayDelete: boolean; mayRenumber?: boolean; delivery?: DeliveryChoices }): StepItem[] {
  const items: StepItem[] = [];
  if (mayEdit) items.push({
    key: "edit",
    label: delivery ? "Edit the package" : mayRenumber ? "Edit number, name and description" : "Edit name and description",
    body: (
      <ActionForm action={updatePackageAction} submitLabel="Save" size="sm" hidden={{ packageId: pkg.id, was: pkg.number, ...(delivery ? { delivery: "1" } : {}) }}>
        {/* Renumbered only before anyone outside saw it: once shared or sent, its number stays. */}
        {mayRenumber ? <Field label="Number" hint="changes only until it is shared or sent"><input name="number" defaultValue={pkg.number} className={inputCls} /></Field> : null}
        <div className={delivery ? "grid grid-cols-1 gap-3 md:grid-cols-3" : "space-y-3"}>
          <Field label="Name" required className={delivery ? "md:col-span-2" : undefined}><input name="title" required defaultValue={pkg.title ?? ""} placeholder={pkg.names.to} className={inputCls} /></Field>
          {delivery ? <Field label="Due by" hint="optional"><input type="date" name="completionDate" defaultValue={pkg.completionDate ?? ""} className={inputCls} /></Field> : null}
          <Field label="Description" hint="optional" className={delivery ? "md:col-span-3" : undefined}><textarea name="description" rows={2} defaultValue={pkg.description ?? ""} className={inputCls} /></Field>
          {delivery ? (
            <>
              <SearchPick browse name="requiredStatus" required label="Needed at" hint="ready at any of them; it also says why they get it" initial={pkg.requiredStatuses} items={delivery.statuses.map((one) => ({ id: one.code, name: one.code, detail: one.label }))} />
              <SearchPick name="compositionOwnerId" required label="Put together by" hint="they add and take out its documents" initial={pkg.ownerIds} items={delivery.people.map((one) => ({ id: one.id, name: one.name, detail: one.functionName }))} />
              <SearchPick name="acceptanceAuthorityId" required label="Accepted by" hint="not those putting it together" initial={pkg.acceptorIds} items={delivery.people.map((one) => ({ id: one.id, name: one.name, detail: one.functionName }))} />
            </>
          ) : null}
        </div>
        {delivery ? <p className="text-[11px] text-slate-500">Changing what it needs or who accepts it means checking readiness again.</p> : null}
      </ActionForm>
    ),
  });
  if (mayDelete) items.push({
    key: "delete",
    label: "Delete the package",
    body: (
      <ActionForm action={deletePackageAction} submitLabel="Delete package" size="sm" variant="danger" hidden={{ packageId: pkg.id }} confirmText="The package is deleted. Its documents stay in the register. Continue?">
        <p className="text-xs text-slate-500">It is empty, so nothing of content goes with it. Its number is not given out again.</p>
        <Field label="Why" required hint="goes on the record"><input name="reason" required className={inputCls} /></Field>
      </ActionForm>
    ),
  });
  return items;
}
