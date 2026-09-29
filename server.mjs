import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";

import { runCaptureJob } from "./lib/captureJob.mjs";
import { zipDirectoryToFile } from "./lib/zipOutput.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_URL = "https://censo.gestiondelamianto.com/#/city:37CB4017";
const PORT = process.env.PORT || 3000;

/**
 * Si está definida, todas las rutas `/api/*` exigen `Authorization: Bearer <token>`.
 * En el VPS es obligatoria (la webapp de informes la envía); en droppy (red local) se puede omitir
 * y la página web de siempre sigue funcionando.
 */
const API_TOKEN = (process.env.CAPTURE_API_TOKEN || "").trim();

/** `HEADLESS=1` lanza Chromium sin ventana; por defecto visible sobre Xvfb, como en droppy. */
const HEADLESS = process.env.HEADLESS === "1";

/** Un lote terminado y no descargado se borra pasado este tiempo (antes se quedaba en /tmp). */
const JOB_TTL_MS = 60 * 60 * 1000;

const jobs = new Map(); // jobId -> { url, refs, tag, callbackUrl, logs, emitter, done, ok, error, zipPath, progress, … }
let busyJobId = null;

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "web")));

function tokenMatches(given) {
  const a = Buffer.from(given);
  const b = Buffer.from(API_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, busy: Boolean(busyJobId) });
});

app.use("/api", (req, res, next) => {
  if (!API_TOKEN) return next();
  const header = req.get("authorization") || "";
  const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!given || !tokenMatches(given)) {
    return res.status(401).json({ error: "No autorizado" });
  }
  next();
});

async function discardJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;
  jobs.delete(jobId);
  if (job.zipPath) await rm(job.zipPath, { force: true }).catch(() => {});
}

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.done && job.finishedAt && now - job.finishedAt > JOB_TTL_MS) void discardJob(id);
  }
}, 5 * 60 * 1000).unref();

/** Cola FIFO: los lotes se encolan (antes se rechazaban con 409) y se capturan de uno en uno. */
const queue = [];

function jobSummary(jobId, job) {
  return {
    jobId,
    tag: job.tag,
    state: job.done ? "done" : busyJobId === jobId ? "running" : "queued",
    ok: job.ok,
    error: job.error,
    progress: job.progress,
    createdAt: job.createdAt,
  };
}

/**
 * Avisa a la webapp de que el lote ha terminado para que se traiga el ZIP e importe.
 * Se reintenta unas veces; si aun así falla, el ZIP queda una hora y «Capturar pendientes» lo repite.
 */
async function notifyCallback(jobId, job) {
  if (!job.callbackUrl) return;
  const payload = JSON.stringify({ jobId, tag: job.tag, ok: job.ok, error: job.error });
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(job.callbackUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
        },
        body: payload,
        signal: AbortSignal.timeout(6 * 60 * 1000),
      });
      if (res.ok) {
        job.logs.push("Importado en la webapp.");
        return;
      }
      job.logs.push(`Aviso a la webapp: HTTP ${res.status} (intento ${attempt})`);
    } catch (e) {
      job.logs.push(`Aviso a la webapp falló (intento ${attempt}): ${e instanceof Error ? e.message : e}`);
    }
    await new Promise((r) => setTimeout(r, attempt * 15000));
  }
}

async function runJob(jobId, job) {
  const onLog = (msg) => {
    job.logs.push(msg);
    job.emitter.emit("log", msg);
  };

  let tmpDir;
  try {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "censo-cap-"));
    await runCaptureJob({
      url: job.url,
      refs: job.refs,
      outDir: tmpDir,
      clip: "pref",
      zoomClicks: job.zoomClicks,
      noZoom: false,
      headless: HEADLESS,
      stepMs: 240,
      buscarModal: false,
      onLog,
      onProgress: (current, total, ref) => {
        job.progress = { current, total, ref };
      },
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
    job.finishedAt = Date.now();
    job.emitter.emit("done", { ok: job.ok, error: job.error });
  }
  // Sin await: la importación en la webapp no debe frenar el siguiente lote de la cola.
  void notifyCallback(jobId, job);
}

