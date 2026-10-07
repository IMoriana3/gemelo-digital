#!/usr/bin/env node
/* Extrae los mapas Modbus canónicos de la ficha cobertura-zigbee/modbus.html y los
   deja en sim/modbus-map.js para que el simulador de planta los use TAL CUAL.

   La ficha es la transcripción verificada de los documentos de los fabricantes
   (tools/test_modbus_map.mjs en cobertura-zigbee la contrasta contra el original).
   Copiar los mapas a mano aquí sería una segunda fuente que envejece sola: esto
   los vuelve a generar en cada cambio.

       node tools/extrae_mapa.mjs [ruta/a/modbus.html]
       node tools/extrae_mapa.mjs --check [ruta]    # no escribe: falla si hay deriva

   Por defecto busca ../cobertura-zigbee/modbus.html (los repos, hermanos).

   ── DOS FABRICANTES, Y NO SE MEZCLAN ──────────────────────────────────────────
   La ficha pasó de un fabricante a dos, y con ello de un literal a un objeto por
   fabricante. Antes esto leía `var DEV={…}` recortando llaves; hoy la ficha tiene

       var BLOQUES_FAB={sunner:[…],p4q:[…]};
       var MAPAS={}; MAPAS.sunner={…}; MAPAS.p4q={…};
       var DEV=MAPAS.sunner, BLOQUES=BLOQUES_FAB.sunner;

   y `DEV` ya no es un literal sino una REFERENCIA, así que el recorte moría con
   «DEV no empieza por { ni [» — y como esto no corría en CI, el mapa del gemelo
   se quedó dos semanas en el R7 sin que nada lo dijera. De ahí el `--check` y su
   puerta en el workflow.

   Se traen LOS DOS fabricantes enteros, cada uno con su reparto del espacio de
   direcciones, porque la misma dirección NO significa lo mismo en los dos: la
   40030 es el ángulo de la posición segura 7 del grupo 1 en ambos, pero en Sunner
   R8 es un entero en CENTÉSIMAS DE GRADO y en P4Q un flotante en RADIANES sobre
   dos registros. Un simulador que sirva «el mapa» sin decir de quién es, miente
   en cuanto entra la segunda planta. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const SOLO_COMPRUEBA = args.includes('--check');
const FICHA = args.filter(a => !a.startsWith('--'))[0] ||
              path.join(RAIZ, '..', 'cobertura-zigbee', 'modbus.html');
const SALIDA = path.join(RAIZ, 'sim', 'modbus-map.js');

if (!fs.existsSync(FICHA)) {
  console.error('no encuentro la ficha: ' + FICHA);
  console.error('clona cobertura-zigbee al lado de este repo, o pasa la ruta como argumento.');
  process.exit(1);
}

const src = fs.readFileSync(FICHA, 'utf8');

/* ── el trozo de la ficha que define los mapas ──
   No se recorta un literal: se EVALÚA el bloque, porque la ficha usa referencias
   (`DEV=MAPAS.sunner`) y, después del marcador, parches sobre lo ya definido
   (`MAPAS.sunner.ncu.max=200`). Recortar un literal no vería ni una cosa ni la
   otra. Son datos y asignaciones puras, sin llamadas ni DOM.

   El final NO es el marcador: los parches viven DETRÁS de él. Medido: cortar en
   `@@MAPA_FIN@@` deja la NCU de Sunner con `max: 0` e `idlab` sin poner, que es
   justo lo que la ficha corrige en la línea siguiente. Así que el bloque llega
   hasta el PRIMER COMENTARIO posterior al marcador, y si el marcador no está, se
   dice en vez de adivinar. */
function bloqueDeMapas() {
  const INI = 'var BLOQUES_FAB=';
  const i = src.indexOf(INI);
  if (i < 0) throw new Error('no aparece «' + INI + '» en la ficha: ha cambiado de forma');
  const MARCA = '/* @@MAPA_FIN@@ */';
  const m = src.indexOf(MARCA, i);
  if (m < 0) throw new Error('no aparece el marcador «@@MAPA_FIN@@» tras los mapas');
  const tras = m + MARCA.length;
  const fin = src.indexOf('/*', tras);
  if (fin < 0) throw new Error('no encuentro dónde acaban los parches tras el marcador');
  return src.slice(i, m) + '\n' + src.slice(tras, fin);
}

let MAPAS, BLOQUES_FAB;
try {
  const r = new Function(bloqueDeMapas() +
    ';return {MAPAS:typeof MAPAS!=="undefined"&&MAPAS, BLOQUES_FAB:typeof BLOQUES_FAB!=="undefined"&&BLOQUES_FAB};')();
  MAPAS = r.MAPAS; BLOQUES_FAB = r.BLOQUES_FAB;
} catch (e) {
  console.error('la ficha no se ha podido evaluar: ' + e.message);
  console.error('si ha cambiado de forma, hay que arreglar ESTE extractor, no copiar el mapa a mano.');
  process.exit(1);
}

