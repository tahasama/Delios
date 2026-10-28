import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { LegalText, lawyerParts } from "@/components/legal-text";
import { Banner } from "@/components/ui";
import { ApiProblem } from "@/lib/client";
import { legalText } from "@/lib/legal/api";
import { fmtDate } from "@/lib/core/utils";
import { LegalFrame } from "../frame";

export const dynamic = "force-dynamic";
export const metadata = { title: "Legal" };

/** One legal text, as published; a draft says so, and its parts for a lawyer are in red. */
export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const text = await legalText(slug).catch((e) => { if (e instanceof ApiProblem && e.status === 404) notFound(); throw e; });
  const parts = lawyerParts(text.body);
  return (
    <LegalFrame>
      <Link href="/legal" className="inline-flex items-center gap-1 text-[13px] text-slate-500 hover:text-link"><ArrowLeft className="h-3.5 w-3.5" /> Legal</Link>
      <article className="register register-sheet register-sheet-open">
        <div className="border-b border-line px-5 pt-5 pb-4 sm:px-6">
          <h1 className="plate-title text-slate-950">{text.title}</h1>
          <p className="plate-meta mt-1.5 font-normal">{text.version ? `Version ${text.version}, published ${fmtDate(text.publishedAt)}` : "Draft, not published yet"}</p>
        </div>
        {parts ? (
          <div className="px-5 pt-4 sm:px-6">
            <Banner tone="danger" title="A draft, not yet reviewed by a lawyer">
              The parts in red are still to be written by a lawyer. Until they are, this text describes how DELIOS works and binds nobody.
            </Banner>
          </div>
        ) : null}
        <div className="px-5 py-5 sm:px-6"><LegalText body={text.body} /></div>
      </article>
    </LegalFrame>
  );
}
