import { Workspace, SUBFOLDERS, canUseFolders } from "./workspace.js";
import { parseEstadoDeCuenta, classifyFactura } from "./pipeline.js";

const ws = new Workspace();
const $ = (sel) => document.querySelector(sel);

// ---------- Step 1: job name + folder ----------
const jobInput = $("#job-name");
jobInput.value = defaultJobName();

if (!canUseFolders) {
  $("#fallback-note").hidden = false;
  $("#btn-pick").hidden = true;
  setStatus("Modo navegador: los archivos se guardan aquí y se descargan en el ZIP.", "muted");
}

$("#btn-pick").addEventListener("click", async () => {
  try {
    const where = await ws.pick(jobInput.value);
    jobInput.disabled = true;
    $("#btn-pick").textContent = "Carpeta lista";
    $("#btn-pick").disabled = true;
    setStatus(`✓ Guardando en: ${where}`, "ok");
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
  input.addEventListener("change", () => { handleFiles(slot, [...input.files]); input.value = ""; });

  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.remove("over");
    handleFiles(slot, [...e.dataTransfer.files]);
  });
});
// Stop the browser from opening a file dropped outside a zone
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

async function handleFiles(slot, files) {
  if (!files.length) return;
  if (!ws.ready) {
    toast("Primero elige la carpeta de trabajo (paso 1)");
    $("#btn-pick").focus();
    return;
  }

  const list = document.querySelector(`[data-list="${slot}"]`);
  let ok = 0;
  for (const file of files) {
    try {
      const saved = await ws.save(SUBFOLDERS[slot], file.name, file);
      addRow(list, saved, file.size);
      ok++;
      if (slot === "estado") await parseEstadoDeCuenta(file);   // stub for now
      if (slot === "facturas") await classifyFactura(file, []); // stub for now
    } catch (err) {
      console.error(err);
      toast(`Error guardando ${file.name}`);
    }
  }
  jobInput.disabled = true;
  $("#btn-zip").disabled = ws.count === 0;
  if (ok) toast(ok === 1 ? "Archivo guardado" : `${ok} archivos guardados`);
}

// ---------- Step 5: ZIP ----------
$("#btn-zip").addEventListener("click", async () => {
  const btn = $("#btn-zip");
  btn.disabled = true;
  btn.textContent = "Preparando…";
  try {
    const blob = await ws.zip(jobInput.value);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${jobInput.value}.zip`;
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
function setStatus(text, kind) {
  const el = $("#folder-status");
  el.textContent = text;
  el.className = `status ${kind}`;
}
function addRow(list, name, size) {
  const li = document.createElement("li");
  const n = document.createElement("span");
  n.textContent = name;
  const s = document.createElement("span");
  s.className = "size";
  s.textContent = fmtSize(size);
  li.append(n, s);
  list.appendChild(li);
}
function fmtSize(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}
