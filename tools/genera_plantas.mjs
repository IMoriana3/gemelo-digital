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
     · "pendiente"    — venían del `LOCS` a mano de index.html, a 3 decimales
                        (~110 m) y sin procedencia declarada: pueden ser el
                        centroide del pueblo y no el de la planta. Es lo más
                        grueso de las tres, va la ÚLTIMA y etiquetada, y su sitio
                        definitivo es la cartera. PENDIENTE de confirmar.
     · null           — SIN COORDENADAS. La planta aparece en el desplegable pero
                        no se puede simular, y el desplegable dice por qué.

   Lo que NO se hace: inventar la coordenada del pueblo cuando falta la de la
   planta. Un número verosímil sobre el sitio equivocado es peor que un hueco,
   porque el hueco se ve.

   ## El emparejado cartera ↔ layout es EXPLÍCITO, y NO se escribe aquí

   La primera versión de este script emparejaba por nombre y número aproximados y
   colocó **Benante en las coordenadas de Panbianco** — dos plantas de Acciona a
   500 m, con números 25004 y 25004.2. Un emparejado difuso entre catálogos es
   exactamente cómo se simula la planta equivocada sin enterarse.

   La segunda lo escribió a mano aquí, y se comió una planta entera: `dicayagua`
   tiene layout, centroide y huso, no está en la cartera, y el mapa a mano
   simplemente no la nombraba. Un catálogo con una planta de menos se lee igual
   que uno completo — por eso no basta con que el emparejado sea explícito: tiene
   que ser COMPROBABLE. Hoy se pide a `cobertura-zigbee/plantas_indice.json`, que
   es quien lo publica, y cada layout del índice tiene que acabar en el catálogo
   o el generador muere.

   ## Tres cosas distintas que la gente confunde

     · la CARTERA      — los proyectos (`SEED`), tengan layout o no.
     · los LAYOUTS     — las plantas levantadas, tengan ficha o no.
     · este CATÁLOGO   — la unión, que es lo que el gemelo puede simular, con
                         `en_cartera:false` en las que están sólo en la segunda.

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

/* Coordenadas que NO están en la cartera ni en un layout, y que hasta ahora vivían
   en el `LOCS` a mano de index.html. Se traen aquí porque index.html pasa a CONSUMIR
   este catálogo: si siguiera siendo su fuente, el generador leería de quien lee del
   generador. Alguien tiene que tener el dato primero, y mientras la cartera no lo
   lleve, lo tiene esta tabla.

   OJO CON LA PRECISIÓN: 3 decimales (~110 m) y sin procedencia declarada — pueden
   ser el centroide del pueblo y no el de la planta. Sirven para el recurso solar;
   no para llamarlas «la planta». Va dicho en `fuente` y en el tooltip.

   SITIO PROVISIONAL: en cuanto estas tres tengan lat/lon en la cartera, esta tabla
   se borra y se toman de allí, que es donde deben vivir. */
const COORD_PENDIENTES = {
  24024: { lat: 41.85,  lon: -0.15   },   /* Alconadre · Huesca */
  25032: { lat: 41.254, lon: 16.351  },   /* Trani · Apulia */
  26009: { lat: 39.210, lon: -8.774  },   /* Valle de Moinhos */
};

/* Huso y horario de verano por PAÍS. No es una suposición: son los nueve
   emplazamientos que index.html tenía a mano, y en los nueve `tz` y `dst` quedan
   determinados por el país sin una sola excepción — comprobado antes de derivarlos.
   Y coinciden con la realidad: la UE aplica horario de verano; Túnez y Perú no. */
const HUSO = {
  'España':   { tz: 1,  dst: true  },
  'Italia':   { tz: 1,  dst: true  },
  'Portugal': { tz: 0,  dst: true  },
  'Túnez':    { tz: 1,  dst: false },
  'Perú':     { tz: -5, dst: false },
};

