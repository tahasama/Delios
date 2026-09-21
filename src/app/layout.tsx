import type { Metadata } from "next";
import "./globals.css";
import { APP_NAME } from "@/lib/standard";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: "Internal Electronic Document Management System implementing the Document Management Standard v1 — Rules · Routes · Checks.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
