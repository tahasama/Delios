import type { Metadata } from "next";
import "./globals.css";
import { APP_NAME } from "@/lib/standard";
import { THEME_SCRIPT } from "@/components/theme-toggle";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: "Internal Electronic Document Management System implementing the Document Management Standard v1 — Rules · Routes · Checks.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Set the theme before first paint, so a dark page never flashes white. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
