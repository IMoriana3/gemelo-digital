#!/usr/bin/env node
/* Genera `sim/cartera.js`: la CARTERA DE PROYECTOS con sus coordenadas.

   ## Por qué se genera y no se escribe

   El desplegable de emplazamientos de `bateria.html` llevaba diez sitios a mano.
   La cartera real vive en `imoriana3/factiun-cartera` —Supabase, con login— y las
   coordenadas finas de cada planta en los `*_layout.json` de `cobertura-zigbee`.
   Tres listas a mano son tres listas que divergen — la enfermedad que este repo
   lleva toda la semana curando. Así que la lista se DERIVA de las dos fuentes.

   ## Y la cartera de la que se deriva estuvo un tiempo siendo la equivocada

   Hasta 2026-09-09 esto leía el `SEED` de `proyectos/cartera-tabla.html`. Parecía
   la cartera —se llama así, tiene los mismos campos— y era otra cosa: una foto
   sembrada de un Excel, editable en el navegador de cada uno. Llevaba **nueve
   plantas de retraso** (Conselice, Minervino, Monsano, Ilio III, Agraval, SAP
   Belcastro, Tuva y dos de los tres emplazamientos de Alconadre) y dieciséis
   coordenadas menos.

   Lo caro no fue el retraso, fue que no se veía: un catálogo de 22 plantas se lee
   exactamente igual que uno de 31 si no sabes cuántas debería haber. Se descubrió
   porque el mantenedor echó en falta una planta por su nombre.

   De ahí la regla que gobierna este fichero: **de cada fuente se dice cuál es,
   dónde está y de cuándo es el dato**. La exportación lleva la fecha en el nombre
   y el catálogo la publica en `_fuentes`.

   ## Cada planta viaja con la PROCEDENCIA de sus coordenadas

   No es cosmética: son datos de precisión distinta y quien simule tiene derecho
   a saberlo.

     · "layout:<x>"   — centroide del layout real de cobertura-zigbee. Es el que
                        MANDA cuando existe: sale de las posiciones reales de los
                        seguidores, mientras que la cartera es una transcripción.
     · "cartera"      — lat/lon rellenados en la cartera viva. Respaldo, y el
                        único origen de las plantas que no tienen layout.
     · null           — SIN COORDENADAS. La planta aparece en el desplegable pero
                        no se puede simular, y el desplegable dice por qué.

   Hubo un cuarto valor, "pendiente": tres coordenadas a 3 decimales heredadas del
   `LOCS` a mano de index.html, sin procedencia declarada. Murió con la cartera
   viva, que trae las tres de verdad — y menos mal que iban etiquetadas: la de
   Alconadre estaba a **12,4 km** del emplazamiento real. Un número verosímil no
   se ve; una etiqueta que dice «esto es provisional», sí.

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

     · la CARTERA      — los proyectos de factiun-cartera, tengan layout o no.
     · los LAYOUTS     — las plantas levantadas, tengan ficha o no.
     · este CATÁLOGO   — la unión, que es lo que el gemelo puede simular, con
                         `en_cartera:false` en las que están sólo en la segunda.

       node tools/genera_plantas.mjs [--desde <clon-de-proyectos>]
                                     [--cobertura <clon-de-cobertura-zigbee>] [--check]
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
   cartera, los PROYECTOS, tengan layout o no. Se cruzan por el número de
   proyecto, no se sustituyen. */
const DESTINO = join(RAIZ, 'sim/cartera.js');

/* LA EXPORTACIÓN DE LA CARTERA VIVA.
   Hasta hoy este generador leía el `SEED` de `proyectos/cartera-tabla.html`, y
   estaba leyendo la cartera EQUIVOCADA. La viva es `imoriana3/factiun-cartera`:
   Supabase, con login, y es donde se dan de alta los proyectos. El SEED es otra
   cosa —una foto sembrada de un Excel, editable en el navegador— y llevaba nueve
   plantas de retraso: Conselice, Minervino, Monsano, Ilio III, Agraval, SAP
   Belcastro, Tuva y las dos Alconadre que faltaban no existían para el gemelo.

   La base pide login, así que lo que se versiona aquí es su EXPORTACIÓN — el
   `⬇ CSV` de la propia cartera, tal cual sale. Fecha en el nombre y a la vista:
   un catálogo derivado de una foto tiene que decir de cuándo es la foto.

   Para actualizar: ⬇ CSV en la cartera, se deja el fichero en `datos/` y se
   regenera. La constante de abajo es lo único que hay que tocar. */
