import { apiFetch } from "@/lib/client";

/** One of the organization's invoices as a PDF, for its administrators (the backend checks who asks). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const answer = await apiFetch(`/api/organization/invoices/${encodeURIComponent(id)}/pdf`);
  return new Response(answer.body, {
    status: answer.status,
    headers: { "content-type": answer.headers.get("content-type") ?? "application/pdf", "content-disposition": answer.headers.get("content-disposition") ?? "inline" },
  });
}
