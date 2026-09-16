#!/usr/bin/env node
/* EL GUARD DEL GUARD: ningún .mjs sin clasificar (GEM-PUERTA-01)
   ==============================================================
   La puerta de `.github/workflows/arneses.yml` protege lo que protegía el día
   que se escribió. Sin nada que lo vigile, el octavo arnés se añade, se corre a
   mano una vez, y se queda fuera para siempre — que es exactamente cómo este
   repo llegó a tener SIETE bancos y CERO puertas.

   Lo que se exige: que TODO `.mjs` de `tools/` y `sim/` esté en una de cuatro
   cajas, y ninguna de las cuatro es «ya se verá».

     puerta       lo ejecuta un trabajo que BLOQUEA. No se declara aquí: se
                  DERIVA leyendo el propio .yml. Una lista escrita a mano sería
                  una segunda copia de lo que CI hace, y se separaría en semanas.
     vigilante    lo ejecuta un trabajo con `continue-on-error`, o sea que
                  informa y no para nada. También se DERIVA — y además hay que
                  declararlo abajo con el porqué, que es lo que impide bajar un
                  arnés de puerta a vigilante en silencio.
     excluido     es un arnés y no corre en CI, con motivo y con lo que haría
                  falta para meterlo.
     no_es_arnes  es un módulo o un generador: no tiene veredicto que dar.

   La primera versión de esto contaba como puerta CUALQUIER `node …` del .yml,
   incluido el del trabajo que no bloquea. O sea que habría llamado puerta a un
   vigilante — la misma confusión que este repo intenta cerrar. Un lector
   incompleto no falla: MIENTE.

   Y las exigencias de la casa sobre listas de exenciones, que aquí valen igual:
   cada entrada tiene DUEÑO VIVO (si el fichero desaparece o se renombra, la
   entrada se borra) y MOTIVO CON SUSTANCIA (estar en la lista no es un permiso
   silencioso). Sin la prueba de zombis, una exención huérfana espera a que
   alguien pase por delante: el siguiente fichero que se llame igual hereda el
   permiso sin que nadie lo decida.

   Guard del guard del guard, y no es broma: se exige que la clasificación
   DISTINGA. Un inventario que mete todo en la misma caja es indistinguible de
   uno que no clasifica, y sale igual de verde.

       node tools/inventario_arneses.mjs
*/
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const FLUJO = join(RAIZ, '.github/workflows/arneses.yml');

let fallos = 0;
const ok = (c, m, x) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x ? '\n      → ' + x : ''));
  if (!c) fallos++;
};

/* ── los arneses que NO bloquean, uno a uno y con su porqué ──
   `motivo` explica por qué no es puerta HOY; `para_meterlo` es lo que haría
   falta, para que la exclusión no se lea como «esto nunca». */
const EXCLUIDOS = {
  'tools/carea_resultado.mjs': {
    motivo:
      'Carea el resultado del espejo JS contra `solargpt_core.tcu_compare`, y '
      + 'SolarGPTfull es un repositorio PRIVADO. El GITHUB_TOKEN por defecto está '
      + 'limitado al repositorio donde corre, así que un `git fetch` de otro repo '
      + 'privado muere con «could not read Username» — medido en la tirada 1 del '
      + 'workflow, no supuesto. No es un descuido de configuración: es el alcance '
      + 'del token. Se corre en local, donde el clon está al lado.',
    para_meterlo:
      'Un secreto del repositorio con acceso de LECTURA a SolarGPTfull (un PAT de '
      + 'grano fino, o una GitHub App instalada en los dos), usado en el `git '
      + 'fetch` de ese hermano. Lo provisiona el mantenedor: no es una decisión '
      + 'técnica, es dar acceso a un repo privado desde otro.',
    lo_que_NO_queda_sin_vigilar:
      'El espejo de física NO se queda desnudo por esto: `carea_fisica.mjs` lo '
      + 'carea función a función contra `sim/goldens-fisica.json`, que está '
      + 'versionado aquí, y ése SÍ está en la puerta. Lo que se pierde es el careo '
      + 'del RESULTADO día a día contra el core vivo.',
  },
};

/* ── los que corren en CI y NO bloquean, con el porqué ──
   Que un arnés no bloquee tiene que ser una DECISIÓN escrita, no el efecto de
   haberlo metido en el trabajo de al lado. Sin esta lista, silenciar una puerta
   sería mover una línea de sitio. */
