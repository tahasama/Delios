"use server";

import { redirect } from "next/navigation";
import { requireScope } from "@/lib/scope";
import { revalidatePath } from "next/cache";
import { isController, isAdmin } from "@/lib/auth";
import { audit, notify } from "@/lib/audit";
import { isReadOnly } from "@/lib/auth";
import { filterFromForm, isEmpty, describeFilter, syncPackage, parseExcluded, meetsStatus, recipientIds } from "@/lib/package-rule";

// ── Actions & deliverable baseline (Part 14) ─────────────────────────────────




// ── Packages (Part 15) ───────────────────────────────────────────────────────

export async function createPackageAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  if (isReadOnly(user)) return { error: "Viewers cannot create packages." };
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const purpose = String(formData.get("purpose") ?? "");

  // A package filled by a rule states it as a filter; its words are made from it.
  const filter = filterFromForm(formData);
  const membershipRule = !isEmpty(filter) ? await describeFilter(ctx, filter) : null;
  // A package with a rule keeps filling itself; the Standard calls it accumulated.
  const type = membershipRule ? "ACCUMULATED" : "DEFINED";
  // Handed to one or more organizations on the project — ours included, for an
  // internal handover. Their names are kept with the package.
  const partyIds = formData.getAll("recipientPartyIds").map(String).filter(Boolean);
  const recipients = partyIds.length ? await db.party.findMany({ where: { id: { in: partyIds } }, select: { id: true, name: true } }) : [];
  const recipientName = recipients.map((one) => one.name).join(", ");
  const completionDate = String(formData.get("completionDate") ?? "");
  // One status or several: a document is ready at any of them.
  const requiredStatus = formData.getAll("requiredStatus").map(String).filter(Boolean).join(",");
  const compositionOwnerId = String(formData.get("compositionOwnerId") ?? "");
  const acceptanceAuthorityId = String(formData.get("acceptanceAuthorityId") ?? "");
 if (!title) return { error: "Give the package a title." };
 if (!purpose) return { error: "Every package states a reason for issue." };
 if (!recipients.length) return { error: "Choose who it is delivered to — another organization, or us." };
 if (!completionDate) return { error: "The completion date is required — it triggers assessment." };
 if (!requiredStatus) return { error: "State the status members shall have reached." };
 if (!compositionOwnerId || !acceptanceAuthorityId) return { error: "Both owners are required." };
 if (compositionOwnerId === acceptanceAuthorityId) return { error: "The two owners shall not be the same person." };
  // Numbered like every record here; a number already taken is skipped.
  const { nextRecordNumber } = await import("@/lib/numbering-records");
  const project = await db.project.findUnique({ where: { id: projectId }, select: { code: true } });
  let identifier = "";
  for (let tries = 0; tries < 50; tries++) {
    identifier = await nextRecordNumber(ctx, "PACKAGE", { project: project?.code ?? "", sender: null, receiver: null, reason: purpose }, "PK");
    if (!(await db.package.findFirst({ where: { identifier }, select: { id: true } }))) break;
  }
  const [owner, acceptor] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: compositionOwnerId } }),
    db.user.findUniqueOrThrow({ where: { id: acceptanceAuthorityId } }),
  ]);
  const created = await db.package.create({
    data: {
      projectId,
      membershipFilter: membershipRule ? JSON.stringify(filter) : null,
      identifier, title, description, purpose, type, membershipRule, recipientName,
      recipientPartyId: recipients[0]?.id ?? null, recipientPartyIds: JSON.stringify(recipients.map((one) => one.id)),
      completionDate: new Date(completionDate), requiredStatus,
      compositionOwnerId, compositionOwnerName: owner.name,
      acceptanceAuthorityId, acceptanceAuthorityName: acceptor.name,
    },
  });
 const joined = await syncPackage(ctx, created.id);
 await audit({ actor: user, action: "PACKAGE_CREATED", entityType: "Package", entityId: identifier, entityLabel: identifier, detail: `${membershipRule ? `Filled by rule: ${membershipRule} (${joined} document${joined === 1 ? "" : "s"} now)` : "A list we choose"} — ${owner.name} composes, ${acceptor.name} accepts.` });
  redirect(`/packages/${identifier}`);
}

