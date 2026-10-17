import { redirect } from "next/navigation";

/** The Schedule's list lives at /schedule; each action keeps its page at /actions/<code>. Old links keep working. */
export default async function OldSchedulePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) for (const one of [value ?? []].flat()) q.append(key, one);
  redirect(`/schedule${q.size ? `?${q}` : ""}`);
}
