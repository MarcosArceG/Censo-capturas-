# Entrega al cliente — qué puede fallar y cómo evitarlo

## 1. Chromium (Playwright) en Windows

La app **no incluye** el navegador de automatización. Sin él, al generar el ZIP aparecerá un error tipo *Executable doesn't exist* / *browser not found*.

**En cada PC Windows** (instalador .exe o fuentes), una vez:

```powershell
npx playwright install chromium
```

(Requiere **Node.js** instalado, o ver [RELEASE-WINDOWS.md](./RELEASE-WINDOWS.md) para alternativas.)

Si en lugar del instalador van a **clonar o descomprimir el código** y arrancar todo desde consola: **`npm ci`**, **`npx playwright install chromium`** y **`npm run app`** en la carpeta del proyecto. Detalle paso a paso en [COMANDOS.md](./COMANDOS.md).

---

## 2. Generar el `.exe` **no** se hace en Mac

`npm run dist` solo construye **Windows**. En macOS no sirve; usar **PC Windows** o **GitHub Actions** (apartado 4).

---

## 3. GitHub Actions: raíz del repositorio

GitHub solo lee `.github/workflows/` en la **raíz del repositorio**.

| Cómo entregáis el código | Qué workflow usar |
|---------------------------|-------------------|
| Repo cuya raíz es la carpeta **`censo-playwright`** (solo este proyecto) | Usar [`.github/workflows/build-windows.yml`](./.github/workflows/build-windows.yml) incluido aquí. |
| Repo **monorepo** (ej. carpeta padre con `censo-playwright/` dentro) | Poner el workflow en la raíz del monorepo (ej. `../.github/workflows/`) con `working-directory: censo-playwright` y rutas `censo-playwright/package-lock.json`, como en vuestro ejemplo. |

Si el cliente clona **solo** `censo-playwright` y no hay `.github` dentro, **Actions no existirá** hasta que copiéis ese directorio.

---

## 4. Identificador de la app (`appId`)

En `package.json` → `build.appId` está como `com.gestiondelamianto.censo.capture`. Si el cliente publica bajo otra empresa, conviene cambiarlo para evitar solaparse con otras apps en Windows.

---

## 5. Archivos que **sí** debe tener el cliente

- Carpeta **`censo-playwright`** completa (código, `package-lock.json`, `electron/`, `renderer/`, `lib/`, `map-clip.mjs`, etc.).
- **`npm install`** en esa carpeta antes de `npm run app` o antes de `npm run dist:win`.

**No** es obligatorio entregar `node_modules/` (se regenera con `npm install`).

---

## 6. Herramienta opcional `analyze-zoom-png`

Usa **`sharp`** (ahora en `devDependencies`). Solo hace falta si ejecutan `npm run analyze-zoom-png`; la app Electron de capturas **no** lo necesita. Instalación normal: `npm install` (incluye devDependencies en desarrollo).

---

## 7. Antivirus / permisos Windows

El instalador y Playwright pueden disparar avisos. Si falla algo extraño, probar carpeta de instalación con permisos de usuario o excepción temporal.

---

Resumen: lo que más suele olvidarse es **`npx playwright install chromium`** en el puesto del técnico y alinear **estructura del repo** con el **workflow de GitHub**.
