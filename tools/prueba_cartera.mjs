#!/usr/bin/env node
/* BANCO DEL LECTOR DE LA CARTERA (GEM-CARTERA-01)
   ===============================================
   `COLUMNAS` declara, campo a campo, las cabeceras que lo pueden traer:

       lat: ['Latitud', 'lat'],  lon: ['Longitud', 'lng']

   Las alternativas no son «por si acaso»: son dos versiones REALES del mismo
   export. Hasta factiun-cartera#198 las coordenadas salían con la clave cruda de
   la base (`lat`/`lng`, porque `LABELS` no las tenía) y desde entonces salen
   rotuladas. Quien bajó el CSV ayer tiene el viejo.

   POR QUÉ EXISTE ESTE FICHERO. El 2026-09-09 el export nuevo sustituyó al viejo
   en `datos/` —trae las coordenadas de Minervino y Monsano, que era el motivo—
   y con eso el repo se quedó SIN NINGÚN fichero con las cabeceras viejas. La
   rama `lat`/`lng` seguía escrita, seguía documentada, y ya no la ejercitaba
   nada: un alias que nadie prueba es indistinguible de uno que no funciona. Se
   comprobó por mutación cuando se escribió (#77) y esa comprobación fue un acto,
   no un mecanismo — que es exactamente la diferencia que esta casa persigue.

   El export viejo se conserva por eso, como FIXTURE y no como rival: vive en
   `datos/pruebas/` y el generador nunca lo mira solo. Es el fichero real que
   salió de la cartera, no una reconstrucción — lo que se carea es lo que de
   verdad tiene delante quien no ha vuelto a exportar.

   Y corre EL GENERADOR DE VERDAD (`--export` a un `--salida` temporal): copiar
   aquí el lector sería una segunda cabeza que daría verde mientras el original
   evoluciona.

       node tools/prueba_cartera.mjs [--desde <proyectos>] [--cobertura <cobertura-zigbee>]
*/
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const OPC = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const PROYECTOS = OPC('--desde') || '/home/user/proyectos';
const COBERTURA = OPC('--cobertura') || '/home/user/cobertura-zigbee';

const VIEJO  = join(RAIZ, 'datos/pruebas/cartera_cabeceras_viejas_20260909.csv');
const NUEVO  = join(RAIZ, 'datos/cartera_20260909.csv');

let fallos = 0;
const ok = (c, m, x) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x ? '\n      → ' + x : ''));
  if (!c) fallos++;
};

/* Corre el generador y devuelve {code, err, cat}. NO se juzga por el código de
   salida a través de una tubería: se ejecuta sin shell y se lee lo que escribió.
   `--check` no sirve aquí — compararía contra `sim/cartera.js`, que es el
   catálogo del export BUENO, y el fixture viejo daría «desactualizado» siempre:
   una diferencia esperada leída como fallo. */
