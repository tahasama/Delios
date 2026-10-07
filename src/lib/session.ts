import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { api, ApiProblem, SESSION_COOKIE } from "./api/client";
import type { Me, MeProject } from "./api/types";

/**
 * Who is signed in, which project they are working in, and what their function
 * there lets them do. Everything comes from the backend's /api/me: the screens
 * never decide permissions themselves, they only hide what would be refused.
 */

/** The project the person last chose; their first project when none is chosen. */
export const PROJECT_COOKIE = "edms_project";

export type Session = {
  me: Me;
  user: Me["user"] & { organization: string; isInternal: boolean };
  project: MeProject;
  projects: MeProject[];
  /** Whether their function on this project holds the verb (READ, CREATE, CONTROL…). */
  can: (verb: string) => boolean;
};

/** The signed-in person, or null when there is no valid session. Asked once per request. */
export const getMe = cache(async (): Promise<Me | null> => {
  const jar = await cookies();
  if (!jar.get(SESSION_COOKIE)) return null;
  try {
    return await api<Me>("/api/me");
  } catch (e) {
    if (e instanceof ApiProblem && e.status === 401) return null;
    throw e;
  }
});

/** The session with its current project, or null when not signed in or on no project. */
export const getSession = cache(async (): Promise<Session | null> => {
  const me = await getMe();
  if (!me || me.projects.length === 0) return null;
  const chosen = (await cookies()).get(PROJECT_COOKIE)?.value;
  const project = me.projects.find((p) => p.id === chosen) ?? me.projects[0];
  return {
    me,
    user: { ...me.user, organization: me.user.party?.name ?? me.tenant.name, isInternal: me.user.party?.isInternal ?? true },
    project,
    projects: me.projects,
    can: (verb) => project.verbs.includes(verb),
  };
});

/** For every page: the session, or off to sign in (or to "no project" when on none). */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (session) return session;
  redirect((await getMe()) ? "/no-project" : "/login");
}

/** The API path of the current project: /api/projects/{id}. */
export function projectPath(session: Session, rest = ""): string {
  return `/api/projects/${session.project.id}${rest}`;
}
