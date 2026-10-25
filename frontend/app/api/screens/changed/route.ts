import { revalidateTag } from "next/cache";

/**
 * The backend says what changed outside a screen's own act (the worker, another organization's DELIOS, a reply by
 * email): the kept answers under those labels are read again on their next view (backend `ScreenChanges`). Reached on
 * the internal network only (Caddy refuses it from outside), with the shared secret when one is set.
 */
export async function POST(request: Request) {
  const secret = process.env.DELIOS_SCREENS_SECRET ?? "";
  if ((request.headers.get("x-delios-screens-secret") ?? "") !== secret) return new Response(null, { status: 404 });
  let tags: unknown;
  try {
    tags = ((await request.json()) as { tags?: unknown }).tags;
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!Array.isArray(tags)) return new Response(null, { status: 400 });
  for (const tag of tags.slice(0, 500)) if (typeof tag === "string" && tag.length <= 200) revalidateTag(tag, { expire: 0 });
  return new Response(null, { status: 204 });
}
