"use server";

import { redirect } from "next/navigation";
import { requireScope } from "@/lib/scope";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { formPolicy, checkForm } from "@/lib/field-policy";
import { isReadOnly } from "@/lib/auth";
import { filterFromForm, isEmpty } from "@/lib/package-rule";
import { api, projectPath, refusal } from "@/lib/api/client";
import { packageView } from "@/lib/api/packages";
import type { PackageView } from "@/lib/api/types";

// ── Actions & deliverable baseline (Part 14) ─────────────────────────────────




// ── Packages (Part 15) ───────────────────────────────────────────────────────

export async function createPackageAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user } = ctx;
  if (isReadOnly(user)) return { error: "Viewers cannot create packages." };
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  // One reason or several; the first leads its transmittals, the others are named on them.
  const purposes = formData.getAll("purpose").map(String).filter(Boolean);
  const purpose = purposes[0] ?? "";

  // A package filled by a rule states it as a filter.
  const filter = filterFromForm(formData);
  // Handed to one or more organizations on the project.
  const partyIds = formData.getAll("recipientPartyIds").map(String).filter(Boolean);
  const completionDate = String(formData.get("completionDate") ?? "");
  // One status or several: a document is ready at any of them.
  const requiredStatuses = formData.getAll("requiredStatus").map(String).filter(Boolean);
  // Either role may be shared by several people.
  const ownerList = formData.getAll("compositionOwnerId").map(String).filter(Boolean);
  const acceptorList = formData.getAll("acceptanceAuthorityId").map(String).filter(Boolean);
 if (!title) return { error: "Give the package a title." };
 if (!purpose) return { error: "Every package states a reason for issue." };
 if (!partyIds.length) return { error: "Choose who it is delivered to — another organization, or us." };
 if (!completionDate) return { error: "The completion date is required — it triggers assessment." };
 if (!requiredStatuses.length) return { error: "State the status members shall have reached." };
 if (!ownerList.length || !acceptorList.length) return { error: "Say who puts it together and who accepts it." };
 if (ownerList.some((id) => acceptorList.includes(id))) return { error: "Whoever accepts it cannot also be putting it together." };
  // What this organization asks when a package is put together.
  const policy = await formPolicy(ctx, "PACKAGE");
  const asked = checkForm(
    "PACKAGE",
    policy,
    { title, description, completionDate, requiredStatus: requiredStatuses.join(","), acceptanceAuthorityId: acceptorList[0] ?? "", po: String(formData.get("po") ?? "") },
    (n) => String(formData.get(n) ?? ""),
  );
  if (asked.error) return { error: asked.error };
  const extras = Object.fromEntries(Object.entries(asked.extras).filter(([, value]) => !!value));

  // The backend numbers it, checks the people and values, and lets the rule fill it.
  let number: string;
  try {
    const created = await api<PackageView>(projectPath(ctx, "/packages"), {
      body: {
        title, description, reason: purpose, reasons: purposes, requiredStatuses, ownerIds: ownerList, acceptorIds: acceptorList, recipientPartyIds: partyIds,
        completionDate, kind: "DELIVERY", extras: Object.keys(extras).length ? extras : null,
        rule: isEmpty(filter) ? null : { disciplines: filter.disciplines ?? [], docTypes: filter.docTypes ?? [], originators: filter.originators ?? [], assetIds: filter.assetIds ?? [] },
      },
      idempotencyKey: randomUUID(),
    });
    number = created.number;
  } catch (e) {
    return { error: refusal(e).message };
  }
  redirect(`/packages/${number}`);
}

/** Runs one act on a package and refreshes its page; the backend's refusal is the answer. */
async function onPackage(packageId: string, path: string, body: unknown, method: "POST" | "PUT" = "POST"): Promise<{ error?: string; number?: string }> {
  const ctx = await requireScope();
  if (isReadOnly(ctx.user)) return { error: "Viewers cannot change packages." };
  try {
    const view = await api<PackageView>(projectPath(ctx, `/packages/${packageId}${path}`), { method, body });
    revalidatePath(`/packages/${view.number}`);
    revalidatePath("/packages");
    return { number: view.number };
  } catch (e) {
    return { error: refusal(e).message };
  }
}