/* El emparejado layout ↔ cartera NO se escribe aquí: se PIDE.
   `cobertura-zigbee/plantas_indice.json` lo publica ya, generado por
   `tools/indice_plantas.mjs`, y se declara a sí mismo «la FUENTE del huso, del
   código de cartera y de las coordenadas: quien las necesite las pide de aquí en
   vez de guardar una copia».

   Aquí había un `LAYOUT_DE` a mano con esa misma equivalencia. Era la TERCERA
   copia (el índice, `proyectos/sim-solar.html` y ésta), escrita sin saber que la
   primera existía, y le faltaba una planta entera: `dicayagua`. Es exactamente el
   décimo corolario de la casa — la tarea salía de un hallazgo ya anotado en el
   repo, así que alguien la estaba haciendo. Gana la que ya existe.

   Lo que se gana además de no divergir: el índice trae el HUSO declarado por
   layout (`tz_fijo_min`), que es mejor dato que deducirlo del país — dicayagua
   está en UTC−4 y el país no sale en la cartera porque la planta tampoco. */
function leeIndiceLayouts() {
  const f = join(COBERTURA, 'plantas_indice.json');
  if (!existsSync(f)) {
    console.error(`no encuentro ${f} — pasa --cobertura <clon-de-cobertura-zigbee>.\n`
      + 'Ese índice es la fuente del emparejado layout↔cartera: sin él no se adivina.');
    process.exit(2);
  }
  const d = JSON.parse(readFileSync(f, 'utf8'));
  if (!Array.isArray(d.plantas) || !d.plantas.length) {
    console.error('plantas_indice.json no trae plantas: un índice vacío no es un índice');
    process.exit(2);
  }
  return d.plantas;
}

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
  return (d && d.clat != null && d.clon != null)
       ? { lat: d.clat, lon: d.clon, titulo: d.title || null, estado: d.estado || null }
       : null;
}

/* Huso: manda el layout, y sólo si calla se deduce del país.
   El índice publica `tz_fijo_min` en MINUTOS cuando el layout declara un huso fijo
   sin cambio de hora (Túnez 60, San José −300, Dicayagua −240); ahí `dst` es
   false POR EL DATO, no por la tabla. Cuando no lo declara, la planta sigue la
   regla peninsular y vale la tabla por país. */
function huso(ent, pais) {
  if (ent && ent.tz_fijo_min != null) return { tz: ent.tz_fijo_min / 60, dst: false };
  const h = HUSO[pais];
  return { tz: h ? h.tz : null, dst: h ? h.dst : null };
}

const { seed, nproy } = leeCartera();
const INDICE = leeIndiceLayouts();
/* nº de cartera → entrada del índice. Las que el índice deja con `codigo: null`
   no tienen proyecto en la cartera y se tratan abajo, aparte. */
const PorCodigo = {};
for (const e of INDICE) if (e.codigo != null) PorCodigo[String(e.codigo)] = e;
const reclamados = new Set();

const plantas = seed.map(p => {
  const num = p.num;
  /* PRECEDENCIA: el layout ANTES que la cartera, porque es el dato más fino — el
     centroide sale de las posiciones reales de los seguidores y la cartera es una
     transcripción a 5 decimales. Medido sobre las cinco plantas que están en las
     dos fuentes: coinciden a <= 1 m en cuatro (El Burgo, Fayón, San José y Ayora,
     0-1 m) y difieren 58 m en Túnez. O sea que la elección casi no mueve nada —
     lo que importa es que la regla sea la que está escrita y no la contraria. */
  let lat = null, lon = null, fuente = null;
  const ent = PorCodigo[String(num)];                     /* emparejado del índice */
  const nom = ent ? ent.planta : null;
  if (nom) reclamados.add(nom);
  /* Las coordenadas se leen del LAYOUT, no del índice: el índice las publica a 6
     decimales y el layout las trae enteras. Que el emparejado venga del índice no
     obliga a bajar la precisión del dato. */
  const c = nom ? leeLayout(nom) : null;
  if (c) { lat = c.lat; lon = c.lon; fuente = `layout:${nom}`; }
  else if (p.lat != null && p.lon != null) { lat = p.lat; lon = p.lon; fuente = 'cartera'; }
  else {
    const g = COORD_PENDIENTES[num] ?? COORD_PENDIENTES[String(num)];
    if (g) { lat = g.lat; lon = g.lon; fuente = 'pendiente'; }
  }
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
    lat: lat ?? null, lon: lon ?? null, fuente, en_cartera: true,
    /* Huso y DST. Manda el que el LAYOUT declara (el índice lo publica en
       `tz_fijo_min`), y sólo si no lo hay se deduce del país. Un huso declarado
       en el dato de la planta gana a una regla de país, siempre. `null` cuando no
       hay ni lo uno ni lo otro: quien consuma cae a su propio defecto
       (index.html usa round(lon/15)) en vez de recibir un huso inventado. */
    ...huso(ent, p.pais),
    homonimo_de: null,      /* se rellena abajo, por dato */
  };
});

