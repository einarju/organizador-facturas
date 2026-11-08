# Organizador de Facturas

Family tool, hosted on GitHub Pages. Static site, no server, no build step:
**documents never leave the computer**, everything is processed in the browser.

## Workflow (target)

1. Pick a work folder on the PC (Chrome/Edge write real files there).
2. Drop the **estado de cuenta** → formatted Excel table.
3. Generate a `.bat` that creates the folders.
4. Drop the **facturas** → each one goes to its matching folder.
5. Download everything as a ZIP.

Status: v0.1 foundation. Steps 1, 2, 4 (saving files) and 5 work.
Parsing, Excel, .bat and classification are stubs in `js/pipeline.js`.

## Folder created on the PC

```
<chosen folder>/
  Proceso_2026-11-08_1430/
    01_estado_de_cuenta/
    02_facturas/
    03_salida/        ← Excel, .bat, sorted output
```

Firefox/Safari can't write to folders: files stay in memory and the ZIP step downloads them.

## Files

- `index.html`: page
- `css/styles.css`: styles (light + dark)
- `js/app.js`: UI, drop zones, ZIP
- `js/workspace.js`: the job folder on the PC (File System Access API + memory fallback)
- `js/pipeline.js`: processing steps (to build)

## Run locally

```
python3 -m http.server 8000
```
then open http://localhost:8000 (folder access needs `localhost` or https).

## Test documents

Put real sample docs in `test-docs/` of the main checkout. It is git-ignored, as are all
`.pdf/.xml/.xlsx/.csv/.zip` files: **bank data must never be committed** (the repo is public).
