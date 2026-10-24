import { converted } from "@/lib/documents/converted";

// A drawing as DXF for the page's drawing viewer: a DXF as it is, a DWG converted once by the backend.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return converted((await params).id, "as-dxf");
}