/* PLANTAS CON LAYOUT QUE LA CARTERA NO TIENE.
   `dicayagua` (El Naranjo Dicayagua, República Dominicana, estado «oferta») tiene
   layout, centroide y huso, y no figura en el SEED. Antes se quedaba fuera con un
   comentario que decía «esto es la cartera, no todo lo que tiene layout» — cierto
   como principio y equivocado como resultado: al gemelo se le pide un SITIO QUE
   SIMULAR, y un sitio con layout real es simulable lo diga la hoja o no. Salen
   marcadas (`en_cartera:false`) para que nadie las cuente como proyecto. */
for (const e of INDICE) {
  if (e.codigo != null || reclamados.has(e.planta)) continue;
  const c = leeLayout(e.planta);
  if (!c) continue;
  const nombre = c.titulo || e.planta;
  plantas.push({
    /* Sin `num`: no tiene número de proyecto porque no es un proyecto. Poner un
       «—» de relleno lo haría parecer un número que falta. */
    num: null, num_cartera: null,
    proyecto: nombre,
    emplazamiento: null, provincia: null, pais: null,
    estado_pem: c.estado || null, alim_tcu: null, bateria_tcu: null,
    trk_total: e.unidades ?? null,
    lat: c.lat, lon: c.lon, fuente: `layout:${e.planta}`,
    ...huso(e, null),
    homonimo_de: null,
    en_cartera: false,
    nota: e.codigo_nota || 'tiene layout pero no figura en la cartera',
  });
}

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

/* COBERTURA DEL ÍNDICE: ningún layout se queda fuera CALLANDO.
   La versión anterior emparejaba con un mapa a mano, así que una planta con
   layout que nadie reclamara simplemente no salía — y así es como `dicayagua`
   llevaba fuera del desplegable desde el principio. Ahora cada entrada del índice
   tiene que acabar en el catálogo, reclamada por un proyecto o emitida aparte, y
   si alguna no lo hace el generador MUERE en vez de publicar una lista corta. Un
   catálogo al que le falta una planta se lee exactamente igual que uno completo. */
const emitidos = new Set(plantas.filter(p => p.fuente && p.fuente.startsWith('layout:'))
                                .map(p => p.fuente.slice(7)));
const huerfanos = INDICE.filter(e => !emitidos.has(e.planta));
if (huerfanos.length) {
  console.error('Hay layouts que no han llegado al catálogo:\n  - '
    + huerfanos.map(e => `${e.planta} (código ${e.codigo ?? 'ninguno'})`).join('\n  - ')
    + '\n\nO les falta el *_layout.json en el clon de cobertura-zigbee, o el índice'
    + '\ncambió de forma. No se publica una lista corta: mira el diff.');
  process.exit(2);
}

const con = plantas.filter(p => p.fuente).length;
const salida = {
  _que_es: 'Cartera de proyectos con coordenadas. GENERADO por tools/genera_plantas.mjs '
         + 'desde proyectos/cartera-tabla.html (SEED) y los *_layout.json de '
         + 'cobertura-zigbee. NO editar a mano: se rellena lat/lon EN LA CARTERA y se '
         + 'regenera.',
  _fuentes: {
    cartera: 'proyectos/cartera-tabla.html · const SEED',
    emparejado: 'cobertura-zigbee/plantas_indice.json · código de cartera y huso por layout',
    layouts: 'cobertura-zigbee/<planta>_layout.json · clat/clon (centroide real)',
  },
  n_total: plantas.length,
  n_con_coordenadas: con,
  n_sin_coordenadas: plantas.length - con,
  n_homonimos: plantas.filter(p => p.homonimo_de).length,
  n_fuera_de_cartera: plantas.filter(p => p.en_cartera === false).length,
  plantas,
};

