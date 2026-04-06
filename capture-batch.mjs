/**
 * CLI: ver cabecera en repo o `npm run capture -- --help`
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runCaptureJob } from "./lib/captureJob.mjs";

async function loadRefsFromFile(path) {
  const text = await readFile(path, "utf8");
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

function parseArgs(argv) {
  const out = {
    url: process.env.CENSO_URL || "",
    refs: [],
    refsFile: null,
    outDir: "./out",
    clip: "pref",
    zoomClicks: 5,
    noZoom: false,
    headless: false,
    stepMs: 400,
    buscarModal: false,
    positional: [],
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--refs" && argv[i + 1]) {
      out.refs = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a === "--refs-file" && argv[i + 1]) {
      out.refsFile = argv[++i];
    } else if (a === "--out" && argv[i + 1]) {
      out.outDir = argv[++i];
    } else if (a === "--clip" && argv[i + 1]) {
      const v = argv[++i];
      if (v === "full" || v === "pref") out.clip = v;
    } else if (a === "--zoom-clicks" && argv[i + 1]) {
      out.zoomClicks = Math.max(0, parseInt(argv[++i], 10) || 0);
    } else if (a === "--no-zoom") {
      out.noZoom = true;
    } else if (a === "--headless") {
      out.headless = true;
    } else if (a === "--step-ms" && argv[i + 1]) {
      out.stepMs = Math.max(0, parseInt(argv[++i], 10) || 0);
    } else if (a === "--buscar-modal") {
      out.buscarModal = true;
    } else if (!a.startsWith("-")) {
      out.positional.push(a);
    }
  }
  if (!out.url && out.positional[0]?.startsWith("http")) {
    out.url = out.positional.shift();
  }
  if (!out.url) {
    out.url = "https://censo.gestiondelamianto.com/#/city:37CB4017";
  }
  return out;
}

async function main() {
  const cfg = parseArgs(process.argv);

  if (cfg.refsFile) {
    try {
      const fromFile = await loadRefsFromFile(resolve(cfg.refsFile));
      cfg.refs = [...cfg.refs, ...fromFile];
    } catch (e) {
      console.error("No se pudo leer --refs-file:", e.message);
      process.exit(1);
    }
  }
  cfg.refs = [...new Set(cfg.refs)];

  if (cfg.refs.length === 0) {
    console.error(
      'Uso: npm run capture -- [URL] --refs "REF1,REF2"   o   --refs-file archivo.txt\n',
    );
    process.exit(1);
  }

  const outDir = resolve(cfg.outDir);

  try {
    await runCaptureJob({
      url: cfg.url,
      refs: cfg.refs,
      outDir,
      clip: cfg.clip,
      zoomClicks: cfg.zoomClicks,
      noZoom: cfg.noZoom,
      headless: cfg.headless,
      stepMs: cfg.stepMs,
      buscarModal: cfg.buscarModal,
      onLog: (msg) => console.log(msg),
      onProgress: (i, t, ref) => {},
    });
    console.log("\nListo.\n");
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

main();
