import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";

import { runCaptureJob } from "../lib/captureJob.mjs";
import { zipDirectoryToFile } from "../lib/zipOutput.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const DEFAULT_URL = "https://censo.gestiondelamianto.com/#/city:37CB4017";

function createWindow() {
  const win = new BrowserWindow({
    width: 720,
    height: 820,
    minWidth: 520,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadFile(path.join(ROOT, "renderer", "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("capture:start", async (event, payload) => {
  const p = payload || {};
  const url = (p.url || DEFAULT_URL).trim() || DEFAULT_URL;
  const refsText = p.refsText || "";
  const zoomClicks = Math.max(1, Number(p.zoomClicks) || 5);

  const refs = String(refsText)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((l) => l && !l.startsWith("#"));

  if (refs.length === 0) {
    return { ok: false, error: "Añade al menos una referencia catastral (una por línea)." };
  }

  const win = BrowserWindow.fromWebContents(event.sender);
  const save = await dialog.showSaveDialog(win, {
    title: "Guardar ZIP de capturas",
    defaultPath: `censo-capturas-${new Date().toISOString().slice(0, 10)}.zip`,
    filters: [{ name: "Archivo ZIP", extensions: ["zip"] }],
  });

  if (save.canceled || !save.filePath) {
    return { ok: false, error: "cancelado" };
  }

  const filePath = save.filePath;
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "censo-cap-"));

  const sendLog = (msg) => {
    win?.webContents.send("capture:log", msg);
  };

  try {
    await runCaptureJob({
      url,
      refs,
      outDir: tmpDir,
      clip: "pref",
      zoomClicks,
      noZoom: false,
      headless: false,
      stepMs: 240,
      buscarModal: false,
      onLog: sendLog,
    });

    sendLog("Creando ZIP…");
    await zipDirectoryToFile(tmpDir, filePath);
    await rm(tmpDir, { recursive: true, force: true });

    sendLog(`Listo: ${filePath}`);
    shell.showItemInFolder(filePath);

    return { ok: true, zipPath: filePath };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    sendLog(`Error: ${msg}`);
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    return { ok: false, error: msg };
  }
});
