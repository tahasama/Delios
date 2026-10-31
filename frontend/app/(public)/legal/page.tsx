import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { legalTexts } from "@/lib/legal/api";
import { fmtDate } from "@/lib/core/utils";
import { LegalFrame } from "./frame";

export const dynamic = "force-dynamic";
export const metadata = { title: "Legal" };

/** Every legal text DELIOS publishes, open to anyone. */
export default async function LegalIndex() {
  const texts = await legalTexts();
  return (
    <LegalFrame>
      <section className="register register-sheet register-sheet-open">
        <div className="px-5 pt-5 pb-4 sm:px-6">
          <h1 className="plate-title text-slate-950">Legal</h1>
          <p className="plate-meta mt-1.5 font-normal">What DELIOS promises, what it keeps and why, and who runs it.</p>
        </div>
        <ul className="divide-y divide-line border-t border-line">
          {texts.map((t) => (
            <li key={t.kind}>
              <Link href={`/legal/${t.slug}`} className="group flex items-center gap-3 px-5 py-3 hover:bg-tint-soft sm:px-6">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-slate-900">{t.title}</span>
                  <span className="block text-[12px] text-slate-600">{t.lead}</span>
                </span>
                <span className="text-[11px] text-slate-500">{t.version ? `version ${t.version} · ${fmtDate(t.publishedAt)}` : "draft"}</span>
                <ArrowRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-link" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </LegalFrame>
  );
}
