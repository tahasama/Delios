/**
 * The PDF in dark mode (owner: "it would change with the app's modes"): the browser's reader shown dark, its page
 * darkened and its hues kept (a stamp stays green or red). The reader's own bar and side panel are hidden then, since
 * darkening the reader from outside flips them to light; the Preview's bar carries zoom, print and download instead.
 * In light mode the reader is the browser's own, whole. The file never changes.
 */
export const DARK_PDF_FILTER = "invert(0.9) hue-rotate(180deg)";

/** The reader's address: at the zoom chosen, without its own bar and side panel in dark mode. */
export function readerUrl(url: string, zoom: number, dark: boolean): string {
  return `${url}#zoom=${Math.round(zoom * 100)}${dark ? "&toolbar=0&navpanes=0" : ""}`;
}

/** Prints the PDF as it is (never darkened), through the browser's own printing. */
export function printPdf(url: string): void {
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0";
  frame.src = url;
  frame.onload = () => {
    try { frame.contentWindow?.print(); } catch { window.open(url, "_blank", "noopener"); }
    setTimeout(() => frame.remove(), 60_000);
  };
  document.body.appendChild(frame);
}
