import { NextResponse } from "next/server";
import { getScope } from "@/lib/scope";
import { getSessionUser } from "@/lib/auth";
import { readStored } from "@/lib/files";
import { audit } from "@/lib/audit";

// Controlled file access: authenticated, confidentiality-checked (§5.7),
// and every download is logged to the audit trail (§16.4 Q5 evidence).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ctx = await getScope();
  if (!ctx) return NextResponse.json({ error: "No active project" }, { status: 403 });
  const { db } = ctx;
  const { id } = await params;
  const file = await db.storedFile.findUnique({
    where: { id },
    include: { revision: { include: { document: true } } },
  });
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const doc = file.revision?.document;
  if (doc && !ctx.canSee(doc.confidentiality)) {
    // §5.7 is about who may see it, not who wrote it, so there is no author
    // exemption: clearance is the whole test.
    return NextResponse.json(
      { error: ctx.why("READ", doc) },
      { status: 403 },
    );
  }

  try {
    const buf = await readStored(file.path);
    const url = new URL(req.url);
    const disposition = url.searchParams.get("dl") === "1" ? "attachment" : "inline";
    await audit({
      actor: user,
      action: "DOWNLOAD",
      entityType: "StoredFile",
      entityId: file.id,
      entityLabel: file.name,
      detail: `${disposition === "attachment" ? "Downloaded" : "Viewed"} (${file.kind.toLowerCase()})${doc ? ` — ${doc.docNumber}` : ""}`,
    });
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": file.mime || "application/octet-stream",
        "Content-Disposition": `${disposition}; filename="${encodeURIComponent(file.name)}"`,
        "Content-Length": String(buf.length),
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "File missing from the repository — recorded as a defect (FM-10)." }, { status: 410 });
  }
}
