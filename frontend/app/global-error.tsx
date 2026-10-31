"use client";

import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { ErrorPage } from "@/components/error-page";
import "./globals.css";

/**
 * The last resort, when even the site's own frame failed: the app's error page on its own, with the brand's fonts and
 * colours. Nothing of the app stands to refresh, so Try again reloads the window.
 */
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono", display: "swap" });

export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <ErrorPage error={error} again={() => window.location.reload()} />
      </body>
    </html>
  );
}