/* EL RÓTULO TAMBIÉN LO PRODUCE EL CATÁLOGO.
   `bateria.html` tenía su `_rotulo` a mano y al enchufar `index.html` estuve a
   punto de escribir el segundo — con el aviso de homónimo perdido por el
   camino, que es exactamente el fallo que ese aviso existe para evitar. Dos
   páginas rotulando la misma planta de dos maneras es la misma enfermedad que
   las dos listas de emplazamientos, un escalón más abajo. Viaja aquí, con los
   datos que lo alimentan. */
const ROTULO = `
  /* Rótulo canónico de una planta. Lo consumen index.html y bateria.html; no se
     escribe a mano en ninguna de las dos. */
  CARTERA.PAIS_ISO = {'España':'ES','Italia':'IT','Portugal':'PT','Perú':'PE','Túnez':'TN'};
  CARTERA.rotulo = function (p) {
    var partes = [], vistos = {};
    /* «Zaragoza, Zaragoza» no, y tampoco «El polvorin + Higueras (El polvorin +
       Higueras)»: se descarta lo que ya dice el nombre del proyecto. */
    var proy = (p.proyecto || '').toLowerCase();
    [p.emplazamiento, p.provincia].forEach(function (x) {
      if (!x || vistos[x]) return;
      if (proy.indexOf(x.toLowerCase()) >= 0) return;
      vistos[x] = 1; partes.push(x);
    });
    var iso = CARTERA.PAIS_ISO[p.pais] || p.pais || '';
    var donde = partes.concat(iso ? [iso] : []).join(', ');
    /* Dos proyectos con el mismo nombre son dos PLANTAS: la cartera tiene dos
       «Túnez», el 24021 y el 26322. Se dice en el rótulo para que nadie los lea
       como duplicado y simule uno creyendo que es el otro. */
    var aviso = p.homonimo_de && p.homonimo_de.length
              ? ' — otro proyecto, no es el ' + p.homonimo_de.join(' ni el ') : '';
    /* Las que tienen layout pero no ficha en la cartera no llevan número, y se
       dice por qué: si no, parecen un proyecto al que se le ha perdido el suyo. */
    if (p.en_cartera === false) {
      return p.proyecto + (donde ? ' (' + donde + ')' : '')
           + ' — con layout, sin ficha en la cartera'
           + (p.estado_pem ? ' (' + p.estado_pem + ')' : '');
    }
    return p.num + ' · ' + p.proyecto + (donde ? ' (' + donde + ')' : '') + aviso;
  };
`;

const CUERPO = '/* GENERADO por tools/genera_plantas.mjs — NO editar a mano.\n'
  + '   Se rellena lat/lon EN LA CARTERA (proyectos/cartera-tabla.html) y se regenera. */\n'
  + '(function (raiz) {\n  var CARTERA = '
  + JSON.stringify(salida, null, 1).split('\n').join('\n  ')
  + ';\n' + ROTULO
  + '  if (typeof window !== "undefined") window.CARTERA = CARTERA;\n'
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
for (const p of plantas.filter(x => x.en_cartera === false))
  console.log(`   FUERA DE CARTERA   ${p.proyecto} — ${p.nota}`);
for (const p of plantas.filter(x => x.homonimo_de))
  console.log(`   HOMÓNIMO         ${p.num.padStart(8)}  ${p.proyecto} — comparte nombre con ${p.homonimo_de.join(', ')}`);
for (const p of plantas.filter(x => !x.fuente))
  console.log(`   SIN COORDENADAS  ${p.num.padStart(8)}  ${p.proyecto}${p.emplazamiento ? ' · ' + p.emplazamiento : ''}`);