const VIGILANTES = {
  'tools/deriva_pines.mjs':
    'No juzga ESTE repo: clona la PUNTA de los hermanos y dice qué se ha movido '
    + 'desde el pin. Si bloqueara, una PR de aquí saldría roja porque otro repo '
    + 'empujó hace un minuto — la puerta mediría el reloj. Ya pasó en SolarGPTfull: '
    + 'un vigilante convertido en peaje atascó tres PRs ajenas a la vez. Pasarlo a '
    + 'puerta tendrá que ser una decisión, no un descuido.',
};

/* ── lo que no es un arnés: módulos y generadores ── */
const NO_ES_ARNES = {
  'tools/ambito.mjs':
    'MÓDULO, no banco: exporta scriptsDe/envuelto/desnudos y quien las ejecuta es '
    + 'prueba_bateria.mjs, que sí es puerta. Corriéndolo suelto no imprime nada ni '
    + 'puede fallar, así que enchufarlo sería un verde que no puede ser otra cosa.',
  'tools/extrae_mapa.mjs':
    'GENERADOR: saca el mapa del DWG. Se corre a mano cuando llega un plano nuevo y '
    + 'escribe en el árbol; no tiene veredicto que dar sobre una PR.',
  'tools/extrae_plantas.mjs':
    'GENERADOR: saca PLANTAS_REALES (posición de cada seguidor) de los layouts del '
    + 'DWG. Mismo caso que extrae_mapa: escribe, no juzga.',
  'sim/servidor.mjs':
    'SERVIDOR de desarrollo para abrir las páginas por http en vez de file://. Es '
    + 'una herramienta de escritorio: se queda escuchando y no termina, así que en '
    + 'una puerta colgaría el trabajo hasta el timeout.',
};

/* ── 1) qué ejecuta REALMENTE el workflow ──
   Se leen las invocaciones `node <ruta>` del .yml. Derivado, no transcrito. */
if (!existsSync(FLUJO)) {
  console.error(`no encuentro ${FLUJO}.\n`
    + 'Este inventario existe para vigilar esa puerta: sin ella no vigila nada, y\n'
    + 'un inventario que no encuentra su objeto tiene que MORIR, no salir verde.');
  process.exit(2);
}
const yml = readFileSync(FLUJO, 'utf8');

/* Se parte el .yml por TRABAJO (dos espacios de sangría bajo `jobs:`) y cada
   trozo se marca según lleve `continue-on-error: true`. Sin este corte, un
   arnés del trabajo que no bloquea contaría como puerta.

   `bloque.split` a pelo sobre el fichero entero no vale: el `continue-on-error`
   de un trabajo marcaría a todos los demás. */
const jobsTxt = yml.slice(yml.search(/^jobs:/m));
const trozos = jobsTxt.split(/\n(?=  [\w-]+:[ \t]*$)/m).slice(1);
const enPuerta = new Set(), enVigilante = new Set();
for (const t of trozos) {
  const destino = /continue-on-error:\s*true/.test(t) ? enVigilante : enPuerta;
  for (const m of t.matchAll(/\bnode\s+((?:tools|sim)\/[\w.-]+\.mjs)/g)) destino.add(m[1]);
}
/* Un mismo fichero en los dos sitios es ambiguo: no se sabe si su rojo para o
   no. Se resuelve a favor de lo estricto y se dice, en vez de elegir en
   silencio. */
const ambiguos = [...enPuerta].filter(f => enVigilante.has(f));
for (const f of ambiguos) enVigilante.delete(f);

/* ── 2) todo lo que hay ── */
const listar = d => readdirSync(join(RAIZ, d))
  .filter(f => f.endsWith('.mjs')).map(f => `${d}/${f}`).sort();
const TODOS = [...listar('tools'), ...listar('sim')].sort();

console.log('\n── clasificación ──');
const sinClasificar = [];
for (const f of TODOS) {
  const caja = enPuerta.has(f) ? 'puerta'
             : enVigilante.has(f) ? 'vigilante'
             : f in EXCLUIDOS ? 'excluido'
             : f in NO_ES_ARNES ? 'no-es-arnés' : null;
  console.log(`  ${(caja || '¡SIN CLASIFICAR!').padEnd(16)} ${f}`);
  if (!caja) sinClasificar.push(f);
}

console.log('\n── exigencias ──');
ok(sinClasificar.length === 0,
   'ningún .mjs se queda sin clasificar',
   sinClasificar.length ? sinClasificar.join(', ')
     + '\n        Si es un banco, enchúfalo a .github/workflows/arneses.yml.'
     + '\n        Si no lo es, dilo en NO_ES_ARNES con su motivo.' : '');

ok(ambiguos.length === 0,
   'ninguno corre a la vez en un trabajo que bloquea y en uno que no',
   ambiguos.join(', ') + '\n        No se sabría si su rojo para la PR o no.');

