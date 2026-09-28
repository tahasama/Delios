import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// Part 10 / §12.5 — every released revision carries a fixed, viewable rendition
// showing the document number, revision, status and date; obsolete renditions are
// visibly marked not-current.

export type StampInfo = {
  docNumber: string;
  rev: string;
  statusLabel: string;
  date: Date;
  state?: "RELEASED" | "SUPERSEDED" | "VOID";
  title?: string;
};

export async function stampPdf(source: Buffer | Uint8Array | undefined, info: StampInfo): Promise<Uint8Array> {
  let pdf: PDFDocument;
  if (source) {
    try {
      pdf = await PDFDocument.load(source);
    } catch {
      pdf = await PDFDocument.create();
    }
  } else {
    pdf = await PDFDocument.create();
  }
  if (pdf.getPageCount() === 0) pdf.addPage([595, 842]);

  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const small = await pdf.embedFont(StandardFonts.Helvetica);
  const obsolete = info.state === "SUPERSEDED" || info.state === "VOID";

  // Title block on every page: number, revision, status, date (§10.2 / DEF-FM-05)
  const pages = pdf.getPages();
  for (const page of pages) {
    const { width, height } = page.getSize();
    const banner = rgb(0.12, 0.23, 0.37); // #1e3a5f
    page.drawRectangle({ x: 0, y: height - 34, width, height: 34, color: banner });
    page.drawText(`${info.docNumber}`, { x: 24, y: height - 22, size: 11, font, color: rgb(1, 1, 1) });
    page.drawText(`Rev ${info.rev}`, { x: width - 170, y: height - 22, size: 11, font, color: rgb(1, 1, 1) });
    page.drawText(`${info.statusLabel} · ${info.date.toLocaleDateString("en-GB")}`, { x: width - 320, y: height - 22, size: 9, font: small, color: rgb(0.85, 0.9, 0.95) });

    if (obsolete) {
      const angle = Math.atan2(height, width);
      const text = info.state === "VOID" ? "VOID — NOT VALID" : "SUPERSEDED — NOT FOR USE";
      page.drawText(text, {
        x: width * 0.12,
        y: height * 0.32,
        size: 42,
        font,
        color: rgb(0.85, 0.1, 0.1),
        opacity: 0.22,
        rotate: { type: "radians", angle, } as never,
      });
      page.drawRectangle({
        x: 24, y: 24, width: Math.min(width - 48, 300), height: 26,
        color: rgb(0.85, 0.1, 0.1),
      });
      page.drawText(info.state === "VOID" ? "VOID (§12.1) — treated as never valid" : "SUPERSEDED (§12.5) — visibly marked not-current", {
        x: 32, y: 32, size: 9, font, color: rgb(1, 1, 1),
      });
    }
  }
  return pdf.save();
}

/** Minimal placeholder rendition used by the demo seed. */
export async function createPlaceholderRendition(info: StampInfo & { content: string }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595, 842]);
  page.drawText(info.title ?? info.docNumber, { x: 48, y: 720, size: 16, font: bold, color: rgb(0.1, 0.1, 0.2) });
  const lines = info.content.split("\n").slice(0, 30);
  let y = 690;
  for (const line of lines) {
    page.drawText(line, { x: 48, y, size: 10, font, color: rgb(0.25, 0.25, 0.3) });
    y -= 16;
  }
  return stampPdf(await pdf.save(), info);
}
