"use server";

import { redirect } from "next/navigation";
import { requireScope } from "@/lib/scope";
import { revalidatePath } from "next/cache";
import { isController, isAdmin } from "@/lib/auth";
import { audit, notify } from "@/lib/audit";
import { isReadOnly } from "@/lib/auth";

// ── Actions & deliverable baseline (Part 14) ─────────────────────────────────




// ── Packages (Part 15) ───────────────────────────────────────────────────────

export async function createPackageAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  if (isReadOnly(user)) return { error: "Viewers cannot create packages." };
  const identifier = String(formData.get("identifier") ?? "").trim();
  const purpose = String(formData.get("purpose") ?? "");
  const type = String(formData.get("type") ?? "");
  const membershipRule = String(formData.get("membershipRule") ?? "").trim() || null;
  const recipientName = String(formData.get("recipientName") ?? "").trim();
  const completionDate = String(formData.get("completionDate") ?? "");
  const requiredStatus = String(formData.get("requiredStatus") ?? "");
  const compositionOwnerId = String(formData.get("compositionOwnerId") ?? "");
  const acceptanceAuthorityId = String(formData.get("acceptanceAuthorityId") ?? "");
 if (!identifier) return { error: "A package identifier is required — unique, never reused." };
 if (!purpose) return { error: "Every package states a reason for issue." };
 if (!type) return { error: "Defined or accumulated — state the type." };
 if (type === "ACCUMULATED" && !membershipRule) return { error: "An accumulated package states its membership rule." };
 if (!recipientName) return { error: "The recipient is required." };
 if (!completionDate) return { error: "The completion date is required — it triggers assessment." };
 if (!requiredStatus) return { error: "State the status members shall have reached." };
 if (!compositionOwnerId || !acceptanceAuthorityId) return { error: "Both owners are required." };
 if (compositionOwnerId === acceptanceAuthorityId) return { error: "The two owners shall not be the same person." };
  const dup = await db.package.findFirst({ where: { identifier } });
 if (dup) return { error: "Identifier already used — never reused." };
  const [owner, acceptor] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: compositionOwnerId } }),
    db.user.findUniqueOrThrow({ where: { id: acceptanceAuthorityId } }),
  ]);
  await db.package.create({
    data: {
      projectId,
      identifier, purpose, type, membershipRule, recipientName,
      completionDate: new Date(completionDate), requiredStatus,
      compositionOwnerId, compositionOwnerName: owner.name,
      acceptanceAuthorityId, acceptanceAuthorityName: acceptor.name,
    },
  });
 await audit({ actor: user, action: "PACKAGE_CREATED", entityType: "Package", entityId: identifier, entityLabel: identifier, detail: `${type.toLowerCase()} package — ${owner.name} composes, ${acceptor.name} accepts.` });
  redirect(`/packages/${identifier}`);
}

export async function addPackageMemberAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId } = ctx;
  if (isReadOnly(user)) return { error: "Viewers cannot change composition." };
  const packageId = String(formData.get("packageId") ?? "");
  const documentIds = formData.getAll("documentId").map(String).filter(Boolean);
  const requiredStatus = String(formData.get("requiredStatus") ?? "");
  const pkg = await db.package.findUniqueOrThrow({ where: { id: packageId }, include: { members: true } });
  if (pkg.closedAt) return { error: "The package is closed — its contents are fixed." };
  if (pkg.category === "SUPPLIER") return { error: "A supplier package holds every document from that supplier automatically." };
  // A defined package is composed by its owner (or Document Control) until it closes (§15.2).
  if (pkg.type === "DEFINED" && user.id !== pkg.compositionOwnerId && !isController(user) && !isAdmin(user)) {
    return { error: `Only ${pkg.compositionOwnerName} or Document Control can change what is in this package.` };
  }
  if (!documentIds.length || !requiredStatus) return { error: "Choose the documents and the status they must reach." };
  const fresh = documentIds.filter((id) => !pkg.members.some((m) => m.documentId === id));
  if (!fresh.length) return { error: "Those documents are already in the package." };
  await db.packageMember.createMany({ data: fresh.map((documentId) => ({ projectId, packageId, documentId, requiredStatus })) });
 await audit({ actor: user, action: "PACKAGE_MEMBER", entityType: "Package", entityId: pkg.identifier, entityLabel: pkg.identifier, detail: `${fresh.length} document(s) added.` });
  revalidatePath(`/packages/${pkg.identifier}`);
  // From the register's "Add to package": land on the package, where the result is.
  if (formData.get("redirect")) redirect(`/packages/${pkg.identifier}?added=${fresh.length}`);
  return {};
}

