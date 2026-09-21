"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { isController, isAdmin } from "@/lib/auth";
import { runAllChecks } from "@/lib/checks/engine";
import { CHECK_BY_ID } from "@/lib/checks/catalog";
import { audit, notify } from "@/lib/audit";

export async function runChecksAction(): Promise<void> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  if (!isController(user) && !isAdmin(user)) return;
  await runAllChecks(ctx, user);
  revalidatePath("/conformance");
  revalidatePath("/conformance/checks");
  revalidatePath("/conformance/defects");
  revalidatePath("/");
}

/** Accept an uncorrectable defect — reason, authority, review date; continues to be counted (§17.6). */
export async function acceptDefectAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  // C.11.5 — only the published acceptance authority may accept
  if (!isController(user) && !isAdmin(user)) return { error: "Acceptance is only by the published authority (C.11.5)." };
  const defectId = String(formData.get("defectId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const reviewDate = String(formData.get("reviewDate") ?? "") || null;
  if (!reason) return { error: "Acceptance requires a recorded reason (§17.6)." };
  if (!reviewDate) return { error: "An accepted defect carries a review date (CF-13)." };
  const defect = await db.defect.findUniqueOrThrow({ where: { id: defectId } });
  await db.defect.update({
    where: { id: defectId },
    data: { status: "ACCEPTED", acceptedByName: user.name, acceptedReason: reason, acceptedAt: new Date(), reviewDate: new Date(reviewDate) },
  });
  await audit({ actor: user, action: "DEFECT_ACCEPTED", entityType: "Defect", entityId: defectId, entityLabel: defect.checkId, newValue: reason, detail: `Accepted by ${user.name}; review date set; continues to be counted (CF-12).` });
  revalidatePath("/conformance/defects");
  return {};
}

/** A defect closes only when the re-run check no longer returns the item (§17.6). */
export async function closeDefectAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  if (!isController(user) && !isAdmin(user)) return { error: "Only the control function may record closure." };
  const defectId = String(formData.get("defectId") ?? "");
  const defect = await db.defect.findUniqueOrThrow({ where: { id: defectId } });
  const meta = CHECK_BY_ID.get(defect.checkId);
  const runner = (await import("@/lib/checks/runners")).RUNNERS[defect.checkId];
  if (runner) {
    const checkCtx = await (async () => (await import("@/lib/checks/runners")).buildCtx(ctx))();
    const result = await runner(checkCtx);
    if (Array.isArray(result)) {
      const still = result.find((f) => f.entityKey === defect.entityKey);
      if (still) return { error: `Closure refused — the check still returns this item (§17.6 / CF-11). Correct the controlled source, then re-run ${defect.checkId}.` };
    }
  } else if (meta) {
    return { error: `${defect.checkId} is not automated — closure requires evidence of the re-run check (§17.6).` };
  }
  await db.defect.update({ where: { id: defectId }, data: { status: "CLOSED", closedAt: new Date() } });
  await audit({ actor: user, action: "DEFECT_CLOSED", entityType: "Defect", entityId: defectId, entityLabel: defect.checkId, detail: "Re-run check no longer returns the item (§17.6)." });
  revalidatePath("/conformance/defects");
  return {};
}