/* Un fichero en dos cajas es una contradicción, no una redundancia: dice a la
   vez que bloquea y que no. */
const dobles = TODOS.filter(f =>
  [enPuerta.has(f), f in EXCLUIDOS, f in NO_ES_ARNES].filter(Boolean).length > 1);
ok(dobles.length === 0, 'ninguno está en dos cajas a la vez', dobles.join(', '));

/* Lo que corre sin bloquear tiene que estar DECLARADO como tal. Es la mitad que
   impide silenciar una puerta moviéndola de trabajo: el .yml diría que no
   bloquea y aquí no habría motivo escrito, y esto se pone rojo. */
const mudos = [...enVigilante].filter(f => !(f in VIGILANTES));
ok(mudos.length === 0,
   'todo lo que corre sin bloquear está declarado en VIGILANTES con su porqué',
   mudos.join(', ') + '\n        ¿Se ha bajado una puerta a vigilante? Dilo aquí o devuélvela.');

const fantasmas = Object.keys(VIGILANTES).filter(f => !enVigilante.has(f));
ok(fantasmas.length === 0,
   'y todo lo declarado vigilante lo es de verdad en el .yml',
   fantasmas.join(', ') + '\n        Está declarado como vigilante y CI no lo corre así.');

/* ── 3) zombis: toda entrada declarada apunta a un fichero que existe ── */
const zombis = [...Object.keys(EXCLUIDOS), ...Object.keys(NO_ES_ARNES), ...Object.keys(VIGILANTES)]
  .filter(f => !TODOS.includes(f));
ok(zombis.length === 0,
   'ninguna entrada declarada es huérfana',
   zombis.length ? zombis.join(', ')
     + '\n        Ese fichero ya no existe (o se renombró): borra su entrada.'
     + '\n        Si no, el siguiente que se llame igual hereda el permiso sin'
     + '\n        que nadie lo decida.' : '');

/* ── 4) sustancia en el motivo ──
   El suelo es bajo a propósito: no pretende medir calidad de prosa, pretende
   que «ídem.» no cuele. Ese fue el hallazgo real la primera vez que esta regla
   se aplicó en la casa: tres motivos escritos como «ídem.», pereza del propio
   autor de la regla. */
/* Una exclusión se declara como objeto (lleva `motivo` y `para_meterlo`); las
   otras dos cajas, como cadena. Leer el objeto con `String()` daría
   «[object Object]» —15 caracteres— y esta comprobación se pondría roja por la
   FORMA en vez de por la sustancia, señalando un motivo que sí está escrito. */
const textoDe = m => (m && typeof m === 'object' ? m.motivo : m);
const flojos = Object.entries({ ...EXCLUIDOS, ...NO_ES_ARNES, ...VIGILANTES })
  .filter(([, m]) => String(textoDe(m) ?? '').trim().length < 60)
  .map(([f]) => f);
ok(flojos.length === 0,
   'todo motivo declarado tiene sustancia (≥60 caracteres)', flojos.join(', '));

/* Y una exclusión tiene que decir qué haría falta para dejar de serlo: sin eso
   se lee como «esto nunca», que es otra cosa. */
const sinSalida = Object.entries(EXCLUIDOS)
  .filter(([, v]) => !v || !String(v.para_meterlo || '').trim()).map(([f]) => f);
ok(sinSalida.length === 0,
   'toda exclusión dice qué haría falta para meterla en la puerta', sinSalida.join(', '));

/* ── 5) que la clasificación DISTINGA ──
   Un inventario que mete todo en una caja da verde sin clasificar nada. Se
   exige que la puerta no esté vacía Y que las otras cajas tampoco lo estén por
   accidente: si algún día TODO es puerta, esta línea obliga a venir a borrarla
   a propósito en vez de dejar el guard inerte. */
ok(enPuerta.size > 0, 'la puerta ejecuta al menos un arnés',
   'el .yml no invoca ningún `node tools/…` — ¿se reescribió el workflow?');
ok(enPuerta.size < TODOS.length,
   'y la clasificación separa: no todo cae en la misma caja',
   `los ${TODOS.length} .mjs están en la puerta; si de verdad es así, borra esta `
   + 'comprobación a propósito y di por qué');

console.log(`\n${TODOS.length} ficheros · ${enPuerta.size} en la puerta · `
  + `${enVigilante.size} vigilantes · ${Object.keys(EXCLUIDOS).length} excluidos · `
  + `${Object.keys(NO_ES_ARNES).length} no son arneses`);
console.log(fallos ? `\n${fallos} FALLOS` : '\nsin fallos');
process.exit(fallos ? 1 : 0);
