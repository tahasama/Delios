import { consoleFetch } from "@/lib/console/client";

/** An invoice's PDF for the DELIOS team (its own session, checked by the backend). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const answer = await consoleFetch(`/api/console/invoices/${encodeURIComponent(id)}/pdf`);
  return new Response(answer.body, {
    status: answer.status,
    headers: { "content-type": answer.headers.get("content-type") ?? "application/pdf", "content-disposition": answer.headers.get("content-disposition") ?? "inline" },
  });
}
