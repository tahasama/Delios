import { converted } from "@/lib/documents/converted";

// A PDF's first page as a picture, to place the review's stamp on it by hand.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return converted((await params).id, "page.png");
}
