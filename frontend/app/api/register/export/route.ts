import { NextResponse } from "next/server";
import { getScope } from "@/lib/scope";
import { getSessionUser } from "@/lib/auth";
import { projectPath } from "@/lib/api/client";
import { passOn } from "@/lib/api/register";

// §16.6 — a view: generated at time of use, carries generation date/time,
// never edited. The flat document list is a view of the register (§16.1).
/** A selection too long for an address arrives as a body instead. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { ids?: string[]; search?: Record<string, string> };
  const params = new URLSearchParams(body.search ?? {});
  if (body.ids?.length) params.set("ids", body.ids.join(","));
  return GET(new Request(`${new URL(request.url).origin}/api/register/export?${params}`, { headers: request.headers }));
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ctx = await getScope();
  if (!ctx) return NextResponse.json({ error: "No active project" }, { status: 403 });

  const params = new URL(request.url).searchParams;
  // A selection is a list of ids; everything else is the question the register
  // was asked, answered by the backend the same way the screen answers it. The
  // backend writes its own columns: the reader's choice of columns (cols) is
  // not one it takes.
  const asked = Object.fromEntries([...params.entries()].filter(([key]) => key !== "cols" && key !== "page"));
  return passOn(projectPath(ctx, "/register/export"), { ...asked, format: params.get("format") === "xlsx" ? "xlsx" : "csv" });
}
