# Organizador de Facturas

Family tool, hosted on GitHub Pages. Static site, no server, no build step:
**documents never leave the computer**, everything is processed in the browser.

## Workflow

1. Pick a work folder on the PC (Chrome/Edge write real files there; other browsers get a ZIP).
2. Drop the Banamex **estado de cuenta** (PDF). Every movement is read and checked
   against the bank's own summary (deposits, withdrawals, final balance).
3. Review the table (type DC/TR/CH and short name are editable), choose the account
   digits, then **Crear Excel, .bat y carpetas**.
4. Drop **facturas** (CFDI PDF or XML) and **BancaNet receipts**. Each one gets a suggested
   folder: receipts by AUT number, facturas by amount (+ date and name). No match goes to
   `SIN MOVIMIENTO` and to its own Excel sheet. The same factura twice is skipped.
5. Download everything as a ZIP.

## Folder name rule

`MMDD_CC_TTAAAA_NOMBRE_$IMPORTE`, e.g. `1001_17_DC0119_ROSAS_$50000`

- `MMDD` date without year
- `CC` last 2 digits of the account (contract by default, CLABE selectable)
- `TT` DC deposit received, TR transfer, CH cheque; `AAAA` last 4 digits of the AUT number
- `IMPORTE` no thousands commas

## Output on the PC

```
Proceso_2026-11-15_1430/
  ESTADO DE CUENTA/                  original statement
  Movimientos Proceso_....xlsx       sheets: Movimientos, Sin movimiento, Resumen
  crear_carpetas.bat                 recreates the folders on any Windows PC
  1001_17_DC0119_ROSAS_$50000/       one folder per movement, with its documents
  SIN MOVIMIENTO/
```

## Files

- `js/pdftext.js`: PDF text by lines (pdf.js) + OCR fallback (Tesseract.js) for receipts drawn as shapes
- `js/estado.js`: Banamex parser, short-name suggestion, folder names, total checks
- `js/facturas.js`: factura / receipt reader and folder matching
- `js/pipeline.js`: Excel (ExcelJS) and .bat
- `js/workspace.js`: the job folder on the PC (File System Access API + memory fallback)
- `js/app.js`: UI

Libraries load from CDNs at pinned versions: pdf.js 3.11.174, ExcelJS 4.4.0, JSZip 3.10.1, Tesseract.js 5.1.1.

## Test documents

Put real sample docs in `test-docs/`. It is git-ignored, as are all
`.pdf/.xml/.xlsx/.csv/.zip` files: **bank data must never be committed** (the repo is public).