/* ── que lo extraído sea un mapa y no un objeto vacío ──
   Un generador que escribe `{}` sin quejarse es peor que uno que falla: deja al
   simulador sin mapa y con cara de estar al día. */
function pasa(cond, queja) { if (!cond) { console.error('FICHA: ' + queja); process.exit(1); } }

pasa(MAPAS && typeof MAPAS === 'object', 'MAPAS no ha salido del bloque');
pasa(BLOQUES_FAB && typeof BLOQUES_FAB === 'object', 'BLOQUES_FAB no ha salido del bloque');
const FABS = Object.keys(MAPAS);
pasa(FABS.length >= 2, 'solo ' + FABS.length + ' fabricante(s): la ficha trae dos (sunner y p4q)');
for (const fab of FABS) {
  pasa(BLOQUES_FAB[fab] && BLOQUES_FAB[fab].length,
       'el fabricante «' + fab + '» no trae reparto de direcciones en BLOQUES_FAB');
  const devs = Object.keys(MAPAS[fab]);
  pasa(devs.length, 'el fabricante «' + fab + '» no trae ningún equipo');
  for (const d of devs) {
    const o = MAPAS[fab][d];
    pasa(o && o.tab && Array.isArray(o.secs) && o.secs.length,
         fab + '.' + d + ' no tiene tab/secs: ¿ha cambiado la forma de la ficha?');
    /* 12 campos, y un 13º OPCIONAL con la revisión. Medido en la ficha de hoy: 734
       filas de 12 y 12 de 13, todas marcadas 'R8'. El marcador solo aparece cuando
       el registro NO está en todas las revisiones, así que su ausencia es «está en
       todas», no «falta un dato». Lo que esta guarda no deja pasar es un 14º campo:
       si la ficha añade uno, aquí se entera alguien antes de que el simulador lo
       lea como si fuera la revisión. */
    for (const s of o.secs) for (const f of (s.f || []))
      pasa(Array.isArray(f) && f.length >= 12 && f.length <= 13,
           fab + '.' + d + ' · sección «' + s.t + '»: una fila trae ' +
           (Array.isArray(f) ? f.length : '?') + ' campos y el formato son 12, ' +
           'más un 13º opcional con la revisión. Si la ficha añadió campos, ' +
           'declárense aquí y en la cabecera del generado.');
  }
}

/* ── recuento, que es lo que se ve en el diff si la ficha cambia de forma ── */
const cuenta = (o) => (o.secs || []).reduce((a, s) => a + (s.f || []).length, 0);
let nReg = 0, resumen = [];
for (const fab of FABS) {
  const devs = Object.keys(MAPAS[fab]);
  const porDev = devs.map(d => MAPAS[fab][d].tab + ': ' + cuenta(MAPAS[fab][d]));
  for (const d of devs) nReg += cuenta(MAPAS[fab][d]);
  resumen.push(fab + ' → ' + porDev.join(' · ') + ' · bloques: ' + BLOQUES_FAB[fab].length);
}

/* el que mira por defecto el simulador. Es el MISMO que la ficha deja en `DEV`, y
   el de Sunner porque es el de las plantas en marcha; P4Q entra con Bagnarelli. */
const POR_DEFECTO = FABS.includes('sunner') ? 'sunner' : FABS[0];

const cab = `/* GENERADO por tools/extrae_mapa.mjs — NO editar a mano.
   Fuente: cobertura-zigbee/modbus.html, que transcribe los documentos de cada fabricante
   (Sunner: NCU_Modbus_Map R7 y R8 · SUNNER_TCU_ModbusMap_v6 · HSU_Modbus_Map_R23.
    P4Q: AUX1-S20015_revT_NCU_Modbus_map, con TCU, TMU, repetidores y RSU).
   ${resumen.join('\n   ')}
   ${nReg} direcciones en total.

   DOS FABRICANTES, Y NO SE MEZCLAN: la misma dirección significa cosas distintas en cada
   uno —la 40030 es el ángulo de la posición segura 7 del grupo 1 en los dos, pero en Sunner
   R8 es un entero en centésimas de grado y en P4Q un flotante en radianes sobre dos
   registros—, así que quien lea de aquí tiene que decir DE QUÉ FABRICANTE lee.
   \`MODBUS_MAP\` y \`MODBUS_BLOQUES\` son el atajo al de por defecto (${POR_DEFECTO}).

   Formato de cada registro (el de la ficha, sin tocar) — 12 CAMPOS Y UN 13º OPCIONAL:
     [dir/offset, nombre, tipo, unidad, bits{nombre:[lsb,msb]}, escala, enum, descripción,
      acceso, descripción de cada bit, por_defecto, rango] (+ revisión)
   El 13º SOLO aparece cuando el registro no está en todas las revisiones: 'R8' si es nuevo
   del R8, 'R7' si el R8 ya no lo trae. Que falte significa «está en todas», no «falta un
   dato», así que leerlo con \`f[12] || null\` es correcto. Hoy: 12 filas lo traen, todas 'R8'.
   Las secciones con base y stride son bloques por unidad:
   dirección = base + (n-1)*stride + offset. */
`;

