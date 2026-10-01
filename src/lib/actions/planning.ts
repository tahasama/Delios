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
  // Handed to an organization on the project; its name is kept with the package.
  const recipientPartyId = String(formData.get("recipientPartyId") ?? "") || null;
  const recipientParty = recipientPartyId ? await db.party.findFirst({ where: { id: recipientPartyId }, select: { id: true, name: true } }) : null;
  const recipientName = recipientParty?.name ?? String(formData.get("recipientName") ?? "").trim();
  const completionDate = String(formData.get("completionDate") ?? "");
  const requiredStatus = String(formData.get("requiredStatus") ?? "");
  const compositionOwnerId = String(formData.get("compositionOwnerId") ?? "");
  const acceptanceAuthorityId = String(formData.get("acceptanceAuthorityId") ?? "");
 if (!identifier) return { error: "A package identifier is required — unique, never reused." };
 if (!purpose) return { error: "Every package states a reason for issue." };
 if (!type) return { error: "Defined or accumulated — state the type." };
 if (type === "ACCUMULATED" && !membershipRule) return { error: "An accumulated package states its membership rule." };
 if (!recipientName) return { error: "Choose the organization it is delivered to." };
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
      identifier, purpose, type, membershipRule, recipientName, recipientPartyId: recipientParty?.id ?? null,
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

/**
 * §15.8 — delivering the package, which closes it. Not while a shortfall is
 * unresolved unless accepted. Where the package names an organization, one
 * transmittal carries every document that is ready, at the package's reason
 * for issue; that transmittal is the delivery.
 */
export async function closePackageAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId } = ctx;
  if (isReadOnly(user)) return { error: "Viewers cannot close packages." };
  const packageId = String(formData.get("packageId") ?? "");
  const ruleCeased = formData.get("ruleCeased") === "on";
  const closureNote = String(formData.get("closureNote") ?? "").trim() || null;
  const pkg = await db.package.findUniqueOrThrow({
    where: { id: packageId },
    include: { members: { include: { document: { include: { revisions: { where: { state: "RELEASED" }, orderBy: { releasedAt: "desc" }, take: 1 } } } } } },
  });
  if (pkg.closedAt) return { error: "Already delivered." };
  if (!pkg.assessedAt) return { error: "Check readiness first." };
  const ready = pkg.members.filter((m) => m.document.revisions[0]?.statusCode === m.requiredStatus);
  const unresolved = ready.length < pkg.members.length;
  if (unresolved && !pkg.shortfallAcceptedBy) {
 if (!pkg.shortfallIssuedAt) return { error: "Some documents are not ready. Send the shortfall to the acceptance authority first." };
 return { error: "Delivery waits for the acceptance authority to accept what is missing." };
  }
 if (pkg.type === "ACCUMULATED" && !ruleCeased) return { error: "State that no more documents will be added." };
  if (pkg.recipientPartyId && !ready.length) return { error: "Nothing is ready to deliver." };

  let transmittalId: string | null = null;
  let number: string | null = null;
  if (pkg.recipientPartyId) {
    const { nextRecordNumber } = await import("@/lib/numbering-records");
    const [internal, project, party] = await Promise.all([
      db.party.findFirst({ where: { isInternal: true }, select: { code: true, name: true } }),
      db.project.findUnique({ where: { id: projectId }, select: { code: true } }),
      db.party.findFirst({ where: { id: pkg.recipientPartyId }, select: { code: true, name: true, users: { where: { active: true }, select: { id: true, name: true } } } }),
    ]);
    if (!party) return { error: "The organization it is delivered to no longer exists." };
    number = await nextRecordNumber(ctx, "TRANSMITTAL", { project: project?.code ?? "", sender: internal?.code ?? null, receiver: party.code, reason: pkg.purpose }, "TR");
    const people = party.users.length ? party.users.map((one) => ({ name: one.name, organization: party.name, userId: one.id })) : [{ name: party.name, organization: party.name, userId: null as string | null }];
    const sent = await db.transmittal.create({
      data: {
        projectId, number, direction: "OUTGOING", reasonForIssue: pkg.purpose, dateOfIssue: new Date(),
        issuingParty: internal?.name ?? "Our organization",
        subject: `Package ${pkg.identifier} — ${ready.length} document${ready.length === 1 ? "" : "s"} at ${pkg.requiredStatus}`,
        message: closureNote, status: "ISSUED", createdById: user.id, createdByName: user.name,
        items: { create: ready.map((m) => ({ projectId, revisionId: m.document.revisions[0].id })) },
        recipients: { create: people.map((one) => ({ projectId, name: one.name, organization: one.organization, userId: one.userId })) },
      },
    });
    transmittalId = sent.id;
    const { notifyMany } = await import("@/lib/audit");
    await notifyMany(people.map((one) => one.userId).filter((id): id is string => !!id), "TRANSMITTAL_RECEIVED", `Package ${pkg.identifier} — ${number}`, `Delivered to you: ${ready.length} document${ready.length === 1 ? "" : "s"}.`, `/transmittals/${sent.id}`, ctx);
  }
  const now = new Date();
  await db.package.update({
    where: { id: packageId },
    data: { closedAt: now, closureNote, deliveredAt: transmittalId ? now : null, transmittalId, ruleCeasedAt: pkg.type === "ACCUMULATED" && ruleCeased ? now : null },
  });
 await audit({ actor: user, action: "PACKAGE_CLOSED", entityType: "Package", entityId: pkg.identifier, entityLabel: pkg.identifier, newValue: number, detail: number ? `Delivered to ${pkg.recipientName} on ${number}: ${ready.length} of ${pkg.members.length} documents.` : "Closure declared." });
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
