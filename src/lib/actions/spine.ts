"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { audit } from "@/lib/audit";
import { effectiveSpine, currentVersions, ALIGNMENT_LABEL, type Alignment } from "@/lib/spine";
import { STANDARD_VERSION } from "@/lib/standard";

type State = { error?: string; ok?: string };

const DECISIONS: Alignment[] = ["ALIGNED", "NOT_APPLICABLE", "WITHDRAWN"];

/**
 * F.5 rule 4 — each affected link is resolved as Aligned, Withdrawn or
 * Not applicable, with owner, date and decision evidence, against the versions
 * that are current now.
 */
export async function resolveSpineLinksAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const { db, user, orgId } = ctx;
  if (!ctx.can("CONTROL") && !ctx.can("CONFIGURE")) return { error: "The control function reviews the spine." };
  const keys = formData.getAll("key").map(String).filter(Boolean);
  const decision = String(formData.get("decision") ?? "") as Alignment;
  const reason = String(formData.get("reason") ?? "").trim() || null;
  const changeRef = String(formData.get("changeRef") ?? "").trim() || null;
  if (!keys.length) return { error: "Tick the links you reviewed." };
  if (!DECISIONS.includes(decision)) return { error: "Choose Aligned, Not applicable or Withdrawn." };
  if (decision !== "ALIGNED" && !reason) return { error: `${ALIGNMENT_LABEL[decision]} is recorded with its reason (F.4).` };

  const { rows } = await effectiveSpine(ctx);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  let done = 0;
  const refused: string[] = [];
  for (const key of keys) {
    const r = byKey.get(key);
    if (!r) continue;
    // A Gap closes only with a reason: the clause states no requirement (F.3),
    // or no Route applies. Otherwise a Check or Route step must be added.
    if (r.state === "GAP" && decision !== "NOT_APPLICABLE") { refused.push(r.ruleId); continue; }
    const v = currentVersions(r.ruleId, r.kind, r.target);
    await db.spineLink.upsert({
      where: { orgId_ruleId_kind_target: { orgId, ruleId: r.ruleId, kind: r.kind, target: r.target } },
      create: { orgId, ruleId: r.ruleId, kind: r.kind, target: r.target, alignment: decision, reason, owner: r.owner, ...v, reviewedAt: new Date(), reviewedByName: user.name, changeRef },
      update: { alignment: decision, reason, ...v, reviewedAt: new Date(), reviewedByName: user.name, changeRef },
    });
    done++;
  }
  if (done) {
    await audit({
      actor: user, action: "SPINE_REVIEWED", entityType: "SpineLink", entityId: keys[0], entityLabel: `${done} link(s)`,
      detail: `${ALIGNMENT_LABEL[decision]}${reason ? ` — ${reason}` : ""}${changeRef ? ` · ${changeRef}` : ""}`,
    });
  }
  revalidatePath("/conformance/traceability");
  const gapNote = `A Gap is closed as Not applicable with its reason, or by adding the missing link: ${refused.join(", ")}.`;
  if (!done) return { error: refused.length ? gapNote : "Nothing to record." };
  return { ok: `${done} link(s) recorded ${ALIGNMENT_LABEL[decision].toLowerCase()}.${refused.length ? ` ${gapNote}` : ""}` };
}

/** F.5 rule 5 — a synchronized baseline is released only when the three views reconcile. */
export async function releaseSpineBaselineAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const { db, user, orgId } = ctx;
  if (!ctx.can("CONFIGURE")) return { error: "Releasing a synchronized baseline needs Configure." };
  const label = String(formData.get("label") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!label) return { error: "Give the baseline a label." };
  if (await db.spineBaseline.findFirst({ where: { label } })) return { error: `${label} is already used. Labels are never reused.` };

  const { counts, releasable } = await effectiveSpine(ctx);
  if (!releasable) {
    return { error: `Release is blocked until the three views reconcile: ${counts.GAP} Gap and ${counts.REVIEW_REQUIRED} Review required (F.5 rule 5).` };
  }
  const baseline = await db.spineBaseline.create({
    data: {
      orgId, label, standardVersion: STANDARD_VERSION, note,
      links: counts.ALIGNED + counts.NOT_APPLICABLE + counts.WITHDRAWN,
      aligned: counts.ALIGNED, notApplicable: counts.NOT_APPLICABLE, withdrawn: counts.WITHDRAWN, unresolved: 0,
      releasedById: user.id, releasedByName: user.name,
    },
  });
  await audit({ actor: user, action: "SPINE_BASELINE_RELEASED", entityType: "SpineBaseline", entityId: baseline.id, entityLabel: label, detail: `Standard v${STANDARD_VERSION} · ${counts.ALIGNED} aligned, ${counts.NOT_APPLICABLE} not applicable, ${counts.WITHDRAWN} withdrawn` });
  revalidatePath("/conformance/traceability");
  return { ok: `${label} released.` };
}
