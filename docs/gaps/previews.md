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

Built: LibreDWG behind a small service (`deploy/dwg`, openSUSE's ready-made libredwg-tools: building it from source failed), the DXF drawn in the page (dxf-viewer). If its reading falls short
on the project's drawings, the certified routes above stay open.

## Decided after trying them (owner)
- **Office → PDF on standby**: out of the default services (compose profile `office`, `PREVIEW_OFFICE_URL` empty).
  About 1.5 GB to download and up to 1 GB of memory, for what the revision's own PDF already shows; nobody edits Word
  in the app. Word and PowerPoint files are offered to download, saying why. To switch it on: `COMPOSE_PROFILES=app,office`
  and `PREVIEW_OFFICE_URL=http://gotenberg:3000` in `.env`.
- **DWG, the free route kept**: light, and good on Autodesk's samples once its multi-line texts were mended (v2).
- **A certified DWG reader stays an option, not built**: added the day a client asks for one (Autodesk Platform Services
  for pay per use, ODA for volume or files that must not leave our servers).
- **How it is suggested** (owner): above every drawing, one short line, "For viewing only · the revision's PDF is the
  reference". The paid reader is suggested only to those who decide: the organization's Settings card **Viewing
  drawings** (`/organization/settings/drawings`, administrators) says the reader in use and what it leaves out, and
  offers "Ask for it" (a message, optional). The ask lands with the app's owner: kept above every organization
  (`product_requests`, `Organizations/ProductRequests.cs`, `POST /api/admin/product-requests`, PRODUCT_REQUESTED), read
  with the backend command `requests`, and emailed to DELIOS's address (`DELIOS_CONTACT_EMAIL` in `.env`,
  `Email__DeliosAddress`; empty: kept only). Under a DWG that does not open, an administrator alone reads "A certified
  reader opens these: see Settings → Viewing drawings".
