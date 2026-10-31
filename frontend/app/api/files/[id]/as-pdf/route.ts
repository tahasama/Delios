import { converted } from "@/lib/documents/converted";

// A Word, PowerPoint or other office file as a PDF, made once by the backend's converter.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return converted((await params).id, "as-pdf");
}
