// Files the Preview's viewers load in the browser, copied from their packages into public/vendor at every build
// (never edited, never committed): the IFC reader's WebAssembly (web-ifc), the drawing viewer's font (DejaVu Sans) and pdf.js's worker.
import { copyFileSync, mkdirSync } from "node:fs";

const files = [
  ["node_modules/web-ifc/web-ifc.wasm", "public/vendor/web-ifc/web-ifc.wasm"],
  ["node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf", "public/vendor/fonts/DejaVuSans.ttf"],
  // The PDF drawn by the page itself for "Dark page" (pdf.js's worker).
  ["node_modules/pdfjs-dist/build/pdf.worker.min.mjs", "public/vendor/pdfjs/pdf.worker.min.mjs"],
];
for (const [from, to] of files) {
  mkdirSync(to.slice(0, to.lastIndexOf("/")), { recursive: true });
  copyFileSync(from, to);
}
