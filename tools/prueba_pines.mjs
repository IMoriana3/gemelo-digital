#!/usr/bin/env node
/* EL VIGILANTE DE LOS PINES, VIGILADO (GEM-PUERTA-03)
 * ===================================================
 * `tools/deriva_pines.mjs` filtra: de todo lo que el hermano ha cambiado, avisa
 * sólo de lo que este repo LEE. Filtrar es correcto —uno que grita por todo se
 * deja de leer, y así murió `sync_seguidor.py --check`— pero el filtro es una
 * LISTA, y una lista se queda atrás.
 *
 * EL 2026-10-07 SE QUEDÓ ATRÁS, y así se descubrió esto. Ese día entró
 * `modbus.html` en el pin de cobertura-zigbee: se escribió en el `para_que` y en
 * el `lo_usan` de pines.json, y NO en la tabla `CONSUMIDO` que el reportero
 * llevaba a mano. Horas después, con la ficha recién cambiada en el hermano, el
 * vigilante dijo:
 *
 *     ── cobertura-zigbee
 *        punta 602ea195  ·  55 commits por delante
 *        nada de lo que este repo consume ha cambiado.
 *
 * Y `git diff --name-only 368ebf71 602ea195 -- modbus.html` devolvía el fichero.
 * No falló: MINTIÓ, y con el verde por delante. Es la enfermedad de las ocho
 * copias del rumbo del viento, cometida en el único mecanismo que existe para
 * avisar de esta clase de deriva — así que detrás de ese «todo en orden» nadie
 * iba a mirar.
 *
 * De ahí las cuatro cosas que este banco exige, y ninguna es la duplicación en
 * sí: lo que mata es que la copia incompleta se lea como una comprobación.
 *
 *   1. El reportero NO lleva su propia tabla de rutas: la lee de pines.json.
 *      Mientras pueda tener una, volverán a separarse.
 *   2. Todo hermano pinchado DECLARA `consume`, y no vacío. Sin lista no hay
 *      filtro, y «nada ha cambiado» significaría «no sé mirar» — el vacío es
 *      error, no PASS.
 *   3. Toda ruta de hermano que la PUERTA nombra (`../<hermano>/<fichero>` en
 *      .github/workflows/arneses.yml) está cubierta por `consume`. Esto no se
 *      teclea: se DERIVA del workflow. Es el único tramo con fuente mecánica, y
 *      es justo el que falló (la puerta nombra `../cobertura-zigbee/modbus.html`
 *      desde el día en que se añadió).
 *   4. Lo que NO se puede derivar —porque al arnés se le pasa el directorio del
 *      hermano y abre los ficheros él— va en `consume_sin_derivar` CON MOTIVO, y
 *      con test de zombis: una exención huérfana es un permiso esperando a que
 *      alguien pase por delante.
 *
 *     node tools/prueba_pines.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { consumidosDe, derivados } from './deriva_pines.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const pines = JSON.parse(readFileSync(join(RAIZ, 'pines.json'), 'utf8'));
const FLUJO = readFileSync(join(RAIZ, '.github/workflows/arneses.yml'), 'utf8');
const FUENTE_REPORTERO = readFileSync(join(RAIZ, 'tools/deriva_pines.mjs'), 'utf8');

let fallos = 0, hechas = 0;
const ok = (cond, que, det) => {
  hechas++;
  if (!cond) { fallos++; console.log('  ✗ ' + que + (det ? '  → ' + det : '')); }
  else console.log('  ✓ ' + que + (det ? '  · ' + det : ''));
};

const REPOS = Object.keys(pines.repos);

/* ── 1 · la lista vive en UN sitio ─────────────────────────────────────────── */
console.log('\n1 · la lista de lo consumido vive en pines.json y en ningún otro sitio');

for (const repo of REPOS) {
  const meta = pines.repos[repo];
  ok(consumidosDe(meta).length > 0,
     `${repo} declara \`consume\` en pines.json`,
     `${consumidosDe(meta).length} rutas`);
}

/* El guard de MECANISMO, que es el que impide la reincidencia. No basta con que
   hoy la tabla no esté: hay que prohibir que vuelva. Se mira sólo el CÓDIGO —la
   cabecera del reportero EXPLICA el bug y nombra `CONSUMIDO`, así que un grep a
   secas se marcaría a sí mismo en rojo; cuarta vez en esta familia de repos que
   el grep sobre comentario muerde a quien escribe el guard. */
