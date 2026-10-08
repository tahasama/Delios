import { NextResponse } from "next/server";
import { getScope } from "@/lib/scope";
import { readStored } from "@/lib/files";
import { audit } from "@/lib/audit";

// Controlled file access, read through the same scoped client every page
// uses: the project the person is working in, the documents they are cleared
// for (§5.7), and — for someone from another party — only what belongs to
// them or was issued to them. A file outside that does not exist for them, so
// the answer is the same "not found" either way. Every download is logged to
// the audit trail (§16.4 Q5 evidence).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getScope();
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { user, db } = scope;
  const { id } = await params;
  const file = await db.storedFile.findFirst({
    where: { id },
    include: { revision: { include: { document: true } } },
  });
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const doc = file.revision?.document;

  try {
    const buf = await readStored(file.path);
    const url = new URL(req.url);
    const disposition = url.searchParams.get("dl") === "1" ? "attachment" : "inline";
    await audit({
      tenant: scope,
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
