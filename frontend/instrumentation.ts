import type { Instrumentation } from "next";

// What fails on the screens' own server (a page drawn, a server action, a route): handed to the backend's log, and
// to Sentry where one is set (backend Platform/ScreenErrors.cs). The browser's own faults come by /api/client-errors.
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const e = error instanceof Error ? error : new Error(String(error));
  const api = (process.env.DELIOS_API_URL ?? "http://localhost:8080").replace(/\/$/, "");
  try {
    await fetch(`${api}/api/screens/errors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        where: "server",
        message: `${e.message} (${context.routeType} ${context.routePath})`,
        digest: (e as { digest?: string }).digest ?? null,
        stack: e.stack ?? null,
        page: request.path.split("?")[0],
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // The backend unreachable: the screens' own log still has it.
  }
};
