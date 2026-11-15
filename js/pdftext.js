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

// ---------- OCR fallback for PDFs whose text is drawn as shapes ----------
// (e.g. the BancaNet transfer receipts). Tesseract.js runs in the browser;
// it is loaded only when needed and the document never leaves the PC.

const TESS = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
let tessLoading = null;

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  tessLoading ||= new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = TESS;
    s.onload = ok;
    s.onerror = () => fail(new Error("No se pudo cargar el lector de texto (OCR)."));
    document.head.appendChild(s);
  });
  return tessLoading;
}

/** Renders the first pages to images and reads them with OCR. */
export async function ocrPdf(file, maxPages = 2) {
  await loadTesseract();
  const lib = window.pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = WORKER;
  const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const worker = await window.Tesseract.createWorker("spa", 1, {
    workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
    corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1",
    langPath: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/spa/4.0.0_best_int",
  });
  try {
    let text = "";
    for (let p = 1; p <= Math.min(pdf.numPages, maxPages); p++) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 2.5 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const { data } = await worker.recognize(canvas);
      text += data.text + "\n";
    }
    return text;
  } finally {
    await worker.terminate();
  }
}
