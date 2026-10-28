"use server";

import { redirect } from "next/navigation";
import { requireScope } from "@/lib/core/scope";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { once } from "@/lib/core/once";
import { formPolicy, checkForm } from "@/lib/settings/field-policy";
import { isReadOnly } from "@/lib/core/auth";
import { filterFromForm, isEmpty } from "@/lib/packages/package-rule";
import { api, projectPath, refusal } from "@/lib/client";
import { packageView } from "@/lib/packages/api";
import type { PackageView } from "@/lib/types";

// ── Actions & deliverable baseline (Part 14) ─────────────────────────────────




// ── Packages (Part 15) ───────────────────────────────────────────────────────

export async function createPackageAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user } = ctx;
  if (isReadOnly(user)) return { error: "Viewers cannot create packages." };
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  // Why they get it follows the status it needs (the backend reads it); an older form may still name reasons.
  const purposes = formData.getAll("purpose").map(String).filter(Boolean);

  // A package filled by a rule states it as a filter.
  const filter = filterFromForm(formData);
  const completionDate = String(formData.get("completionDate") ?? "");
  // One status or several: a document is ready at any of them.
  const requiredStatuses = formData.getAll("requiredStatus").map(String).filter(Boolean);
  // Either role may be shared by several people.
  const ownerList = formData.getAll("compositionOwnerId").map(String).filter(Boolean);
  const acceptorList = formData.getAll("acceptanceAuthorityId").map(String).filter(Boolean);
 if (!title) return { error: "Give the package a title." };
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
        title, description, reasons: purposes.length ? purposes : null, requiredStatuses, ownerIds: ownerList, acceptorIds: acceptorList,
        completionDate, kind: "DELIVERY", extras: Object.keys(extras).length ? extras : null,
        // Inside another package: a branch of its arborescence.
        parentId: String(formData.get("parentId") ?? "") || null,
        rule: isEmpty(filter) ? null : { disciplines: filter.disciplines ?? [], docTypes: filter.docTypes ?? [], originators: filter.originators ?? [], assetIds: filter.assetIds ?? [] },
      },
      idempotencyKey: once(formData, "create") ?? randomUUID(),
    });
    number = created.number;
    // Started from a supplier package (Deliver): it holds that package's documents.
    const documentIds = formData.getAll("documentId").map(String).filter(Boolean);
    if (documentIds.length) {
      await api(projectPath(ctx, `/packages/${created.id}/members`), { body: { documentIds, requiredStatuses } });
    }
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

/**
 * From the register opened for a supplier's package: what was ticked joins it, what was unticked leaves it (never one
 * already sent to the supplier; the backend refuses). Back on the package, where the result is.
 */
export async function setPackageMembersAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const packageId = String(formData.get("packageId") ?? "");
  const adding = formData.getAll("add").map(String).filter(Boolean);
  const leaving = formData.getAll("remove").map(String).filter(Boolean);
  if (!adding.length && !leaving.length) return { error: "Nothing changed: tick a document to add it, untick one to take it out." };
  let number: string | undefined;
  if (leaving.length) {
    const out = await onPackage(packageId, "/members/remove", { documentIds: leaving });
    if (out.error) return { error: out.error };
    number = out.number;
  }
  if (adding.length) {
    const added = await onPackage(packageId, "/members", { documentIds: adding, requiredStatuses: null });
    if (added.error) return { error: added.error };
    number = added.number;
  }
  redirect(`/packages/${number}`);
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

/**
 * Change a package while it is open: name and description; for a delivery package also its date, the statuses it
 * needs, who it goes to, who puts it together and who accepts it. The control function (and above); the backend checks.
 */
export async function updatePackageAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  // Renumbered only before it was shared or sent; the backend refuses otherwise.
  const number = String(formData.get("number") ?? "").trim() || null;
  const was = String(formData.get("was") ?? "");
  if (!title) return { error: "Give the package a name." };
  const full = formData.get("delivery") === "1";
  const list = (name: string) => formData.getAll(name).map(String).filter(Boolean);
  const date = String(formData.get("completionDate") ?? "");
  const body = full
    ? {
        title, description, number,
        completionDate: date || null, clearCompletionDate: !date,
        requiredStatuses: list("requiredStatus"),
        ownerIds: list("compositionOwnerId"), acceptorIds: list("acceptanceAuthorityId"),
      }
    : { title, description, number };
  if (full && !body.requiredStatuses?.length) return { error: "Say the status its documents need." };
  if (full && (!body.ownerIds?.length || !body.acceptorIds?.length)) return { error: "Say who puts it together and who accepts it." };
  const { error, number: now } = await onPackage(String(formData.get("packageId") ?? ""), "", body, "PUT");
  if (error) return { error };
  if (now && was && now !== was) redirect(`/packages/${now}`);
  return {};
}

