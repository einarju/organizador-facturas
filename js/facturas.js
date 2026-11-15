// Reads facturas (CFDI PDF or XML) and BancaNet transfer receipts,
// then suggests which movement folder each one belongs to.

import { readPdfLines } from "./pdftext.js";
import { clean } from "./estado.js";

const money = (s) => Number(String(s).replace(/[$,\s]/g, ""));
const near = (a, b) => Math.abs(a - b) < 0.005;
const FORMAS = { "01": "Efectivo", "02": "Cheque nominativo", "03": "Transferencia", "04": "Tarjeta de crédito", "28": "Tarjeta de débito", "99": "Por definir" };

export async function readDocument(file) {
  const base = { archivo: file.name, file };
  try {
    if (/\.xml$/i.test(file.name)) return { ...base, ...parseXml(await file.text()) };
    if (/\.pdf$/i.test(file.name)) return { ...base, ...parsePdfText((await readPdfLines(file)).flat().join("\n")) };
  } catch (err) {
    console.error(err);
  }
  return { ...base, tipo: "otro" };
}

export function parsePdfText(t) {
  if (/BancaNet|transferencia ha sido Aceptada/i.test(t)) {
    return {
      tipo: "comprobante",
      importe: money((t.match(/Importe MXN\s*\$?\s*([\d,]+\.\d{2})/) || [])[1] || NaN),
      aut: (t.match(/autorizaci[oó]n\s+(\d+)/i) || [])[1] || "",
      fecha: dmyToIso((t.match(/Fecha valor\s+(\d{2}\/\d{2}\/\d{4})/) || [])[1]),
      emisor: cutLabel((t.match(/Nombre:\s*(.+?)\s*\(Dato/) || [])[1] || ""),
    };
  }
  if (/Folio fiscal|CFDI/i.test(t)) {
    const totals = [...t.matchAll(/(?:TOTAL DEL COMPROBANTE|(?<![A-Za-z])Total)\s*\$\s*([\d,]+\.\d{2})/g)];
    return {
      tipo: "factura",
      uuid: ((t.match(/Folio fiscal:?\s*([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})/i) || t.match(/UUID\s*([0-9A-F-]{36})/i) || [])[1] || "").toUpperCase(),
      emisor: cutLabel((t.match(/Nombre (?:del )?emisor:?\s*(.+)/i) || [])[1] || ""),
      rfcEmisor: (t.match(/RFC (?:del )?emisor:?\s*([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})/i) || [])[1] || "",
      importe: totals.length ? money(totals[totals.length - 1][1]) : NaN,
      fecha: (t.match(/(\d{4}-\d{2}-\d{2})[ T]\d{2}:\d{2}:\d{2}/) || [])[1] || "",
      formaPago: (t.match(/Forma de pago:?\s*(?:\d{2}-)?(Efectivo|Tarjeta de d[eé]bito|Tarjeta de cr[eé]dito|Transferencia electr[oó]nica de fondos|Cheque nominativo|Por definir)/i) || [])[1] || "",
    };
  }
  return { tipo: "otro" };
}

export function parseXml(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const byName = (n) => [...doc.getElementsByTagName("*")].find((e) => e.localName === n);
  const comp = byName("Comprobante");
  if (!comp) return { tipo: "otro" };
  const emisor = byName("Emisor");
  const tfd = byName("TimbreFiscalDigital");
  return {
    tipo: "factura",
    uuid: (tfd?.getAttribute("UUID") || "").toUpperCase(),
    emisor: emisor?.getAttribute("Nombre") || "",
    rfcEmisor: emisor?.getAttribute("Rfc") || "",
    importe: Number(comp.getAttribute("Total")),
    fecha: (comp.getAttribute("Fecha") || "").slice(0, 10),
    formaPago: FORMAS[comp.getAttribute("FormaPago")] || comp.getAttribute("FormaPago") || "",
  };
}

// The PDF puts two columns on one line; cut a value where the next label starts.
function cutLabel(v) {
  return v.split(/\s+(?:No\. de serie|Folio fiscal|Folio:|Serie:|C[oó]digo postal|Efecto de|R[eé]gimen|Exportaci[oó]n|RFC)/i)[0].trim();
}
function dmyToIso(s) {
  if (!s) return "";
  const [d, m, y] = s.split("/");
  return `${y}-${m}-${d}`;
}

/**
 * Pick the movement for each document.
 * Receipts: same AUT number. Facturas: same amount, closest date, name hint.
 * @returns index into movs, or -1 for SIN MOVIMIENTO
 */
export function matchDocument(doc, movs) {
  if (doc.tipo === "comprobante" && doc.aut) {
    const i = movs.findIndex((m) => m.aut && Number(m.aut) === Number(doc.aut));
    if (i >= 0) return i;
  }
  if (!(doc.importe > 0)) return -1;
  const cands = movs.map((m, i) => ({ m, i })).filter(({ m }) => near(m.importe, doc.importe));
  if (!cands.length) return -1;
  if (cands.length === 1) return cands[0].i;
  const name = clean(doc.emisor).replace(/[^A-Z0-9]/g, "");
  const score = ({ m }) => {
    let s = 0;
    if (doc.fecha && m.fechaISO) s -= Math.abs(Date.parse(m.fechaISO) - Date.parse(doc.fecha)) / 864e5;
    if (name && m.nombre && name.includes(m.nombre.slice(0, 6))) s += 30;
    if (doc.tipo === "factura" && m.dir === "retiro") s += 1;
    return s;
  };
  return cands.sort((a, b) => score(b) - score(a))[0].i;
}
