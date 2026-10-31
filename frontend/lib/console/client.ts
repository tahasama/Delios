import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { problemOf } from "@/lib/client";

/**
 * The console's one door to the backend (`/api/console`): the DELIOS team's own session, never an organization's. Its
 * cookie on the screens is `console_session`, passed on as the backend's `delios_console`. Nothing here is kept:
 * every read is fresh.
 */
const API_URL = (process.env.DELIOS_API_URL ?? "http://localhost:8080").replace(/\/$/, "");
export const CONSOLE_COOKIE = "console_session";

export async function consoleFetch(path: string, options: { method?: "GET" | "POST" | "PUT"; body?: unknown } = {}): Promise<Response> {
  const token = (await cookies()).get(CONSOLE_COOKIE)?.value;
  const incoming = await headers();
  const forwarded = incoming.get("x-forwarded-for") ?? incoming.get("x-real-ip");
  const send: Record<string, string> = { Accept: "application/json" };
  if (token) send.Cookie = `delios_console=${token}`;
  if (forwarded) send["X-Forwarded-For"] = forwarded;
  if (options.body !== undefined) send["Content-Type"] = "application/json";
  return fetch(`${API_URL}${path}`, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers: send,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
  });
}

/** A read or an act of the console; not signed in, the sign-in page. */
export async function consoleApi<T>(path: string, options: { method?: "GET" | "POST" | "PUT"; body?: unknown } = {}): Promise<T> {
  const response = await consoleFetch(path, options);
  if (response.status === 401) redirect("/console/sign-in");
  if (!response.ok) throw await problemOf(response);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export type Operator = { id: string; name: string; email: string; authenticatorOff?: boolean };

/** Who is signed in to the console, or the sign-in page. */
export async function requireOperator(): Promise<Operator> {
  return consoleApi<Operator>("/api/console/me");
}
