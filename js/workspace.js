// Workspace = the job folder on the PC where everything for one run lives.
//
// Chrome / Edge: uses the File System Access API to write real files into a
// folder the user picks:  <picked folder>/<job name>/01_estado_de_cuenta/...
// Other browsers: keeps files in memory and the ZIP step downloads them.

export const SUBFOLDERS = {
  estado: "01_estado_de_cuenta",
  facturas: "02_facturas",
  salida: "03_salida", // Excel, .bat and anything the pipeline generates
};

export const canUseFolders = "showDirectoryPicker" in window;

export class Workspace {
  constructor() {
    this.root = null;        // FileSystemDirectoryHandle of <picked>/<job>
    this.rootName = "";
    this.memory = new Map(); // "sub/name" -> Blob, mirror of everything written (feeds the ZIP)
  }

  get ready() { return this.root !== null || !canUseFolders; }

  async pick(jobName) {
    const parent = await window.showDirectoryPicker({ id: "organizador", mode: "readwrite" });
    this.root = await parent.getDirectoryHandle(safeName(jobName), { create: true });
    this.rootName = `${parent.name}/${this.root.name}`;
    for (const sub of Object.values(SUBFOLDERS)) {
      await this.root.getDirectoryHandle(sub, { create: true });
    }
    return this.rootName;
  }

  /** Save a File/Blob into a subfolder (or a nested path like "03_salida/Comida"). */
  async save(subPath, name, blob) {
    const finalName = this.uniqueName(subPath, safeName(name));
    if (this.root) {
      let dir = this.root;
      for (const part of subPath.split("/").filter(Boolean)) {
        dir = await dir.getDirectoryHandle(part, { create: true });
      }
      const fh = await dir.getFileHandle(finalName, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
    }
    this.memory.set(`${subPath}/${finalName}`, blob);
    return finalName;
  }

  uniqueName(subPath, name) {
    if (!this.memory.has(`${subPath}/${name}`)) return name;
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    let i = 2;
    while (this.memory.has(`${subPath}/${base} (${i})${ext}`)) i++;
    return `${base} (${i})${ext}`;
  }

  /** Build a ZIP of everything saved in this run. */
  async zip(jobName) {
    const zip = new window.JSZip();
    const top = zip.folder(safeName(jobName));
    for (const [path, blob] of this.memory) top.file(path, blob);
    return zip.generateAsync({ type: "blob" });
  }

  get count() { return this.memory.size; }
}

// Windows-safe names (the family uses Windows, and the .bat must not choke).
export function safeName(name) {
  const s = String(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim().replace(/[. ]+$/, "");
  return s || "sin_nombre";
}
