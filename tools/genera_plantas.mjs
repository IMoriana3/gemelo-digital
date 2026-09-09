#!/usr/bin/env node
/* Genera `sim/cartera.js`: la CARTERA DE PROYECTOS con sus coordenadas.

   ## Por qué se genera y no se escribe

   El desplegable de emplazamientos de `bateria.html` llevaba diez sitios a mano.
   La cartera real vive en `proyectos/cartera-tabla.html` (constante `SEED`) y las
   coordenadas finas de cada planta en los `*_layout.json` de `cobertura-zigbee`.
   Tres listas a mano son tres listas que divergen — la enfermedad que este repo
   lleva toda la semana curando. Así que la lista se DERIVA de las dos fuentes.

   ## Cada planta viaja con la PROCEDENCIA de sus coordenadas

   No es cosmética: son datos de precisión distinta y quien simule tiene derecho
   a saberlo.

     · "layout:<x>"   — centroide del layout real de cobertura-zigbee. Es el que
                        MANDA cuando existe: sale de las posiciones reales de los
                        seguidores, mientras que la cartera es una transcripción.
     · "cartera"      — lat/lon rellenados en la cartera. Respaldo.
     · null           — SIN COORDENADAS. La planta aparece en el desplegable pero
                        no se puede simular, y el desplegable dice por qué.

   Lo que NO se hace: inventar la coordenada del pueblo cuando falta la de la
   planta. Un número verosímil sobre el sitio equivocado es peor que un hueco,
   porque el hueco se ve.

   ## El emparejado cartera ↔ layout es EXPLÍCITO

   La primera versión de este script emparejaba por nombre y número aproximados y
   colocó **Benante en las coordenadas de Panbianco** — dos plantas de Acciona a
   500 m, con números 25004 y 25004.2. Un emparejado difuso entre catálogos es
   exactamente cómo se simula la planta equivocada sin enterarse.

       node tools/genera_plantas.mjs --desde <clon-de-proyectos> [--check]
*/
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const idx = args.indexOf('--desde');
const PROYECTOS = idx >= 0 ? args[idx + 1] : '/home/user/proyectos';
const COBERTURA = (() => { const i = args.indexOf('--cobertura');
  return i >= 0 ? args[i + 1] : '/home/user/cobertura-zigbee'; })();
const CHECK = args.includes('--check');
/* .js y no .json: la ficha se abre también por file://, donde un fetch de JSON
   falla por CORS. Un <script src> sí carga — es el mismo motivo por el que
   viento.js y fisica.js son scripts y no datos.

   Y `cartera.js`, NO `plantas.js`: ese nombre ya lo tiene el PLANO —
   `PLANTAS_REALES`, las posiciones de cada seguidor sacadas de los layouts del
   DWG, que genera tools/extrae_plantas.mjs—. Son dos cosas de alcance distinto y
   compartían nombre por accidente: el plano tiene las 11 plantas con layout; la
   cartera, los 22 PROYECTOS, tengan layout o no. Se cruzan por el número de
   proyecto, no se sustituyen. */
const DESTINO = join(RAIZ, 'sim/cartera.js');

/* Mapa nº-de-proyecto → fichero de layout. EXPLÍCITO a propósito: ver cabecera. */
const LAYOUT_DE = {
  24002: 'elburgo',
  24007: 'fayon',
  24019: 'sanjose',
  24021: 'tunez',
  24025: 'ayora',
  24030: 'bagnarelli',
  25019: 'paramo',
  25082: 'polvorin',
  25004: 'benante',
  '25004.2': 'panbianco',
  /* dicayagua tiene layout pero NO está en la cartera (estado «oferta»): no se
     cuela aquí, porque esto es la cartera y no «todo lo que tiene layout». */
};

