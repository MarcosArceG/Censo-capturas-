/**
 * Heurística sobre el PNG del recorte del mapa: estimar si el resaltado (marco claro)
 * ocupa poco o mucho del encuadre y sugerir +/− en los controles de zoom.
 *
 * Calibrar con capturas reales (ok / grande / pequeña) si hace falta:
 *   MIN_BBOX_FRAC, MAX_BBOX_FRAC, MIN_BRIGHT_FRAC
 */

import sharp from "sharp";

/** Pixel tipo marco blanco / halo del visor (luminoso, poca saturación o cian claro). */
function isHighlightPixel(r, g, b) {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  if (lum < 188) return false;
  if (mx < 165) return false;
  if (mx - mn < 52) return true;
  if (b > 198 && g > 195 && r > 115) return true;
  return false;
}

/**
 * @param {Buffer} pngBuffer
 * @returns {Promise<{ deltaPlus: number, debug: { bboxFrac: number, brightFrac: number, w: number, h: number } }>}
 *   deltaPlus ∈ { -2, -1, 0, 1, 2 } — zoom in = positivo
 */
export async function suggestZoomStepsFromClipPng(pngBuffer) {
  const { data, info } = await sharp(pngBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const total = w * h;

  let bright = 0;
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;

  /** Región central (~56% ancho/alto): el marco de la parcela suele estar aquí; el bbox global engloba todo el catastro blanco del encuadre y dispara falsos. */
  const mx = Math.floor(w * 0.22);
  const my = Math.floor(h * 0.22);
  const x1 = w - mx;
  const y1 = h - my;

  let centerBright = 0;
  let cminX = w;
  let cminY = h;
  let cmaxX = 0;
  let cmaxY = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (!isHighlightPixel(r, g, b)) continue;
      bright += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;

      if (x >= mx && x < x1 && y >= my && y < y1) {
        centerBright += 1;
        if (x < cminX) cminX = x;
        if (y < cminY) cminY = y;
        if (x > cmaxX) cmaxX = x;
        if (y > cmaxY) cmaxY = y;
      }
    }
  }

  const brightFrac = bright / total;

  /** Demasiados píxeles claros: probablemente cielo / nubes / fallo heurística → no tocar */
  if (brightFrac > 0.38) {
    return { deltaPlus: 0, debug: { bboxFrac: 1, centerBboxFrac: 1, brightFrac, w, h } };
  }

  let bboxFrac = 0;
  if (bright >= 40 && maxX >= minX && maxY >= minY) {
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    bboxFrac = (bw * bh) / total;
  }

  let centerBboxFrac = 0;
  if (centerBright >= 25 && cmaxX >= cminX && cmaxY >= cminY) {
    const cbw = cmaxX - cminX + 1;
    const cbh = cmaxY - cminY + 1;
    centerBboxFrac = (cbw * cbh) / total;
  }

  /** Decisión principal por centro; si hay poco dato en centro, usar bbox global. */
  const useCenter = centerBright >= 35;
  const metric = useCenter ? centerBboxFrac : bboxFrac;

  /**
   * Pequeña en encuadre (muy alejado): acercar (+). Grande: alejar (−).
   * Banda cómoda: no tocar si ya parece razonable (evita corregir una primera captura ya bien).
   */
  const MIN_BBOX_FRAC = 0.014;
  const MAX_BBOX_FRAC = 0.38;
  const COMFORT_LOW = 0.011;
  const COMFORT_HIGH = 0.44;
  const MIN_BRIGHT_FRAC = 0.00028;

  let deltaPlus = 0;

  if (metric >= COMFORT_LOW && metric <= COMFORT_HIGH && bright >= 45) {
    deltaPlus = 0;
  } else if (bright < 45) {
    deltaPlus = brightFrac < MIN_BRIGHT_FRAC ? 1 : 0;
  } else if (metric > 0 && metric < MIN_BBOX_FRAC) {
    deltaPlus = metric < MIN_BBOX_FRAC * 0.5 ? 2 : 1;
  } else if (metric > MAX_BBOX_FRAC) {
    deltaPlus = metric > MAX_BBOX_FRAC * 1.2 ? -2 : -1;
  }

  return {
    deltaPlus,
    debug: { bboxFrac, centerBboxFrac, brightFrac, w, h, useCenter },
  };
}
