/**
 * KML de ubicaciones para Google Maps (My Maps) a partir de los puntos que el censo
 * ya trae en cada fila (`item.gps`). Se escribe dentro de la carpeta de salida, así que
 * viaja en el ZIP tanto desde la app de escritorio como desde el servidor web.
 *
 * El censo posiciona por **parcela**, no por inmueble: varias referencias del listado
 * pueden caer en el mismo punto. Se agrupan en una sola chincheta que las lista.
 */

/** Colores del icono según peligrosidad del censo (`dl`). KML usa aabbggrr, no rrggbb. */
const ESTILOS = [
  { id: "gda-alta", min: 7, color: "ff2222dd", etiqueta: "Peligrosidad alta" },
  { id: "gda-media", min: 4, color: "ff22aaff", etiqueta: "Peligrosidad media" },
  { id: "gda-baja", min: 0, color: "ff44cc44", etiqueta: "Peligrosidad baja" },
];

function estiloPara(dl) {
  const n = Number(dl);
  const v = Number.isFinite(n) ? n : 0;
  return ESTILOS.find((e) => v >= e.min) ?? ESTILOS[ESTILOS.length - 1];
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function filaHtml(etiqueta, valor) {
  const v = String(valor ?? "").trim();
  if (!v) return "";
  return `<p><b>${esc(etiqueta)}:</b> ${esc(v)}</p>`;
}

/**
 * @param {Array<{ref: string, gps?: {lat:number,lng:number}|null, censo?: object|null}>} items
 * @param {string} titulo
 * @returns {string|null} KML, o null si ningún item tiene punto.
 */
export function buildUbicacionesKml(items, titulo) {
  /** Agrupa por coordenada redondeada: es lo que de verdad distingue una chincheta de otra. */
  const grupos = new Map();

  for (const it of items || []) {
    const gps = it?.gps;
    if (!gps || !Number.isFinite(gps.lat) || !Number.isFinite(gps.lng)) continue;
    const clave = `${gps.lat.toFixed(7)},${gps.lng.toFixed(7)}`;
    if (!grupos.has(clave)) {
      grupos.set(clave, { gps, refs: [], censo: it.censo ?? null });
    }
    const g = grupos.get(clave);
    if (!g.refs.includes(it.ref)) g.refs.push(it.ref);
    if (!g.censo && it.censo) g.censo = it.censo;
  }

  if (grupos.size === 0) return null;

  const partes = [];
  partes.push('<?xml version="1.0" encoding="UTF-8"?>');
  partes.push('<kml xmlns="http://www.opengis.net/kml/2.2">');
  partes.push("<Document>");
  partes.push(`<name>${esc(titulo)}</name>`);

  for (const e of ESTILOS) {
    partes.push(
      `<Style id="${e.id}"><IconStyle><color>${e.color}</color>` +
        "<Icon><href>https://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon>" +
        "</IconStyle></Style>",
    );
  }

  for (const g of grupos.values()) {
    const c = g.censo ?? {};
    const nombre = String(c.name ?? "").trim() || g.refs[0];
    const titulo2 = g.refs.length > 1 ? `${nombre} (${g.refs.length} inmuebles)` : nombre;

    const desc =
      filaHtml(g.refs.length > 1 ? "Referencias" : "Referencia", g.refs.join(", ")) +
      filaHtml("Dirección", c.address) +
      filaHtml("Uso", c.usage) +
      filaHtml("Titularidad", c.owenerLabel) +
      filaHtml("Año construcción", c.buildYear && c.buildYear !== 0 ? c.buildYear : "") +
      filaHtml("Peligrosidad", c.dl);

    partes.push("<Placemark>");
    partes.push(`<name>${esc(titulo2)}</name>`);
    if (desc) partes.push(`<description><![CDATA[${desc}]]></description>`);
    partes.push(`<styleUrl>#${estiloPara(c.dl).id}</styleUrl>`);
    /** KML va en longitud,latitud — al revés que Google Maps. */
    partes.push(`<Point><coordinates>${g.gps.lng},${g.gps.lat}</coordinates></Point>`);
    partes.push("</Placemark>");
  }

  partes.push("</Document>");
  partes.push("</kml>");
  return partes.join("\n");
}
