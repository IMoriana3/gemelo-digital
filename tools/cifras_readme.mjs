#!/usr/bin/env node
/* LAS CIFRAS DE LOS README, CONTRA QUIEN LAS MIDE (auditoría Construct F0, H-13)
   ================================================================================
   Los README del gemelo daban cifras que fueron verdad un día y ya no lo eran:
   515 direcciones de mapa cuando son 746, 196 comprobaciones del banco cuando son
   360, «3 de sus 6» y «4/7» funciones careadas cuando son 5/9. Ningún banco las
   fijaba, así que derivaron, y un informe externo las copió como si fueran de hoy.

   Este banco no las escribe por nadie: las MIDE donde viven y exige que los README
   digan lo mismo.
     · direcciones del mapa      → sim/modbus-map.js, con la misma cuenta que usa
                                   extrae_mapa.mjs (la puerta ya comprueba que el
                                   fichero está al día con la ficha del pin)
     · comprobaciones del banco  → la salida de `node sim/prueba.mjs`
     · funciones careadas        → la línea «cobertura» de `node tools/carea_fisica.mjs`
   Si una cambia, cae aquí con la cifra nueva y el README se corrige en la misma PR.
   Y si el README deja de decir la frase donde va la cifra, también cae: una cifra
   que no se encuentra no es una cifra que coincide.

       node tools/cifras_readme.mjs
*/
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let fallos = 0;
const ok = (c, m, x) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x ? '\n      → ' + x : ''));
  if (!c) fallos++;
};

/* ── 1) lo medido ── */
console.log('lo medido:');
const { MODBUS_MAPAS } = require(join(RAIZ, 'sim/modbus-map.js'));
const cuenta = (o) => (o.secs || []).reduce((a, s) => a + (s.f || []).length, 0); // la de extrae_mapa.mjs
const direcciones = Object.values(MODBUS_MAPAS)
  .reduce((n, fab) => n + Object.values(fab).reduce((m, d) => m + cuenta(d), 0), 0);
const cabecera = /(\d+) direcciones en total\./.exec(readFileSync(join(RAIZ, 'sim/modbus-map.js'), 'utf8'));
ok(cabecera && +cabecera[1] === direcciones,
  `mapa Modbus: ${direcciones} direcciones (y la cabecera generada dice lo mismo)`,
  `la cabecera dice ${cabecera && cabecera[1]}: o la cuenta de aquí o la del generador ha cambiado`);

function salida(fichero) {
  try {
    return execFileSync(process.execPath, [join(RAIZ, fichero)], { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    return '';                                   // el suyo ya cae en su propio paso; aquí, «no se pudo medir»
  }
}
const banco = /✓ (\d+) comprobaciones, todas bien/.exec(salida('sim/prueba.mjs'));
ok(!!banco, `sim/prueba.mjs: ${banco ? banco[1] : '?'} comprobaciones`, 'no se pudo medir: el banco no terminó en verde');
const fisica = /^cobertura: .*\((\d+)\/(\d+)\)\s*$/m.exec(salida('tools/carea_fisica.mjs'));
ok(!!fisica, `tools/carea_fisica.mjs: ${fisica ? fisica[1] + '/' + fisica[2] : '?'} funciones careadas`, 'no se pudo medir: el arnés no imprimió su cobertura');

/* ── 2) lo que dicen los README ── */
const README = readFileSync(join(RAIZ, 'README.md'), 'utf8');
const SIM = readFileSync(join(RAIZ, 'sim/README.md'), 'utf8');
const MEDIDO = {
  direcciones: String(direcciones),
  banco: banco ? banco[1] : null,
  fisica: fisica ? fisica[1] + '/' + fisica[2] : null,
};
const DICHOS = [
  ['README.md', README, /(\d+) direcciones, sin copiar ninguna a mano/g, 'direcciones'],
  ['README.md', README, /node sim\/prueba\.mjs` \((\d+) comprobaciones\)/g, 'banco'],
  ['README.md', README, /Cubre hoy (\d+) de sus (\d+) funciones/g, 'fisica'],
  ['sim/README.md', SIM, /`modbus-map\.js` \|[^\n|]*?(\d+) direcciones/g, 'direcciones'],
  ['sim/README.md', SIM, /`prueba\.mjs` \| prueba de humo: (\d+) comprobaciones/g, 'banco'],
  ['sim/README.md', SIM, /carea_fisica\.mjs` \|[^\n]*?\((\d+)\/(\d+) funciones hoy/g, 'fisica'],
];
console.log('\nlo que dicen los README:');
for (const [nombre, texto, re, que] of DICHOS) {
  const vistos = [...texto.matchAll(re)].map((m) => m.slice(1).join('/'));
  if (vistos.length !== 1) {
    ok(false, `${nombre}: la frase de «${que}»`, `se esperaba UNA mención y hay ${vistos.length} (${re}); si se reescribió la frase, actualiza este banco`);
    continue;
  }
  ok(vistos[0] === MEDIDO[que], `${nombre}: ${que} = ${vistos[0]}`, `lo medido es ${MEDIDO[que]}: corrige el README`);
}

console.log(fallos ? `\n✗ ${fallos} cifras no cuadran` : '\n✓ los README dicen lo que se mide');
process.exitCode = fallos ? 1 : 0;
