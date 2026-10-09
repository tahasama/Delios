import { NextRequest, NextResponse } from "next/server";
import { getScope } from "@/lib/scope";
import { getSessionUser } from "@/lib/auth";
import { api, ApiProblem, projectPath } from "@/lib/api/client";
import type { TransmittalView } from "@/lib/api/types";

// Opening a transmittal while signed in is the receipt. The backend records a
// recipient's first opening when they read it, and their acknowledgement here;
// doing it twice changes nothing, and somebody it did not go to has nothing to
// record.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const ctx = await getScope();
  if (!ctx) return NextResponse.json({ error: "No active project" }, { status: 403 });

  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }

  const { id } = await params;
  let before: TransmittalView;
  let after: TransmittalView;
  try {
    before = await api<TransmittalView>(projectPath(ctx, `/transmittals/${id}`));
    after = await api<TransmittalView>(projectPath(ctx, `/transmittals/${id}/acknowledge`), { method: "POST" });
  } catch (e) {
    if (e instanceof ApiProblem && (e.status === 403 || e.status === 404)) return new NextResponse(null, { status: 204 });
    throw e;
  }

  // The first time is the one that counts: it was not acknowledged before, and is now.
  const acknowledged = (t: TransmittalView) => t.recipients.filter((one) => one.acknowledgedAt).length;
  return NextResponse.json({ firstOpen: acknowledged(after) > acknowledged(before) });
}
