#!/usr/bin/env node
/* ============================================================================
   extrae_plantas.mjs — LAS PLANTAS DE VERDAD, GENERADAS.

   El simulador tenía siete emplazamientos escritos a mano con su latitud, su longitud
   y poco más. El inventario —cuántos seguidores, de qué tipo, cuántas NCU, cuántas
   HSU, si es bífila o monofila, dónde está cada mesa— lo ponía a ojo quien montara la
   simulación. Y ese inventario existe: está en los layouts que salen del DWG, en
   `cobertura-zigbee/<planta>_layout.json`, que es lo que ya consumen Cobertura 3D,
   Backtracking y Overcast.

   Así que no se teclea: se genera. Mismo criterio que `extrae_mapa.mjs` y
   `extrae_fisica.mjs` — y, como ellos, **se niega a escribir si las fuentes no dicen
   lo mismo**. Aquí se contrastan tres:

     · el LAYOUT       cuántos trackers, NCU, estaciones y TCU sin mesa hay de verdad
     · su `geometria`  si el seguidor es bífila, el paso entre filas y el filaZ
     · overcast.html   el desplegable con los códigos («23003 · El Burgo (215 uds ·
                       2 NCUs)») y su REALMETA con la bífila de cada planta

   Si el desplegable dice 215 uds y el layout trae 214, alguien ha tocado uno de los
   dos y hay que mirarlo, no promediar.

       node tools/extrae_plantas.mjs            # escribe sim/plantas.js
       node tools/extrae_plantas.mjs --check    # solo contrasta, no escribe

   Lo que NO se genera: la lista de emplazamientos «de laboratorio» (Gorraiz, Jodhpur),
   que no son plantas de la casa y no tienen layout. Esas siguen a mano en la interfaz,
   marcadas como lo que son.
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';

const AQUI = path.dirname(new URL('.', import.meta.url).pathname);
const COB = process.env.COBERTURA || path.join(AQUI, '..', 'cobertura-zigbee');
const SALIDA = path.join(AQUI, 'sim', 'plantas.js');
const SOLO_MIRA = process.argv.includes('--check');

if (!fs.existsSync(COB)) {
  console.error(`no encuentro cobertura-zigbee en ${COB}\n` +
                'clónalo al lado de gemelo-digital, o pasa COBERTURA=/ruta/al/repo');
  process.exit(2);
}

/* ── overcast.html: los códigos de planta y quién es monofila ────────────────
   Se lee el HTML porque es donde vive esa lista, y con una expresión regular sobre el
   `<option>`: si mañana alguien añade una planta al desplegable y no al layout —o al
   revés—, este extractor lo dice en vez de heredar la mitad. */
const OV = fs.readFileSync(path.join(COB, 'overcast.html'), 'utf8');

const opciones = {};
const reOpt = /<option value="([a-z]+)">([^<]+)<\/option>/g;
let m;
while ((m = reOpt.exec(OV))) {
  const [, k, txt] = m;
  if (!/uds/.test(txt)) continue;                       /* solo las del selector de plantas */
  const cod = (txt.match(/^(\d{5})\s·\s/) || [])[1] || null;
  const uds = +(txt.match(/([\d.]+)\s*uds/) || [])[1].replace('.', '');
  const ncus = +((txt.match(/(\d+)\s*NCUs?/) || [])[1] || 1);
  const nombre = txt.replace(/^\d{5}\s·\s/, '').replace(/\s*\(.*$/, '').trim();
  opciones[k] = { cod, uds, ncus, nombre, monofila: /monofila/.test(txt) };
}

const meta = {};
const bloque = OV.slice(OV.indexOf('const REALMETA={'));
const reMeta = /(\w+):\s*\{bifila:\s*(true|false),\s*title:\s*'([^']*)'/g;
while ((m = reMeta.exec(bloque.slice(0, bloque.indexOf('};'))))) {
  meta[m[1]] = { bifila: m[2] === 'true', title: m[3] };
}

