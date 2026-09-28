"use client";

/**
 * What went wrong, said on the page.
 *
 * Without a boundary here, a failure inside the app shell is handled by the
 * framework's own fallback, which in development re-renders the route from
 * scratch — the page appears to reload and the reason never reaches either the
 * reader or the terminal. This shows the message instead, and leaves the way
 * back open.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="rounded-xl border border-red-300 bg-surface p-6">
      <h1 className="text-base font-semibold text-red-700">Something in this page failed.</h1>
      <p className="mt-1 text-sm text-slate-600">
        The rest of the application is unaffected. This is what the server reported:
      </p>
      <pre className="mt-3 overflow-x-auto rounded-lg bg-canvas-deep p-3 font-mono text-xs whitespace-pre-wrap text-slate-800">
        {error.message}
        {error.digest ? `\n\ndigest: ${error.digest}` : ""}
        {error.stack ? `\n\n${error.stack}` : ""}
      </pre>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-lg border border-line-strong px-3 py-1.5 text-[13px] font-semibold text-brand-ink hover:bg-tint"
      >
        Try again
      </button>
    </div>
  );
}
