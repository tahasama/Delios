import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono, Newsreader } from "next/font/google";
import "./globals.css";
import { APP_NAME } from "@/lib/core/standard";
import { cookies } from "next/headers";
import { PREF, SIDEBAR_LIMITS } from "@/lib/core/preferences";
import { ErrorWatch } from "@/components/error-watch";
import { SandboxBand } from "@/components/sandbox-band";

/**
 * The register is a technical document, so it is set in a technical face. Plex
 * Sans carries the interface; Plex Mono carries everything that is a code or a
 * figure — document numbers, revisions, statuses, dates — with tabular digits,
 * so columns of numbers line up on their own.
 */
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono", display: "swap" });
/**
 * Correspondence is not data. Transmittals are letters with documents attached,
 * so the dispatch log sets what a person wrote — the subject of a transmittal —
 * in a serif, and leaves the technical face to numbers and codes.
 */
const serif = Newsreader({ subsets: ["latin"], weight: ["400", "500", "600"], style: ["normal", "italic"], variable: "--font-serif", display: "swap" });

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: "Project information, controlled: one register, one review route per document, and checks that say how far it can be trusted.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The theme and sidebar width come from cookies, so the page arrives already
  // right: no flash of white, and no code has to run in the page first.
  const jar = await cookies();
  const theme = jar.get(PREF.theme)?.value;
  const dark = theme === "dark" || (theme !== "light" && jar.get(PREF.deviceDark)?.value === "1");
  const width = Number.parseInt(jar.get(PREF.sidebar)?.value ?? "", 10);
  // 268 was the width the menu opened at before (owner: "10px less"); kept by an expand, it reads as the new 258.
  const kept = width === 268 ? 258 : width;
  const sidebar = kept >= SIDEBAR_LIMITS.min && kept <= SIDEBAR_LIMITS.max ? kept : null;
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} ${serif.variable}${dark ? " dark" : ""}`}
      style={sidebar ? ({ "--sidebar-w": `${sidebar}px` } as React.CSSProperties) : undefined}
      data-sidebar={sidebar && sidebar < SIDEBAR_LIMITS.railBelow ? "rail" : undefined}
      suppressHydrationWarning
    >
      <body>
        <ErrorWatch />
        {children}
        <SandboxBand />
      </body>
    </html>
  );
}
