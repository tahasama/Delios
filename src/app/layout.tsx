import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono, Newsreader } from "next/font/google";
import "./globals.css";
import { APP_NAME } from "@/lib/standard";
import { THEME_SCRIPT } from "@/components/theme-toggle";

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable}`} suppressHydrationWarning>
      <head>
        {/* Set the theme before first paint, so a dark page never flashes white. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
