import { NextRequest, NextResponse } from "next/server";
import { getScope } from "@/lib/scope";
import { getSessionUser } from "@/lib/auth";
import { audit, notifyMany } from "@/lib/audit";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const ctx = await getScope();
  if (!ctx) return NextResponse.json({ error: "No active project" }, { status: 403 });
  const { db } = ctx;

  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }

  const { id } = await params;
  const recipient = await db.transmittalRecipient.findFirst({
    where: { transmittalId: id, userId: user.id },
    include: { transmittal: { select: { id: true, number: true, status: true, createdById: true } } },
  });
  if (!recipient || recipient.transmittal.status === "DRAFT") {
    return new NextResponse(null, { status: 204 });
  }

  const now = new Date();
  const repeatWindow = new Date(now.getTime() - 60_000);
  const firstOpen = await db.transmittalRecipient.updateMany({
    where: { id: recipient.id, openedAt: null },
    data: { openedAt: now },
  });
  await db.transmittalRecipient.updateMany({
    where: {
      id: recipient.id,
      OR: [{ lastViewedAt: null }, { lastViewedAt: { lt: repeatWindow } }],
    },
    data: { lastViewedAt: now, viewCount: { increment: 1 } },
  });

  if (firstOpen.count === 1) {
    await audit({
      actor: user,
      action: "TRANSMITTAL_OPENED",
      entityType: "Transmittal",
      entityId: id,
      entityLabel: recipient.transmittal.number,
      detail: `${recipient.name} opened the issued transmittal. Authenticated read evidence recorded.`,
    });
    const controllers = await db.user.findMany({
      where: { active: true, role: { in: ["CONTROLLER", "ADMIN"] } },
      select: { id: true },
    });
    await notifyMany(
      [recipient.transmittal.createdById, ...controllers.map((controller) => controller.id)].filter((id) => id !== user.id),
      "TRANSMITTAL_OPENED",
      `${recipient.name} opened ${recipient.transmittal.number}`,
      "Authenticated read evidence was recorded. Formal acknowledgement may still be pending.",
      `/transmittals/${id}`,
    );
  }

  return NextResponse.json({ firstOpen: firstOpen.count === 1 });
}
