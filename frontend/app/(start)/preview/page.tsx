import { cookies } from "next/headers";
import { requireScope } from "@/lib/core/scope";
import { isAdmin } from "@/lib/core/auth";
import { PREF } from "@/lib/core/preferences";
import { readersOn } from "@/lib/settings/viewers";
import { FilePreview } from "@/components/file-preview";

export const dynamic = "force-dynamic";
export const metadata = { title: "Preview" };

/**
 * The Preview on a page of its own, the whole window (owner: "full page on preview", opened by its icon in a new tab):
 * the same PDF and source file, with the same bar. The backend still decides who may open each file.
 */
export default async function FullPreviewPage({ searchParams }: {
  searchParams: Promise<{ pdf?: string; pdfName?: string; source?: string; sourceName?: string; title?: string; show?: string }>;
}) {
  const ctx = await requireScope();
  const q = await searchParams;
  const id = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
  const pdf = id(q.pdf) ? { id: id(q.pdf)!, name: q.pdfName || "The PDF" } : null;
  const source = id(q.source) ? { id: id(q.source)!, name: q.sourceName || "The source file" } : null;
  const jar = await cookies();
  return (
    <main className="flex h-screen flex-col bg-surface">
      <h1 className="sr-only">{q.title ?? "Preview"}</h1>
      <FilePreview pdf={pdf} source={source} title={q.title ?? "Preview"} height="h-[calc(100vh-2.6rem)]" full show={q.show === "source" ? "source" : "pdf"}
        admin={isAdmin(ctx.user)} readers={await readersOn(ctx)} viewingNote={jar.get(PREF.viewingNote)?.value !== "0"} pdfDark={jar.get(PREF.pdfDark)?.value === "1"}
        empty={<p className="p-6 text-center text-sm text-slate-500">Nothing to show.</p>} />
    </main>
  );
}
