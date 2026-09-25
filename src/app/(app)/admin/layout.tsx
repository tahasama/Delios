import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SETUP_PAGES } from "./setup-pages";
import { AdminCrumb } from "./crumb";

/**
 * Every settings screen sits under Settings, and says so. Written once, here,
 * so a new screen cannot be added without its way back — which is how people
 * ended up several clicks deep with nothing but the browser's back button.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <nav aria-label="Where you are" className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
        <Link href="/admin" className="inline-flex items-center gap-1 font-semibold text-link hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Settings
        </Link>
        <AdminCrumb pages={SETUP_PAGES.map((p) => ({ href: p.href, title: p.title }))} />
      </nav>
      {children}
    </div>
  );
}
