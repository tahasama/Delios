import Link from "next/link";
import { btn } from "@/components/ui";

/** An address that leads nowhere at all, outside the app's frame (signed in or not): the way back to the start. */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-8">
      <div role="alert" className="max-w-md rounded-md border border-line bg-surface p-6">
        <h1 className="text-base font-semibold text-slate-900">Nothing at this address.</h1>
        <p className="mt-1 text-sm text-slate-600">The link may be old, or mistyped. Start again from Home.</p>
        <Link href="/" className={`${btn("primary")} mt-4`}>Back to Home</Link>
      </div>
    </main>
  );
}
