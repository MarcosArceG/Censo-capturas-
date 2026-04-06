# Comandos rápidos

## Quien **usa** la app (Windows)

Una vez por PC (hace falta [Node.js](https://nodejs.org) instalado):

```bash
npx playwright install chromium
```

Luego abrir **Censo capturas** y usar **Generar ZIP** como siempre.

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