async function pumpQueue() {
  if (busyJobId) return;
  const jobId = queue.shift();
  if (!jobId) return;
  const job = jobs.get(jobId);
  if (!job) return pumpQueue();
  busyJobId = jobId;
  try {
    await runJob(jobId, job);
  } finally {
    busyJobId = null;
    void pumpQueue();
  }
}

/**
 * Body: `{ url, refs | refsText, zoomClicks?, tag?, callbackUrl? }`.
 * `tag` agrupa lotes (la webapp usa el id del municipio) y `callbackUrl` recibe un POST al terminar.
 */
app.post("/api/capture", (req, res) => {
  const body = req.body || {};
  const url = (body.url || DEFAULT_URL).trim() || DEFAULT_URL;
  const zoomClicks = Math.max(1, Number(body.zoomClicks) || 5);

  const refs = (Array.isArray(body.refs) ? body.refs : String(body.refsText || "").split(/\r?\n/))
    .map((s) => String(s).trim())
    .filter((l) => l && !l.startsWith("#"));

  if (refs.length === 0) {
    return res.status(400).json({ error: "Añade al menos una referencia catastral (una por línea)." });
  }

  let callbackUrl = null;
  if (body.callbackUrl) {
    try {
      const u = new URL(String(body.callbackUrl));
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
      callbackUrl = u.toString();
    } catch {
      return res.status(400).json({ error: "callbackUrl inválida." });
    }
  }

  const jobId = randomUUID();
  const job = {
    url,
    refs,
    zoomClicks,
    tag: body.tag ? String(body.tag).slice(0, 128) : null,
    callbackUrl,
    logs: [],
    emitter: new EventEmitter(),
    done: false,
    ok: false,
    error: null,
    zipPath: null,
    progress: { current: 0, total: refs.length, ref: null },
    createdAt: Date.now(),
    finishedAt: null,
  };
  jobs.set(jobId, job);
  queue.push(jobId);
  void pumpQueue();

  res.status(202).json({ jobId, total: refs.length, queuePosition: queue.indexOf(jobId) + 1 });
});

/** Lotes de un `tag` (en cola, en curso y terminados aún no borrados), en orden de llegada. */
app.get("/api/jobs", (req, res) => {
  const tag = String(req.query.tag || "");
  const list = [...jobs.entries()]
    .filter(([, j]) => !tag || j.tag === tag)
    .map(([id, j]) => jobSummary(id, j))
    .sort((a, b) => a.createdAt - b.createdAt);
  res.json({ jobs: list });
});

/**
 * Estado por sondeo (la webapp no puede mantener un SSE abierto desde una función serverless).
 * `?from=N` devuelve solo las líneas de registro a partir de la N.
 */
app.get("/api/capture/:id/status", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Lote no encontrado (caducado o ya descargado)." });

  const from = Math.max(0, Number(req.query.from) || 0);
  res.json({
    state: jobSummary(req.params.id, job).state,
    done: job.done,
    ok: job.ok,
    error: job.error,
    progress: job.progress,
    logs: job.logs.slice(from),
    nextFrom: job.logs.length,
  });
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

/**
 * Descarga el ZIP. Por defecto lo borra al terminar (página web de siempre).
 * La webapp pide `?keep=1` y lo borra con DELETE solo cuando la importación ha ido bien,
 * para poder reintentar si la importación falla a medias.
 */
app.get("/api/capture/:id/download", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || !job.zipPath) return res.status(404).end();

  const keep = req.query.keep === "1";
  const filename = `censo-capturas-${new Date().toISOString().slice(0, 10)}.zip`;
  res.download(job.zipPath, filename, (err) => {
    if (!keep) void discardJob(req.params.id);
    if (err && !res.headersSent) res.status(500).end();
  });
});

app.delete("/api/capture/:id", async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).end();
  const queuedAt = queue.indexOf(req.params.id);
  if (queuedAt >= 0) {
    queue.splice(queuedAt, 1); // cancelar un lote que aún no ha empezado
  } else if (!job.done) {
    return res.status(409).json({ error: "El lote sigue en curso." });
  }
  await discardJob(req.params.id);
  res.status(204).end();
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Censo capturas web escuchando en http://0.0.0.0:${PORT}${API_TOKEN ? " (API con token)" : ""}`);
});
