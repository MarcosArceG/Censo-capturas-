/**
 * Lanza Chromium en modo visible y registra cada clic en la TERMINAL (Node).
 *
 * Uso:
 *   cd censo-playwright
 *   npm install
 *   npx playwright install chromium
 *   npm run probe
 *   npm run probe -- "https://censo.gestiondelamianto.com/#/city:37CB4017"
 *
 * Cierra la ventana del navegador o Ctrl+C en la terminal para salir.
 */

import { chromium } from "playwright";

const url =
  process.argv[2] ||
  process.env.CENSO_URL ||
  "https://censo.gestiondelamianto.com/#/city:37CB4017";

console.log("\n▶ Abriendo:", url);
console.log("▶ Cada clic se mostrará abajo con clientX/clientY (viewport).\n");

const browser = await chromium.launch({
  headless: false,
  slowMo: 0,
});

const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  locale: "es-ES",
});

const page = await context.newPage();

let clickCount = 0;

await page.exposeFunction("__censoLogClick", (payload) => {
  clickCount += 1;
  console.log("\n┌── CLICK #" + clickCount + " ──────────────────────────────────────");
  console.log("│ viewport (útil para clip en screenshot)");
  console.log("│   clientX:", payload.clientX, " clientY:", payload.clientY);
  console.log("│ página (scroll + viewport)");
  console.log("│   pageX:", payload.pageX, " pageY:", payload.pageY);
  console.log("│ elemento");
  console.log("│   tag:", payload.tag);
  console.log("│   id:", payload.id || "(vacío)");
  console.log("│   class:", payload.className || "(vacío)");
  if (payload.textPreview) {
    console.log("│   texto:", payload.textPreview);
  }
  console.log("└──────────────────────────────────────────────────\n");
});

await page.addInitScript(() => {
  window.addEventListener(
    "click",
    (e) => {
      const t = e.target;
      const el = t instanceof Element ? t : null;
      const id = el?.id ?? "";
      let className = "";
      if (el) {
        if (typeof el.className === "string") {
          className = el.className.slice(0, 120);
        } else if (el.className && typeof el.className.baseVal === "string") {
          className = el.className.baseVal.slice(0, 120);
        }
      }
      let textPreview = "";
      if (el && el.textContent) {
        textPreview = el.textContent.replace(/\s+/g, " ").trim().slice(0, 60);
      }
      window.__censoLogClick?.({
        clientX: e.clientX,
        clientY: e.clientY,
        pageX: e.pageX,
        pageY: e.pageY,
        tag: t?.nodeName ?? "?",
        id,
        className,
        textPreview,
      });
    },
    true,
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

console.log("▶ Navegador listo. Haz clics; copia los bloques que necesites para el script.");
console.log("▶ Cierra la ventana del navegador o pulsa Ctrl+C aquí para salir.\n");

const done = new Promise((resolve) => {
  browser.on("disconnected", () => resolve("browser"));
  process.once("SIGINT", () => resolve("sigint"));
  process.once("SIGTERM", () => resolve("sigterm"));
});

await done;
await browser.close().catch(() => {});
console.log("\n▶ Fin.\n");
process.exit(0);
