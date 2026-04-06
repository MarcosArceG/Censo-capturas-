/**
 * Núcleo de capturas (CLI y app Electron).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { CLIP_MAP_FULL, CLIP_MAP_PREFERRED, MAP_ZOOM_UI } from "../map-clip.mjs";

export const VIEWPORT = { width: 1280, height: 800 };

/** Pausa base entre micro-pasos (UI Webix); Electron puede pasar stepMs más bajo). */
const DEFAULT_STEP_MS = 400;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function safeFilename(ref) {
  return ref.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Normaliza ref para comparar (espacios, mayúsculas). */
function normalizeRefText(s) {
  return String(s)
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

/**
 * Limpia marcas temporales de búsqueda (data-censo-hit).
 */
async function clearCensoHitMarks(page) {
  await page.evaluate(() => {
    document.querySelectorAll(".webix_cell.gda_dl_7[data-censo-hit]").forEach((el) => {
      el.removeAttribute("data-censo-hit");
    });
  });
}

/**
 * Igual que Ctrl+F sobre lo que hay en el DOM: solo celdas .gda_dl_7 montadas (~ventana virtual).
 * Playwright hasText a veces no coincide con Webix (nodos / enlaces); esto usa el mismo texto que el buscador del navegador.
 */
async function findRefCellLikeCtrlF(page, refRaw) {
  const ref = refRaw.trim();
  if (!ref) return null;

  const mark = String(Date.now());
  const found = await page.evaluate(
    ({ ref: r, mark: m }) => {
      const strip = (s) =>
        String(s || "")
          .replace(/[\u200B-\u200D\uFEFF]/g, "")
          .replace(/\u00a0/g, " ")
          .replace(/\r?\n/g, " ");
      const compact = (s) => strip(s).replace(/\s+/g, "").toUpperCase();
      const pr = compact(r);
      if (pr.length < 4) return false;

      document.querySelectorAll(".webix_cell.gda_dl_7[data-censo-hit]").forEach((el) => {
        el.removeAttribute("data-censo-hit");
      });

      const cells = document.querySelectorAll(".webix_datatable .webix_cell.gda_dl_7");
      for (const el of cells) {
        const raw = strip(el.innerText || el.textContent || "");
        const tx = compact(raw);
        if (!tx) continue;

        const rawUp = raw.toUpperCase();
        const rUp = r.toUpperCase();

        if (tx.startsWith(pr)) {
          el.setAttribute("data-censo-hit", m);
          return true;
        }
        if (pr.length >= 10 && tx.includes(pr)) {
          el.setAttribute("data-censo-hit", m);
          return true;
        }
        if (rawUp.includes(rUp)) {
          el.setAttribute("data-censo-hit", m);
          return true;
        }
      }
      return false;
    },
    { ref, mark },
  );

  if (!found) return null;

  const loc = page.locator(`.webix_datatable .webix_cell.gda_dl_7[data-censo-hit="${mark}"]`).first();
  try {
    if ((await loc.count()) > 0 && (await loc.isVisible({ timeout: 500 }))) {
      return loc;
    }
  } catch {
    /* */
  }
  await clearCensoHitMarks(page).catch(() => {});
  return null;
}

/**
 * Celda visible que coincide con la ref (prefijo, subcadena o texto compacto).
 */
async function firstVisibleRefCell(base, refRaw) {
  const t = refRaw.trim();
  if (!t) return null;

  const compact = normalizeRefText(t);
  const prefixRe = new RegExp(`^\\s*${escapeRegex(t)}`, "i");
  const subRe = new RegExp(escapeRegex(t), "i");

  async function tryVisible(filtered) {
    const n = await filtered.count();
    const limit = Math.min(n, 120);
    for (let i = 0; i < limit; i++) {
      const c = filtered.nth(i);
      try {
        if (await c.isVisible({ timeout: 200 })) return c;
      } catch {
        /* */
      }
    }
    return null;
  }

  let cell = await tryVisible(base.filter({ hasText: prefixRe }));
  if (cell) return cell;

  cell = await tryVisible(base.filter({ hasText: subRe }));
  if (cell) return cell;

  if (compact.length >= 6) {
    const n = await base.count();
    const cap = Math.min(n, 250);
    for (let i = 0; i < cap; i++) {
      const c = base.nth(i);
      try {
        if (!(await c.isVisible({ timeout: 150 }))) continue;
        const txt = normalizeRefText((await c.innerText()) || "");
        if (txt.startsWith(compact) || txt.includes(compact)) return c;
      } catch {
        /* */
      }
    }
  }

  return null;
}

/**
 * Webix a veces ignora un click “normal” de Playwright (overlay, captura en <a>, timing).
 * Probamos varias rutas: force, mouse down/up, eventos DOM en la fila.
 */
async function clickGridCellSelectingRowNotLink(page, cell) {
  await cell.scrollIntoViewIfNeeded();
  await sleep(260);

  const row = cell.locator("xpath=ancestor::div[contains(@class,'webix_row')]").first();
  try {
    if ((await row.count()) > 0) {
      const spRow = row.locator(".webix_tree_none").first();
      if ((await spRow.count()) > 0 && (await spRow.isVisible({ timeout: 2500 }).catch(() => false))) {
        const sb = await spRow.boundingBox();
        if (sb && sb.width >= 1 && sb.height >= 1) {
          try {
            await spRow.click({ force: true, timeout: 6000 });
            await sleep(180);
            return;
          } catch {
            try {
              await page.mouse.move(sb.x + Math.max(2, sb.width / 2), sb.y + sb.height / 2);
              await sleep(40);
              await page.mouse.down();
              await sleep(50);
              await page.mouse.up();
              await sleep(180);
              return;
            } catch {
              /* seguir */
            }
          }
        }
      }

      for (const sel of [".webix_cell.gda_dl_6", ".webix_cell.gda_dl_5", ".webix_cell.gda_dl_4"]) {
        const other = row.locator(sel).first();
        if ((await other.count()) > 0 && (await other.isVisible({ timeout: 1000 }).catch(() => false))) {
          try {
            await other.click({ position: { x: 10, y: 12 }, force: true, timeout: 6000 });
            await sleep(180);
            return;
          } catch {
            const ob = await other.boundingBox();
            if (ob && ob.width > 4) {
              try {
                await page.mouse.move(ob.x + 10, ob.y + ob.height / 2);
                await page.mouse.down();
                await sleep(40);
                await page.mouse.up();
                await sleep(180);
                return;
              } catch {
                /* */
              }
            }
          }
        }
      }
    }
  } catch {
    /* seguir */
  }

  const spacer = cell.locator(".webix_tree_none").first();
  try {
    if (await spacer.isVisible({ timeout: 2000 }).catch(() => false)) {
      await spacer.click({ force: true, timeout: 5000 });
      await sleep(180);
      return;
    }
  } catch {
    /* seguir */
  }

  const box = await cell.boundingBox();
  if (box && box.width > 10 && box.height > 8) {
    const relX = Math.min(8, Math.max(2, Math.round(box.width * 0.06)));
    const relY = Math.round(box.height / 2);

    try {
      await cell.click({ position: { x: relX, y: relY }, force: true, timeout: 8000 });
      await sleep(180);
      return;
    } catch {
      /* */
    }

    const vx = box.x + relX;
    const vy = box.y + relY;
    try {
      await page.mouse.move(vx, vy);
      await sleep(50);
      await page.mouse.down();
      await sleep(60);
      await page.mouse.up();
      await sleep(180);
      return;
    } catch {
      /* */
    }
  }

  try {
    await cell.click({ position: { x: 6, y: 16 }, force: true, timeout: 8000 });
    await sleep(180);
    return;
  } catch {
    /* */
  }

  await cell.evaluate((el) => {
    const rowEl =
      el.closest(".webix_row") ||
      el.closest("[class*='webix_row']") ||
      el.parentElement?.parentElement;

    const tree = rowEl?.querySelector?.(".webix_tree_none");
    const side = rowEl?.querySelector?.(".webix_cell.gda_dl_6") || rowEl?.querySelector?.(".webix_cell.gda_dl_5");
    const target = tree || side || el;

    const r = target.getBoundingClientRect();
    const cx = r.left + Math.min(6, Math.max(2, r.width * 0.08));
    const cy = r.top + r.height / 2;

    const fireMouse = (type) => {
      try {
        target.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: cx,
            clientY: cy,
            view: window,
            button: 0,
            buttons: type === "mousedown" ? 1 : 0,
          }),
        );
      } catch {
        /* */
      }
    };

    if (typeof PointerEvent !== "undefined") {
      try {
        target.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: cx,
            clientY: cy,
            view: window,
            pointerId: 1,
            pointerType: "mouse",
            buttons: 1,
          }),
        );
        target.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: cx,
            clientY: cy,
            view: window,
            pointerId: 1,
            pointerType: "mouse",
            buttons: 0,
          }),
        );
      } catch {
        /* */
      }
    }

    fireMouse("mousedown");
    fireMouse("mouseup");
    fireMouse("click");
  });

  await sleep(220);
}

