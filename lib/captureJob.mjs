/**
 * Núcleo de capturas (CLI y app Electron).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { CLIP_MAP_FULL, CLIP_MAP_PREFERRED, MAP_ZOOM_UI } from "../map-clip.mjs";
import { buildUbicacionesKml } from "./kmlOutput.mjs";

export const VIEWPORT = { width: 1280, height: 800 };

/** Nombre fijo: la webapp lo ignora al importar el ZIP (solo lee lo listado en manifest.json). */
export const KML_FILENAME = "ubicaciones.kml";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function safeFilename(ref) {
  return ref.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Script que se inyecta ANTES de que cargue cualquier JS de la página.
 * Parchea google.maps.Map.prototype.setCenter para capturar la instancia
 * en window.__gdaMap la primera vez que se mueva el mapa.
 *
 * Por qué setCenter y no el constructor: Webix captura la referencia al
 * constructor de google.maps.Map antes de que podamos instalar un Proxy, así
 * que el constructor pasa desapercibido. El prototipo en cambio afecta a todas
 * las instancias existentes y futuras — setCenter ES llamado cuando el usuario
 * (o el código) hace click en una fila y la SPA centra el mapa en esa parcela.
 */
function mapInterceptorScript() {
  window.__gdaMap = null;
  window.__mapPatched = false;
  const tick = setInterval(() => {
    if (window.__mapPatched) { clearInterval(tick); return; }
    if (window.google?.maps?.Map?.prototype) {
      window.__mapPatched = true;
      clearInterval(tick);
      const orig = window.google.maps.Map.prototype.setCenter;
      window.google.maps.Map.prototype.setCenter = function (...args) {
        if (!window.__gdaMap) window.__gdaMap = this;
        return orig.apply(this, args);
      };
    }
  }, 50);
  setTimeout(() => clearInterval(tick), 60000);
}

/**
 * Busca la referencia catastral en los datos del Webix TABLE (todos los ítems,
 * no solo los visibles) y la selecciona disparando el evento de la app.
 *
 * Estrategia:
 *   1. Busca el ítem en memoria (eachRow — todos los datos, no solo los visibles).
 *   2. Selecciona la fila y la hace visible con la API de Webix (showItem).
 *   3. Hace click en el ENLACE dentro de la celda que contiene la referencia.
 *      El enlace llama a setCenter() en Google Maps, que captura __gdaMap.
 *      Se busca en CUALQUIER celda gda_dl_* (el índice varía por municipio:
 *      algunos usan gda_dl_7, otros gda_dl_1, etc.)
 *
 * Devuelve los datos de la parcela (incluido su punto `gps`) si la encontró, o null si no
 * existe en el censo. El punto lo trae ya calculado cada fila del censo: se aprovecha para
 * generar el KML de ubicaciones sin ninguna petición extra.
 */
async function selectParcelByRef(page, ref) {
  const refClean = ref.replace(/\s/g, "").toUpperCase();

  return page.evaluate(async (rc) => {
    const table = typeof webix !== "undefined" && webix.$$("TABLE");
    if (!table) return null;

    let match = null;
    table.eachRow((id) => {
      if (match) return;
      const item = table.getItem(id);
      const r = (item.ref || "").replace(/\s/g, "").toUpperCase();
      if (r === rc || rc.startsWith(r) || r.startsWith(rc)) match = item;
    });

    if (!match) return null;

    table.select(match.id);
    table.showItem(match.id);

    // Esperar a que el scroll virtual actualice el DOM con la fila visible
    await new Promise((r) => setTimeout(r, 450));

    // Buscar el enlace de la ref en CUALQUIER celda gda_dl_* (el índice varía
    // por municipio: gda_dl_1, gda_dl_7, etc.) y hacer click para que la SPA
    // llame a setCenter() en el mapa — lo que captura window.__gdaMap.
    const mref = (match.ref || "").replace(/\s/g, "").toUpperCase();
    const prefix = mref.slice(0, 10);
    for (const cell of document.querySelectorAll(".webix_cell")) {
      if (!/\bgda_dl_\d/.test(cell.className)) continue;
      const txt = (cell.innerText || "").replace(/\s/g, "").toUpperCase();
      if (txt.startsWith(prefix)) {
        const link = cell.querySelector("a") || cell;
        link.click();
        break;
      }
    }

    const gps =
      match.gps && Number.isFinite(match.gps.lat) && Number.isFinite(match.gps.lng)
        ? { lat: match.gps.lat, lng: match.gps.lng }
        : null;

    return {
      refCenso: match.ref || null,
      gps,
      censo: {
        name: match.name || "",
        address: match.address || "",
        usage: match.usage || "",
        owenerLabel: match.owenerLabel || "",
        buildYear: match.buildYear || 0,
        dl: match.dl ?? null,
      },
    };
  }, refClean);
}

/**
 * Ajusta el zoom exacto a la parcela seleccionada usando fitBounds con sus polígonos.
 * Devuelve true si funcionó, false si no se pudo (sin mapa capturado o sin polígonos).
 */
async function fitBoundsToParcel(page, onLog) {
  try {
    const fitted = await page.evaluate(() => {
      const map = window.__gdaMap;
      if (!map || typeof map.fitBounds !== "function") return false;
      const table = typeof webix !== "undefined" && webix.$$("TABLE");
      if (!table) return false;
      const sel = table.getSelectedId?.();
      if (!sel) return false;
      const item = table.getItem(sel.id !== undefined ? sel.id : sel);
      if (!item?.polygons || item.polygons.length < 3) return false;

      let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
      for (const [lat, lng] of item.polygons) {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
      }

      const bounds = new google.maps.LatLngBounds(
        { lat: minLat, lng: minLng },
        { lat: maxLat, lng: maxLng },
      );
      map.fitBounds(bounds, 80);
      return true;
    });
    if (fitted) onLog("  Zoom ajustado a la parcela");
    return !!fitted;
  } catch {
    return false;
  }
}

/**
 * Fallback: abre los controles de zoom del mapa y pulsa + N veces.
 * Solo se usa si fitBoundsToParcel no está disponible.
 */
async function applyZoomWithMapControls(page, plusCount) {
  const n = Math.max(1, plusCount);
  const u = MAP_ZOOM_UI;

  await page.mouse.click(u.open.x, u.open.y);
  await sleep(450);
  for (let i = 0; i < n; i++) {
    await page.mouse.click(u.plus.x, u.plus.y);
    await sleep(350);
  }
  await sleep(280);
  await page.mouse.click(u.close.x, u.close.y);
  await sleep(400);
}

/**
 * @param {object} options
 * @param {(msg: string) => void} [options.onLog]
 * @param {(i: number, total: number, ref: string) => void} [options.onProgress]
 */
export async function runCaptureJob(options) {
  const {
    url,
    refs: refsInput,
    outDir: outDirRaw,
    clip = "pref",
    zoomClicks = 5,
    noZoom = false,
    headless = false,
    onLog = () => {},
    onProgress = () => {},
  } = options;

  const refs = [...new Set((refsInput || []).map((r) => String(r).trim()).filter(Boolean))];
  if (refs.length === 0) throw new Error("No hay referencias catastrales.");

  const outDir = resolve(outDirRaw);
  const clipRect = clip === "full" ? CLIP_MAP_FULL : CLIP_MAP_PREFERRED;

  await mkdir(outDir, { recursive: true });

  onLog(`URL: ${url}`);
  onLog(`Referencias: ${refs.length}`);
  onLog(`Carpeta temporal: ${outDir}`);

  const browser = await chromium.launch({ headless, slowMo: 0 });
  const context = await browser.newContext({ viewport: VIEWPORT, locale: "es-ES" });
  const page = await context.newPage();

  // Inyectar interceptor ANTES de que cargue cualquier JS de la página.
  // Esto garantiza que capturamos __gdaMap cuando Google Maps llame a setCenter
  // durante su propia inicialización (no podemos inyectarlo después del goto).
  await page.addInitScript(mapInterceptorScript);

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
    // Espera extra para que Google Maps inicialice, cargue los datos del municipio
    // y llame a setCenter (capturando __gdaMap) antes de empezar las capturas.
    await sleep(4000);
  } catch (e) {
    await browser.close();
    throw new Error(`No se pudo cargar la URL: ${e.message}`);
  }

  const manifest = { url, viewport: VIEWPORT, clip: clipRect, items: [] };
  /** Puntos para el KML; también se guardan en el manifest para que la webapp los importe. */
  const ubicaciones = [];
  let zoomApplied = false;

  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i];
    const file = `${safeFilename(ref)}.png`;
    const pngPath = join(outDir, file);

    onProgress(i + 1, refs.length, ref);
    onLog(`[${i + 1}/${refs.length}] ${ref}`);

    try {
      const found = await selectParcelByRef(page, ref);
      if (!found) {
        throw new Error(`Referencia no encontrada en el censo: "${ref}"`);
      }
      if (found.gps) {
        ubicaciones.push({ ref, gps: found.gps, censo: found.censo });
      } else {
        onLog("  Sin punto GPS en el censo (no entra en el KML)");
      }

      // Pausa para que el click procese y el mapa empiece a actualizarse
      await sleep(800);

      if (!noZoom) {
        const fitted = await fitBoundsToParcel(page, onLog);
        if (fitted) {
          // Espera a que los tiles del mapa carguen tras el fitBounds
          await sleep(1400);
        } else {
          // fitBounds no disponible: aplicar zoom manual la primera vez
          if (zoomClicks > 0 && !zoomApplied) {
            onLog(`  Zoom manual (fallback): ${zoomClicks}× +`);
            await applyZoomWithMapControls(page, zoomClicks);
            zoomApplied = true;
          }
          // Espera en cualquier caso para que el mapa se centre por el click
          await sleep(1200);
        }
      }

      await page.screenshot({ path: pngPath, clip: clipRect });
      onLog(`  OK → ${file}`);
      manifest.items.push({ ref, file, gps: found.gps ?? null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onLog(`  ERROR: ${msg}`);
      manifest.items.push({ ref, file: null, error: msg });
    }
  }

  const manifestPath = join(outDir, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  onLog(`Manifest: manifest.json`);

  const kml = buildUbicacionesKml(ubicaciones, "Ubicaciones de inmuebles");
  if (kml) {
    await writeFile(join(outDir, KML_FILENAME), kml, "utf8");
    onLog(`Ubicaciones para Google Maps: ${KML_FILENAME} (${ubicaciones.length} con punto)`);
  } else {
    onLog("Ninguna parcela traía punto GPS: no se genera el KML de ubicaciones.");
  }

  await browser.close();

  return { manifestPath, outDir, manifest };
}