/** §15.6 — the completion date triggers assessment; §15.7 shortfall record. */
export async function assessPackageAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  if (isReadOnly(user)) return { error: "Viewers cannot assess packages." };
  const packageId = String(formData.get("packageId") ?? "");
  const pkg = await db.package.findUniqueOrThrow({ where: { id: packageId }, include: { members: { include: { document: { include: { revisions: { where: { state: "RELEASED" }, orderBy: { releasedAt: "desc" }, take: 1 } } } } } } });
  if (pkg.closedAt) return { error: "Package already closed." };
  const shortfall = [];
  let complete = true;
  for (const m of pkg.members) {
    const current = m.document.revisions[0];
    const at = current?.statusCode === m.requiredStatus;
    if (!at) {
      complete = false;
      shortfall.push({
        docNumber: m.document.docNumber,
        requiredStatus: m.requiredStatus,
        currentStatus: current?.statusCode ?? "not released",
        reason: "not yet at required status",
        expectedDate: null,
      });
    }
  }
  await db.package.update({
    where: { id: packageId },
    data: { assessedAt: new Date(), shortfall: shortfall.length ? JSON.stringify(shortfall) : null },
  });
  await audit({
    actor: user,
    action: "PACKAGE_ASSESSED",
    entityType: "Package",
    entityId: pkg.identifier,
    entityLabel: pkg.identifier,
 detail: complete ? "Complete — every member at required status.": `Shortfall recorded for ${shortfall.length} member(s).`,
  });
  revalidatePath(`/packages/${pkg.identifier}`);
  return {};
}

/** §15.7 — issue the shortfall record to the acceptance authority. */
export async function issueShortfallAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  const packageId = String(formData.get("packageId") ?? "");
  const pkg = await db.package.findUniqueOrThrow({ where: { id: packageId } });
  if (!pkg.shortfall) return { error: "No shortfall recorded for this package." };
  await db.package.update({ where: { id: packageId }, data: { shortfallIssuedAt: new Date() } });
 await audit({ actor: user, action: "SHORTFALL_ISSUED", entityType: "Package", entityId: pkg.identifier, entityLabel: pkg.identifier, detail: `Shortfall issued to the acceptance authority (${pkg.acceptanceAuthorityName}).` });
 await notify(pkg.acceptanceAuthorityId, "SHORTFALL", `Package shortfall: ${pkg.identifier}`, "A shortfall record has been issued to you as acceptance authority.", `/packages/${pkg.identifier}`);
  revalidatePath(`/packages/${pkg.identifier}`);
  return {};
}

/** §15.8 — closure declared by the composition owner; not while a shortfall is unresolved unless accepted. */
export async function closePackageAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  if (isReadOnly(user)) return { error: "Viewers cannot close packages." };
  const packageId = String(formData.get("packageId") ?? "");
  const ruleCeased = formData.get("ruleCeased") === "on";
  const closureNote = String(formData.get("closureNote") ?? "").trim() || null;
  const pkg = await db.package.findUniqueOrThrow({
    where: { id: packageId },
    include: { members: { include: { document: { include: { revisions: { where: { state: "RELEASED" }, orderBy: { releasedAt: "desc" }, take: 1 } } } } } },
  });
  if (pkg.closedAt) return { error: "Already closed." };
  const unresolved = pkg.members.some((m) => {
    const cur = m.document.revisions[0];
    return cur?.statusCode !== m.requiredStatus;
  });
  if (unresolved && !pkg.shortfallAcceptedBy) {
 if (!pkg.shortfallIssuedAt) return { error: "A shortfall exists and has not been issued to the acceptance authority." };
 return { error: "Closure blocked — an unresolved shortfall must first be accepted by the acceptance authority." };
  }
 if (pkg.type === "ACCUMULATED" && !ruleCeased) return { error: "State that the membership rule has ceased to admit members." };
  await db.package.update({ where: { id: packageId }, data: { closedAt: new Date(), closureNote, ruleCeasedAt: pkg.type === "ACCUMULATED" && ruleCeased ? new Date() : null } });
 await audit({ actor: user, action: "PACKAGE_CLOSED", entityType: "Package", entityId: pkg.identifier, entityLabel: pkg.identifier, detail: "Closure declared." });
  revalidatePath(`/packages/${pkg.identifier}`);
  return {};
}

/** Acceptance authority accepts a shortfall (§15.8) — recorded with its authority. */
export async function acceptShortfallAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  const packageId = String(formData.get("packageId") ?? "");
  const pkg = await db.package.findUniqueOrThrow({ where: { id: packageId } });
 if (user.id !== pkg.acceptanceAuthorityId && !isAdmin(user)) return { error: "Only the acceptance authority may accept the shortfall." };
  await db.package.update({ where: { id: packageId }, data: { shortfallAcceptedBy: user.name, shortfallIssuedAt: pkg.shortfallIssuedAt ?? new Date() } });
 await audit({ actor: user, action: "SHORTFALL_ACCEPTED", entityType: "Package", entityId: pkg.identifier, entityLabel: pkg.identifier, detail: "Shortfall accepted by the acceptance authority." });
  revalidatePath(`/packages/${pkg.identifier}`);
  return {};
}

/**
 * Step 2 of the schedule process: the project manager says which departments
 * an activity concerns. Until this is done nobody can list its documents.
 */
