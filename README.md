# Censo — prueba Playwright (clicks en consola)

Herramienta mínima para **localizar en la terminal** dónde pinchas en el mapa del censo (`clientX` / `clientY` en viewport) y qué elemento es (tag, id, class). Con eso definimos **selectores** y **rectángulos `clip`** para capturas.

## Requisitos

- Node.js 18+

**Entrega a cliente / soporte:** revisar **[ENTREGA-CLIENTE.md](./ENTREGA-CLIENTE.md)** (Chromium, GitHub Actions, estructura del repo).

## Instalación (una vez)

```bash
cd censo-playwright
npm install
npx playwright install chromium
```

## Prueba de scroll (trackpad vs script)

Si el lote se queda en la misma parcela, graba cómo reacciona el visor a **tu** scroll:

```bash
npm run probe:scroll
```

1. Carga la URL del municipio.
2. Se abre el **Inspector de Playwright** (`page.pause`): pulsa **Resume ▶** cuando quieras, o déjalo abierto mientras pruebas.
3. Pon el cursor sobre el **listado** y desplázate con el **trackpad**.
4. En la **terminal** salen líneas `[WHEEL]` con deltas del trackpad, clases del elemento bajo el cursor y `center_scrollTop` / `vscroll_body_h`.

Copia unas cuantas líneas y/o indica si `center_scrollTop` se queda en 0 mientras baja el listado (así sabremos si hay que enganchar otro nodo).

Si no aparece el Inspector: `PWDEBUG=1 npm run probe:scroll`

Sin inspector (solo logs en terminal): `SCROLL_PROBE_NO_PAUSE=1 npm run probe:scroll`

## Uso (clics)

```bash
npm run probe
```

O con otra URL (hash incluido entre comillas en zsh/bash):

```bash
npm run probe -- "https://censo.gestiondelamianto.com/#/city:37CB4017"
```

Variable de entorno:

```bash
CENSO_URL="https://..." npm run probe
```

- Se abre **Chromium visible** (1280×800).
- Cada **clic** imprime un bloque en la **consola del terminal** (no en DevTools del navegador).
- **Cierra la ventana del navegador** o **Ctrl+C** en la terminal para terminar (el script queda esperando mientras el navegador siga abierto).

## Qué enviar para la primera versión del script

1. Secuencia de clics que haces (buscador → fila → etc.) y los **bloques `[CLICK #n]`** que salgan.
2. Si ya sabes el **rectángulo del mapa solo**: clica **esquina superior izquierda** y **esquina inferior derecha** del área que quieres capturar y pasa esos dos `clientX/clientY` (asumimos mismo tamaño de ventana que en la prueba).

## Captura por lote (`capture-batch.mjs`)

Misma ventana **1280×800** y recorte `map-clip.mjs` (preferido o completo).

```bash
npm run capture -- "https://censo.gestiondelamianto.com/#/city:37CB4017" --refs "6460002QC3066S0001XQ,5763621QC3056S0001EB"
```

Archivo (una ref por línea):

```bash
npm run capture -- --refs-file ./refs.txt --out ./out
```

Opciones útiles:

| Flag | Descripción |
|------|-------------|
| `--clip full` | Captura `CLIP_MAP_FULL` en lugar del recorte interior |
| `--zoom-clicks 6` | Veces que se pulsa «+» tras abrir controles (default **5**; solo **primera** ref.) |
| `--no-zoom` | Sin zoom (ni siquiera en la primera parcela) |
| `--headless` | Sin ventana (más frágil si hay login manual) |
| `--step-ms 600` | Más pausa entre pasos |

Salida: PNG por ref en `--out` (default `./out`) y `manifest.json`.

### Zoom (estrategia actual)

En la **primera** referencia del lote se aplica **abrir controles → N× «+» → cerrar** (por defecto **N = 5**). **No** se vuelve a tocar el zoom en el resto de parcelas: se mantiene el mismo nivel para todo el lote. El técnico puede **repasar a mano** las capturas que queden demasiado pequeñas o grandes.

*(Opcional para desarrollo: `npm run analyze-zoom-png -- ./captura.png` prueba la heurística en `lib/zoomAnalyze.mjs` sobre un PNG suelto; no forma parte del flujo de captura.)*

### Estrategia por defecto: solo filas visibles + modal (sin scroll automático)

En la columna `.gda_dl_7` solo se consideran celdas **ya visibles** (no hay scroll/rueda en la tabla). Coincidencia por prefijo o texto contenido (ej. `5763621QC3056S` → `5763621QC3056S0001EB`).

Si no aparece: **Buscar → Aceptar → Cerrar** y otra búsqueda solo en lo visible; si hace falta, fila de resultados y hasta **una segunda** vuelta de Buscar.

### Solo modal «Buscar» (`--buscar-modal`)

Omite la tabla al inicio (comportamiento antiguo):

```bash
npm run capture -- [URL] --refs "REF" --buscar-modal
```

Si el buscador no expone bien el input, el script puede esperar para intervención manual (45s en modo solo modal).

## App de escritorio

Interfaz con formulario: pegas **referencias (una por línea)**, **nivel zoom** y se genera un **ZIP** con los PNG + `manifest.json`.

### macOS / desarrollo desde consola

```bash
cd censo-playwright
npm install
npx playwright install chromium
npm run app
```

1. Ajusta la **URL del visor** si cambia de municipio.
2. Pega las refs en el cuadro de texto.
3. Opcional: **Nivel zoom** (por defecto 5; solo afecta a la primera captura del lote).
4. Pulsa **Generar ZIP** y elige dónde guardar el archivo.
5. Se abre **Chromium (Playwright)** para el proceso; al terminar se abre la carpeta del ZIP.

Hace falta **Node**, dependencias instaladas y **`npx playwright install chromium`** al menos una vez en esa máquina.

### Windows — instalador .exe para técnicos

**No uses `npm run dist` desde Mac** para esto: el target es Windows y hay que compilar en **Windows** o con **GitHub Actions** (ver abajo).

Generar el instalador **NSIS** (`CensoCapturas-Setup-<versión>.exe`):

```powershell
cd censo-playwright
npm install
npm run dist:win
```

El `.exe` queda en `release\`. Instrucciones completas (GitHub Actions si no tienes Windows, Chromium en el PC del técnico, versión): **[RELEASE-WINDOWS.md](./RELEASE-WINDOWS.md)**.

También puedes disparar el workflow **Censo capturas — Windows (.exe)** en GitHub Actions (carpeta `.github/workflows/` del repo).

## Notas

- `clientX` / `clientY` son respecto al **viewport** de la página (coinciden con el sistema que usa Playwright para `clip` si capturas el viewport).
- Si cambias el tamaño de la ventana manualmente, las coordenadas cambian; para repetibilidad usa viewport fijo o no redimensiones.
