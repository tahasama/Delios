import { NextResponse } from "next/server";
import { apiFetch } from "@/lib/client";

// What failed in a browser (components/report-error.ts), handed to the backend, which writes it in its log and passes
// it on to Sentry where one is set (backend Platform/ScreenErrors.cs). Open to the signed-out pages too (proxy.ts).
export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return new NextResponse(null, { status: 400 }); }
  const text = (key: string) => (typeof body[key] === "string" ? (body[key] as string) : null);
  await apiFetch("/api/screens/errors", {
    method: "POST",
    body: { where: "browser", message: text("message"), digest: text("digest"), stack: text("stack"), page: text("page") },
  }).catch(() => undefined);
  return new NextResponse(null, { status: 204 });
}
