"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { audit, notifyMany } from "@/lib/audit";
import { departmentRows, departmentMembers, senderRecipients, senderRows, isDepartmentSender } from "@/lib/requirements-process";
import { departmentsOf, businessDaysBefore, DEFAULT_LEAD_BUSINESS_DAYS } from "@/lib/schedule";
import { parseDate } from "@/lib/controlled/registry";
import { fmtDate } from "@/lib/utils";

type State = { error?: string; ok?: string };

const PAGE = "/actions/requirements";

function refresh() {
  revalidatePath(PAGE);
  revalidatePath("/actions");
  revalidatePath("/");
}

/**
 * Step 3 — ask each chosen department for the documents its activities need.
 * A call covers the department's activities no earlier call covered, so a new
 * schedule version only asks about what is new.
 */
export async function issueCallsAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const { user, db } = ctx;
  if (!ctx.can("CONTROL")) return { error: "Document Control issues the calls to departments." };
  const chosen = formData.getAll("department").map(String).filter(Boolean);
  const dueAt = parseDate(String(formData.get("dueAt") ?? ""));
  if (!chosen.length) return { error: "Choose at least one department." };
  if (!dueAt) return { error: "Give the date the departments must answer by." };
  if (dueAt.getTime() < Date.now() - 86_400_000) return { error: "The answer date is in the past." };

  const rows = (await departmentRows(ctx)).filter((r) => chosen.includes(r.department) && r.notIssued.length);
  if (!rows.length) return { error: "Those departments have no activity left to ask about." };

  const unstaffed: string[] = [];
  for (const r of rows) {
    const call = await db.requirementCall.create({
      data: { projectId: ctx.projectId, department: r.department, actionCodes: r.notIssued.join(","), dueAt, issuedById: user.id, issuedByName: user.name },
    });
    const members = await departmentMembers(ctx, r.department);
    if (!members.length) unstaffed.push(r.department);
    await notifyMany(members, "REQUIREMENT_CALL",
      `List the documents ${r.department} needs — due ${fmtDate(dueAt)}`,
      `${r.notIssued.length} activit${r.notIssued.length === 1 ? "y" : "ies"}: ${r.notIssued.join(", ")}. Download your department's sheet, fill it and return it to Document Control.`,
      PAGE);
    await audit({ actor: user, action: "REQUIREMENT_CALL_ISSUED", entityType: "RequirementCall", entityId: call.id, entityLabel: r.department, detail: `${r.notIssued.join(", ")} · answer by ${fmtDate(dueAt)}` });
  }
  refresh();
  return {
    ok: `Issued to ${rows.map((r) => r.department).join(", ")}.${unstaffed.length ? ` Nobody is assigned to ${unstaffed.join(", ")} yet — set their department on the People page, then remind them.` : ""}`,
  };
}

/** Step 5 — a late department is reminded; each reminder is counted and audited. */
export async function remindCallAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const { user, db } = ctx;
  if (!ctx.can("CONTROL")) return { error: "Document Control sends reminders." };
  const call = await db.requirementCall.findFirst({ where: { id: String(formData.get("callId") ?? "") } });
  if (!call || call.answeredAt) return { error: "That call is already answered." };
  const members = await departmentMembers(ctx, call.department);
  if (!members.length) return { error: `Nobody is assigned to ${call.department} — set their department on the People page.` };
  const late = call.dueAt.getTime() < Date.now();
  await db.requirementCall.update({ where: { id: call.id }, data: { reminders: { increment: 1 }, lastRemindedAt: new Date() } });
  await notifyMany(members, "REQUIREMENT_REMINDER",
    `${late ? "Overdue" : "Reminder"}: ${call.department} document list${late ? ` was due ${fmtDate(call.dueAt)}` : ` due ${fmtDate(call.dueAt)}`}`,
    `Reminder ${call.reminders + 1} from ${user.name}. Activities: ${call.actionCodes.split(",").join(", ")}.`,
    PAGE);
  await audit({ actor: user, action: "REQUIREMENT_CALL_REMINDED", entityType: "RequirementCall", entityId: call.id, entityLabel: call.department, detail: `Reminder ${call.reminders + 1}${late ? " — overdue" : ""}` });
  refresh();
  return { ok: `${call.department} reminded (${members.length} people).` };
}

/** A department answers that it needs nothing — recorded, not assumed. */
export async function closeCallAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const { user, db } = ctx;
  if (!ctx.can("CONTROL")) return { error: "Document Control records the answer." };
  const note = String(formData.get("note") ?? "").trim();
  if (!note) return { error: "Say what the department answered — e.g. \"Nothing needed for these activities\"." };
  const call = await db.requirementCall.findFirst({ where: { id: String(formData.get("callId") ?? "") } });
  if (!call || call.answeredAt) return { error: "That call is already answered." };
  await db.requirementCall.update({ where: { id: call.id }, data: { answeredAt: new Date(), answerNote: note } });
  await audit({ actor: user, action: "REQUIREMENT_CALL_ANSWERED", entityType: "RequirementCall", entityId: call.id, entityLabel: call.department, detail: note });
  refresh();
  return { ok: `${call.department} recorded as answered.` };
}

