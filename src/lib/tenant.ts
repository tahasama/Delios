/**
 * Tenancy, as the screens carry it: the organization and the project a request
 * works in. The backend applies both to every read and write (row-level
 * security per organization, project access per request); the screens only say
 * which project they mean, through `projectPath`.
 */
export type Tenant = {
  orgId: string;
  projectId: string;
  /** The data comes from the backend now (`src/lib/api`); this marks what still reaches for the old client. */
  db: { readonly movedToBackend: true };
};

/** A tenant named explicitly, outside a request. */
export function tenantFor(orgId: string, projectId: string): Tenant {
  return { orgId, projectId, db: { movedToBackend: true } };
}
