import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// Part 10 / §12.5 — every released revision carries a fixed, viewable rendition
// showing the document number, revision, status and date; obsolete renditions are
// visibly marked not-current.

export type StampInfo = {
  docNumber: string;
  rev: string;
  statusLabel: string;
  date: Date;
  /** HELD: released, then on hold for an outside approval — not for use. */
  state?: "RELEASED" | "SUPERSEDED" | "VOID" | "HELD";
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
  const obsolete = info.state === "SUPERSEDED" || info.state === "VOID" || info.state === "HELD";

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
      const text = info.state === "VOID" ? "VOID — NOT VALID" : info.state === "HELD" ? "ON HOLD — NOT FOR USE" : "SUPERSEDED — NOT FOR USE";
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
      page.drawText(info.state === "VOID" ? "VOID (§12.1) — treated as never valid" : info.state === "HELD" ? "ON HOLD — awaiting outside approval; not for use" : "SUPERSEDED (§12.5) — visibly marked not-current", {
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

export type VerdictStamp = {
  /** The review's own number, e.g. RV-0076 — kept in the record, not printed. */
  review: string | null;
  code: string;
  label: string;
  /** Whether the verdict lets the document proceed — the stamp's colour. */
  proceeds: boolean;
  by: string;
  /** An outside party's verdict, written down by one of us. */
  forParty?: string | null;
  at: Date;
  reason?: string | null;
};

/** Standard PDF fonts carry only Latin-1; anything else is shown as "?" rather than failing. */
function latin(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

/** Break a sentence into lines no wider than `width` points, at most `max` of them. */
function lines(text: string, width: number, size: number, font: { widthOfTextAtSize(t: string, s: number): number }, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) { line = next; continue; }
    if (line) out.push(line);
    line = word;
    if (out.length === max) break;
  }
  if (line && out.length < max) out.push(line);
  if (out.length === max && text.length > out.join(" ").length) out[max - 1] = `${out[max - 1].replace(/.{0,3}$/, "")}...`;
  return out;
}

/**
 * The review verdict stamped on the first page, top right, the way a reviewer
 * stamps a paper drawing: which review, what it decided, who decided it, when,
 * and why. Green where the verdict lets the document proceed, red where it does
 * not. It sits below the title block the release adds, so the two never meet.
 */
export async function stampVerdict(source: Uint8Array, info: VerdictStamp): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(source);
  if (pdf.getPageCount() === 0) return source;
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.getPages()[0];
  const { width, height } = page.getSize();
  const ink = info.proceeds ? rgb(0.02, 0.45, 0.25) : rgb(0.75, 0.1, 0.1);
  const boxW = Math.min(230, width * 0.42);
  const pad = 8;
  const reason = info.reason ? lines(latin(info.reason), boxW - pad * 2, 7.5, font, 3) : [];
  const boxH = 64 + reason.length * 9.5 + (info.forParty ? 9.5 : 0);
  const x = width - boxW - 18;
  const top = height - 34 - 12; // below the release title block
  page.drawRectangle({ x, y: top - boxH, width: boxW, height: boxH, color: rgb(1, 1, 1), opacity: 0.92, borderColor: ink, borderWidth: 1.4 });
  let y = top - pad - 7;
  page.drawText("REVIEW", { x: x + pad, y, size: 7, font: bold, color: ink });
  y -= 15;
  page.drawText(latin(`${info.code} - ${info.label}`.slice(0, 48)), { x: x + pad, y, size: 11, font: bold, color: ink });
  y -= 13;
  page.drawText(latin(info.by), { x: x + pad, y, size: 8, font, color: rgb(0.15, 0.17, 0.22) });
  if (info.forParty) {
    y -= 9.5;
    page.drawText(latin(`for ${info.forParty}`), { x: x + pad, y, size: 7.5, font, color: rgb(0.35, 0.38, 0.45) });
  }
  y -= 10;
  const when = `${info.at.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}  ${info.at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
  page.drawText(latin(when), { x: x + pad, y, size: 7.5, font, color: rgb(0.35, 0.38, 0.45) });
  for (const one of reason) {
    y -= 9.5;
    page.drawText(one, { x: x + pad, y, size: 7.5, font, color: rgb(0.2, 0.22, 0.28) });
  }
  return pdf.save();
}
