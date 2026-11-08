// The processing pipeline. Each step is a stub until the workflow details
// and the test documents arrive. Keep every step pure where possible:
// input data in, data/Blob out, and let app.js decide where to save it.

/** Step A: read the estado de cuenta (PDF/Excel/CSV) into rows. */
export async function parseEstadoDeCuenta(file) {
  // TODO: depends on the bank format of the test documents.
  return { rows: [], note: "Lectura del estado de cuenta: pendiente" };
}

/** Step B: rows -> formatted Excel table (Blob). */
export async function buildExcel(rows) {
  // TODO: formatted .xlsx (ExcelJS or SheetJS from CDN).
  return null;
}

/** Step C: folder names -> .bat that creates them next to itself. */
export function buildBat(folderNames) {
  const lines = ["@echo off", "chcp 65001 >nul", 'cd /d "%~dp0"'];
  for (const name of folderNames) lines.push(`if not exist "${name}" mkdir "${name}"`);
  lines.push("echo Carpetas creadas.", "pause");
  // CRLF line endings so Windows cmd reads it correctly
  return new Blob([lines.join("\r\n") + "\r\n"], { type: "application/x-bat" });
}

/** Step D: decide which folder each factura belongs to. */
export async function classifyFactura(file, rows) {
  // TODO: match by RFC / amount / date / concept once the rules are defined.
  return null; // null = leave it in 02_facturas
}
