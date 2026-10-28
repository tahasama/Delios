import Link from "next/link";

/** The legal pages' frame: open to anyone, the brand's band, the text on a sheet. */
export function LegalFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-brand text-white">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-4 sm:px-6">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 text-sm font-black">D</span>
          <Link href="/legal" className="text-sm font-bold">DELIOS · Legal</Link>
          <Link href="/login" className="ml-auto text-[13px] text-white/70 hover:text-white">Sign in</Link>
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-4 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}

/** The links the sign-in and sign-up pages carry at their foot. */
export function LegalLinks() {
  return (
    <p className="mt-8 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
      {[["terms", "Terms"], ["privacy", "Privacy"], ["dpa", "Data processing"], ["security", "Security"], ["cookies", "Cookies"], ["imprint", "Legal notice"]].map(([slug, label]) => (
        <Link key={slug} href={`/legal/${slug}`} className="hover:text-link hover:underline">{label}</Link>
      ))}
    </p>
  );
}