/** Clic suave en el grid para quitar foco del modal y recibir eventos en la tabla. */
async function focusDatatableBody(page) {
  const dt = page.locator(".webix_datatable").first();
  try {
    if ((await dt.count()) === 0) return;
    const b = await dt.boundingBox();
    if (b && b.height > 40) {
      const x = b.x + Math.min(32, b.width * 0.12);
      const y = b.y + Math.min(120, b.height * 0.35);
      await page.mouse.move(x, y);
      await sleep(40);
      await page.mouse.click(x, y);
      await sleep(120);
    }
  } catch {
    /* */
  }
}

async function clickSearchTrigger(page) {
  const byClassAndIcon = page
    .locator("button.webix_img_btn")
    .filter({ has: page.locator('img[src*="icono_buscar"]') })
    .first();

  try {
    await byClassAndIcon.waitFor({ state: "visible", timeout: 8000 });
    await byClassAndIcon.click();
    return;
  } catch {
    /* fallback */
  }

  const anyBtnWithIcon = page.locator('button:has(img[src*="icono_buscar"])').first();
  await anyBtnWithIcon.waitFor({ state: "visible", timeout: 6000 });
  await anyBtnWithIcon.click();
}

async function fillSearchModalText(page, ref) {
  const primary = page.locator('[view_id="SEARCH_TEXT"] input[type="text"]').first();
  try {
    await primary.waitFor({ state: "visible", timeout: 6000 });
    await primary.click();
    await primary.fill("");
    await primary.fill(ref);
    return true;
  } catch {
    /* */
  }

  const win = page
    .locator(".webix_win_content")
    .filter({ has: page.getByText("Buscar", { exact: true }) })
    .first();
  const inputInWin = win.locator('input[type="text"]').first();
  try {
    await inputInWin.waitFor({ state: "visible", timeout: 3000 });
    await inputInWin.click();
    await inputInWin.fill("");
    await inputInWin.fill(ref);
    return true;
  } catch {
    return false;
  }
}

