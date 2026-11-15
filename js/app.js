import { Workspace, canUseFolders, ESTADO_DIR, SIN_MOV_DIR, safeName } from "./workspace.js";
import { readPdfLines } from "./pdftext.js";
import { parseBanamex, folderNames, cleanNameInput } from "./estado.js";
import { readDocument, matchDocument } from "./facturas.js";
import { buildExcel, buildBat } from "./pipeline.js";

const ws = new Workspace();
const $ = (sel) => document.querySelector(sel);
const fmtMoney = (n) => "$" + n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const state = {
  estado: null,     // parseBanamex result
  created: false,   // folders + Excel + .bat written
  names: [],        // folder name per movement (fixed once created)
  pending: [],      // documents waiting to be saved
  saved: [],        // documents already saved
  uuids: new Set(), // to skip the same factura twice
};

// ---------- Step 1: job name + folder ----------
const jobInput = $("#job-name");
jobInput.value = defaultJobName();

if (!canUseFolders) {
  $("#fallback-note").hidden = false;
  $("#btn-pick").hidden = true;
  setStatus($("#folder-status"), "Modo navegador: los archivos se guardan aquí y se descargan en el ZIP.", "muted");
}

$("#btn-pick").addEventListener("click", async () => {
  try {
    const where = await ws.pick(jobInput.value);
    jobInput.disabled = true;
    $("#btn-pick").textContent = "Carpeta lista";
    $("#btn-pick").disabled = true;
    setStatus($("#folder-status"), `✓ Guardando en: ${where}`, "ok");
    toast("Carpeta lista");
  } catch (err) {
    if (err.name !== "AbortError") { console.error(err); toast("No se pudo usar esa carpeta"); }
  }
});

// ---------- Drop zones ----------
document.querySelectorAll(".drop").forEach((zone) => {
  const input = zone.querySelector("input[type=file]");
  const slot = zone.dataset.slot;
  zone.addEventListener("click", () => input.click());
  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
  });
  input.addEventListener("change", () => { onFiles(slot, [...input.files]); input.value = ""; });
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.remove("over");
    onFiles(slot, [...e.dataTransfer.files]);
  });
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

function onFiles(slot, files) {
  if (!files.length) return;
  if (!ws.ready) {
    toast("Primero elige la carpeta de trabajo (paso 1)");
    $("#btn-pick").focus();
    return;
  }
  jobInput.disabled = true;
  if (slot === "estado") onEstado(files[0]);
  else onFacturas(files);
}

// ---------- Step 2: estado de cuenta ----------
async function onEstado(file) {
  if (state.created) {
    toast("Las carpetas de este proceso ya se crearon. Para otro estado de cuenta, recarga la página.");
    return;
  }
  const list = document.querySelector('[data-list="estado"]');
  list.innerHTML = "";
  const li = addRow(list, file.name, "leyendo…");
  try {
    const estado = parseBanamex(await readPdfLines(file));
    if (!estado.movs.length) throw new Error("No encontré movimientos en el estado de cuenta.");
    const saved = await ws.save(ESTADO_DIR, file.name, file, { overwrite: true });
    li.firstChild.textContent = saved;
    li.lastChild.textContent = `${estado.movs.length} movimientos`;
    state.estado = estado;
    renderTable();
    updateZip();
    $("#step-tabla").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    console.error(err);
    li.lastChild.textContent = "error";
    toast(err.message || "No se pudo leer el estado de cuenta");
  }
}

// ---------- Step 3: table ----------
// Decided by the family (2026-11-15): always the last 2 digits of the
// account number (contrato), never the CLABE.
function cc() {
  return (state.estado.info.contrato || "00").slice(-2);
}

