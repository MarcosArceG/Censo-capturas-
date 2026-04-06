#!/usr/bin/env node
/**
 * Solo para quien mantenga el repo: prueba la heurística sobre un PNG guardado.
 * Los usuarios finales NO necesitan ejecutar esto.
 *
 *   npm run analyze-zoom-png -- ./mi-captura.png
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { suggestZoomStepsFromClipPng } from "../lib/zoomAnalyze.mjs";

const file = process.argv[2];
if (!file) {
  console.error("Uso: node scripts/analyze-zoom-png.mjs <captura.png>");
  process.exit(1);
}

const buf = await readFile(resolve(file));
const { deltaPlus, debug } = await suggestZoomStepsFromClipPng(buf);
console.log(JSON.stringify({ archivo: file, deltaPlus, ...debug }, null, 2));
console.log(
  deltaPlus === 0
    ? "→ Sin cambio sugerido"
    : `→ Sugerido: ${deltaPlus > 0 ? "+" : ""}${deltaPlus} pulsación(es) en zoom`,
);
