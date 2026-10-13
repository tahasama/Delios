/**
 * Tenancy, as the screens carry it: the organization and the project a request
 * works in. The backend applies both to every read and write (row-level
 * security per organization, project access per request); the screens only say
 * which project they mean, through `projectPath`.
 */
export type Tenant = {
  orgId: string;
  projectId: string;
};
