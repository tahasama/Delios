"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { isController, isAdmin } from "@/lib/auth";
import { audit, notify } from "@/lib/audit";
import { controlDoes, actIsOff } from "@/lib/control-activities";
import { delegationRefusal, delegationFlag } from "@/lib/delegation";
import type { Verb } from "@/lib/permissions";

/**
 * Handing a review step to somebody else, and carrying that out.
 *
 * Where Document Control carries this act out, the reviewer asks and the request
 * waits; where the people doing the work carry it out themselves, the same form
 * puts the delegation in force at once. Which of the two is in use is read from
 * the project — see `src/lib/control-activities.ts` — and an administrator may
 * override it per project.
 */

type State = { error?: string; message?: string };

/** What the form says, and the review it was raised from. */
async function asked(formData: FormData) {
  const cycleId = String(formData.get("cycleId") ?? "") || null;
  const toUserIds = [...new Set(formData.getAll("toUserId").map(String).filter(Boolean))];
  const verb = (String(formData.get("verb") ?? "REVIEW") === "APPROVE" ? "APPROVE" : "REVIEW") as Verb;
  const endDate = String(formData.get("endDate") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || null;
  return { cycleId, toUserIds, verb, endDate, reason };
}

export async function delegateReviewAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const { user, db, projectId } = ctx;
  const { cycleId, toUserIds, verb, endDate, reason } = await asked(formData);
  if (await actIsOff(ctx, "DELEGATE")) return { error: "Handing a review over is not used on this project: the step is answered by the person it was given to." };
  if (!toUserIds.length) return { error: "Say who takes it." };
  if (!endDate) return { error: "A delegation ends on a date — say when (§8.5)." };
  const ends = new Date(`${endDate}T23:59:59`);
  if (Number.isNaN(ends.getTime())) return { error: "That is not a date." };
  if (ends < new Date()) return { error: "A delegation cannot end in the past." };

  const cycle = cycleId
    ? await db.reviewCycle.findUnique({
        where: { id: cycleId },
        include: { assignments: true, revision: { include: { document: true } } },
      })
    : null;
  if (cycleId && !cycle) return { error: "That review no longer exists." };
  if (cycle && cycle.status !== "OPEN") return { error: "That review is closed — there is nothing left to hand over." };
  const target = cycle?.revision.document ?? null;
  if (!target) return { error: "A delegation is raised from a review." };

  // One person or several; any one of them may answer in the holder's place.
  const people = await db.user.findMany({ where: { id: { in: toUserIds }, active: true }, select: { id: true, name: true } });
  if (people.length < toUserIds.length) return { error: "Somebody chosen has no active account." };

  // Where the matrix is the only rule, only somebody it names for this act may
  // be handed the step; otherwise anyone on the project, flagged when the
  // matrix does not name them. Either way the record says who chose whom.
  for (const takes of people) {
    const refusal = await delegationRefusal(ctx, {
      target, verb, fromUserId: user.id, fromName: user.name, toUserId: takes.id, toName: takes.name,
    });
    if (refusal) return { error: refusal };
  }

  const throughControl = await controlDoes(ctx, "DELEGATE");
  const label = `${target.docNumber} rev ${cycle!.revision.value}`;
  for (const takes of people) {
    const flag = await delegationFlag(ctx, { target, verb, toUserId: takes.id, toName: takes.name });
    const row = await db.delegation.create({
      data: {
        projectId,
        fromUserId: user.id,
        toUserId: takes.id,
        cycleId: cycle!.id,
        verb,
        scope: `${target.discipline} · ${target.docType}`,
        endDate: ends,
        reason,
        status: throughControl ? "OPEN" : "ACTIVE",
        askedById: user.id,
        askedByName: user.name,
        ...(throughControl ? {} : { grantedById: user.id, grantedByName: user.name, grantedAt: new Date() }),
      },
    });
    await audit({
      tenant: ctx, actor: user, action: throughControl ? "DELEGATION_REQUESTED" : "DELEGATION_GRANTED",
      entityType: "Delegation", entityId: row.id, entityLabel: label,
      newValue: `${user.name} → ${takes.name}`,
      detail: `${user.name} delegated ${verb === "APPROVE" ? "the decision" : "their advice"} on ${label} to ${takes.name}, until ${endDate}, and answers for that choice.${reason ? ` ${reason}` : ""}${flag ? ` Flagged: ${flag}` : ""}`,
    });
    if (!throughControl) await notify(takes.id, "DELEGATION_GRANTED", `You answer ${label} for ${user.name}`, `Until ${endDate}.`, `/reviews/${cycle!.id}`, ctx);
  }
  const names = people.map((one) => one.name).join(", ");
  if (throughControl) {
    const { holdersOf } = await import("@/lib/permissions");
    for (const one of await holdersOf(ctx, "CONTROL")) {
      await notify(one.id, "DELEGATION_REQUESTED", `Delegation asked for on ${label}`, `${user.name} asks that ${names} answer in their place.`, `/reviews/${cycle!.id}`, ctx);
    }
  }
  revalidatePath(`/reviews/${cycle!.id}`);
  revalidatePath(`/documents/${target.id}`);
  return { message: throughControl ? "Asked. Document Control puts it in force." : `${names} ${people.length === 1 ? "answers" : "may answer"} it in your place.` };
}