async function clickSearchModalAceptar(page) {
  const btn = page.locator('[view_id="SEARCH_ACCEPT"] button.webix_button').first();
  await btn.waitFor({ state: "visible", timeout: 6000 });
  await btn.click();
}

async function clickSearchModalCerrar(page) {
  const btn = page.locator('[view_id="SEARCH_CLOSE"] button.webix_button').first();
  try {
    await btn.waitFor({ state: "visible", timeout: 5000 });
    await btn.click();
  } catch {
    /* */
  }
}

async function clickResultRow(page, ref) {
  await clickResultRowFlexible(page, ref);
}

/** Fila de resultados del buscador: texto exacto o parcial (timeouts cortos: fail rápido si no hay ref). */
async function clickResultRowFlexible(page, ref) {
  const t = ref.trim();
  const re = new RegExp(escapeRegex(t), "i");

  const rows = page.locator(".webix_row_select");
  const byExact = rows.filter({ has: page.getByText(t, { exact: true }) }).first();
  try {
    await byExact.waitFor({ state: "visible", timeout: 3500 });
    await byExact.click({ force: true, timeout: 4000 });
    await sleep(120);
    return;
  } catch {
    /* */
  }

  const byLoose = rows.filter({ hasText: re }).first();
  await byLoose.waitFor({ state: "visible", timeout: 4500 });
  await byLoose.click({ force: true, timeout: 4000 });
  await sleep(120);
}

/**
 * Solo filas ya montadas en el DOM (ventana ~10 filas). Sin scroll ni rueda:
 * el desplazamiento automático no localizaba refs en vuestro visor.
 */
async function tryTableSelectByRef(page, refShort) {
  const t = refShort.trim();
  if (!t) return false;

  await focusDatatableBody(page);

  const colRef = page.locator(".webix_cell.gda_dl_7");
  const base =
    (await colRef.count()) > 0 ? colRef : page.locator(".webix_cell");

  await clearCensoHitMarks(page).catch(() => {});
  await sleep(35);

  let cell = await findRefCellLikeCtrlF(page, t);
  if (!cell) cell = await firstVisibleRefCell(base, t);

  if (!cell) {
    await clearCensoHitMarks(page).catch(() => {});
    return false;
  }

  try {
    await clickGridCellSelectingRowNotLink(page, cell);
    return true;
  } finally {
    await clearCensoHitMarks(page).catch(() => {});
  }
}

async function clickTableCellByRefPrefix(page, refShort) {
  const ok = await tryTableSelectByRef(page, refShort);
  if (!ok) {
    throw new Error(
      `No aparece "${refShort.trim()}" en la tabla del visor (comprueba municipio/URL y que la ref exista en el listado).`,
    );
  }
}

/**
 * Una vuelta: abrir Buscar, rellenar, Aceptar, Cerrar (para ver tabla filtrada).
 */