/* ── los layouts ─────────────────────────────────────────────────────────── */
const avisos = [];
const plantas = [];

for (const f of fs.readdirSync(COB).filter((x) => x.endsWith('_layout.json')).sort()) {
  const k = f.replace('_layout.json', '');
  const L = JSON.parse(fs.readFileSync(path.join(COB, f), 'utf8'));
  const T = L.trackers || [];
  if (!T.length) { avisos.push(`${k}: el layout no trae trackers`); continue; }

  /* ── EL LARGO DE CADA SEGUIDOR ────────────────────────────────────────────────
     No todos miden lo mismo, ni de lejos: el DWG de Polvorín trae SIETE tallas, de
     9,9 a 82,4 m, y una monofila suelta en una planta bífila. Pintarlas todas del
     largo canónico es lo que mete unas dentro de otras.

     Tres fuentes, en este orden:

       1. MEDIDA — `mesa.tipos[tp].largo`, sacado del propio DWG. Manda siempre.
       2. DERIVADA — de los módulos que lleva ese seguidor y las constantes del DWG
          de esa planta (`modW`, `gapMod`, `gapDrive`):

              largo = n·modW + (n−2)·gapMod + gapDrive

          con `n` = módulos A LO LARGO DEL EJE. Careada contra las ONCE tallas que sí
          están medidas (Polvorín 7, Panbianco 2, Benante 2): cuadra al milímetro en
          las once.
       3. NINGUNA — se emite `null` y el 3D pinta el canónico diciéndolo.

     De dónde sale `n`, y por qué hacen falta las dos vías: el nombre del tipo es una
     CAPA DEL DWG, no una fórmula, y cada planta la escribe a su manera.
       · `1V62`, `1V28` … → n es el número: los módulos del eje. (panbianco, benante,
         ayora, fayón, páramo)
       · `31+31`, `24+23x3` … → ahí el nombre NO da n de forma fiable —probado: falla
         en uno de siete, `7+8x3` sale 15 y son 16— así que n sale de `mods`, que es
         el total de la bífila: n = ceil(mods/2), o `mods` si es monofila. (polvorín)
     Las dos vías están careadas contra las medidas; ninguna se usa a ciegas. */
  const nEje = (L, t) => {
    const tp = String(t.tp || '');
    const m1 = tp.match(/(?:^|\s)1V(\d+)/i);          /* «1V62», «Exterior 1V28» */
    if (m1) return +m1[1];
    if (t.mods != null) {
      const mono = /mono/i.test(tp) ||
                   !!(L.mesa && L.mesa.tipos && L.mesa.tipos[tp] && L.mesa.tipos[tp].mono);
      return mono ? +t.mods : Math.ceil(+t.mods / 2);
    }
    return null;
  };
  const largoDe = (L, t) => {
    const m = L.mesa || {}, tp = String(t.tp || '');
    const med = m.tipos && m.tipos[tp] && m.tipos[tp].largo;
    if (med != null) return +(+med).toFixed(2);        /* medido en el DWG: manda */
    if (m.modW == null) return null;                   /* sin constantes no se inventa */
    const n = nEje(L, t);
    if (!n) return null;
    return +(n * m.modW + (n - 2) * (m.gapMod || 0) + (m.gapDrive || 0)).toFixed(2);
  };
  const fuenteLargo = (L) => {
    const T2 = L.trackers || [];
    const conMedida = T2.filter((t) => L.mesa && L.mesa.tipos &&
                                       L.mesa.tipos[String(t.tp || '')] &&
                                       L.mesa.tipos[String(t.tp || '')].largo != null).length;
    const con = T2.filter((t) => largoDe(L, t) != null).length;
    if (!con) return 'ninguna';
    if (con < T2.length) return 'parcial';
    return conMedida === T2.length ? 'medida' : 'derivada';
  };

  /* el tipo lo escribe cada layout a su manera: «medio», «Medio», «Medio sin rotula».
     Lo único que importa aquí es si la mesa es de media longitud. */
  const esMedio = (t) => /medio/i.test(String(t.t || ''));
  const medios = T.filter(esMedio).length;

  const o = opciones[k], mt = meta[k], g = L.geometria || {};

  /* CONTRASTE. No se promedia ni se elige el que mejor suene: se dice y se para. */
  if (o && o.uds !== T.length) {
    avisos.push(`${k}: overcast dice ${o.uds} uds y el layout trae ${T.length}`);
  }
  if (o && L.ncus && o.ncus !== L.ncus.length && L.ncus.length > 0) {
    avisos.push(`${k}: overcast dice ${o.ncus} NCU y el layout trae ${L.ncus.length}`);
  }
  if (mt && g.bifila != null && mt.bifila !== !!g.bifila) {
    avisos.push(`${k}: REALMETA dice bifila=${mt.bifila} y geometria.bifila=${g.bifila}`);
  }
  if (o && mt && o.monofila === mt.bifila) {
    avisos.push(`${k}: el texto del desplegable dice ${o.monofila ? 'monofila' : 'bífila'} ` +
                `y REALMETA dice bifila=${mt.bifila}`);
  }

  /* bífila: manda el layout si lo declara; si no, lo que diga REALMETA; y si tampoco,
     la de la casa, que es bífila. Se anota de dónde salió. */
  const bifila = g.bifila != null ? !!g.bifila : (mt ? mt.bifila : true);
  const fuenteBif = g.bifila != null ? 'layout' : (mt ? 'overcast' : 'por defecto');

  /* el azimut de eje: el `rot` de los seguidores. Si no todos coinciden se dice. */
  const rots = [...new Set(T.map((t) => +(t.rot || 0).toFixed(1)))];
  if (rots.length > 3) avisos.push(`${k}: ${rots.length} rotaciones de eje distintas`);

  plantas.push({
    k,
    cod: o ? o.cod : null,
    n: (o && o.nombre) || (mt && mt.title) || k,
    lat: +(+L.clat).toFixed(4),
    lon: +(+L.clon).toFixed(4),
    /* el huso del layout va en MINUTOS y sin cambio de hora (Perú, Túnez, Dominicana);
       si no lo trae, es península o Italia y sí cambia */
    tz: L.tzFijo != null ? L.tzFijo / 60 : 1,
    dst: L.tzFijo == null,
    tcu: T.length,
    medios,
    completos: T.length - medios,
    rep: (L.tcuSinMesa || []).length,
    ncu: (L.ncus || []).length,
    hsu: (L.meteo || []).length,
    bifila,
    fuenteBif,
    ejeAz: rots.length === 1 ? rots[0] : +(T.reduce((a, t) => a + (t.rot || 0), 0) / T.length).toFixed(1),
    /* el paso y la media separación de la bífila, en NÚMERO. Ojo: algunos layouts los
       explican en prosa dentro de `geometria` (Bagnarelli decía «filaZ = 5,50/2 = 2,75»
       en una frase) y ahí no los lee nadie: los que valen son los de `mesa`. */
    pitch: (L.mesa && L.mesa.pasoFila) != null ? L.mesa.pasoFila
         : (g.pasoEntreFilas != null ? g.pasoEntreFilas : null),
    filaZ: (L.mesa && L.mesa.filaZ) != null ? L.mesa.filaZ
         : (g.filaZ != null ? g.filaZ : null),
    /* de dónde sale el largo de cada seguidor en esta planta: medido, derivado o
       ninguno. Lo consume el 3D para no pintarlos todos iguales, y la interfaz para
       decirlo cuando no se sabe. */
    largoFuente: fuenteLargo(L),
    /* posiciones: NORTE, ESTE, rotación, medio (0/1), NCU y LARGO en metros.
       Redondeadas a un decimal — un centímetro no cambia dónde cae una sombra y el
       fichero se queda en la cuarta parte.

       EL LARGO ES EL SEXTO CAMPO, y es la diferencia entre un plano y un dibujo: en la
       misma planta conviven tallas de 9,9 a 82,4 m (Polvorín, siete), y pintarlas todas
       del largo canónico mete unas dentro de otras. Se emite `null` cuando no se puede
       saber, que es mejor que un número inventado: el 3D lo pinta canónico Y LO DICE. */
    pos: T.map((t) => [+(+t.n).toFixed(1), +(+t.x).toFixed(1), +(+(t.rot || 0)).toFixed(1),
                       esMedio(t) ? 1 : 0, t.ncu || 1, largoDe(L, t)])
  });
}

