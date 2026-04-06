# Instalador Windows (.exe)

## Qué se genera

Tras el build aparece en `release/` un instalador **NSIS**, por ejemplo:

`CensoCapturas-Setup-0.0.1.exe`

Los técnicos lo ejecutan, eligen carpeta de instalación y obtienen el acceso directo **Censo capturas**.

Checklist general (Chromium, repo, etc.): **[ENTREGA-CLIENTE.md](./ENTREGA-CLIENTE.md)**.

## Mac no genera el .exe

`npm run dist` / `npm run dist:win` lanzan **electron-builder --win**. En **macOS** eso **no funciona** de forma fiable (haría falta Wine, etc.). Usa **Opción B (GitHub Actions)** o un **PC Windows**.

## Cómo compilarlo

### Opción A — PC con Windows (recomendado en local)

```powershell
cd censo-playwright
npm install
npm run dist:win
```

El `.exe` queda en `censo-playwright\release\`.

### Opción B — Desde Mac o sin Windows (GitHub Actions)

1. Sube el repo a GitHub (incluida la carpeta `.github/workflows/`).
2. **Actions** → **Censo capturas — Windows (.exe)** → **Run workflow**.
3. Al terminar, descarga el artefacto **CensoCapturas-Windows-Setup** (contiene el `.exe`).

También se dispara al etiquetar un commit con `censo-v*` (ej. `censo-v0.0.2`).

## Chromium (Playwright) en el PC del técnico

El instalador **no incluye** el navegador de automatización (~300 MB). La primera vez, en ese Windows hace falta **una de estas dos**:

1. **Tener Node.js** y ejecutar una vez en consola (en cualquier carpeta):

   ```powershell
   npx playwright install chromium
   ```

2. O instalar Chromium desde la misma máquina donde desarrollaste, copiando la carpeta de navegadores de Playwright según la [documentación de Playwright](https://playwright.dev/docs/browsers) (`PLAYWRIGHT_BROWSERS_PATH`).

Sin Chromium instalado en caché, al pulsar **Generar ZIP** la captura fallará con un error del tipo “browser not found”.

## Versión

Cambia `"version"` en `package.json` antes de generar un instalador nuevo; el nombre del `.exe` incluye esa versión.
