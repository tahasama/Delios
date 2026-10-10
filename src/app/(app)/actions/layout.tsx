import { Hanken_Grotesk, Geist_Mono } from "next/font/google";

// Schedule & actions is tried in its own look, the planning board: its own
// faces and palette, scoped here so the rest of the application is unchanged.
const sans = Hanken_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-board", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-board-mono", display: "swap" });

export default function ActionsLayout({ children }: { children: React.ReactNode }) {
  return <div className={`planboard ${sans.variable} ${mono.variable}`}>{children}</div>;
}
