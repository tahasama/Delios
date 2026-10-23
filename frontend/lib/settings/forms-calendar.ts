"use server";

import { revalidatePath } from "next/cache";
import { api, projectPath, refusalForForm } from "@/lib/client";
import { requireScope } from "@/lib/core/scope";
import { readPlace } from "@/lib/settings/place";

type Result = { error?: string; ok?: string; fields?: string[] };
const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();
const failed = (e: unknown): Result => refusalForForm(e);

function refresh() {
  revalidatePath("/organization/settings/calendar");
  revalidatePath("/settings/calendar");
  revalidatePath("/schedule");
}

/** Claims a day: the organization's public holiday (with its country, or every country), or the project's own day off. */
export async function markDayAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const level = text(formData, "level");
  const body = { day: text(formData, "day") || null, name: text(formData, "name"), country: text(formData, "country") || null };
  try {
    if (level === "organization") await api("/api/admin/calendar/days", { body });
    else await api(projectPath(await requireScope(), "/calendar/days"), { body });
  } catch (e) {
    return failed(e);
  }
  refresh();
  return { ok: `${body.name} is marked: due days skip it.` };
}

/** Takes a claimed day off the calendar: due days count it again. */
export async function unmarkDayAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const level = text(formData, "level");
  const id = text(formData, "dayId");
  try {
    if (level === "organization") await api(`/api/admin/calendar/days/${id}`, { method: "DELETE" });
    else await api(projectPath(await requireScope(), `/calendar/days/${id}`), { method: "DELETE" });
  } catch (e) {
    return failed(e);
  }
  refresh();
  return { ok: "Taken off: due days count it again." };
}

/** Where the project's site is: its country, time zone and days off each week (the control function). */
export async function setSitePlaceAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  try {
    await api(projectPath(await requireScope(), "/calendar/place"), {
      method: "PUT", body: { timeZone: "UTC", weekendDays: [], country: null, ...readPlace(formData) },
    });
  } catch (e) {
    return failed(e);
  }
  refresh();
  revalidatePath("/settings/projects");
  return { ok: "Saved: due days are counted at the site from now on." };
}

/** Adds a country's public holidays for a year, as the list that knows them gives them; those already marked stay. */
export async function fillHolidaysAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const country = text(formData, "country");
  const year = Number(text(formData, "year"));
  const { nationalHolidays } = await import("@/lib/settings/national-holidays");
  const days = Number.isInteger(year) ? nationalHolidays(country, year) : [];
  try {
    const done = await api<{ added: number; alreadyThere: number }>("/api/admin/calendar/days/many", { body: { country, days } });
    refresh();
    return { ok: `${done.added} added${done.alreadyThere ? `, ${done.alreadyThere} already marked` : ""}: due days skip them.` };
  } catch (e) {
    return failed(e);
  }
}
