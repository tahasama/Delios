import type { SessionUser } from "./auth";
import type { Tenant } from "./tenant";

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

/**
 * The backend writes the audit trail for every act it carries out, in the same
 * transaction as the act, so the screens record nothing themselves. Kept for
 * the callers that still announce an act; it records nothing.
 */
export async function audit(_input: AuditInput) {
  // Recorded by the backend with the act itself.
}

/** Notifications are not in the backend yet: nothing is sent. */
export async function notify(_userId: string, _type: string, _title: string, _body?: string, _link?: string, _tenant?: Tenant) {
  // Not in the backend yet.
}

export async function notifyMany(_userIds: string[], _type: string, _title: string, _body?: string, _link?: string, _tenant?: Tenant) {
  // Not in the backend yet.
}
