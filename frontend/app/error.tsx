"use client";

import { ErrorPage } from "@/components/error-page";
import { useTryAgain } from "@/components/try-again";

/** A frame that failed (the app's menu and top bar, the organization's band): its page in the app's look, read afresh on Try again. */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const again = useTryAgain(reset);
  return <ErrorPage error={error} again={again} />;
}