/** the control function shares a supplier's package with that supplier: once, and for good. */
export async function sharePackageAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const { error } = await onPackage(String(formData.get("packageId") ?? ""), "/share", {});
  return error ? { error } : {};
}

/** "Fill the package": its supplier's documents in none of its packages yet are filed, by hand only. */
export async function fillPackageAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const { error } = await onPackage(String(formData.get("packageId") ?? ""), "/fill", {});
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
  revalidatePath("/packages", "layout");
  // Removed from the package it sat in (its "Packages in it"), the page stays on that package.
  const back = String(formData.get("back") ?? "");
  redirect(back.startsWith("/packages/") ? back : `/packages?category=${pkg.kind === "SUPPLY" ? "SUPPLIER" : "DELIVERY"}`);
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
 * Step 2 of the schedule process: whoever plans says which departments
 * an activity concerns. Until this is done nobody can list its documents.
 */

/**
 * Moves a package inside another one, or to the top, while it is open (the control function). Its number never changes;
 * the backend refuses another kind, another supplier, a package delivered, or one of its own branches.
 */
export async function movePackageAction(_prev: { error?: string; message?: string } | undefined, formData: FormData): Promise<{ error?: string; message?: string }> {
  const ctx = await requireScope();
  const packageId = String(formData.get("packageId") ?? "");
  const parentId = String(formData.get("parentId") ?? "");
  try {
    await api(projectPath(ctx, `/packages/${packageId}/place`), {
      method: "PUT",
      body: { parentId: parentId && parentId !== "TOP" ? parentId : null, reason: String(formData.get("reason") ?? "").trim() || null },
    });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/packages", "layout");
  return { message: parentId && parentId !== "TOP" ? "Moved." : "Moved to the top." };
}

/**
 * Several packages ticked on Packages, moved inside another (or to the top) at once, each as "Where it sits" does it;
 * the backend checks each. Stops at the first it refuses, naming it.
 */
export async function movePackagesAction(_prev: { error?: string; message?: string } | undefined, formData: FormData): Promise<{ error?: string; message?: string }> {
  const ctx = await requireScope();
  const ids = formData.getAll("packageId").map(String).filter(Boolean);
  const parentId = String(formData.get("parentId") ?? "");
  let moved = 0;
  for (const id of ids) {
    try {
      await api(projectPath(ctx, `/packages/${id}/place`), { method: "PUT", body: { parentId: parentId && parentId !== "TOP" ? parentId : null, reason: null } });
      moved++;
    } catch (e) {
      revalidatePath("/packages", "layout");
      return { error: `${moved ? `${moved} moved; then ` : ""}${refusal(e).message}` };
    }
  }
  revalidatePath("/packages", "layout");
  return { message: `${moved} moved.` };
}

/**
 * Several packages ticked on Packages, removed at once with one why, each as its own page's Delete does it (a package in
 * another hands its documents and packages back up there; one at the top goes only empty). Stops at the first refused.
 */
export async function deletePackagesAction(_prev: { error?: string; message?: string } | undefined, formData: FormData): Promise<{ error?: string; message?: string }> {
  const ctx = await requireScope();
  const ids = formData.getAll("packageId").map(String).filter(Boolean);
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { error: "Say why they are removed — it goes on the record." };
  let removed = 0;
  for (const id of ids) {
    try {
      await api(projectPath(ctx, `/packages/${id}`), { method: "DELETE", query: { reason } });
      removed++;
    } catch (e) {
      revalidatePath("/packages", "layout");
      return { error: `${removed ? `${removed} removed; then ` : ""}${refusal(e).message}` };
    }
  }
  revalidatePath("/packages", "layout");
  return { message: `${removed} removed.` };
}