/** Document Control puts an asked-for delegation in force. */
export async function grantDelegationAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const { user, db } = ctx;
  if (!isController(user) && !isAdmin(user)) return { error: "Document Control puts a delegation in force." };
  const id = String(formData.get("delegationId") ?? "");
  const row = await db.delegation.findUnique({
    where: { id },
    include: { fromUser: { select: { name: true } }, toUser: { select: { id: true, name: true } }, cycle: { include: { revision: { include: { document: true } } } } },
  });
  if (!row) return { error: "That request no longer exists." };
  if (row.status !== "OPEN") return { error: "That request has already been answered." };
  const target = row.cycle?.revision.document ?? null;
  if (!target) return { error: "The review this was raised from no longer exists." };
  if (await actIsOff(ctx, "DELEGATE")) return { error: "Handing a review over is no longer used on this project, so this request can only be declined." };

  // Asked for yesterday, carried out today: the rule is applied now, not then.
  const refusal = await delegationRefusal(ctx, {
    target, verb: row.verb as Verb, fromUserId: row.fromUserId, fromName: row.fromUser.name,
    toUserId: row.toUserId, toName: row.toUser.name,
  });
  if (refusal) return { error: refusal };

  await db.delegation.update({
    where: { id },
    data: { status: "ACTIVE", grantedById: user.id, grantedByName: user.name, grantedAt: new Date() },
  });
  const label = `${target.docNumber} rev ${row.cycle!.revision.value}`;
  await audit({
    tenant: ctx, actor: user, action: "DELEGATION_GRANTED", entityType: "Delegation", entityId: id,
    entityLabel: label, newValue: `${row.fromUser.name} → ${row.toUser.name}`, detail: "Put in force by Document Control.",
  });
  await notify(row.toUser.id, "DELEGATION_GRANTED", `You answer ${label} for ${row.fromUser.name}`, `Until ${row.endDate.toISOString().slice(0, 10)}.`, `/reviews/${row.cycleId}`, ctx);
  revalidatePath(`/reviews/${row.cycleId}`);
  return { message: `${row.toUser.name} answers it in ${row.fromUser.name}'s place.` };
}

/** Document Control declines it, with a reason — a refusal must be answerable. */
export async function refuseDelegationAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const { user, db } = ctx;
  if (!isController(user) && !isAdmin(user)) return { error: "Document Control answers a delegation request." };
  const id = String(formData.get("delegationId") ?? "");
  const why = String(formData.get("refusedReason") ?? "").trim();
  if (!why) return { error: "Say why, so the person who asked knows what to do next." };
  const row = await db.delegation.findUnique({ where: { id }, include: { fromUser: { select: { id: true, name: true } }, toUser: { select: { name: true } } } });
  if (!row) return { error: "That request no longer exists." };
  if (row.status !== "OPEN") return { error: "That request has already been answered." };
  await db.delegation.update({ where: { id }, data: { status: "REFUSED", refusedReason: why, grantedById: user.id, grantedByName: user.name, grantedAt: new Date() } });
  await audit({
    tenant: ctx, actor: user, action: "DELEGATION_REFUSED", entityType: "Delegation", entityId: id,
    entityLabel: `${row.fromUser.name} → ${row.toUser.name}`, newValue: why, detail: "Declined by Document Control.",
  });
  await notify(row.fromUser.id, "DELEGATION_REFUSED", "Your delegation was not put in force", why, `/reviews/${row.cycleId}`, ctx);
  revalidatePath(`/reviews/${row.cycleId}`);
  return { message: "Declined, and the person who asked has been told." };
}

/** The person who gave it takes it back; Document Control may also end it. */
export async function endDelegationAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const { user, db } = ctx;
  const id = String(formData.get("delegationId") ?? "");
  const row = await db.delegation.findUnique({ where: { id }, include: { toUser: { select: { id: true, name: true } } } });
  if (!row) return { error: "That delegation no longer exists." };
  if (row.fromUserId !== user.id && !isController(user) && !isAdmin(user)) {
    return { error: "Only the person who handed the step over, or Document Control, ends it." };
  }
  if (row.status !== "ACTIVE" && row.status !== "OPEN") return { error: "It is not in force." };
  await db.delegation.update({ where: { id }, data: { status: "WITHDRAWN" } });
  await audit({
    tenant: ctx, actor: user, action: "DELEGATION_WITHDRAWN", entityType: "Delegation", entityId: id,
    entityLabel: row.toUser.name, detail: "Ended before its date.",
  });
  await notify(row.toUser.id, "DELEGATION_WITHDRAWN", "A delegation to you was ended", `${user.name} ended it.`, `/reviews/${row.cycleId}`, ctx);
  revalidatePath(`/reviews/${row.cycleId}`);
  return { message: "Ended." };
}
