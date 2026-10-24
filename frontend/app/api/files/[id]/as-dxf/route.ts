import { converted } from "@/lib/documents/converted";

// A drawing as DXF for the page's drawing viewer: a DXF as it is, a DWG converted once by the backend.
// ?minimal=1: only the drawing's entities, asked when the viewer could not draw the full file.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const minimal = new URL(req.url).searchParams.get("minimal") === "1";
  return converted((await params).id, "as-dxf", minimal ? { minimal: "true" } : undefined);
}
