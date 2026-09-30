# Despliegue en el VPS (Coolify)

El servicio de capturas corre en el VPS de OVH y lo usa la webapp de informes directamente
(sustituye a droppy; ver `DESPLIEGUE-DROPPY.md` solo como histórico).

| | |
|---|---|
| URL | https://capturas.gestiondelamianto.com (`/api/health` → `{"ok":true,…}`) |
| Panel | https://coolify.gestiondelamianto.com → proyecto `narciso` → `production` → **capturas** |
| Servidor | `ssh ubuntu@51.89.150.239` (solo con la clave del Mac de Marcos) |
| Build | **`Dockerfile`** de este repo (no el `docker-compose.yml`) |
| Base de datos | ninguna |

## Desplegar un cambio

**`git push origin main` y listo.** GitHub avisa a Coolify por webhook y en unos minutos está
en producción. Si el build falla, sigue la versión anterior.

- Ver cómo va: panel → capturas → **Deployments**.
- **Redesplegar corta el lote que esté en curso** (la cola vive en memoria). Mejor desplegar
  cuando no haya capturas en marcha: `curl -s https://capturas.gestiondelamianto.com/api/health`
  → `"busy":false`. Lo que se corte se recupera con «Capturar pendientes» en la webapp.

Comprobar después:

```bash
curl -s https://capturas.gestiondelamianto.com/api/health                       # {"ok":true,...}
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://capturas.gestiondelamianto.com/api/capture   # 401 sin token
```

Prueba completa (2 parcelas, token en Coolify → capturas → `CAPTURE_API_TOKEN`):

```bash
curl -sS -X POST https://capturas.gestiondelamianto.com/api/capture \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"url":"https://censo.gestiondelamianto.com/#/city:AD58AACD","refsText":"1424070DF1812S\n0822801DF1802S"}'
```

## Ajustes de Coolify que NO están en el repo (no quitarlos)

- **Opciones de Docker:** `--shm-size=1g --init`
  - `--shm-size=1g`: Chromium se queda sin memoria compartida con los 64 MB por defecto.
  - `--init`: sin él, `xvfb-run` se queda colgado como PID 1 y el servidor nunca arranca.
- **Healthcheck de Coolify desactivado:** usa `curl`/`wget`, que la imagen de Playwright no
  trae. La comprobación de salud la hace el `HEALTHCHECK` del `Dockerfile` (con node).
- **Sin puertos publicados:** el tráfico entra por el dominio (HTTPS). Por eso no se usa el
  `docker-compose.yml`, que publica `3000:3000` y en el VPS saltaría el firewall.

## Cosas que rompen el build o el arranque

- **Versión de Playwright:** la imagen base (`mcr.microsoft.com/playwright:vX.Y.Z-noble`) debe
  coincidir con la versión de `playwright` de `package-lock.json`. Si se actualiza una, actualizar
  la otra en el mismo commit.
- Archivos nuevos que necesite el servidor: añadirlos a los `COPY` del `Dockerfile`.

## Variables de entorno

Coolify → capturas → **Environment Variables**, y **Redeploy** tras cambiarlas:

- `CAPTURE_API_TOKEN`: **el mismo valor** que `CENSUS_CAPTURE_TOKEN` en la webapp de informes.
  Si se cambia, cambiar los dos y redesplegar los dos.
- `HEADLESS=1` (opcional): Chromium sin ventana. Por defecto visible sobre Xvfb.

## Logs y volver atrás

- Logs en vivo: panel → capturas → **Logs**.
- Volver atrás: panel → capturas → **Deployments** → despliegue anterior → **Redeploy**; o
  `git revert <commit>` + push.