export async function addPackageMemberAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId } = ctx;
  if (isReadOnly(user)) return { error: "Viewers cannot change composition." };
  const packageId = String(formData.get("packageId") ?? "");
  const documentIds = formData.getAll("documentId").map(String).filter(Boolean);
  const requiredStatus = formData.getAll("requiredStatus").map(String).filter(Boolean).join(",");
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
  // Added back by hand: no longer kept out.
  const excluded = parseExcluded(pkg.membershipExcluded);
  if (excluded.some((id) => fresh.includes(id))) {
    await db.package.update({ where: { id: packageId }, data: { membershipExcluded: JSON.stringify(excluded.filter((id) => !fresh.includes(id))) } });
  }
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
  await syncPackage(ctx, packageId);
  const pkg = await db.package.findUniqueOrThrow({ where: { id: packageId }, include: { members: { include: { document: { include: { revisions: { where: { state: "RELEASED" }, orderBy: { releasedAt: "desc" }, take: 1 } } } } } } });
  if (pkg.closedAt) return { error: "Package already closed." };
  const shortfall = [];
  let complete = true;
  for (const m of pkg.members) {
    const current = m.document.revisions[0];
    const at = meetsStatus(current?.statusCode, m.requiredStatus);
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
  await syncPackage(ctx, packageId);
  const pkg = await db.package.findUniqueOrThrow({
    where: { id: packageId },
    include: { members: { include: { document: { include: { revisions: { where: { state: "RELEASED" }, orderBy: { releasedAt: "desc" }, take: 1 } } } } } },
  });
  if (pkg.closedAt) return { error: "Already delivered." };
  if (!pkg.assessedAt) return { error: "Check readiness first." };
  const ready = pkg.members.filter((m) => meetsStatus(m.document.revisions[0]?.statusCode, m.requiredStatus));
  const unresolved = ready.length < pkg.members.length;
  if (unresolved && !pkg.shortfallAcceptedBy) {
 if (!pkg.shortfallIssuedAt) return { error: "Some documents are not ready. Send the shortfall to the acceptance authority first." };
 return { error: "Delivery waits for the acceptance authority to accept what is missing." };
  }
 if (pkg.type === "ACCUMULATED" && !ruleCeased) return { error: "State that no more documents will be added." };
  if (pkg.recipientPartyId && !ready.length) return { error: "Nothing is ready to deliver." };

  const going = recipientIds(pkg);
  if (going.length && !ready.length) return { error: "Nothing is ready to deliver." };
  let transmittalId: string | null = null;
  const numbers: string[] = [];
  if (going.length) {
    const { nextRecordNumber } = await import("@/lib/numbering-records");
    const { notifyMany } = await import("@/lib/audit");
    const [internal, project, parties] = await Promise.all([
      db.party.findFirst({ where: { isInternal: true }, select: { code: true, name: true } }),
      db.project.findUnique({ where: { id: projectId }, select: { code: true } }),
      db.party.findMany({ where: { id: { in: going } }, select: { code: true, name: true, isInternal: true, users: { where: { active: true }, select: { id: true, name: true } } } }),
    ]);
    if (!parties.length) return { error: "The organizations it is delivered to no longer exist." };
    for (const party of parties) {
      // Handed over inside our own organization: to whoever accepts it, not to everyone.
      const people = party.isInternal
        ? [{ name: pkg.acceptanceAuthorityName, organization: party.name, userId: pkg.acceptanceAuthorityId as string | null }]
        : party.users.length ? party.users.map((one) => ({ name: one.name, organization: party.name, userId: one.id as string | null })) : [{ name: party.name, organization: party.name, userId: null as string | null }];
      const number = await nextRecordNumber(ctx, "TRANSMITTAL", { project: project?.code ?? "", sender: internal?.code ?? null, receiver: party.code, reason: pkg.purpose }, "TR");
      const sent = await db.transmittal.create({
        data: {
          projectId, number, packageId: pkg.id, direction: "OUTGOING", reasonForIssue: pkg.purpose, dateOfIssue: new Date(),
          issuingParty: internal?.name ?? "Our organization",
          subject: `${pkg.identifier} ${pkg.title ?? ""} — ${ready.length} document${ready.length === 1 ? "" : "s"}`.replace(/\s+/g, " "),
          message: closureNote, status: "ISSUED", createdById: user.id, createdByName: user.name,
          items: { create: ready.map((m) => ({ projectId, revisionId: m.document.revisions[0].id })) },
          recipients: { create: people.map((one) => ({ projectId, name: one.name, organization: one.organization, userId: one.userId })) },
        },
      });
      transmittalId = transmittalId ?? sent.id;
      numbers.push(number);
      await notifyMany(people.map((one) => one.userId).filter((id): id is string => !!id), "TRANSMITTAL_RECEIVED", `${pkg.identifier} — ${number}`, `Delivered to you: ${ready.length} document${ready.length === 1 ? "" : "s"}.`, `/transmittals/${sent.id}`, ctx);
    }
    // The acceptance authority accepts it now that it is delivered.
    await notify(pkg.acceptanceAuthorityId, "PACKAGE_DELIVERED", `${pkg.identifier} delivered — accept it`, `${ready.length} document${ready.length === 1 ? "" : "s"} went out on ${numbers.join(", ")}. Accept the package when it is complete.`, `/packages/${pkg.identifier}`);
  }
  const number = numbers.join(", ") || null;
  const now = new Date();
  await db.package.update({
    where: { id: packageId },
    data: { closedAt: now, closureNote, deliveredAt: transmittalId ? now : null, transmittalId, ruleCeasedAt: pkg.type === "ACCUMULATED" && ruleCeased ? now : null },
  });
 await audit({ actor: user, action: "PACKAGE_CLOSED", entityType: "Package", entityId: pkg.identifier, entityLabel: pkg.identifier, newValue: number, detail: number ? `Delivered to ${pkg.recipientName} on ${number}: ${ready.length} of ${pkg.members.length} documents.` : "Closure declared." });
  revalidatePath(`/packages/${pkg.identifier}`);
  return {};
}

