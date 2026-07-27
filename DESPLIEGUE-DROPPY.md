# Despliegue en «droppy» (mini PC de la oficina)

Los técnicos del coworking generan las capturas desde el navegador, conectándose al mini PC
de la oficina antes de salir a campo. No instalan nada: entran a una URL.

Esto documenta ese montaje, que hasta julio de 2026 solo existía en la máquina y en el
portátil de Marcos.

## Qué hay

| | |
|---|---|
| Equipo | `droppy` — Ubuntu 24.04 LTS, x86_64 |
| Dirección | `192.168.1.2` en la red de la oficina (fuera, por Tailscale) |
| Los técnicos entran a | `http://192.168.1.2:3000` |
| Código | `/opt/censo-playwright` (grupo `censo`) |
| Node | `/usr/local/bin/node` |
| Acceso | `ssh marcos@192.168.1.2` (clave pública) |

`/opt/censo-playwright` **no es un repositorio git**: el código se copia desde el portátil.
Antes de sustituir nada, comparar con `md5sum` para no pisar cambios hechos solo en el servidor.

## Servicios

Dos unidades systemd, y la segunda no es opcional:

- **`censo-web.service`** — el servidor Express (`server.mjs`). `Restart=always`, así que si el
  proceso muere vuelve solo en 3 segundos.
- **`censo-xvfb.service`** — pantalla virtual `:1`. Playwright arranca Chromium **en modo visible**
  (`headless: false`), y sin un display el navegador no levanta. `censo-web` la declara como
  `Requires=`, o sea que arrancar el servidor arrastra la pantalla virtual.

Variables que fija la unidad de `censo-web`:

```
DISPLAY=:1
PLAYWRIGHT_BROWSERS_PATH=/opt/censo-playwright/.playwright-browsers
PORT=3000
```

`PLAYWRIGHT_BROWSERS_PATH` apunta dentro del proyecto: el Chromium de Playwright vive ahí, no en
el `~/.cache` del usuario.

## Actualizar

```bash
# 1. Comprobar que nadie está capturando (si hay Chromium vivo, esperar)
ssh marcos@192.168.1.2 'ps -eo cmd | grep -c "[c]hromium"'

# 2. Copia de seguridad de lo que se vaya a sustituir
ssh marcos@192.168.1.2 'cp -a /opt/censo-playwright/lib/captureJob.mjs{,.bak-$(date +%F-%H%M%S)}'

# 3. Subir los archivos cambiados
scp lib/captureJob.mjs lib/kmlOutput.mjs marcos@192.168.1.2:/opt/censo-playwright/lib/

# 4. Verificar que llegaron íntegros y que Node los acepta
ssh marcos@192.168.1.2 'cd /opt/censo-playwright && md5sum lib/captureJob.mjs && node --check lib/captureJob.mjs'

# 5. Reiniciar (corta unos 3 s: se pierde el lote que esté en curso)
ssh marcos@192.168.1.2 'sudo systemctl restart censo-web && systemctl is-active censo-web'
```

Si se tocan dependencias (`package.json`), hace falta además `npm ci` en `/opt/censo-playwright`
antes de reiniciar.

## Comprobar que funciona

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://192.168.1.2:3000/     # 200
journalctl -u censo-web -n 20 --no-pager
```

Prueba completa, que es la que de verdad vale, lanzando un lote de dos referencias:

```bash
curl -sS -X POST http://192.168.1.2:3000/api/capture \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://censo.gestiondelamianto.com/#/city:AD58AACD","refsText":"1424070DF1812S\n0822801DF1802S"}'
# devuelve {"jobId":"…"}; seguir el progreso en /api/capture/<jobId>/events
# y descargar con /api/capture/<jobId>/download
```

El ZIP debe traer los PNG, `manifest.json` (con `gps` en cada entrada) y `ubicaciones.kml`.

## «No me carga la página» desde un Mac

En **macOS 15 (Sequoia) o posterior** cada aplicación necesita permiso explícito para hablar con
equipos de la red local. Si el navegador no lo tiene, `http://192.168.1.2:3000` no carga **y el
error no dice nada útil**: parece que el servidor está caído cuando está perfecto.

Se distingue en un segundo, desde una terminal del mismo equipo:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://192.168.1.2:3000/   # 200 → el servidor va bien
```

Si `curl` responde 200 y el navegador no carga, es el permiso, no el servidor:
**Ajustes del Sistema → Privacidad y seguridad → Red local** → activar el navegador, y después
**cerrarlo del todo (⌘Q) y volver a abrirlo**, porque no se aplica hasta reiniciar la app.

Se desactiva solo con más frecuencia de la esperable: instalar o quitar una VPN, o cualquier
extensión de red del sistema, reinicia estos permisos.

## Cosas que se olvidan

- **Una captura a la vez.** El servidor rechaza un lote nuevo con HTTP 409 si ya hay otro en curso.
  Es a propósito: comparten el mismo navegador.
- **Los ZIP viven en `/tmp`** y se borran al descargarlos. Un lote que se genere y nadie descargue
  se queda ahí ocupando sitio hasta el siguiente reinicio de la máquina.
- **Reiniciar corta el lote en curso** sin avisar al técnico: su descarga nunca llega.