const EXPORT_CARTERA = 'cartera_20260909.csv';

/* Campo → cabeceras que lo pueden traer. EXPLÍCITO y obligatorio: si la cartera
   renombra una columna y no está en su lista, esto MUERE nombrándola en vez de
   emitir el campo vacío. Un `emplazamiento` en blanco no se ve; un catálogo que
   no se genera, sí.

   Las alternativas NO son por si acaso: son dos versiones REALES del mismo
   export. Hasta factiun-cartera#198 las coordenadas salían con la clave cruda de
   la base —`lat` y `lng`, porque `LABELS` no las tenía— y desde entonces salen
   como «Latitud» y «Longitud». Los dos ficheros existen y los dos se tienen que
   poder leer: exigir solo el nuevo convertiría en basura el CSV que alguien
   bajó ayer. La lista se lee de izquierda a derecha y gana la primera que esté.

   Y aquí vive la traducción `lng`→`lon`, que son dos convenios vivos: el sitio de
   traducirlos es este mapa, no la cabeza de quien lea el fichero en seis meses. */
const COLUMNAS = {
  num: ['Nº'], proyecto: ['Proyecto'], emplazamiento: ['Emplazamiento'],
  provincia: ['Provincia/Estado'], pais: ['País'], estado_pem: ['Estado PEM'],
  alim_tcu: ['Alimentación TCUs'], bateria_tcu: ['Batería TCU'],
  trk_total: ['Total trackers'],
  lat: ['Latitud', 'lat'], lon: ['Longitud', 'lng'],
};

/* Huso y horario de verano por PAÍS, para las plantas sin layout. Los nueve
   emplazamientos que index.html tenía a mano quedaban determinados por el país
   sin una sola excepción, comprobado antes de derivarlos, y coinciden con la
   realidad: la UE aplica horario de verano; Túnez, Perú y la India no.

   La India entra con la cartera viva (Agraval y Tuva) y trae media hora: UTC+5:30.
   Por eso `tz` va en HORAS y no en un entero — con enteros, media India se
   simularía con media hora de error y nadie lo vería en la gráfica. */
const HUSO = {
  'España':   { tz: 1,   dst: true  },
  'Italia':   { tz: 1,   dst: true  },
  'Portugal': { tz: 0,   dst: true  },
  'Túnez':    { tz: 1,   dst: false },
  'Perú':     { tz: -5,  dst: false },
  'India':    { tz: 5.5, dst: false },
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

/* CSV con separador `;` y campos entrecomillados, que es lo que exporta la
   cartera. Se parsea entero en vez de partir por `;`: hay campos con saltos de
   línea dentro (la columna String de El Polvorín lleva seis) y un `split` los
   convertiría en filas fantasma. */
function filasCSV(t) {
  const filas = []; let f = [], c = '', comillas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (comillas) {
      if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++; } else comillas = false; }
      else c += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === ';') { f.push(c); c = ''; }
    else if (ch === '\n') { f.push(c); c = ''; filas.push(f); f = []; }
    else if (ch !== '\r') c += ch;
  }
  if (c !== '' || f.length) { f.push(c); filas.push(f); }
  return filas;
}

