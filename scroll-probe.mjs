/**
 * Prueba cómo el visor reacciona al scroll (trackpad / rueda) y qué nodos Webix cambian.
 *
 * Uso:
 *   cd censo-playwright
 *   npm run probe:scroll
 *   npm run probe:scroll -- "https://censo.gestiondelamianto.com/#/city:37CB4017"
 *
 * Tras cargar la página se abre el Inspector de Playwright (ventana aparte):
 *   - En Chromium: desplázate con el TRACKPAD como siempre.
 *   - En la terminal verás líneas [WHEEL] con deltaY y el elemento bajo el cursor.
 *   - También scrollTop del .webix_ss_center_scroll y altura del .webix_vscroll_body si existen.
 *
 * En el Inspector pulsa "Resume" (▶) cuando quieras cerrar la pausa; luego cierra el navegador o Ctrl+C.
 *
 * Variable de entorno (opcional):
 *   SCROLL_PROBE_NO_PAUSE=1  → no abre el inspector; solo escucha rueda hasta que cierres el navegador.
 */

import { chromium } from "playwright";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const url =
  process.argv[2] ||
  process.env.CENSO_URL ||
  "https://censo.gestiondelamianto.com/#/city:37CB4017";

const noPause = process.env.SCROLL_PROBE_NO_PAUSE === "1";

console.log("\n▶ scroll-probe");
console.log("▶ URL:", url);
console.log(
  noPause
    ? "▶ Modo sin pausa: desplázate con el trackpad; mira la terminal.\n"
    : "▶ Se abrirá el Inspector de Playwright: Resume ▶ para seguir tras inspeccionar.\n",
);

const browser = await chromium.launch({
  headless: false,
  slowMo: 0,
});

const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  locale: "es-ES",
});

const page = await context.newPage();

let wheelSeq = 0;

await page.exposeFunction("__censoLogWheel", (payload) => {
  wheelSeq += 1;
  const s = payload.snapshot || {};
  console.log(
    `\n[WHEEL #${wheelSeq}] últimoΔ=${payload.lastDeltaY?.toFixed?.(1) ?? payload.lastDeltaY} ` +
      `suma80ms=${payload.acc80ms?.toFixed?.(1) ?? "?"} mode=${payload.deltaMode}`,
  );
  console.log(
    "  target:",
    payload.tag,
    payload.className?.slice?.(0, 100) || "(sin class)",
  );
  if (payload.id) console.log("  id:", payload.id);
  console.log(
    "  webix:",
    `center_scrollTop=${s.centerScrollTop ?? "?"} / max≈${s.centerScrollMax ?? "?"} | ` +
      `vscroll_body_h=${s.vscrollBodyH ?? "?"}`,
  );
});

await page.addInitScript(() => {
  function webixSnapshot() {
    const cs = document.querySelector(".webix_datatable .webix_ss_center_scroll");
    const vb = document.querySelector(".webix_vscroll_body");
    const max =
      cs && cs.scrollHeight > cs.clientHeight
        ? Math.round(cs.scrollHeight - cs.clientHeight)
        : null;
    return {
      centerScrollTop: cs != null ? Math.round(cs.scrollTop) : null,
      centerScrollMax: max,
      vscrollBodyH: vb != null ? vb.offsetHeight : null,
    };
  }

  function targetInfo(target) {
    const el = target instanceof Element ? target : null;
    let className = "";
    if (el) {
      if (typeof el.className === "string") {
        className = el.className;
      } else if (el.className && typeof el.className.baseVal === "string") {
        className = el.className.baseVal;
      }
    }
    return {
      tag: target?.nodeName ?? "?",
      id: el?.id ?? "",
      className,
    };
  }

  let acc = 0;
  let lastTarget = null;
  let lastDeltaY = 0;
  let lastDeltaMode = 0;
  let timer = null;

  window.addEventListener(
    "wheel",
    (e) => {
      acc += e.deltaY;
      lastTarget = e.target;
      lastDeltaY = e.deltaY;
      lastDeltaMode = e.deltaMode;
      if (timer) return;
      timer = setTimeout(() => {
        const t = lastTarget;
        const info = targetInfo(t);
        window.__censoLogWheel?.({
          lastDeltaY,
          deltaMode: lastDeltaMode,
          acc80ms: acc,
          tag: info.tag,
          id: info.id,
          className: info.className,
          snapshot: webixSnapshot(),
        });
        acc = 0;
        timer = null;
      }, 80);
    },
    { capture: true, passive: true },
  );
});

page.on("close", () => {
  console.log("\n▶ Pestaña cerrada.\n");
});

try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
} catch (e) {
  console.error("Error navegando:", e.message);
  await browser.close();
  process.exit(1);
}

await sleep(1500);

console.log(
  "▶ Coloca el cursor sobre la TABLA del listado y desplázate con el trackpad.\n" +
    "▶ Copia 2–3 bloques [WHEEL] de la terminal si el scroll del script no coincide.\n",
);

if (!noPause) {
  console.log("▶ Abriendo Inspector de Playwright (page.pause)…\n");
  await page.pause();
}

const done = new Promise((resolve) => {
  browser.on("disconnected", () => resolve("browser"));
  process.once("SIGINT", () => resolve("sigint"));
  process.once("SIGTERM", () => resolve("sigterm"));
});

await done;
await browser.close().catch(() => {});
console.log("\n▶ Fin scroll-probe.\n");
process.exit(0);
