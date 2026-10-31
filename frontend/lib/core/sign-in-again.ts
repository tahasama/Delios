import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

/**
 * Sends someone whose session ended to sign in again, saying so, and back to the page they were on afterwards
 * (`x-delios-path`, set by `proxy.ts`; only a same-site path).
 */
export async function signInAgain(): Promise<never> {
  const here = (await headers()).get("x-delios-path") ?? "/";
  const next = /^\/(?![/\\])/.test(here) && !/[\\\x00-\x1f]/.test(here) ? here : "/";
  redirect(`/login?expired=1&next=${encodeURIComponent(next)}`);
}