/** Take documents out of a package. One the rule matches stays out. */
export async function removePackageMemberAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db } = ctx;
  if (isReadOnly(user)) return { error: "Viewers cannot change composition." };
  const packageId = String(formData.get("packageId") ?? "");
  const documentIds = formData.getAll("documentId").map(String).filter(Boolean);
  const reason = String(formData.get("reason") ?? "").trim();
  const pkg = await db.package.findUniqueOrThrow({ where: { id: packageId }, include: { members: { include: { document: { select: { docNumber: true } } } } } });
  if (pkg.closedAt) return { error: "The package is delivered — its contents are fixed." };
  if (user.id !== pkg.compositionOwnerId && !isController(user) && !isAdmin(user)) {
    return { error: `Only ${pkg.compositionOwnerName} or Document Control can change what is in this package.` };
  }
  if (!reason) return { error: "Say why they are taken out — it goes on the record." };
  const going = pkg.members.filter((m) => documentIds.includes(m.documentId));
  if (!going.length) return { error: "Tick the documents to take out." };
  await db.packageMember.deleteMany({ where: { packageId, documentId: { in: going.map((m) => m.documentId) } } });
  const excluded = [...new Set([...parseExcluded(pkg.membershipExcluded), ...going.map((m) => m.documentId)])];
  await db.package.update({ where: { id: packageId }, data: { membershipExcluded: JSON.stringify(excluded), assessedAt: null, shortfall: null, shortfallIssuedAt: null, shortfallAcceptedBy: null } });
  await audit({ actor: user, action: "PACKAGE_MEMBER", entityType: "Package", entityId: pkg.identifier, entityLabel: pkg.identifier, detail: `Taken out: ${going.map((m) => m.document.docNumber).join(", ")}. ${reason}` });
  revalidatePath(`/packages/${pkg.identifier}`);
  return {};
}

/** Set, change or clear the rule a package fills itself by. */
export async function setPackageRuleAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db } = ctx;
  if (isReadOnly(user)) return { error: "Viewers cannot change composition." };
  const packageId = String(formData.get("packageId") ?? "");
  const pkg = await db.package.findUniqueOrThrow({ where: { id: packageId } });
  if (pkg.closedAt) return { error: "The package is delivered — its contents are fixed." };
  if (user.id !== pkg.compositionOwnerId && !isController(user) && !isAdmin(user)) {
    return { error: `Only ${pkg.compositionOwnerName} or Document Control can change what is in this package.` };
  }
  const filter = filterFromForm(formData);
  const rule = isEmpty(filter) ? null : await describeFilter(ctx, filter);
  await db.package.update({
    where: { id: packageId },
    data: { membershipFilter: rule ? JSON.stringify(filter) : null, membershipRule: rule, type: rule ? "ACCUMULATED" : "DEFINED", ruleCeasedAt: null },
  });
  const joined = await syncPackage(ctx, packageId);
  await audit({ actor: user, action: "PACKAGE_RULE", entityType: "Package", entityId: pkg.identifier, entityLabel: pkg.identifier, oldValue: pkg.membershipRule, newValue: rule, detail: rule ? `Fills itself with ${rule}; ${joined} document${joined === 1 ? "" : "s"} joined.` : "No rule: documents are added by hand only." });
  revalidatePath(`/packages/${pkg.identifier}`);
  return {};
}

/** The acceptance authority accepts the delivered package: the last step. */
export async function acceptPackageAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db } = ctx;
  const packageId = String(formData.get("packageId") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  const pkg = await db.package.findUniqueOrThrow({ where: { id: packageId } });
  if (user.id !== pkg.acceptanceAuthorityId && !isAdmin(user)) return { error: `Only ${pkg.acceptanceAuthorityName} accepts this package.` };
  if (!pkg.closedAt) return { error: "It is accepted once it is delivered." };
  if (pkg.acceptedAt) return { error: "Already accepted." };
  await db.package.update({ where: { id: packageId }, data: { acceptedAt: new Date(), acceptedByName: user.name } });
  await audit({ actor: user, action: "PACKAGE_ACCEPTED", entityType: "Package", entityId: pkg.identifier, entityLabel: pkg.identifier, detail: `Accepted by ${user.name}.${note ? ` ${note}` : ""}` });
  await notify(pkg.compositionOwnerId, "PACKAGE_ACCEPTED", `${pkg.identifier} accepted`, `${user.name} accepted the package.`, `/packages/${pkg.identifier}`);
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
