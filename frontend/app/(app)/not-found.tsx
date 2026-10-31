import Link from "next/link";
import { btn } from "@/components/ui";

/**
 * A page asked for by its address that does not exist, or that this person may not open: the two read the same on
 * purpose (the backend never says whether something it hides exists). Inside the app's frame, with the way on.
 */
export default function NotFound() {
  return (
    <div role="alert" className="rounded-md border border-line bg-surface p-6">
      <h1 className="text-base font-semibold text-slate-900">Not found, or not yours to open.</h1>
      <p className="mt-1 max-w-xl text-sm text-slate-600">
        This page does not exist, or what it shows is not open to your function on this project (a document above your
        clearance, another organization&apos;s, or one never sent to you). If you need it, ask the control function: the
        Project directory says who that is.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link href="/" className={btn("primary")}>Back to Home</Link>
        <Link href="/directory" className={btn("secondary")}>Project directory</Link>
      </div>
    </div>
  );
}
