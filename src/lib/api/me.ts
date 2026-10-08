import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { api, apiShortLived, ApiProblem, SESSION_COOKIE } from "./client";

/** A rule of the permission matrix as the backend holds it (the function's rows). */
export type MeRule = {
  deliverableType: string | null; docType: string | null; discipline: string | null; criticality: string | null;
  confidentiality: string | null; projectRole: string | null; verbs: string[];
};

/** A project the person is on, with their function, department and the function's rules. */
export type MeProject = {
  id: string; code: string; name: string; timeZone: string; contractRole: string; status: string; department: string | null;
  function: { id: string; code: string; name: string }; verbs: string[]; rules: MeRule[];
};

/** GET /api/me: who is signed in, their organization, and the projects they are on. */
export type Me = {
  user: { id: string; name: string; email: string; isAdmin: boolean; party: { code: string; name: string; isInternal: boolean } | null };
  tenant: { slug: string; name: string };
  projects: MeProject[];
};

/** The signed-in person as the backend knows them, once per request; null when there is no valid session. */
export const getMe = cache(async (): Promise<Me | null> => {
  if (!(await cookies()).get(SESSION_COOKIE)?.value) return null;
  try {
    return await apiShortLived<Me>("/api/me", 2000);
  } catch (e) {
    if (e instanceof ApiProblem && (e.status === 401 || e.status === 403)) return null;
    throw e;
  }
});

/** A notification as GET /api/me/notifications returns it. */
export type MeNotification = {
  id: string; projectId: string | null; kind: string; title: string; body: string | null; link: string | null;
  createdAt: string; readAt: string | null;
};

/** The signed-in person's notifications, newest first, with how many are unread. */
export async function getNotifications(per = 60): Promise<{ unread: number; total: number; rows: MeNotification[] }> {
  return api("/api/me/notifications", { query: { per } });
}

/** How many notifications are unread; 0 when the backend cannot say. */
export async function unreadNotifications(): Promise<number> {
  try {
    return (await apiShortLived<{ unread: number }>("/api/me/notifications", 5000, { query: { per: 1 } })).unread;
  } catch {
    return 0;
  }
}

/** Marks every notification read. */
export async function markAllNotificationsRead(): Promise<void> {
  await api("/api/me/notifications/read", { method: "POST", body: { all: true } });
}
