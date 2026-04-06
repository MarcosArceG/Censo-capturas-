/**
 * Recortes en viewport 1280×800 (calibrados con click-probe).
 * CLIP_MAP_PREFERRED: zona útil del mapa (sin tanto borde).
 */

/** Rectángulo completo aproximado del mapa (esquinas #13–#14). */
export const CLIP_MAP_FULL = { x: 52, y: 0, width: 733, height: 378 };

/** Recorte interior deseado (#15–#18). */
export const CLIP_MAP_PREFERRED = { x: 138, y: 91, width: 561, height: 250 };

/**
 * Controles nativos Google Maps (viewport 1280×800, probe inicial).
 * Secuencia: **abrir** panel → N veces **+** (parcela sigue centrada) → **cerrar**.
 */
export const MAP_ZOOM_UI = {
  open: { x: 761, y: 277 },
  plus: { x: 706, y: 227 },
  /** Aprox. botón − bajo el + (Google Maps); calibrar con probe si el zoom auto aleja mal. */
  minus: { x: 706, y: 252 },
  close: { x: 761, y: 280 },
};
