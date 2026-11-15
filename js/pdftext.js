// Reads a PDF in the browser (pdf.js) and rebuilds its text as lines,
// grouping text pieces that sit on the same baseline.

const WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

/** @returns {Promise<string[][]>} pages -> lines (top to bottom) */
export async function readPdfLines(file) {
  const lib = window.pdfjsLib;
  if (!lib) throw new Error("No se cargó el lector de PDF. Revisa tu conexión a internet.");
  lib.GlobalWorkerOptions.workerSrc = WORKER;

  const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const { items } = await page.getTextContent();
    const pieces = items
      .filter((i) => i.str && i.str.trim())
      .map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5] }))
      .sort((a, b) => b.y - a.y || a.x - b.x);

    const lines = [];
    for (const it of pieces) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - it.y) < 2.5) last.items.push(it);
      else lines.push({ y: it.y, items: [it] });
    }
    pages.push(
      lines.map((l) =>
        l.items.sort((a, b) => a.x - b.x).map((i) => i.s.trim()).join(" ").replace(/\s+/g, " ").trim()
      )
    );
  }
  return pages;
}
