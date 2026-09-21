import type { SessionUser } from "./auth";
import type { Tenant } from "./tenant";
import { captureSnapshotsForAudit } from "./history";

type AuditInput = {
  actor?: SessionUser | null;
  action: string;
  entityType?: string;
  entityId?: string;
  entityLabel?: string;
  field?: string;
  oldValue?: string | null;
  newValue?: string | null;
  detail?: string;
  /**
   * Batch jobs and seeds name their tenant. Request code omits it and the
   * active scope is used, which keeps the ~80 call sites free of ceremony.
   */
  tenant?: Tenant;
  /**
   * Organization-level events can happen before any project exists, and an
   * audit row has to live on a project. Those events are recorded in the
   * organization's own history once a project opens; until then, skip rather
   * than throw.
   */
  skipWhenNoProject?: boolean;
};

/** Marker for callers that know they may be running before any project exists. */
export type AuditTenantOptional = { skipWhenNoProject: true };

async function resolve(given?: Tenant): Promise<Tenant | null> {
  if (given) return given;
  // Loaded lazily: `scope` is server-component-only, and batch callers always
  // pass a tenant, so `run-checks` and the seeds never pull it in.
  const { getScope } = await import("./scope");
  return await getScope();
}

export async function audit(input: AuditInput) {
  const t = await resolve(input.tenant);
  // An audit event that cannot be attributed to a project has nowhere to live.
  // Dropping it silently would be worse than loud, so it is surfaced.
  if (!t) {
    if (input.skipWhenNoProject) return;
    throw new Error(`audit(${input.action}): no tenant in scope — pass { tenant } from batch code.`);
  }

  const event = await t.db.auditEvent.create({
    data: {
      projectId: t.projectId,
      actorId: input.actor?.id ?? null,
      actorName: input.actor?.name ?? "system",
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      entityLabel: input.entityLabel ?? null,
      field: input.field ?? null,
      oldValue: input.oldValue ?? null,
      newValue: input.newValue ?? null,
      detail: input.detail ?? null,
    },
  });
  try {
    await captureSnapshotsForAudit(
      t,
      {
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        entityLabel: input.entityLabel,
        detail: input.detail,
        actorName: input.actor?.name ?? "system",
      },
      event.id,
      event.ts,
    );
  } catch (error) {
    console.error("Document snapshot capture failed", error);
  }
}

export async function notify(userId: string, type: string, title: string, body?: string, link?: string, tenant?: Tenant) {
  const t = await resolve(tenant);
  if (!t) return;
  await t.db.notification.create({
    data: { projectId: t.projectId, userId, type, title, body: body ?? null, link: link ?? null },
  });
}

export async function notifyMany(userIds: string[], type: string, title: string, body?: string, link?: string, tenant?: Tenant) {
  const uniq = [...new Set(userIds)].filter(Boolean);
  if (!uniq.length) return;
  const t = await resolve(tenant);
  if (!t) return;
  await t.db.notification.createMany({
    data: uniq.map((userId) => ({ projectId: t.projectId, userId, type, title, body: body ?? null, link: link ?? null })),
  });
}