async function modalBuscarRound(page, ref, stepMs, onLog) {
  try {
    await clickSearchTrigger(page);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    onLog?.(`  (no se pudo abrir Buscar: ${m})`);
    return false;
  }

  await sleep(stepMs);

  let filled = false;
  try {
    filled = await fillSearchModalText(page, ref);
  } catch {
    /* */
  }
  if (!filled) {
    onLog?.("  (modal: input no listo; espera breve…)");
    await sleep(2200);
  }

  await sleep(stepMs);
  try {
    await clickSearchModalAceptar(page);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    onLog?.(`  (Aceptar modal: ${m})`);
    return false;
  }

  await sleep(Math.max(stepMs, 650));

  try {
    await clickSearchModalCerrar(page);
  } catch {
    /* */
  }
  await sleep(stepMs);
  await focusDatatableBody(page);
  return true;
}

/**
 * 1) Tabla visible actual. 2) Un solo ciclo Buscar → Aceptar → Cerrar. 3) Tabla o fila de resultados.
 * Sin segundo modal (antes duplicaba tiempo cuando la ref no existía).
 */
async function selectParcelRowTableThenModal(page, ref, stepMs, onLog) {
  if (await tryTableSelectByRef(page, ref)) {
    return;
  }

  onLog?.("  → No en filas visibles; Buscar…");
  if (!(await modalBuscarRound(page, ref, stepMs, onLog))) {
    throw new Error(`No se pudo completar el modal Buscar para "${ref}".`);
  }

  await sleep(Math.max(stepMs, 320));
  onLog?.("  → Tras Buscar: tabla o resultados…");
  if (await tryTableSelectByRef(page, ref)) {
    return;
  }

  try {
    await clickResultRowFlexible(page, ref);
    return;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Referencia no encontrada en el censo (no se captura): "${ref}". ${m}`,
    );
  }
}

/** Solo modal + resultado (comportamiento antiguo con --buscar-modal). */
async function selectParcelRowModalOnly(page, ref, stepMs, onLog) {
  await clickSearchTrigger(page);
  await sleep(stepMs);

  const filled = await fillSearchModalText(page, ref);
  if (!filled) {
    onLog?.("  (modal buscar: espera breve…)");
    await sleep(4000);
  }

  await sleep(stepMs);
  await clickSearchModalAceptar(page);
  await sleep(Math.max(stepMs, 650));

  await clickSearchModalCerrar(page);
  await sleep(stepMs);

  await clickResultRowFlexible(page, ref);
}

/**
 * Abre controles de zoom del mapa, pulsa + N veces y cierra. Solo se usa en la **primera** parcela;
 * el mismo nivel de zoom se mantiene para el resto del lote (revisión manual si hace falta).
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
    stepMs = DEFAULT_STEP_MS,
    buscarModal = false,
    onLog = () => {},
    onProgress = () => {},
  } = options;

  const refs = [...new Set((refsInput || []).map((r) => String(r).trim()).filter(Boolean))];
  if (refs.length === 0) {
    throw new Error("No hay referencias catastrales.");
  }

  const outDir = resolve(outDirRaw);
  const clipRect = clip === "full" ? CLIP_MAP_FULL : CLIP_MAP_PREFERRED;

  await mkdir(outDir, { recursive: true });

  onLog(`URL: ${url}`);
  onLog(`Referencias: ${refs.length}`);
  onLog(`Carpeta temporal: ${outDir}`);

  const browser = await chromium.launch({
    headless,
    slowMo: 0,
  });

  const context = await browser.newContext({
    viewport: VIEWPORT,
    locale: "es-ES",
  });

  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
    await sleep(2000);
  } catch (e) {
    await browser.close();
    throw new Error(`No se pudo cargar la URL: ${e.message}`);
  }

  const manifest = { url, viewport: VIEWPORT, clip: clipRect, items: [] };

  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i];
    const file = `${safeFilename(ref)}.png`;
    const pngPath = join(outDir, file);

    onProgress(i + 1, refs.length, ref);
    onLog(`[${i + 1}/${refs.length}] ${ref}`);

    try {
      if (buscarModal) {
        await selectParcelRowModalOnly(page, ref, stepMs, onLog);
      } else {
        await selectParcelRowTableThenModal(page, ref, stepMs, onLog);
      }

      await sleep(1100);

      if (!noZoom && zoomClicks > 0 && i === 0) {
        onLog(`  Zoom (solo 1ª parcela): abrir → ${zoomClicks}× + → cerrar; resto sin tocar zoom`);
        await sleep(1200);
        await applyZoomWithMapControls(page, zoomClicks);
        await sleep(1400);
      }

      await page.screenshot({ path: pngPath, clip: clipRect });
      onLog(`  OK → ${file}`);
      manifest.items.push({ ref, file });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onLog(`  ERROR: ${msg}`);
      manifest.items.push({ ref, file: null, error: msg });
    }
  }

  const manifestPath = join(outDir, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  onLog(`Manifest: manifest.json`);

  await browser.close();

  return { manifestPath, outDir, manifest };
}