/**
 * Step 7 — the approved list goes to whoever sends each document. Suppliers
 * also see it in their package; our departments see it here and on Home.
 */
export async function issueToSendersAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const { user, db } = ctx;
  if (!ctx.can("CONTROL")) return { error: "Document Control issues the list to senders." };
  const chosen = formData.getAll("sender").map(String).filter(Boolean);
  if (!chosen.length) return { error: "Choose at least one sender." };
  const rows = (await senderRows(ctx)).filter((r) => chosen.includes(r.sender));
  const nobody: string[] = [];
  for (const r of rows) {
    await db.senderIssue.create({ data: { projectId: ctx.projectId, sender: r.sender, entryCount: r.documents, issuedById: user.id, issuedByName: user.name } });
    const to = await senderRecipients(ctx, r.sender);
    const name = isDepartmentSender(r.sender) ? r.sender.slice(5) : r.sender;
    if (!to.length) nobody.push(name);
    await notifyMany(to, "REQUIREMENTS_ISSUED",
      `${r.documents} document${r.documents === 1 ? "" : "s"} to deliver — first due ${fmtDate(r.firstNeeded)}`,
      "Base your delivery baseline on these submit-by dates. Reviewers need the working days between submit-by and the activity.",
      isDepartmentSender(r.sender) ? PAGE : "/packages");
    await audit({ actor: user, action: "REQUIREMENTS_ISSUED", entityType: "SenderIssue", entityId: r.sender, entityLabel: name, detail: `${r.documents} document(s), first due ${fmtDate(r.firstNeeded)}` });
  }
  refresh();
  return { ok: `Issued to ${rows.length} sender${rows.length === 1 ? "" : "s"}.${nobody.length ? ` No one to notify for ${nobody.join(", ")} — assign people first.` : ""}` };
}

/**
 * Step 8 — before the activity, a department confirms its documents are
 * available. Declaring a shortage needs a note, and alerts Document Control.
 */
export async function confirmReadinessAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const { user, db } = ctx;
  const actionId = String(formData.get("actionId") ?? "");
  const department = String(formData.get("department") ?? "");
  const available = formData.get("available") === "yes";
  const note = String(formData.get("note") ?? "").trim() || null;

  const action = await db.action.findFirst({ where: { id: actionId }, include: { entries: { where: { OR: [{ department }, { department: null }] }, include: { document: { include: { revisions: { where: { state: "RELEASED" }, orderBy: { releasedAt: "desc" }, take: 1 } } } } } } });
  if (!action) return { error: "That activity no longer exists." };
  if (!departmentsOf(action).includes(department)) return { error: `${department} is not concerned by ${action.code}.` };
  // Confirmation belongs to the review window: from submit-by to the activity.
  const opens = action.scheduledDate ? businessDaysBefore(action.scheduledDate, DEFAULT_LEAD_BUSINESS_DAYS) : null;
  if (opens && opens.getTime() > Date.now()) return { error: `Confirmation opens ${fmtDate(opens)}, ${DEFAULT_LEAD_BUSINESS_DAYS} working days before the activity.` };

  const membership = await db.projectMembership.findFirst({ where: { projectId: ctx.projectId, userId: user.id, active: true } });
  if (membership?.department !== department && !ctx.can("CONTROL")) return { error: `Only someone from ${department} confirms for ${department}.` };

  const missing = action.entries.filter((e) => e.document.revisions[0]?.statusCode !== e.requiredStatus);
  if (available && missing.length && !note) {
    return { error: `${missing.length} document${missing.length === 1 ? " is" : "s are"} not at the required status (${missing.map((e) => e.document.docNumber).join(", ")}). Say why the activity can still go ahead, or declare them missing.` };
  }
  if (!available && !note) return { error: "Say what is missing — Document Control is alerted." };

  await db.readinessConfirmation.upsert({
    where: { actionId_department: { actionId, department } },
    create: { projectId: ctx.projectId, actionId, department, available, note, confirmedById: user.id, confirmedByName: user.name },
    update: { available, note, confirmedById: user.id, confirmedByName: user.name, confirmedAt: new Date() },
  });
  if (!available) {
    const controllers = await db.projectMembership.findMany({ where: { projectId: ctx.projectId, active: true, function: { legacyRole: "CONTROLLER" } }, select: { userId: true } });
    await notifyMany(controllers.map((c) => c.userId), "READINESS_SHORT",
      `${action.code}: ${department} documents not available`, note ?? undefined, `/actions/${action.code}`);
  }
  await audit({ actor: user, action: available ? "READINESS_CONFIRMED" : "READINESS_SHORT", entityType: "Action", entityId: action.id, entityLabel: `${action.code} · ${department}`, detail: note ?? (available ? "Documents available" : "") });
  revalidatePath(`/actions/${action.code}`);
  refresh();
  return { ok: available ? `${department} confirmed for ${action.code}.` : `Shortage recorded; Document Control alerted.` };
}