function leeCartera() {
  const f = join(PROYECTOS, 'cartera-tabla.html');
  if (!existsSync(f)) { console.error(`no encuentro ${f} — pasa --desde <clon-de-proyectos>`); process.exit(2); }
  const s = readFileSync(f, 'utf8');
  const m = s.match(/const SEED = (\[[\s\S]*?\]);/);
  if (!m) { console.error('cartera-tabla.html ya no declara `const SEED = [...]`: mira el diff antes de tocar este script'); process.exit(2); }
  /* El número de la HOJA no siempre es el número con el que se ROTULA la planta.
     El Burgo es 24002 en la cartera y 23003 en el DWG y en el Excel de siting, y
     está decidido (2026-08-13) que se rotula el 23003. La equivalencia es canónica
     y vive AQUÍ MISMO, en `const NPROY` — se lee, no se copia: una segunda tabla
     de equivalencias es una segunda tabla que se queda atrás. */
  const n = s.match(/const NPROY\s*=\s*(\{[^}]*\});/);
  if (!n) { console.error('cartera-tabla.html ya no declara `const NPROY = {...}`: sin él no sé con qué número se rotula cada planta'); process.exit(2); }
  return { seed: JSON.parse(m[1]), nproy: JSON.parse(n[1].replace(/'/g, '"')) };
}

function leeLayout(nombre) {
  const f = join(COBERTURA, `${nombre}_layout.json`);
  if (!existsSync(f)) return null;
  const d = JSON.parse(readFileSync(f, 'utf8'));
  return (d && d.clat != null && d.clon != null) ? { lat: d.clat, lon: d.clon } : null;
}

const { seed, nproy } = leeCartera();
const plantas = seed.map(p => {
  const num = p.num;
  /* PRECEDENCIA: el layout ANTES que la cartera, porque es el dato más fino — el
     centroide sale de las posiciones reales de los seguidores y la cartera es una
     transcripción a 5 decimales. Medido sobre las cinco plantas que están en las
     dos fuentes: coinciden a <= 1 m en cuatro (El Burgo, Fayón, San José y Ayora,
     0-1 m) y difieren 58 m en Túnez. O sea que la elección casi no mueve nada —
     lo que importa es que la regla sea la que está escrita y no la contraria. */
  let lat = null, lon = null, fuente = null;
  const nom = LAYOUT_DE[num] ?? LAYOUT_DE[String(num)];   /* mapa por nº de HOJA */
  const c = nom ? leeLayout(nom) : null;
  if (c) { lat = c.lat; lon = c.lon; fuente = `layout:${nom}`; }
  else if (p.lat != null && p.lon != null) { lat = p.lat; lon = p.lon; fuente = 'cartera'; }
  const rotulo = nproy[String(num)] || String(num);
  return {
    /* `num` es con el que se ROTULA; `num_cartera` la clave de la hoja. Los dos
       viajan: quien busque por uno u otro lo encuentra, y nadie tiene que saberse
       la equivalencia de memoria. */
    num: rotulo, num_cartera: String(num),
    proyecto: String(p.proyecto || '').trim(),
    emplazamiento: p.emplazamiento || null, provincia: p.provincia || null,
    pais: p.pais || null, estado_pem: p.estado_pem || null,
    alim_tcu: p.alim_tcu || null, bateria_tcu: p.bateria_tcu || null,
    trk_total: p.trk_total ?? null,
    lat: lat ?? null, lon: lon ?? null, fuente,
    homonimo_de: null,      /* se rellena abajo, por dato */
  };
});

/* HOMÓNIMOS. La cartera tiene dos proyectos llamados «Túnez» — el 24021 (El
   Hamma, Gabes, en marcha) y el 26322 — y son PLANTAS DISTINTAS. Un desplegable
   con dos entradas del mismo nombre invita a leerlas como duplicado, y de ahí a
   simular una creyendo que es la otra hay un paso.

   Se detecta por dato, no con una lista a mano: si mañana entra otro par de
   homónimos queda marcado solo. Y que compartan nombre NO les mezcla las
   coordenadas: cada una toma las suyas por su número, o se queda sin ellas. */
const porNombre = {};
for (const p of plantas) {
  const k = p.proyecto.toLowerCase().trim();
  (porNombre[k] = porNombre[k] || []).push(p);
}
for (const grupo of Object.values(porNombre)) {
  if (grupo.length < 2) continue;
  for (const p of grupo) p.homonimo_de = grupo.filter(q => q !== p).map(q => q.num);
}

const con = plantas.filter(p => p.fuente).length;
const salida = {
  _que_es: 'Cartera de proyectos con coordenadas. GENERADO por tools/genera_plantas.mjs '
         + 'desde proyectos/cartera-tabla.html (SEED) y los *_layout.json de '
         + 'cobertura-zigbee. NO editar a mano: se rellena lat/lon EN LA CARTERA y se '
         + 'regenera.',
  _fuentes: {
    cartera: 'proyectos/cartera-tabla.html · const SEED',
    layouts: 'cobertura-zigbee/<planta>_layout.json · clat/clon (centroide real)',
  },
  n_total: plantas.length,
  n_con_coordenadas: con,
  n_sin_coordenadas: plantas.length - con,
  n_homonimos: plantas.filter(p => p.homonimo_de).length,
  plantas,
};

const CUERPO = '/* GENERADO por tools/genera_plantas.mjs — NO editar a mano.\n'
  + '   Se rellena lat/lon EN LA CARTERA (proyectos/cartera-tabla.html) y se regenera. */\n'
  + '(function (raiz) {\n  var CARTERA = '
  + JSON.stringify(salida, null, 1).split('\n').join('\n  ')
  + ';\n  if (typeof window !== "undefined") window.CARTERA = CARTERA;\n'
  + '  if (typeof module !== "undefined") module.exports = CARTERA;\n})(this);\n';

if (CHECK) {
  if (!existsSync(DESTINO)) { console.error('no hay sim/cartera.js — corre sin --check'); process.exit(1); }
  if (readFileSync(DESTINO, 'utf8') === CUERPO) {
    console.log(`OK — sim/cartera.js al día (${con}/${plantas.length} con coordenadas)`); process.exit(0);
  }
  console.error('MAL — sim/cartera.js no coincide con la cartera. Regenera:');
  console.error('  node tools/genera_plantas.mjs --desde <clon-de-proyectos>');
  process.exit(1);
}

writeFileSync(DESTINO, CUERPO);
console.log(`sim/cartera.js · ${plantas.length} proyectos · ${con} con coordenadas · ${plantas.length - con} sin`);
for (const p of plantas.filter(x => x.homonimo_de))
  console.log(`   HOMÓNIMO         ${p.num.padStart(8)}  ${p.proyecto} — comparte nombre con ${p.homonimo_de.join(', ')}`);
for (const p of plantas.filter(x => !x.fuente))
  console.log(`   SIN COORDENADAS  ${p.num.padStart(8)}  ${p.proyecto}${p.emplazamiento ? ' · ' + p.emplazamiento : ''}`);
