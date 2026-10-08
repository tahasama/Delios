import "server-only";
import { cookies, headers } from "next/headers";

/**
 * The one door to the backend. Every screen and action reaches the .NET API
 * through `api()`: it sends the person's session cookie along, passes on their
 * address (so sign-in limits count people, not this server), and turns the
 * backend's problem answers into an `ApiProblem` with the same code.
 */

/** Where the backend answers. Set DELIOS_API_URL; the default suits a local Docker Compose stack. */
export const API_URL = (process.env.DELIOS_API_URL ?? "http://localhost:8080").replace(/\/$/, "");

/** The browser's session cookie (the name the app always used); it holds the backend's session token. */
export const SESSION_COOKIE = "edms_session";
/** The backend's own name for that token. */
const BACKEND_COOKIE = "delios_session";

/** A refusal from the backend: its HTTP status, stable code (TITLE_REQUIRED…), message and details. */
export class ApiProblem extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | null,
    message: string,
    public readonly params: unknown = null,
  ) {
    super(message);
  }
}

export type Query = Record<string, string | number | boolean | null | undefined | (string | number)[]>;

export type ApiOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  query?: Query;
  /** Makes a create safe to repeat: the same key gives back the first answer. */
  idempotencyKey?: string;
};

function url(path: string, query?: Query): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    for (const one of Array.isArray(value) ? value : [value]) search.append(key, String(one));
  }
  const qs = search.toString();
  return `${API_URL}${path}${qs ? `?${qs}` : ""}`;
}

/** The raw response, for the few callers that need headers (sign-in's cookie, file exports). */
export async function apiFetch(path: string, options: ApiOptions = {}): Promise<Response> {
  const jar = await cookies();
  const incoming = await headers();
  const session = jar.get(SESSION_COOKIE)?.value;
  const forwarded = incoming.get("x-forwarded-for") ?? incoming.get("x-real-ip");
  const sendHeaders: Record<string, string> = { Accept: "application/json" };
  if (session) sendHeaders.Cookie = `${BACKEND_COOKIE}=${session}`;
  if (forwarded) sendHeaders["X-Forwarded-For"] = forwarded;
  if (options.idempotencyKey) sendHeaders["Idempotency-Key"] = options.idempotencyKey;
  if (options.body !== undefined) sendHeaders["Content-Type"] = "application/json";
  const started = TRACE ? performance.now() : 0;
  const response = await fetch(url(path, options.query), {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers: sendHeaders,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
  });
  if (TRACE) console.log(`[api] ${response.status} ${Math.round(performance.now() - started)}ms ${options.method ?? "GET"} ${path}`);
  return response;
}

/** DELIOS_API_TRACE=1 logs every backend call with its time, to see what a page waits on. */
const TRACE = process.env.DELIOS_API_TRACE === "1";

/** Reads a problem answer into an ApiProblem. */
export async function problemOf(response: Response): Promise<ApiProblem> {
  let body: { code?: string; title?: string; detail?: string; params?: unknown } = {};
  try {
    body = await response.json();
  } catch {
    // Not JSON (a proxy error page, an empty 401): the status says enough.
  }
  const message = body.title ?? body.detail ?? (response.status === 401 ? "Please sign in again." : `The server answered ${response.status}.`);
  return new ApiProblem(response.status, body.code ?? null, message, body.params ?? null);
}

/** Calls the backend and returns its JSON answer; throws ApiProblem when it refuses. */
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const response = await apiFetch(path, options);
  if (!response.ok) throw await problemOf(response);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/**
 * A read that many parts of one page ask for — who is signed in, the value
 * lists — answered once for that session for a few seconds rather than once per
 * caller. Keyed by the session, so nobody ever reads another person's answer.
 * Only for reads whose staleness of a few seconds cannot mislead.
 */
const shortLived = new Map<string, { until: number; value: Promise<unknown> }>();

export async function apiShortLived<T>(path: string, ttlMs: number, options: Pick<ApiOptions, "query"> = {}): Promise<T> {
  const session = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  const key = `${session}\n${url(path, options.query)}`;
  const now = Date.now();
  const hit = shortLived.get(key);
  if (hit && hit.until > now) return hit.value as Promise<T>;
  const value = api<T>(path, options);
  shortLived.set(key, { until: now + ttlMs, value });
  value.catch(() => shortLived.delete(key));
  if (shortLived.size > 2000) {
    for (const [k, v] of shortLived) if (v.until <= now) shortLived.delete(k);
  }
  return value;
}

/** Forget the short-lived answers of this session: after an act that changes them. */
export async function forgetShortLived(): Promise<void> {
  const session = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  for (const key of shortLived.keys()) if (key.startsWith(`${session}\n`)) shortLived.delete(key);
}

/** For actions: the problem's message to show, or rethrows anything that is not a refusal. */
export function refusal(error: unknown): { message: string; code: string | null; params: unknown } {
  if (error instanceof ApiProblem) return { message: error.message, code: error.code, params: error.params };
  throw error;
}

/** A path under the project the person is working in: `/api/projects/{id}{rest}`. */
export function projectPath(scope: { projectId: string }, rest = ""): string {
  return `/api/projects/${scope.projectId}${rest}`;
}