/* las que están en el desplegable de overcast y no tienen layout: eso también es un
   descuadre que hay que decir */
for (const k of Object.keys(opciones)) {
  if (!plantas.some((p) => p.k === k)) avisos.push(`${k}: está en overcast y no hay layout`);
}

console.log(`plantas: ${plantas.length}`);
for (const p of plantas) {
  console.log(`  ${(p.cod || '—').padEnd(6)} ${p.n.padEnd(13)} ` +
              `${String(p.tcu).padStart(5)} TCU (${p.medios} medios) · ${p.rep} rep · ` +
              `${p.ncu} NCU · ${p.hsu} HSU · ${p.bifila ? 'bífila' : 'MONOFILA'} (${p.fuenteBif})` +
              ` · eje ${p.ejeAz}° · UTC${p.tz >= 0 ? '+' : ''}${p.tz}${p.dst ? ' con cambio' : ''}`);
}

if (avisos.length) {
  console.error('\n✗ LAS FUENTES NO DICEN LO MISMO — no se escribe nada:');
  avisos.forEach((a) => console.error('   · ' + a));
  console.error('\nMira cuál de las dos está mal antes de seguir. Promediar aquí es');
  console.error('exactamente cómo se cuela un dato inventado en algo que parece canónico.');
  process.exit(1);
}
console.log('\n✓ layout, geometría y overcast dicen lo mismo');

