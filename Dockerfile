# Servicio de capturas del censo para el VPS (Coolify).
# La imagen oficial de Playwright ya trae Chromium y sus librerías; la versión debe coincidir
# con la de `playwright` en package-lock.json (hoy 1.58.2) o no encontrará el navegador.
FROM mcr.microsoft.com/playwright:v1.58.2-noble

# Chromium se lanza visible (headless: false, igual que en droppy): necesita una pantalla virtual.
RUN apt-get update \
  && apt-get install -y --no-install-recommends xvfb \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production PORT=3000

COPY package.json package-lock.json ./
# Electron, electron-builder y sharp son solo del escritorio: no entran en la imagen.
RUN npm ci --omit=dev

COPY server.mjs map-clip.mjs ./
COPY lib ./lib
COPY web ./web

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["xvfb-run", "-a", "--server-args=-screen 0 1280x800x24", "node", "server.mjs"]