export async function addPackageMemberAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const packageId = String(formData.get("packageId") ?? "");
  const documentIds = formData.getAll("documentId").map(String).filter(Boolean);
  const requiredStatuses = formData.getAll("requiredStatus").map(String).filter(Boolean);
  if (!documentIds.length) return { error: "Tick the documents to add." };
  // A supplier package holds what its supplier produces: adding puts back what was taken out.
  const { error, number } = await onPackage(packageId, "/members", { documentIds, requiredStatuses: requiredStatuses.length ? requiredStatuses : null });
  if (error) return { error };
  // From the register's "Add to package": land on the package, where the result is.
  if (formData.get("redirect")) redirect(`/packages/${number}?added=${documentIds.length}`);
  return {};
}

/** §15.6 — the completion date triggers assessment; §15.7 shortfall record. */
export async function assessPackageAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const { error } = await onPackage(String(formData.get("packageId") ?? ""), "/assess", undefined);
  return error ? { error } : {};
}

/** §15.7 — issue the shortfall record to the acceptance authority. */
export async function issueShortfallAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const { error } = await onPackage(String(formData.get("packageId") ?? ""), "/shortfall/issue", undefined);
  return error ? { error } : {};
}

/**
 * §15.8 — delivering the package, which closes it. Not while a shortfall is
 * unresolved unless accepted. Where the package names an organization, one
 * transmittal to each carries every document that is ready, at the package's
 * reason for issue; that transmittal is the delivery.
 */
export async function closePackageAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ruleCeased = formData.get("ruleCeased") === "on";
  const note = String(formData.get("closureNote") ?? "").trim() || null;
  const { error } = await onPackage(String(formData.get("packageId") ?? ""), "/deliver", { ruleCeased, note });
  return error ? { error } : {};
}

/** Take documents out of a package. One the rule matches stays out. */
export async function removePackageMemberAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const documentIds = formData.getAll("documentId").map(String).filter(Boolean);
  if (!documentIds.length) return { error: "Tick the documents to take out." };
  const { error } = await onPackage(String(formData.get("packageId") ?? ""), "/members/remove", { documentIds });
  return error ? { error } : {};
}

/** Set, change or clear the rule a package fills itself by. */
export async function setPackageRuleAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const filter = filterFromForm(formData);
  const rule = isEmpty(filter) ? null : { disciplines: filter.disciplines ?? [], docTypes: filter.docTypes ?? [], originators: filter.originators ?? [], assetIds: filter.assetIds ?? [] };
  const { error } = await onPackage(String(formData.get("packageId") ?? ""), "/rule", rule, "PUT");
  return error ? { error } : {};
}

/** Rename a package, or change its description. */
export async function updatePackageAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  if (!title) return { error: "Give the package a name." };
  const { error } = await onPackage(String(formData.get("packageId") ?? ""), "", { title, description }, "PUT");
  return error ? { error } : {};
}

/**
 * Delete a package that holds nothing and never went anywhere. Its documents
 * stay in the register; only the package goes. The number is not given out again.
 */
export async function deletePackageAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const packageId = String(formData.get("packageId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { error: "Say why it is deleted — it goes on the record." };
  const pkg = await packageView(ctx, packageId);
  if (!pkg) return { error: "That package no longer exists." };
  try {
    await api(projectPath(ctx, `/packages/${packageId}`), { method: "DELETE", query: { reason } });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/packages");
  redirect(`/packages?category=${pkg.kind === "SUPPLY" ? "SUPPLIER" : "DELIVERY"}`);
}

/** The acceptance authority accepts the delivered package: the last step. */
export async function acceptPackageAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const note = String(formData.get("note") ?? "").trim() || null;
  const { error } = await onPackage(String(formData.get("packageId") ?? ""), "/accept", { note });
  return error ? { error } : {};
}

/** Acceptance authority accepts a shortfall (§15.8) — recorded with its authority. */
export async function acceptShortfallAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const { error } = await onPackage(String(formData.get("packageId") ?? ""), "/shortfall/accept", { note: null });
  return error ? { error } : {};
}

/**
 * Step 2 of the schedule process: the project manager says which departments
 * an activity concerns. Until this is done nobody can list its documents.
 */