let corrida = 0;
function genera(csv, tmp) {
  /* Salida DISTINTA en cada llamada. Con una ruta compartida, una tirada que
     muere (salida 2, sin escribir) dejaba en pie el fichero de la ANTERIOR y
     este banco lo leía como suyo: «trae las 32 plantas» salía verde sobre un run
     que no llegó a generar nada, y el careo de conjuntos se comparaba consigo
     mismo. Lo cazó el mutante del alias nuevo — el banco medía estado viejo. */
  const salida = join(tmp, `cartera_${++corrida}.js`);
  let code = 0, err = '';
  try {
    execFileSync(process.execPath, [join(RAIZ, 'tools/genera_plantas.mjs'),
      '--export', csv, '--salida', salida,
      '--desde', PROYECTOS, '--cobertura', COBERTURA],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { code = e.status; err = String(e.stderr || ''); }
  let cat = null;
  if (existsSync(salida)) {
    const w = {};
    new Function('window', readFileSync(salida, 'utf8'))(w);
    cat = w.CARTERA;
  }
  return { code, err, cat };
}

const tmp = mkdtempSync(join(tmpdir(), 'gem-cartera-'));
try {
  if (!existsSync(VIEJO)) {
    console.error(`falta el fixture ${VIEJO}.\n`
      + 'Es el export REAL con cabeceras `lat`/`lng`, y es lo único que ejercita\n'
      + 'esa rama de COLUMNAS. Si se ha borrado, la rama vieja quedó sin vigilar:\n'
      + 'recupéralo del historial, no lo reconstruyas a mano.');
    process.exit(2);
  }

  /* ── 1) las DOS grafías se leen, y dan el mismo catálogo salvo el dato ──
     El fixture viejo es el mismo export sin las dos coordenadas que se metieron
     después, así que el recuento de plantas tiene que COINCIDIR y el de
     coordenadas diferir en exactamente esas dos. Comparar solo «no revienta»
     dejaría pasar un lector que devuelve la columna equivocada. */
  console.log('\n── cabeceras viejas (lat/lng) ──');
  const v = genera(VIEJO, tmp);
  ok(v.code === 0, 'el generador acepta el export viejo', `salida ${v.code}\n${v.err}`);
  ok(v.cat && v.cat.plantas.length === 32, 'trae las 32 plantas',
     v.cat && `${v.cat.plantas.length}`);
  ok(v.cat && v.cat.n_con_coordenadas === 30, '30 con coordenadas (sin Minervino ni Monsano)',
     v.cat && `${v.cat.n_con_coordenadas}`);

  console.log('\n── cabeceras nuevas (Latitud/Longitud) ──');
  const n = genera(NUEVO, tmp);
  ok(n.code === 0, 'el generador acepta el export nuevo', `salida ${n.code}\n${n.err}`);
  ok(n.cat && n.cat.plantas.length === 32, 'trae las 32 plantas',
     n.cat && `${n.cat.plantas.length}`);
  ok(n.cat && n.cat.n_con_coordenadas === 32, '32 con coordenadas',
     n.cat && `${n.cat.n_con_coordenadas}`);

  /* Las dos que separan un export del otro, con el valor exacto. Un recuento
     que cuadra no dice QUÉ coordenada entró: si el lector cogiera la columna de
     al lado, los conteos seguirían siendo 30 y 32. */
  console.log('\n── el dato, no el recuento ──');
  const busca = (cat, num) => cat && cat.plantas.find(p => p.num === num);
  for (const [num, nombre, lat, lon] of [
    ['26057', 'Minervino', 41.030539, 16.073579],
    ['26078', 'Monsano',   43.561018, 13.274657],
  ]) {
    const a = busca(v.cat, num), b = busca(n.cat, num);
    ok(a && a.lat === null && a.lon === null,
       `${nombre} sale SIN coordenadas del export viejo`, a && `${a.lat} / ${a.lon}`);
    ok(b && b.lat === lat && b.lon === lon,
       `${nombre} sale en ${lat} / ${lon} del export nuevo`, b && `${b.lat} / ${b.lon}`);
  }

  /* Y el resto del catálogo NO se mueve entre los dos exports: si cambiara algo
     más, el fixture habría dejado de ser «el mismo fichero antes del dato» y
     este banco estaría careando dos cosas distintas sin saberlo.

     Se compara el CONJUNTO, no la lista. Escrito primero como igualdad de listas
     salió ROJO, y el hallazgo fue del banco: la cartera exportó las dos Alconadre
     en orden distinto (Sodeto y San Miguel intercambiadas). El orden de las
     plantas sale del orden de filas del CSV, o sea de cómo le apetezca ordenar a
     la cartera ese día — congelarlo es fijar algo que no es del catálogo, y el
     rojo diría «el lector cambió» cuando lo que cambió fue la hoja. Lo que sí es
     contrato es QUÉ plantas hay y con qué datos. */
  const conjunto = c => c.plantas.map(p => JSON.stringify({ ...p, lat: 0, lon: 0, fuente: 0 })).sort();
  ok(v.cat && n.cat && JSON.stringify(conjunto(v.cat)) === JSON.stringify(conjunto(n.cat)),
     'las mismas plantas con los mismos datos en los dos exports (el orden no es contrato)');

  /* ── 2) EL MUTANTE: sin la cabecera en su lista, esto MUERE ──
     Es la mitad que da valor a lo de arriba. Dos verdes solo dicen que las dos
     grafías declaradas se leen; lo que hay que poder demostrar es que una
     TERCERA no se cuela en silencio dejando el campo vacío — que es como se ve
     un catálogo sin coordenadas y con buena pinta. */
  console.log('\n── mutante: una grafía que NO está declarada ──');
  const mut = join(tmp, 'mutante.csv');
  const crudo = readFileSync(NUEVO, 'utf8');
  const cab = crudo.slice(0, crudo.indexOf('\n')).replace(';Longitud;', ';Lon;');
  writeFileSync(mut, cab + crudo.slice(crudo.indexOf('\n')));
  const m = genera(mut, tmp);
  ok(m.code === 2, 'muere con salida 2 en vez de emitir el campo vacío', `salida ${m.code}`);
  ok(/lon \(buscado como Longitud o lng\)/.test(m.err),
     'y nombra el campo y las cabeceras que buscaba', m.err.split('\n')[0]);

  console.log('\n' + (fallos ? `${fallos} FALLOS` : 'sin fallos'));
  process.exit(fallos ? 1 : 0);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
