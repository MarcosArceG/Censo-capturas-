# Comandos rápidos

## Lanzar la app **desde la terminal** (Windows)

En la carpeta del proyecto (donde está `package.json`), **una vez por máquina**:

```powershell
cd ruta\a\censo-playwright
npm ci
npx playwright install chromium
```

Cada vez que quieran abrir la app **sin** usar el acceso directo del instalador:

```powershell
cd ruta\a\censo-playwright
npm run app
```

(Si aún no han instalado dependencias en ese PC, antes `npm ci` o `npm install`.)

Requisitos: [Node.js](https://nodejs.org) 18+ instalado. No hace falta copiar `node_modules` en el paquete que enviáis: se genera con `npm ci` en destino.

---

## Quien **usa** la app con el instalador `.exe` (Windows)

Una vez por PC (hace falta [Node.js](https://nodejs.org) instalado **solo** para Playwright):

```powershell
npx playwright install chromium
```

Luego abrir **Censo capturas** desde el menú Inicio y usar **Generar ZIP** como siempre.

---

## Quien **genera** el instalador `.exe` (solo Windows)

En la carpeta del proyecto:

```bash
npm install
npm run dist
```

El `.exe` queda en `release/`.

---

## Desarrollo (Mac o Windows)

```bash
npm install
npx playwright install chromium
npm run app
```
