import "server-only";
import { cookies, headers } from "next/headers";
import { revalidateTag, updateTag } from "next/cache";
import { after } from "next/server";
import { keepRequestDateFormat } from "@/lib/core/date-format";
import { KEEP_SECONDS, labelsOf, type Keep } from "@/lib/core/kept";

/**
 * The one door to the backend. Every screen and action reaches the .NET API
 * through `api()`: it sends the person's session cookie along, passes on their
 * address (so sign-in limits count people, not this server), and turns the
 * backend's problem answers into an `ApiProblem` with the same code.
 */

/** Where the backend answers. Set DELIOS_API_URL; the default suits a local Docker Compose stack. */
const API_URL = (process.env.DELIOS_API_URL ?? "http://localhost:8080").replace(/\/$/, "");

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

type ApiOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  query?: Query;
  /** Makes a create safe to repeat: the same key gives back the first answer. */
  idempotencyKey?: string;
  /** This browser's id (the sign-in calls): a sign-in from a browser never seen before is emailed to the person. */
  device?: string;
  /**
   * Keep the answer (a read only) until a change names one of its labels (`lib/core/kept.ts`): what it depends on.
   * Without it, the answer is read fresh every time.
   */
  keep?: Keep;
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
  // The screens read what changed on the answer to their own acts (backend ScreenChanges).
  const sendHeaders: Record<string, string> = { Accept: "application/json", "X-Delios-Screens": "1" };
  if (session) sendHeaders.Cookie = `${BACKEND_COOKIE}=${session}`;
  // The project the person is in: the backend reads the lists as that project sees them (its own, else the organization's).
  const project = jar.get("edms_project")?.value;
  if (project) sendHeaders["X-Delios-Project"] = project;
  if (forwarded) sendHeaders["X-Forwarded-For"] = forwarded;
  if (options.device) {
    sendHeaders["X-Delios-Device"] = options.device;
    const agent = incoming.get("user-agent");
    if (agent) sendHeaders["User-Agent"] = agent;
  }
  if (options.idempotencyKey) sendHeaders["Idempotency-Key"] = options.idempotencyKey;
  if (options.body !== undefined) sendHeaders["Content-Type"] = "application/json";
  const started = TRACE ? performance.now() : 0;
  const method = options.method ?? (options.body === undefined ? "GET" : "POST");
  // A read that says what it depends on is kept, per session, until a change names one of its labels.
  const kept = method === "GET" && options.keep;
  const response = await fetch(url(path, options.query), {
    method,
    headers: sendHeaders,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    ...(kept ? { cache: "force-cache" as const, next: { revalidate: KEEP_SECONDS, tags: labelsOf(path, options.keep!) } } : { cache: "no-store" as const }),
  });
  // An act: what it changed is cleared now, so the page drawn after it reads it fresh (read-your-own-writes).
  if (method !== "GET") clearChanged(response.headers.get("x-delios-changed"));
  if (TRACE) console.log(`[api] ${response.status} ${Math.round(performance.now() - started)}ms ${options.method ?? "GET"} ${path}`);
  // How dates read: the organization's, on every answer; kept for the page being drawn.
  keepRequestDateFormat(response.headers.get("x-delios-date-format"));
  return response;
}

/**
 * An act sent once the page is drawn (Next.js `after`), never making it wait: an opening recorded while the page's
 * answers are kept. The session is read now; the call goes after.
 */
export async function apiAfter(path: string, options: Pick<ApiOptions, "method" | "body"> = {}) {
  const jar = await cookies();
  const session = jar.get(SESSION_COOKIE)?.value;
  const project = jar.get("edms_project")?.value;
  const sendHeaders: Record<string, string> = { Accept: "application/json", "X-Delios-Screens": "1" };
  if (session) sendHeaders.Cookie = `${BACKEND_COOKIE}=${session}`;
  if (project) sendHeaders["X-Delios-Project"] = project;
  if (options.body !== undefined) sendHeaders["Content-Type"] = "application/json";
  after(async () => {
    try {
      await fetch(url(path), { method: options.method ?? "POST", headers: sendHeaders, body: options.body === undefined ? undefined : JSON.stringify(options.body), cache: "no-store" });
    } catch {
      // Recorded on the next opening.
    }
  });
}

/** Clears the labels a backend answer says its act changed: at once in a Server Action, else for the next view. */
function clearChanged(header: string | null) {
  if (!header) return;
  for (const tag of header.split(",").map((one) => one.trim()).filter(Boolean)) {
    try {
      updateTag(tag);
    } catch {
      try {
        revalidateTag(tag, { expire: 0 });
      } catch {
        // Neither an action nor a route (a page being drawn): the backend's own word, posted, clears it.
      }
    }
  }
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
  // A fault of ours (no refusal code, a 5xx) is never shown in the server's own words ("An error occurred while
  // processing your request."): it says plainly what happened and what to do.
  const fault = response.status >= 500 && !body.code;
  const message = fault
    ? "Something went wrong on our side and nothing was saved. Try again; if it happens again, tell your administrator what you were doing."
    : body.title ?? body.detail ?? (response.status === 401 ? "Please sign in again." : `The server answered ${response.status}.`);
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
  const jar = await cookies();
  const session = jar.get(SESSION_COOKIE)?.value ?? "";
  // Per session and per project: a project reads its own lists.
  const key = `${session}\n${jar.get("edms_project")?.value ?? ""}\n${url(path, options.query)}`;
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

/**
 * A refusal as a form shows it: the backend's words, and the fields it named (its `field` or `fields`), so the form
 * outlines them.
 */
export function refusalForForm(error: unknown): { error: string; fields?: string[] } {
  const { message, params } = refusal(error);
  const p = (params ?? {}) as { field?: unknown; fields?: unknown };
  const fields = [...(typeof p.field === "string" ? [p.field] : []), ...(Array.isArray(p.fields) ? p.fields.map(String) : [])];
  return fields.length ? { error: message, fields } : { error: message };
}

/** A path under the project the person is working in: `/api/projects/{id}{rest}`. */
export function projectPath(scope: { projectId: string }, rest = ""): string {
  return `/api/projects/${scope.projectId}${rest}`;
}