const texto = cab +
  'var MODBUS_MAPAS = ' + JSON.stringify(MAPAS) + ';\n' +
  'var MODBUS_BLOQUES_FAB = ' + JSON.stringify(BLOQUES_FAB) + ';\n' +
  'var MODBUS_FAB_DEFECTO = ' + JSON.stringify(POR_DEFECTO) + ';\n' +
  '/* atajos al fabricante por defecto, para quien no elige */\n' +
  'var MODBUS_MAP = MODBUS_MAPAS[MODBUS_FAB_DEFECTO];\n' +
  'var MODBUS_BLOQUES = MODBUS_BLOQUES_FAB[MODBUS_FAB_DEFECTO];\n' +
  'if (typeof window !== "undefined") { window.MODBUS_MAPAS = MODBUS_MAPAS;' +
  ' window.MODBUS_BLOQUES_FAB = MODBUS_BLOQUES_FAB; window.MODBUS_FAB_DEFECTO = MODBUS_FAB_DEFECTO;' +
  ' window.MODBUS_MAP = MODBUS_MAP; window.MODBUS_BLOQUES = MODBUS_BLOQUES; }\n' +
  'if (typeof module !== "undefined") { module.exports = { MODBUS_MAPAS: MODBUS_MAPAS,' +
  ' MODBUS_BLOQUES_FAB: MODBUS_BLOQUES_FAB, MODBUS_FAB_DEFECTO: MODBUS_FAB_DEFECTO,' +
  ' MODBUS_MAP: MODBUS_MAP, MODBUS_BLOQUES: MODBUS_BLOQUES }; }\n';

if (SOLO_COMPRUEBA) {
  const viejo = fs.existsSync(SALIDA) ? fs.readFileSync(SALIDA, 'utf8') : null;
  if (viejo === texto) {
    console.log('sim/modbus-map.js al día · ' + nReg + ' direcciones');
    for (const l of resumen) console.log('  ' + l);
    process.exit(0);
  }
  console.error('sim/modbus-map.js NO coincide con la ficha.');
  if (viejo === null) {
    console.error('  (no existe: nunca se ha generado)');
  } else {
    /* DECIR QUÉ SE HA MOVIDO. El recuento por equipo solo sirve cuando ha cambiado
       el número de registros; si se movió una unidad, un tipo o una descripción, los
       recuentos salen idénticos y repetirlos dos veces no informa de nada. Así que
       cuando coinciden se dice que coinciden y se señala el primer byte distinto, que
       es lo que de verdad lleva a la línea. */
    const dev = (t) => { const m = /\n   (\w+ → .*)/g; const r = []; let x;
                         while ((x = m.exec(t))) r.push(x[1]); return r; };
    const antes = dev(viejo);
    if (antes.length && antes.join('|') === resumen.join('|')) {
      console.error('  el recuento por equipo es el MISMO, así que lo que cambió es el');
      console.error('  contenido de algún registro (tipo, unidad, bits, descripción…):');
      console.error('    ' + resumen.join('\n    '));
    } else {
      console.error('  antes:  ' + (antes.join('\n          ') || '(no se pudo leer el recuento)'));
      console.error('  ahora:  ' + resumen.join('\n          '));
    }
    let i = 0;
    while (i < viejo.length && i < texto.length && viejo[i] === texto[i]) i++;
    const linea = viejo.slice(0, i).split('\n').length;
    const ven = (t) => JSON.stringify(t.slice(Math.max(0, i - 40), i + 80));
    console.error('  primer byte distinto: ' + i + ' (línea ' + linea + ')');
    console.error('    en el fichero: ' + ven(viejo));
    console.error('    en la ficha:   ' + ven(texto));
    console.error('  tamaño: ' + viejo.length + ' → ' + texto.length + ' bytes');
  }
  console.error('\nRegenéralo y comitea el resultado:  node tools/extrae_mapa.mjs');
  process.exit(1);
}

fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
fs.writeFileSync(SALIDA, texto);

console.log('sim/modbus-map.js  ·  ' + nReg + ' direcciones  ·  ' +
  (fs.statSync(SALIDA).size / 1024).toFixed(0) + ' kB');
for (const l of resumen) console.log('  ' + l);
console.log('  por defecto: ' + POR_DEFECTO);