if (SOLO_MIRA) process.exit(0);

/* ── a fichero ───────────────────────────────────────────────────────────── */
const cab = `/* ============================================================================
   plantas.js — GENERADO por tools/extrae_plantas.mjs. NO SE TOCA A MANO.

   Las plantas de la casa con su inventario y su plano, sacados de los layouts del DWG
   (cobertura-zigbee/<planta>_layout.json) y contrastados con el desplegable y el
   REALMETA de overcast.html. Si las tres fuentes no coinciden, el extractor no escribe.

   Por planta:
     k, cod, n        clave, código de proyecto y nombre
     lat, lon, tz, dst
     tcu, medios, completos, rep, ncu, hsu
     bifila           dos vigas por seguidor (la de la casa) o una
     ejeAz            azimut del eje, grados al este del norte
     pitch, filaZ     paso entre filas y media separación de la bífila, si el layout lo dice
     pos[]            [norte, este, rot, medio(0/1), ncu] por seguidor, en metros
                      respecto al centro de planta. El punto es el EJE DE UNIDAD: el
                      centro de la bífila, no el motor — el motor va en la viga oeste.

   Regenerar:  node tools/extrae_plantas.mjs
   ============================================================================ */
`;
const salida = cab + 'var PLANTAS_REALES = [\n' +
  plantas.map((p) => '  ' + JSON.stringify(p)).join(',\n') + '\n];\n' +
  `\nif (typeof window !== 'undefined') window.PLANTAS_REALES = PLANTAS_REALES;\n` +
  `if (typeof module !== 'undefined') module.exports = PLANTAS_REALES;\n`;

fs.writeFileSync(SALIDA, salida);
console.log(`\n→ ${path.relative(AQUI, SALIDA)}  (${(salida.length / 1024).toFixed(0)} KB)`);
