// Workspace = the job folder on the PC where everything for one run lives.
//
// Chrome / Edge: uses the File System Access API to write real files into a
// folder the user picks: <picked folder>/<job name>/...
// Other browsers: keeps files in memory and the ZIP step downloads them.
//
// Layout of one job:
//   <job>/
//     ESTADO DE CUENTA/          the original statement PDF
//     Movimientos <job>.xlsx     the formatted table
//     crear_carpetas.bat         creates the movement folders
//     1001_17_DC0119_ROSAS_$50000/   one folder per movement, with its facturas
//     SIN MOVIMIENTO/            facturas that match no movement

export const ESTADO_DIR = "ESTADO DE CUENTA";
export const SIN_MOV_DIR = "SIN MOVIMIENTO";

export const canUseFolders = "showDirectoryPicker" in window;

export class Workspace {
  constructor() {
    this.root = null;        // FileSystemDirectoryHandle of <picked>/<job>
    this.rootName = "";
    this.files = new Map();  // "dir/name" -> Blob, mirror of everything written (feeds the ZIP)
    this.dirs = new Set();   // folders created (so empty ones also go in the ZIP)
  }

  get ready() { return this.root !== null || !canUseFolders; }
  get count() { return this.files.size; }

  async pick(jobName) {
    const parent = await window.showDirectoryPicker({ id: "organizador", mode: "readwrite" });
    this.root = await parent.getDirectoryHandle(safeName(jobName), { create: true });
    this.rootName = `${parent.name}/${this.root.name}`;
    return this.rootName;
  }

  async dirHandle(path) {
    let dir = this.root;
    for (const part of split(path)) dir = await dir.getDirectoryHandle(part, { create: true });
    return dir;
  }

  async mkdir(path) {
    this.dirs.add(norm(path));
    if (this.root) await this.dirHandle(path);
  }

  /** Save a File/Blob into a folder ("" = job root). */
  async save(path, name, blob, { overwrite = false } = {}) {
    const clean = safeName(name);
    const finalName = overwrite ? clean : this.uniqueName(path, clean);
    if (this.root) {
      const dir = await this.dirHandle(path);
      const fh = await dir.getFileHandle(finalName, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
    }
    if (norm(path)) this.dirs.add(norm(path));
    this.files.set(join(path, finalName), blob);
    return finalName;
  }

  uniqueName(path, name) {
    if (!this.files.has(join(path, name))) return name;
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    let i = 2;
    while (this.files.has(join(path, `${base} (${i})${ext}`))) i++;
    return `${base} (${i})${ext}`;
  }

  /** Build a ZIP of everything in this run, empty folders included. */
  async zip(jobName) {
    const zip = new window.JSZip();
    const top = zip.folder(safeName(jobName));
    for (const d of this.dirs) top.folder(d);
    for (const [p, blob] of this.files) top.file(p, blob);
    return zip.generateAsync({ type: "blob" });
  }
}

const split = (p) => String(p).split("/").filter(Boolean);
const norm = (p) => split(p).join("/");
const join = (p, n) => (norm(p) ? `${norm(p)}/${n}` : n);

// Windows-safe names (the family uses Windows, and the .bat must not choke).
export function safeName(name) {
  const s = String(name).replace(/[<>:"/\\|?*%\u0000-\u001f]/g, "_").trim().replace(/[. ]+$/, "");
  return s || "sin_nombre";
}
