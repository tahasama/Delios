import "server-only";
import { api } from "@/lib/client";
import type { Serving } from "./serving";

/** For each list named, which set serves each deliverable type (`GET /api/values/serving`). */
export async function servingOf(lists: string[]): Promise<Serving> {
  return api<Serving>("/api/values/serving", { keep: { areas: [] }, query: { sets: lists.join(",") } }).catch(() => ({}));
}
