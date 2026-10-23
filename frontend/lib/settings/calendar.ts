import "server-only";
import { cache } from "react";
import { api, projectPath } from "@/lib/client";
import type { Place } from "@/lib/settings/place";

/** A day nobody counts: an organization's public holiday (for a country, or every country), or a project's own. */
export type DayOffView = { id: string; day: string; name: string; country: string | null; source: "ORGANIZATION" | "PROJECT"; at: string; by: string };
/** An action of the schedule, by its days (start → finish; a day of work with no finish is its start alone). */
export type ActionDay = { code: string; name: string; start: string | null; finish: string | null };

export type OrganizationCalendar = { year: number; dateFormat: string; place: Place; holidays: DayOffView[] };
export type ProjectCalendar = {
  from: string; to: string; place: Place; today: string; daysOff: DayOffView[]; actions: ActionDay[];
  mayChange: boolean; ownDaysFree: boolean; exception: import("@/lib/settings/exception").ExceptionHere;
};

/** The organization's calendar for a year (administrators). */
export const organizationCalendar = cache(async (year?: number) =>
  api<OrganizationCalendar>("/api/admin/calendar", { query: { year } }));

/** A project's calendar, from the month it starts to the month it finishes. */
export const projectCalendar = cache(async (t: { projectId: string }) => api<ProjectCalendar>(projectPath(t, "/calendar")));
