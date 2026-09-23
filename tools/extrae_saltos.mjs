#!/usr/bin/env node
/* ============================================================================
   extrae_saltos.mjs — LOS SALTOS DE VERDAD, del hermano cobertura-zigbee.

   El poleo «varía según posición de los seguidores»: lo que tarda cada equipo en que
   le toque depende de su PROFUNDIDAD EN LA MALLA, no de su número. Con los saltos
   medidos, `sim/planta.js` ordena la vuelta por ellos.

   La fuente es `zigbee_routes.csv` del repo cobertura-zigbee —lo escribe
   `zigbee_routes_logger.ps1` por telnet contra el gateway Digi— y su contrato está en
   `docs/contrato_datos_zigbee.md`:

       hop_count   entero   saltos = nodos − 1. Vacío si ok=0

   ── LO QUE ESTE EXTRACTOR NO HACE ──

   · NO usa el RSSI. Lo prohíbe el propio README del hermano: «El RSSI no es el mapa de
     cobertura: es el nivel del último salto al vecino, no la distancia al coordinador».
     Un orden sacado del RSSI parecería medido y no lo sería.
   · NO usa los `barrido_*.csv` de `cobertura_coords/`: son el PLAN del barrido, con
     `llega` y `rssi_medido_dbm` vacíos. Son enlaces previstos, no medidos.
   · NO rellena los que falten. Si un equipo del censo no tiene ruta, se dice y se
     escribe igual; quien manda es `planta.js`, que solo ordena por saltos si los tiene
     TODOS — con la mitad mezclaría dos criterios y lo parecería uno.

       node tools/extrae_saltos.mjs --rutas <zigbee_routes.csv> --planta <clave> [--sal <dir>]

   Varias vueltas del recolector dan varias filas por nodo. Se toma la MODA de
   `hop_count` por nodo, no la última: la malla se reorganiza y la última captura puede
   ser un transitorio. Y se dice cuánta dispersión había.
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const RUTAS = arg('rutas');
const PLANTA = arg('planta');
const SAL = arg('sal', path.join(path.dirname(new URL('.', import.meta.url).pathname), 'sim', 'saltos'));

if (!RUTAS || !PLANTA) {
  console.error('uso: node tools/extrae_saltos.mjs --rutas <zigbee_routes.csv> --planta <clave>');
  process.exit(2);
}
if (!fs.existsSync(RUTAS)) { console.error('no encuentro ' + RUTAS); process.exit(2); }

/* ── el CSV, por NOMBRE de columna ────────────────────────────────────────────
   El contrato declara diez columnas y el generador de demo del visor escribe seis.
   Buscar por nombre en vez de por posición es lo que hace que las dos valgan, y que
   si alguien añade una columna esto no empiece a leer otra cosa en silencio. */
const bruto = fs.readFileSync(RUTAS, 'utf8').trim();
const sep = (bruto.split('\n')[0].match(/;/g) || []).length >
            (bruto.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
const celdas = (l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
const filas = bruto.split(/\r?\n/).filter((l) => l.trim());
const cab = celdas(filas[0]).map((c) => c.toLowerCase());
const col = (...nombres) => {
  for (const n of nombres) { const i = cab.indexOf(n); if (i >= 0) return i; }
  return -1;
};
const cEsquema = col('schema_version');
const cNodo = col('target_ext', 'target');
const cSaltos = col('hop_count');
const cOk = col('ok');

if (cNodo < 0 || cSaltos < 0) {
  console.error('ese CSV no tiene las columnas del contrato: hacen falta `hop_count` y ' +
                '`target_ext` (o `target`). Tiene: ' + cab.join(', '));
  process.exit(1);
}

const porNodo = new Map();
let sinRuta = 0, esquemaRaro = new Set();
for (let i = 1; i < filas.length; i++) {
  const f = celdas(filas[i]);
  if (cEsquema >= 0 && f[cEsquema] && f[cEsquema] !== '2') esquemaRaro.add(f[cEsquema]);
  const nodo = f[cNodo];
  if (!nodo) continue;
  if (cOk >= 0 && f[cOk] === '0') { sinRuta++; continue; }
  const h = parseInt(f[cSaltos], 10);
  if (!isFinite(h) || h < 0) { sinRuta++; continue; }
  if (!porNodo.has(nodo)) porNodo.set(nodo, []);
  porNodo.get(nodo).push(h);
}

if (esquemaRaro.size) {
  console.error('schema_version inesperado (' + [...esquemaRaro].join(', ') +
                '): este extractor lee el 2 del contrato. No escribo nada.');
  process.exit(1);
}
if (!porNodo.size) { console.error('ninguna fila con ruta válida'); process.exit(1); }

/* la MODA por nodo, y cuánta dispersión hubo */
const moda = (a) => {
  const c = new Map();
  for (const v of a) c.set(v, (c.get(v) || 0) + 1);
  return [...c.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0][0];
};
const salida = {};
let inestables = 0;
for (const [nodo, hs] of porNodo) {
  salida[nodo] = moda(hs);
  if (new Set(hs).size > 1) inestables++;
}

const hist = new Map();
for (const h of Object.values(salida)) hist.set(h, (hist.get(h) || 0) + 1);

fs.mkdirSync(SAL, { recursive: true });
const destino = path.join(SAL, PLANTA + '.json');
fs.writeFileSync(destino, JSON.stringify({
  planta: PLANTA,
  fuente: path.basename(RUTAS),
  generado: new Date().toISOString().slice(0, 10),
  nota: 'hop_count de zigbee_routes.csv (contrato v2), moda por nodo. NO es RSSI.',
  saltos: salida
}, null, 1) + '\n');

console.log('saltos de ' + PLANTA + ': ' + Object.keys(salida).length + ' nodos con ruta' +
            (sinRuta ? ', ' + sinRuta + ' lecturas sin ruta descartadas' : ''));
console.log('  reparto: ' + [...hist.entries()].sort((a, b) => a[0] - b[0])
  .map(([h, n]) => h + ' saltos: ' + n).join(' · '));
if (inestables) {
  console.log('  ⚠ ' + inestables + ' nodos cambiaron de profundidad entre vueltas: se toma la ' +
              'moda, pero esa malla se está reorganizando');
}
console.log('  → ' + destino);