function renderTable() {
  const { info, movs, checks, skipped } = state.estado;
  $("#tabla-empty").hidden = true;
  $("#tabla-wrap").hidden = false;

  $("#cc-info").textContent = info.contrato
    ? `Cuenta …${info.contrato.slice(-4)} → ${cc()}`
    : "⚠ No encontré el número de cuenta, se usará 00";

  const ul = $("#checks");
  ul.innerHTML = "";
  for (const c of checks) {
    const li = document.createElement("li");
    li.className = c.ok ? "ok" : "bad";
    li.textContent = c.ok ? `✓ ${c.label}: ${c.got}, igual que el banco` : `⚠ ${c.label}: leí ${c.got}, el banco dice ${c.want}. Revisa la tabla.`;
    ul.appendChild(li);
  }
  for (const s of skipped) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = `· ${s.fecha} ${s.concepto.slice(0, 40)}… no lleva carpeta (${s.motivo})`;
    ul.appendChild(li);
  }

  const body = $("#movs-body");
  body.innerHTML = "";
  movs.forEach((m, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="nowrap"></td>
      <td><select aria-label="Tipo"><option value="DC">DC</option><option value="TR">TR</option><option value="CH">CH</option></select></td>
      <td><input class="name" aria-label="Nombre corto"><div class="concept"></div></td>
      <td class="amt nowrap"></td>
      <td><code class="folder"></code></td>`;
    tr.cells[0].textContent = m.fecha;
    const sel = tr.querySelector("select");
    sel.value = m.tipo;
    sel.addEventListener("change", () => { m.tipo = sel.value; refreshNames(); });
    const inp = tr.querySelector("input");
    inp.value = m.nombre;
    inp.addEventListener("input", () => {
      const v = cleanNameInput(inp.value);
      if (v !== inp.value) inp.value = v;
      m.nombre = v;
      refreshNames();
    });
    tr.querySelector(".concept").textContent = m.concepto.slice(0, 90);
    tr.querySelector(".concept").title = m.concepto;
    tr.cells[3].textContent = (m.dir === "deposito" ? "+" : "−") + fmtMoney(m.importe);
    tr.cells[3].className = `amt nowrap ${m.dir}`;
    body.appendChild(tr);
  });
  refreshNames();
}

function refreshNames() {
  const names = folderNames(state.estado.movs, cc());
  [...$("#movs-body").rows].forEach((tr, i) => (tr.querySelector(".folder").textContent = names[i]));
  return names;
}

$("#btn-crear").addEventListener("click", async () => {
  const btn = $("#btn-crear");
  const empty = state.estado.movs.filter((m) => !m.nombre);
  if (empty.length) { toast("Hay movimientos sin nombre corto"); return; }
  btn.disabled = true;
  btn.textContent = "Creando…";
  try {
    state.names = refreshNames();
    for (const n of state.names) await ws.mkdir(n);
    await ws.mkdir(SIN_MOV_DIR);
    await ws.save("", "crear_carpetas.bat", buildBat(state.names), { overwrite: true });
    await writeExcel();
    state.created = true;
    $("#tabla-wrap").classList.add("locked");
    $("#tabla-wrap").querySelectorAll("input, select").forEach((el) => (el.disabled = true));
    btn.textContent = "Carpetas creadas";
    setStatus($("#crear-status"), `✓ ${state.names.length} carpetas, el Excel y crear_carpetas.bat están listos. Ahora sube las facturas (paso 4).`, "ok");
    updateZip();
    $("#step-facturas").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    console.error(err);
    btn.disabled = false;
    btn.textContent = "Crear Excel, .bat y carpetas";
    toast("No se pudieron crear las carpetas");
  }
});

function excelName() {
  return `Movimientos ${safeName(jobInput.value)}.xlsx`;
}

async function writeExcel() {
  const docsByFolder = new Map();
  for (const d of state.saved) {
    if (d.dest === SIN_MOV_DIR) continue;
    if (!docsByFolder.has(d.dest)) docsByFolder.set(d.dest, []);
    docsByFolder.get(d.dest).push(d.guardadoComo);
  }
  const blob = await buildExcel({
    estado: state.estado,
    names: state.names,
    cc: cc(),
    docsByFolder,
    sinMov: state.saved.filter((d) => d.dest === SIN_MOV_DIR),
  });
  await ws.save("", excelName(), blob, { overwrite: true });
}

// ---------- Step 4: facturas ----------
async function onFacturas(files) {
  if (!state.created) {
    toast("Primero crea las carpetas (paso 3)");
    $("#step-tabla").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  $("#docs-wrap").hidden = false;
  let n = 0;
  for (const file of files) {
    setStatus($("#docs-status"), `Leyendo ${++n} de ${files.length}… (los PDF escaneados tardan unos segundos)`, "muted");
    const doc = await readDocument(file);
    if (doc.uuid && state.uuids.has(doc.uuid)) {
      doc.duplicada = true;
      doc.dest = "";
    } else {
      if (doc.uuid) state.uuids.add(doc.uuid);
      const idx = matchDocument(doc, state.estado.movs);
      doc.dest = idx >= 0 ? state.names[idx] : SIN_MOV_DIR;
    }
    state.pending.push(doc);
  }
  renderDocs();
  setStatus($("#docs-status"), "", "muted");
}

function renderDocs() {
  const ul = $("#docs-list");
  ul.innerHTML = "";
  const all = [...state.saved.map((d) => ({ d, saved: true })), ...state.pending.map((d) => ({ d, saved: false }))];
  for (const { d, saved } of all) {
    const li = document.createElement("li");
    li.className = saved ? "saved" : d.duplicada ? "dup" : "";
    const info = document.createElement("div");
    info.className = "doc-info";
    const name = document.createElement("div");
    name.className = "doc-name";
    name.textContent = d.archivo;
    const meta = document.createElement("div");
    meta.className = "doc-meta muted";
    meta.textContent = describe(d);
    info.append(name, meta);

    const sel = document.createElement("select");
    sel.setAttribute("aria-label", "Carpeta destino");
    sel.add(new Option("No guardar", ""));
    sel.add(new Option(SIN_MOV_DIR, SIN_MOV_DIR));
    state.names.forEach((n) => sel.add(new Option(n, n)));
    sel.value = d.dest;
    sel.disabled = saved;
    sel.addEventListener("change", () => (d.dest = sel.value));
    li.append(info, sel);
    ul.appendChild(li);
  }
  $("#btn-guardar").disabled = !state.pending.length;
}

function describe(d) {
  if (saved(d)) return `✓ Guardado en ${d.dest}`;
  if (d.duplicada) return "Duplicada: esta factura ya está en la lista";
  if (d.tipo === "comprobante") return `Comprobante de transferencia · ${d.emisor || "?"} · ${num(d.importe)} · aut. ${d.aut || "?"}${d.ocr ? " · leído como imagen, revisa la carpeta" : ""}`;
  if (d.tipo === "factura") return `Factura · ${d.emisor || "?"} · ${num(d.importe)} · ${d.fecha || ""}${d.formaPago ? " · " + d.formaPago : ""}`;
  return "No se reconoció el documento: elige la carpeta a mano";
}
const saved = (d) => state.saved.includes(d);
const num = (n) => (Number.isFinite(n) ? fmtMoney(n) : "$?");

$("#btn-guardar").addEventListener("click", async () => {
  const btn = $("#btn-guardar");
  btn.disabled = true;
  let n = 0;
  try {
    for (const d of [...state.pending]) {
      state.pending.splice(state.pending.indexOf(d), 1);
      if (!d.dest) continue;
      d.guardadoComo = await ws.save(d.dest, d.archivo, d.file);
      state.saved.push(d);
      n++;
    }
    await writeExcel();
    renderDocs();
    const sin = state.saved.filter((d) => d.dest === SIN_MOV_DIR).length;
    setStatus($("#docs-status"), `✓ ${n} documentos guardados. El Excel ya incluye los documentos${sin ? ` y ${sin} sin movimiento en su propia hoja` : ""}.`, "ok");
    updateZip();
  } catch (err) {
    console.error(err);
    renderDocs();
    toast("Error guardando documentos");
  }
});

// ---------- Step 5: ZIP ----------
function updateZip() {
  $("#btn-zip").disabled = ws.count === 0;
}

$("#btn-zip").addEventListener("click", async () => {
  const btn = $("#btn-zip");
  btn.disabled = true;
  btn.textContent = "Preparando…";
  try {
    const blob = await ws.zip(jobInput.value);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${safeName(jobInput.value)}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (err) {
    console.error(err);
    toast("No se pudo crear el ZIP");
  } finally {
    btn.textContent = "Descargar ZIP";
    btn.disabled = false;
  }
});

// ---------- helpers ----------
function defaultJobName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `Proceso_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}
function setStatus(el, text, kind) {
  el.textContent = text;
  el.className = `status ${kind}`;
}
function addRow(list, name, right) {
  const li = document.createElement("li");
  const n = document.createElement("span");
  n.textContent = name;
  const s = document.createElement("span");
  s.className = "size";
  s.textContent = right;
  li.append(n, s);
  list.appendChild(li);
  return li;
}
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3000);
}

// exposed for testing in the browser console
window.__organizador = { state, ws };
