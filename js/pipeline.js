// Output files: the formatted Excel and the .bat that creates the folders.

import { fmtImporte } from "./estado.js";

const HEADERS = [
  "SIEMPRE md",
  "FECHA sin año MMDD_",
  "#cta de QBE los últimos 2 dígitos",
  "DC=depósito recibido TR=Transferencia banc. CH=Cheque + 4 ult. dígitos de AUT",
  "Nombre",
  "IMPORTE sin comas, solo puntos decimales",
  "Concatenado (nombre de la carpeta)",
  "Fecha",
  "Concepto en el estado de cuenta",
  "Retiro",
  "Depósito",
  "Saldo",
  "Documentos en la carpeta",
];

/**
 * @param estado  result of parseBanamex
 * @param names   folder name per movement
 * @param cc      the 2 account digits
 * @param docsByFolder  Map folderName -> [file names]
 * @param sinMov  documents with no movement
 */
export async function buildExcel({ estado, names, cc, docsByFolder = new Map(), sinMov = [] }) {
  const wb = new window.ExcelJS.Workbook();
  wb.creator = "Organizador de Facturas";

  // ---- Sheet 1: Movimientos ----
  const ws = wb.addWorksheet("Movimientos", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [8, 12, 10, 14, 22, 14, 44, 11, 60, 14, 14, 14, 40].map((width) => ({ width }));
  ws.addRow(HEADERS);
  estado.movs.forEach((m, i) => {
    const r = i + 2;
    const aut4 = (m.aut || "0000").slice(-4).padStart(4, "0");
    const imp = Number(fmtImporte(m.importe));
    ws.addRow([
      "md",
      `${m.mmdd}_`,
      `${cc}_`,
      `${m.tipo}${aut4}_`,
      `${m.nombre}_$`,
      imp,
      { formula: `A${r}&" "&B${r}&C${r}&D${r}&E${r}&F${r}`, result: `md ${names[i]}` },
      m.fecha,
      m.concepto,
      m.dir === "retiro" ? m.importe : null,
      m.dir === "deposito" ? m.importe : null,
      m.saldo,
      (docsByFolder.get(names[i]) || []).join(", "),
    ]);
  });
  const last = estado.movs.length + 1;
  const tot = ws.addRow(["", "", "", "", "", "", "", "", "TOTAL", { formula: `SUM(J2:J${last})` }, { formula: `SUM(K2:K${last})` }]);
  tot.font = { bold: true };

  styleHeader(ws.getRow(1));
  ws.autoFilter = { from: "A1", to: `M${last}` };
  ["J", "K", "L"].forEach((c) => (ws.getColumn(c).numFmt = "#,##0.00"));
  ws.getColumn("I").alignment = { wrapText: true, vertical: "top" };
  for (let r = 2; r <= last; r++) {
    const row = ws.getRow(r);
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.border = thin;
      if (col !== 9) cell.alignment = { vertical: "top" };
    });
    if (estado.movs[r - 2].dir === "deposito") row.getCell(11).font = { color: { argb: "FF1F6F5C" } };
  }

  // ---- Sheet 2: Sin movimiento ----
  const ws2 = wb.addWorksheet("Sin movimiento", { views: [{ state: "frozen", ySplit: 1 }] });
  ws2.columns = [12, 40, 16, 40, 22, 14, 46].map((width) => ({ width }));
  ws2.addRow(["Fecha", "Emisor", "RFC emisor", "Folio fiscal", "Forma de pago", "Total", "Archivo"]);
  styleHeader(ws2.getRow(1));
  for (const d of sinMov) {
    const row = ws2.addRow([d.fecha || "", d.emisor || "", d.rfcEmisor || "", d.uuid || "", d.formaPago || "", Number.isFinite(d.importe) ? d.importe : null, d.guardadoComo || d.archivo]);
    row.eachCell({ includeEmpty: true }, (c) => (c.border = thin));
  }
  ws2.getColumn(6).numFmt = "#,##0.00";

  // ---- Sheet 3: Resumen ----
  const ws3 = wb.addWorksheet("Resumen");
  ws3.columns = [{ width: 30 }, { width: 30 }];
  const i = estado.info;
  const rows = [
    ["Estado de cuenta al", i.periodo],
    ["Contrato", i.contrato],
    ["CLABE", i.clabe],
    ["Dígitos de cuenta usados", cc],
    ["Saldo anterior", i.saldoAnterior],
    ["Depósitos (según banco)", i.depositos ? `${i.depositos.n} por ${i.depositos.total}` : ""],
    ["Retiros (según banco)", i.retiros ? `${i.retiros.n} por ${i.retiros.total}` : ""],
    ["Saldo final", i.saldoFinal],
    ["Movimientos con carpeta", estado.movs.length],
    ["Facturas sin movimiento", sinMov.length],
  ];
  rows.forEach((r) => ws3.addRow(r));
  ws3.getColumn(1).font = { bold: true };
  ws3.getColumn(2).numFmt = "#,##0.00";

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

const thin = { top: { style: "thin", color: { argb: "FFD0D0D0" } }, left: { style: "thin", color: { argb: "FFD0D0D0" } }, bottom: { style: "thin", color: { argb: "FFD0D0D0" } }, right: { style: "thin", color: { argb: "FFD0D0D0" } } };

function styleHeader(row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.alignment = { wrapText: true, vertical: "middle" };
  row.height = 48;
  row.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F6F5C" } };
    c.border = thin;
  });
}

/** .bat that creates every folder next to itself. */
export function buildBat(folderNames) {
  const lines = ["@echo off", "chcp 65001 >nul", 'cd /d "%~dp0"'];
  for (const name of folderNames) lines.push(`if not exist "${name}" md "${name}"`);
  lines.push(`echo Listo: ${folderNames.length} carpetas.`, "pause");
  // CRLF line endings so Windows cmd reads it correctly
  return new Blob([lines.join("\r\n") + "\r\n"], { type: "application/x-bat" });
}
