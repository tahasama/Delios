import { Archivo, Archivo_Narrow } from "next/font/google";

// The schedule's two pages are drawn as the forms a project runs on: printed
// labels in a narrow grotesque, filled values in a plain one. Scoped here, so
// the rest of the application keeps its own look while this one is tried.
const archivo = Archivo({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-docket", display: "swap" });
const narrow = Archivo_Narrow({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-print", display: "swap" });

export default function ActionsLayout({ children }: { children: React.ReactNode }) {
  return <div className={`dockets ${archivo.variable} ${narrow.variable}`}>{children}</div>;
}
