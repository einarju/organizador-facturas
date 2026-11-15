// Banamex "estado de cuenta" -> list of movements + the naming rule.
//
// Folder name rule (from "Archivo concatenado Ejemplo.xlsx"):
//   MMDD_CC_TTAAAA_NOMBRE_$IMPORTE
//   MMDD   date without year
//   CC     last 2 digits of the QBE account number (contrato, never the CLABE)
//   TT     DC = deposit received, TR = transfer, CH = cheque
//   AAAA   last 4 digits of the movement's AUT number
//   IMPORTE no thousands commas, only the decimal point

const MONTHS = { ENE: "01", FEB: "02", MAR: "03", ABR: "04", MAY: "05", JUN: "06", JUL: "07", AGO: "08", SEP: "09", OCT: "10", NOV: "11", DIC: "12" };
const AMOUNT = /^\d{1,3}(?:,\d{3})*\.\d{2}$/;
const money = (s) => Number(String(s).replace(/[$,\s]/g, ""));
const near = (a, b) => Math.abs(a - b) < 0.005;

export function parseBanamex(pages) {
  const full = pages.flat().join("\n");
  if (!/banamex|BANCO NACIONAL DE MEXICO/i.test(full) || !/DETALLE DE OPERACIONES/.test(full)) {
    throw new Error("Este archivo no parece un estado de cuenta de Banamex.");
  }

  const info = {
    periodo: (full.match(/ESTADO DE CUENTA AL ([0-9]{1,2} DE [A-ZÁÉÍÓÚ]+ DE \d{4})/) || [])[1] || "",
    year: (full.match(/ESTADO DE CUENTA AL .*? DE (\d{4})/) || [])[1] || "",
    contrato: (full.match(/CONTRATO\s+(\d{6,})/) || [])[1] || "",
    clabe: (full.match(/CLABE Interbancaria\s+(\d{18})/i) || [])[1] || "",
    saldoAnterior: pick(full, /Saldo Anterior\s+\$([\d,]+\.\d{2})/),
    depositos: pick(full, /(\d+)\s+Dep[oó]sitos\s+\$([\d,]+\.\d{2})/, true),
    retiros: pick(full, /(\d+)\s+Retiros\s+\$([\d,]+\.\d{2})/, true),
    saldoFinal: pick(full, /SALDO AL \d{1,2} DE [A-ZÁÉÍÓÚ]+ DE \d{4}\s+\$([\d,]+\.\d{2})/),
  };

  const movs = [];
  const skipped = [];
  let prevSaldo = null;

  // A movement can start at the bottom of one page and end on the next,
  // so `cur` survives page breaks; only the detail table switch resets per page.
  let cur = null;
  for (const lines of pages) {
    let inDetail = false;
    for (const text of lines) {
      if (/^FECHA\s+CONCEPTO\s+RETIROS/.test(text)) { inDetail = true; continue; }
      if (!inDetail) continue;
      if (/SALDO MINIMO REQUERIDO|COMISIONES COBRADAS|^\d{6}\.[A-Z0-9]+\.OD\./.test(text)) { inDetail = false; continue; }

      let rest = text;
      const d = text.match(/^(\d{2}) ([A-Z]{3})\b\s*(.*)$/);
      if (d && MONTHS[d[2]]) {
        cur = { dia: d[1], mes: d[2], lines: [] };
        rest = d[3];
      }
      if (!cur) continue; // continuation of a movement whose amounts were already read

      const toks = rest.split(" ");
      const amts = [];
      while (toks.length && AMOUNT.test(toks[toks.length - 1])) amts.unshift(toks.pop());
      if (toks.join(" ").trim()) cur.lines.push(toks.join(" ").trim());
      if (!amts.length) continue;

      const concepto = cur.lines.join(" ").replace(/\s+/g, " ").trim();
      const saldo = money(amts[amts.length - 1]);
      if (/^SALDO ANTERIOR/.test(concepto)) {
        prevSaldo = saldo;
      } else if (amts.length === 1) {
        skipped.push({ fecha: `${cur.dia} ${cur.mes}`, concepto, motivo: "sin importe (solo saldo)" });
        prevSaldo = saldo;
      } else {
        const importe = money(amts[amts.length - 2]);
        let dir = "retiro";
        if (prevSaldo !== null && near(prevSaldo + importe, saldo)) dir = "deposito";
        else if (prevSaldo !== null && near(prevSaldo - importe, saldo)) dir = "retiro";
        else if (/PAGO RECIBIDO|DEPOSITO|ABONO/i.test(concepto)) dir = "deposito";
        movs.push(buildMovement(cur, concepto, importe, saldo, dir, info.year));
        prevSaldo = saldo;
      }
      cur = null;
    }
  }

  return { info, movs, skipped, checks: checkTotals(info, movs) };
}

function pick(text, re, pair = false) {
  const m = text.match(re);
  if (!m) return null;
  return pair ? { n: Number(m[1]), total: money(m[2]) } : money(m[1]);
}