function leeCartera() {
  const f = join(RAIZ, 'datos', EXPORT_CARTERA);
  if (!existsSync(f)) {
    console.error(`no encuentro ${f}.\nBaja el CSV de la cartera (factiun-cartera, botón ⬇ CSV), `
      + 'déjalo en datos/ y apunta EXPORT_CARTERA a él.');
    process.exit(2);
  }
  const filas = filasCSV(readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
  const cab = filas[0] || [];
  /* Cada campo tiene que llegar por ALGUNA de sus cabeceras. Si por ninguna, el
     generador muere nombrando el campo y las alternativas que buscaba; sin esto
     saldría vacío en el catálogo y el hueco no se vería hasta que alguien echara
     en falta un dato. */
  const pos = {}, faltan = [];
  for (const [campo, nombres] of Object.entries(COLUMNAS)) {
    const i = nombres.map(n => cab.indexOf(n)).find(k => k >= 0);
    if (i === undefined) faltan.push(`${campo} (buscado como ${nombres.join(' o ')})`);
    else pos[campo] = i;
  }
  if (faltan.length) {
    console.error('la exportación de la cartera no trae estos campos:\n  - '
      + faltan.join('\n  - ')
      + '\n\nCabeceras que sí trae:\n  ' + cab.join(' · ')
      + '\n\nAñade el nombre nuevo a su lista en COLUMNAS; no se adivina.');
    process.exit(2);
  }
  const num = x => { const v = String(x || '').trim().replace(',', '.'); return v === '' ? null : Number(v); };
  const txt = x => { const v = String(x || '').trim(); return v === '' ? null : v; };

  const cartera = filas.slice(1).filter(r => r.some(v => v !== '')).map(r => ({
    num: txt(r[pos.num]), proyecto: txt(r[pos.proyecto]),
    emplazamiento: txt(r[pos.emplazamiento]), provincia: txt(r[pos.provincia]),
    pais: txt(r[pos.pais]), estado_pem: txt(r[pos.estado_pem]),
    alim_tcu: txt(r[pos.alim_tcu]), bateria_tcu: txt(r[pos.bateria_tcu]),
    trk_total: num(r[pos.trk_total]),
    lat: num(r[pos.lat]), lon: num(r[pos.lon]),
  }));
  if (!cartera.length) { console.error('la exportación no trae ninguna planta'); process.exit(2); }

  /* El número de la HOJA no siempre es el número con el que se ROTULA la planta.
     El Burgo es 24002 en la cartera y 23003 en el DWG y en el Excel de siting, y
     está decidido (2026-08-13) que se rotula el 23003. La equivalencia es canónica
     y vive en `proyectos/cartera-tabla.html`, en `const NPROY` — se lee, no se
     copia: una segunda tabla de equivalencias es una segunda tabla que se queda
     atrás. Es lo ÚNICO que se sigue leyendo de ahí. */
  const g = join(PROYECTOS, 'cartera-tabla.html');
  if (!existsSync(g)) { console.error(`no encuentro ${g} — pasa --desde <clon-de-proyectos>`); process.exit(2); }
  const n = readFileSync(g, 'utf8').match(/const NPROY\s*=\s*(\{[^}]*\});/);
  if (!n) { console.error('cartera-tabla.html ya no declara `const NPROY = {...}`: sin él no sé con qué número se rotula cada planta'); process.exit(2); }
  return { cartera, nproy: JSON.parse(n[1].replace(/'/g, '"')) };
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

const { cartera, nproy } = leeCartera();
const INDICE = leeIndiceLayouts();
/* nº de cartera → entrada del índice. Las que el índice deja con `codigo: null`
   no tienen proyecto en la cartera y se tratan abajo, aparte. */
const PorCodigo = {};
for (const e of INDICE) if (e.codigo != null) PorCodigo[String(e.codigo)] = e;
const reclamados = new Set();

const plantas = cartera.map(p => {
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
/* UN LAYOUT, UNA PLANTA. La cartera viva repite número: `24024` son TRES
   emplazamientos de Alconadre (Sodeto, San Miguel y Peralta de Alcofea), y el
   emparejado va por número. Hoy ese número no tiene layout y no pasa nada; el día
   que lo tenga, las tres se llevarían el MISMO centroide y saldrían las tres
   plantadas en el mismo sitio.
   Es exactamente el fallo de Benante y Panbianco —dos plantas a 500 m con las
   coordenadas de una sola— que ya se pagó una vez aquí. Que no haya que verlo dos
   veces: si un layout lo reclama más de una fila, esto muere. */
const porLayout = {};
for (const p of plantas) {
  if (!p.fuente || !p.fuente.startsWith('layout:')) continue;
  (porLayout[p.fuente.slice(7)] = porLayout[p.fuente.slice(7)] || []).push(p);
}
const compartidos = Object.entries(porLayout).filter(([, v]) => v.length > 1);
if (compartidos.length) {
  console.error('Un layout no puede ser de dos plantas a la vez:\n  - '
    + compartidos.map(([l, v]) => `${l} lo reclaman ${v.map(x => x.num + ' ' + x.proyecto).join(' Y ')}`).join('\n  - ')
    + '\n\nLa cartera repite ese número en varias filas. Hace falta desambiguar el'
    + '\nemparejado (por emplazamiento, o dando número propio a cada una en la cartera).');
  process.exit(2);
}

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
    cartera: 'factiun-cartera (Supabase) · exportación ⬇ CSV en datos/' + EXPORT_CARTERA,
    rotulos: 'proyectos/cartera-tabla.html · const NPROY (equivalencia de números)',
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
