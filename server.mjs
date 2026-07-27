import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import { runCaptureJob } from "./lib/captureJob.mjs";
import { zipDirectoryToFile } from "./lib/zipOutput.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_URL = "https://censo.gestiondelamianto.com/#/city:37CB4017";
const PORT = process.env.PORT || 3000;

const jobs = new Map(); // jobId -> { logs, emitter, done, ok, error, zipPath }
let busyJobId = null;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "web")));

app.post("/api/capture", (req, res) => {
  if (busyJobId) {
    return res.status(409).json({ error: "Ya hay una captura en curso. Espera a que termine." });
  }

  const body = req.body || {};
  const url = (body.url || DEFAULT_URL).trim() || DEFAULT_URL;
  const refsText = body.refsText || "";
  const zoomClicks = Math.max(1, Number(body.zoomClicks) || 5);

  const refs = String(refsText)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((l) => l && !l.startsWith("#"));

  if (refs.length === 0) {
    return res.status(400).json({ error: "Añade al menos una referencia catastral (una por línea)." });
  }

  const jobId = randomUUID();
  const emitter = new EventEmitter();
  const job = { logs: [], emitter, done: false, ok: false, error: null, zipPath: null };
  jobs.set(jobId, job);
  busyJobId = jobId;

  const onLog = (msg) => {
    job.logs.push(msg);
    emitter.emit("log", msg);
  };

  (async () => {
    let tmpDir;
    try {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), "censo-cap-"));
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
        onLog,
      });

      onLog("Creando ZIP…");
      const zipPath = path.join(os.tmpdir(), `censo-capturas-${jobId}.zip`);
      await zipDirectoryToFile(tmpDir, zipPath);
      await rm(tmpDir, { recursive: true, force: true });

      job.zipPath = zipPath;
      job.ok = true;
      onLog("Listo. Descargando ZIP…");
    } catch (e) {
      job.ok = false;
      job.error = e instanceof Error ? e.message : String(e);
      onLog(`Error: ${job.error}`);
      if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    } finally {
      job.done = true;
      busyJobId = null;
      emitter.emit("done", { ok: job.ok, error: job.error });
    }
  })();

  res.status(202).json({ jobId });
});

app.get("/api/capture/:id/events", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).end();

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();

  for (const line of job.logs) {
    res.write(`event: log\ndata: ${JSON.stringify(line)}\n\n`);
  }

  const onLog = (msg) => res.write(`event: log\ndata: ${JSON.stringify(msg)}\n\n`);
  const onDone = (payload) => {
    res.write(`event: done\ndata: ${JSON.stringify(payload)}\n\n`);
    res.end();
  };

  if (job.done) {
    onDone({ ok: job.ok, error: job.error });
    return;
  }

  job.emitter.on("log", onLog);
  job.emitter.on("done", onDone);

  req.on("close", () => {
    job.emitter.off("log", onLog);
    job.emitter.off("done", onDone);
  });
});

app.get("/api/capture/:id/download", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || !job.zipPath) return res.status(404).end();

  const filename = `censo-capturas-${new Date().toISOString().slice(0, 10)}.zip`;
  res.download(job.zipPath, filename, (err) => {
    rm(job.zipPath, { force: true }).catch(() => {});
    jobs.delete(req.params.id);
    if (err && !res.headersSent) res.status(500).end();
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Censo capturas web escuchando en http://0.0.0.0:${PORT}`);
});