function buildMovement(cur, concepto, importe, saldo, dir, year) {
  const auts = [...concepto.matchAll(/\bAUT\s+(\d{3,})/g)].map((m) => m[1]).filter((a) => Number(a) > 0);
  const aut = auts.length ? auts[auts.length - 1] : "";
  const tipo = dir === "deposito" ? "DC" : /CHEQUE/i.test(concepto) ? "CH" : "TR";
  return {
    fecha: `${cur.dia} ${cur.mes}`,
    fechaISO: year ? `${year}-${MONTHS[cur.mes]}-${cur.dia}` : "",
    mmdd: MONTHS[cur.mes] + cur.dia,
    concepto,
    importe,
    saldo,
    dir,
    aut,
    tipo,
    nombre: suggestName(concepto),
  };
}

// ---------- short name suggestion ----------

const COMPANY = /\s(S\.?\s?A\.?|SA|S DE R\.?L|SAPI|S\.?C\.?|A\.?C\.?)(\s|$|\.)/;

export function suggestName(c) {
  if (/^IVA COMISION/.test(c)) return "IVACOMISION";
  if (/^COMISION/.test(c)) return "COMISION";
  if (/S\.A\.T\.|IMPUESTOS/.test(c)) return "SAT";
  if (/^DOMI\b/.test(c)) return "DOMICILIACION";

  const raw =
    (c.match(/POR ORDEN DE (.+?) CTA\.?ORDENANTE/) || [])[1] ||
    (c.match(/AL BENEF\.? (.+?)(?: \(DATO| SU REF| CTA\.| CLAVE|$)/) || [])[1] ||
    (c.match(/PAGO RECIBIDO DE (.+?)(?: SU REF| REF\.| CTA\.|$)/) || [])[1] ||
    c;
  return shortName(raw);
}

function shortName(raw) {
  let s = clean(raw.replace(/\b(QUE BUENA EMPRESA S DE RL DE C\.?V?|SUC \d+|CAJA \d+ AUT \d+ HORA [\d: ]+)\b/g, " "));
  // "ALEJANDRO ROBERTO,LIRUSSO/MEMOLI" -> first name + first surname
  const person = s.match(/^([A-Z]+)(?: [A-Z]+)*,([A-Z]+)(?:\/[A-Z]+)?/);
  if (person) return (person[1] + person[2]).slice(0, 20);
  s = s.replace(/[,/]/g, " ");
  const cut = s.search(COMPANY);
  const isCompany = cut > 0;
  if (isCompany) s = s.slice(0, cut);
  const words = s.split(/\s+/).filter(Boolean);
  // 4-word person name without commas ("JUAN ANTONIO ROSAS OLIVERA") -> first surname
  if (!isCompany && words.length === 4) return words[2].slice(0, 20);
  return words.slice(0, 2).join("").slice(0, 20) || "SINNOMBRE";
}

export function clean(s) {
  return String(s)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9,/ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** What the family types in the name box: letters and numbers only. */
export function cleanNameInput(s) {
  return clean(s).replace(/[^A-Z0-9]/g, "").slice(0, 30);
}

// ---------- folder name ----------

export function fmtImporte(n) {
  return String(Math.round(n * 100) / 100);
}

export function folderName(m, cc) {
  const aut4 = (m.aut || "0000").slice(-4).padStart(4, "0");
  return `${m.mmdd}_${cc}_${m.tipo}${aut4}_${m.nombre || "SINNOMBRE"}_$${fmtImporte(m.importe)}`;
}

/** Folder names for every movement, made unique if two would collide. */
export function folderNames(movs, cc) {
  const seen = new Map();
  return movs.map((m) => {
    let name = folderName(m, cc);
    const n = (seen.get(name) || 0) + 1;
    seen.set(name, n);
    if (n > 1) name += `_${n}`;
    return name;
  });
}

// ---------- checks against the statement summary ----------

function checkTotals(info, movs) {
  const dep = movs.filter((m) => m.dir === "deposito");
  const ret = movs.filter((m) => m.dir === "retiro");
  const sum = (a) => Math.round(a.reduce((t, m) => t + m.importe, 0) * 100) / 100;
  const out = [];
  if (info.depositos) out.push({ label: "Depósitos", ok: dep.length === info.depositos.n && near(sum(dep), info.depositos.total), got: `${dep.length} por $${sum(dep).toLocaleString("es-MX", { minimumFractionDigits: 2 })}`, want: `${info.depositos.n} por $${info.depositos.total.toLocaleString("es-MX", { minimumFractionDigits: 2 })}` });
  if (info.retiros) out.push({ label: "Retiros", ok: ret.length === info.retiros.n && near(sum(ret), info.retiros.total), got: `${ret.length} por $${sum(ret).toLocaleString("es-MX", { minimumFractionDigits: 2 })}`, want: `${info.retiros.n} por $${info.retiros.total.toLocaleString("es-MX", { minimumFractionDigits: 2 })}` });
  if (info.saldoFinal !== null && movs.length) out.push({ label: "Saldo final", ok: near(movs[movs.length - 1].saldo, info.saldoFinal), got: `$${movs[movs.length - 1].saldo.toLocaleString("es-MX", { minimumFractionDigits: 2 })}`, want: `$${info.saldoFinal.toLocaleString("es-MX", { minimumFractionDigits: 2 })}` });
  return out;
}
