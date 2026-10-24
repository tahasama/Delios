# Previews: what the page shows, and what comes next

Decided with the owner (keep this answer).

## Shown today
PDF (the browser's viewer), pictures (JPG, PNG, GIF, WebP, AVIF, BMP; SVG stays a download, it can carry code), Excel
(.xlsx, .xlsm), CSV (one sheet), Primavera P6 (.xer). Every one with the zoom and the download in the bar above.

## Built (owner: "build all including the dwg workaround")
1. **.xls** (old Excel): a free reader for the old format, drawn in the same table as .xlsx.
2. **Plain text** (.txt, .log, .json, .xml): shown as text, never run.
3. **Word (.docx)**: a free converter to a readable page in the app; close, not exact, on complex layouts.
4. **PowerPoint (.pptx), and Word exactly**: turned into a PDF on our side (LibreOffice in a container, free), then shown
   as any PDF. Faithful; one more service to run.
5. **3D, BIM first** (owner: "mostly BIM"): **IFC**, and **glTF / OBJ / STL**, viewed in the page (turn, zoom, hide
   parts), free libraries. STEP left out.

## DWG: the free route built; a certified reader to decide
No good free reader. Paid, certified: the Open Design Alliance's SDK (yearly membership; web use needs the Sustaining
tier or above), or Autodesk Platform Services (the Viewer free, each conversion paid in Flex tokens past a free monthly
allowance). Free route: convert to DXF or PDF on our side, mixed quality. DXF itself can be drawn free in the page.

Built: LibreDWG behind a small service (`deploy/dwg`), the DXF drawn in the page (dxf-viewer). If its reading falls short
on the project's drawings, the certified routes above stay open.
