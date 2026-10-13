import { ActionForm } from "@/components/form";
import type { PackageView } from "@/lib/api/types";
import { Field, inputCls } from "@/components/ui";
import { updatePackageAction, deletePackageAction } from "@/lib/forms/planning";
import type { StepItem } from "@/app/(app)/documents/[id]/next-step";

/** Renaming and deleting a package — the same on a delivery and a supplier package. */
export function manageItems(pkg: PackageView, { mayEdit, mayDelete, mayRenumber = false }: { mayEdit: boolean; mayDelete: boolean; mayRenumber?: boolean }): StepItem[] {
  const items: StepItem[] = [];
  if (mayEdit) items.push({
    key: "edit",
    label: mayRenumber ? "Edit number, name and description" : "Edit name and description",
    body: (
      <ActionForm action={updatePackageAction} submitLabel="Save" size="sm" hidden={{ packageId: pkg.id, was: pkg.number }}>
        {/* Renumbered only before anyone outside saw it: once shared or sent, its number stays. */}
        {mayRenumber ? <Field label="Number" hint="changes only until it is shared or sent"><input name="number" defaultValue={pkg.number} className={inputCls} /></Field> : null}
        <Field label="Name" required><input name="title" required defaultValue={pkg.title ?? ""} placeholder={pkg.names.to} className={inputCls} /></Field>
        <Field label="Description" hint="optional"><textarea name="description" rows={2} defaultValue={pkg.description ?? ""} className={inputCls} /></Field>
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
