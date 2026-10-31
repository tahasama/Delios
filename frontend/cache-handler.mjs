// What the screens keep of the backend's answers, kept in Redis (Valkey) rather than in the screens' own memory (owner:
// "copies in Redis"): they survive a restart of the screens and are shared by every screens server. A kept answer is
// read again only after a change names one of its labels (lib/core/kept.ts, backend Platform/ScreenChanges.cs): each
// label keeps when it was last named, and an answer kept before that is not used. Nothing is refreshed by itself.
// Redis unreachable: nothing is kept, every answer read fresh.
import { createClient } from "redis";

const URL = process.env.SCREENS_CACHE_REDIS;
// An answer nobody asked for in 30 days goes (memory, not freshness: freshness is the labels'). Kept answers carry this
// end, so Valkey's volatile-lru may push out the least used first when full; the labels' times carry none and stay.
const UNUSED_FOR = 30 * 86400;
const TAGS = "next:tags";
// Answers kept before this moment are not used: written when a screens server finds Redis again after losing it (a
// label it could not name in between would otherwise leave an old answer standing).
const EPOCH = "next:epoch";

let client = null;
let lost = false;
function redis() {
  if (!URL) return null;
  if (!client) {
    client = createClient({ url: URL, socket: { reconnectStrategy: (tries) => Math.min(tries * 200, 5000) } });
    client.on("error", () => { lost = true; });
    client.on("end", () => { lost = true; });
    client.on("ready", () => {
      if (lost) client.set(EPOCH, String(Date.now())).catch(() => {});
      lost = false;
    });
    client.connect().catch(() => { lost = true; });
  }
  return client.isReady ? client : null;
}

export default class CacheHandler {
  constructor() {}

  async get(key, ctx) {
    const c = redis();
    if (!c) return null;
    try {
      const [raw, epoch] = await c.mGet([`next:e:${key}`, EPOCH]);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (epoch && Number(epoch) >= entry.lastModified) return null;
      const tags = [...new Set([...(entry.tags ?? []), ...(ctx?.tags ?? []), ...(ctx?.softTags ?? [])])];
      if (tags.length) {
        const named = await c.hmGet(TAGS, tags);
        // A label named since it was kept: read it again.
        if (named.some((at) => at && Number(at) >= entry.lastModified)) return null;
      }
      return { lastModified: entry.lastModified, value: entry.value, cacheControl: entry.cacheControl };
    } catch {
      return null;
    }
  }

  async set(key, data, ctx) {
    const c = redis();
    if (!c) return;
    try {
      if (!data) {
        await c.del(`next:e:${key}`);
        return;
      }
      const tags = ctx?.tags ?? data?.tags ?? [];
      await c.set(`next:e:${key}`, JSON.stringify({ lastModified: Date.now(), value: data, tags, cacheControl: ctx?.cacheControl }), { EX: UNUSED_FOR });
    } catch {
      // Not kept: read fresh next time.
    }
  }

  async revalidateTag(tags) {
    const c = redis();
    if (!c) return;
    const list = [tags].flat().filter(Boolean);
    if (!list.length) return;
    const now = String(Date.now());
    try {
      await c.hSet(TAGS, Object.fromEntries(list.map((tag) => [tag, now])));
    } catch {
      // Unreachable: nothing is being kept either.
    }
  }

  resetRequestCache() {}
}
