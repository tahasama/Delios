import { ActionForm } from "@/components/form";
import { Field, inputCls } from "@/components/ui";
import { updatePackageAction, deletePackageAction } from "@/lib/actions/planning";
import type { StepItem } from "@/app/(app)/documents/[id]/next-step";

/** Renaming and deleting a package — the same on a delivery and a supplier package. */
export function manageItems(pkg: { id: string; title: string | null; description: string | null; recipientName: string }, { mayEdit, mayDelete }: { mayEdit: boolean; mayDelete: boolean }): StepItem[] {
  const items: StepItem[] = [];
  if (mayEdit) items.push({
    key: "edit",
    label: "Edit name and description",
    body: (
      <ActionForm action={updatePackageAction} submitLabel="Save" size="sm" hidden={{ packageId: pkg.id }}>
        <Field label="Name" required><input name="title" required defaultValue={pkg.title ?? ""} placeholder={pkg.recipientName} className={inputCls} /></Field>
        <Field label="Description" hint="optional"><textarea name="description" rows={2} defaultValue={pkg.description ?? ""} className={inputCls} /></Field>
      </ActionForm>
    ),
  });
  if (mayDelete) items.push({
    key: "delete",
    label: "Delete the package",
    body: (
      <ActionForm action={deletePackageAction} submitLabel="Delete package" size="sm" variant="danger" hidden={{ packageId: pkg.id }} confirmText="The package is deleted. Its documents stay in the register. Continue?">
        <p className="text-xs text-slate-500">Only the package goes; its documents stay in the register. Its number is not given out again.</p>
        <Field label="Why" required hint="goes on the record"><input name="reason" required className={inputCls} /></Field>
      </ActionForm>
    ),
  });
  return items;
}