const codigo = FUENTE_REPORTERO
  .replace(/\/\*[\s\S]*?\*\//g, '')   // bloques
  .replace(/(^|[^:])\/\/.*$/gm, '$1'); // línea
const tablaPropia = /const\s+CONSUMIDO\s*=/.test(codigo);
ok(!tablaPropia,
   'deriva_pines.mjs no reintroduce su propia tabla `CONSUMIDO`',
   tablaPropia ? 'la ha vuelto a declarar: la lista estaría otra vez en dos sitios'
               : 'sólo la lee de pines.json');

/* Y que la lea de verdad, no que simplemente no tenga tabla: borrar código
   también deja esto en verde, y lo que se pide es que el criterio esté unido. */
ok(/pines\.json/.test(codigo) && /meta\s*&&\s*meta\.consume|meta\.consume/.test(codigo),
   'deriva_pines.mjs LEE `consume` de pines.json',
   'no basta con no tener tabla: el criterio tiene que venir del pin');

/* ── 2 · lo que la puerta nombra está cubierto ─────────────────────────────── */
console.log('\n2 · toda ruta de hermano que NOMBRA la puerta está en `consume` (derivado del workflow)');

/* Se deriva del workflow, que es quien de verdad se las pasa a los arneses.
   `[\w./-]` a propósito: para el `../cobertura-zigbee` pelado (un directorio,
   sin fichero detrás) no hay nada que cubrir, y se descarta abajo. */
const rutasPuerta = [...new Set(
  (FLUJO.match(/\.\.\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+/g) || []),
)];
ok(rutasPuerta.length > 0,
   'el workflow nombra al menos una ruta de hermano',
   `${rutasPuerta.length}: ${rutasPuerta.join(', ')}`);
/* El vacío sería un verde que no puede ser otra cosa: si el regex deja de
   encajar, este bloque no comprobaría nada y lo diría «todo cubierto». */

for (const ruta of rutasPuerta) {
  const [, repo, ...resto] = ruta.split('/');
  const dentro = resto.join('/');
  const meta = pines.repos[repo];
  if (!meta) {
    ok(false, `la puerta lee ${ruta} pero ${repo} no está pinchado en pines.json`);
    continue;
  }
  const cubierto = consumidosDe(meta).some(p => dentro.includes(p));
  ok(cubierto, `${ruta} está cubierta por el \`consume\` de ${repo}`,
     cubierto ? dentro
              : `la puerta la lee y el vigilante no avisaría si cambiase — ` +
                `añádela a repos["${repo}"].consume`);
}

/* ── 3 · las exenciones, con motivo y sin zombis ───────────────────────────── */
console.log('\n3 · lo que no se puede derivar va declarado CON MOTIVO, y sin huérfanos');

for (const repo of REPOS) {
  const meta = pines.repos[repo];
  const consume = consumidosDe(meta);
  const motivos = meta.consume_sin_derivar || {};

  /* Qué rutas de este repo sí respalda el workflow. */
  const respaldadas = new Set();
  for (const ruta of rutasPuerta) {
    const [, r, ...resto] = ruta.split('/');
    if (r !== repo) continue;
    const dentro = resto.join('/');
    for (const p of consume) if (dentro.includes(p)) respaldadas.add(p);
  }

  for (const p of consume) {
    if (respaldadas.has(p)) continue;
    const motivo = motivos[p];
    ok(typeof motivo === 'string' && motivo.trim().length >= 40,
       `${repo} · ${p} no sale del workflow, así que explica por qué se declara a mano`,
       motivo ? `«${motivo.slice(0, 60)}…»`
              : 'sin motivo: un «ídem.» o un hueco aquí es la lista de exenciones ' +
                'volviéndose permiso silencioso');
  }

  /* Zombis: un motivo para una ruta que ya no se consume es un permiso huérfano
     esperando a que alguien llame igual al fichero siguiente. */
  for (const p of Object.keys(motivos)) {
    ok(consume.includes(p),
       `${repo} · el motivo de ${p} tiene dueño vivo en \`consume\``,
       consume.includes(p) ? null : 'exención zombi: bórrala');
  }
}

/* ── 4 · el filtro muerde, y depende de la lista ───────────────────────────── */
console.log('\n4 · el filtro DEPENDE de la lista (el mutante del 2026-10-07)');

/* El régimen de riesgo es el real: la tanda de commits que de verdad hubo entre
   el pin de aquel día y la punta. Con la lista buena tiene que salir
   `modbus.html`; quitándola de la lista, el vigelante se queda mudo — que es
   exactamente lo que pasó, y el verde que lo tapó. */
const TOCADOS_REALES = [
  'modbus.html',
  'tools/gen_modbus_map.mjs',
  'tools/test_modbus_map.mjs',
  'tools/con_piso.mjs',
  'elburgo_cotas.json',
  'overcast.html',
];
const zig = consumidosDe(pines.repos['cobertura-zigbee']);
const conLista = derivados(TOCADOS_REALES, zig);
ok(conLista.includes('modbus.html'),
   'con la lista de hoy, un cambio en modbus.html SE AVISA',
   `avisa de: ${conLista.join(', ') || '(nada)'}`);

const mutante = zig.filter(p => p !== 'modbus.html');
const sinModbus = derivados(TOCADOS_REALES, mutante);
ok(!sinModbus.includes('modbus.html'),
   'quitando modbus.html de la lista, el vigilante DEJA de avisar — por eso la lista es el guard',
   `avisaría de: ${sinModbus.join(', ') || '(nada: el silencio del 2026-10-07)'}`);

/* Y que el sufijo siga siendo sufijo: `_layout.json` cubre `ayora_layout.json`.
   Si alguien lo cambia a igualdad exacta, los centroides dejarían de vigilarse
   y nada más lo diría. */
ok(derivados(['ayora_layout.json', 'fayon_layout.json'], zig).length === 2,
   '`_layout.json` se compara como SUFIJO: cubre los <planta>_layout.json',
   'son uno por planta; una ruta exacta no valdría');

/* Un fichero del hermano que aquí no se lee NO es deriva: el filtro tiene que
   seguir filtrando, o vuelve el peaje. */
ok(derivados(['overcast.html', 'elburgo_cotas.json'], zig).length === 0,
   'lo que este repo no lee sigue sin avisar',
   'un vigilante que grita por todo se deja de leer');

console.log('');
if (fallos) { console.error(`✗ ${fallos} de ${hechas} comprobaciones`); process.exit(1); }
console.log(`✓ ${hechas} comprobaciones · el filtro del vigilante sale del pin, y no de una copia`);
