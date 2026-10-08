/**
 * The screens already working on the new backend. The rest are hidden from the
 * menu and closed by the middleware until their turn comes, so nothing shown
 * can fail. Each area adds its paths here when it is moved.
 */
export const MIGRATED: string[] = ["/", "/login", "/no-project", "/documents", "/api/register", "/api/files", "/reviews", "/api/export", "/transmittals", "/packages"];

/** Whether a path belongs to a moved screen ("/" itself, or under a listed prefix). */
export function isMigrated(path: string): boolean {
  if (path === "/") return true;
  return MIGRATED.some((m) => m !== "/" && (path === m || path.startsWith(`${m}/`)));
}
