#!/usr/bin/env node
/* ARNÉS: la inercia térmica es UNA regla, y las dos superficies la consumen.

   QUÉ PASÓ (2026-10-21). `sim/planta.js` modelaba la temperatura de la batería
   con inercia y decidía el calefactor con ELLA; `bateria.html` le pasaba la
   ambiente cruda. La misma regla con dos cabezas, y el propio comentario de
   planta.js decía cuál era la buena. Medido sobre 20 inviernos de Chorzele
   (53,3 °N, el emplazamiento de validación del core): el veredicto «¿la batería
   está bajo 0 °C?» —el que bloquea la carga— cambiaba en 10 h por invierno, con
   hasta 2,0 °C de discrepancia.

   Y la fórmula era `Math.min(1, dt/τ)`, el paso de Euler, que SE SATURA: a paso
   ≥ τ vale exactamente 1 y la inercia DESAPARECE sin que nada lo diga. Un
   mecanismo que deja de actuar en un régimen y no avisa es peor que no tenerlo,
   porque el fichero sigue leyéndose como si modelara algo.

   QUÉ VIGILA
     1. que `FISICA.retardo1` sea la forma EXACTA y no la saturante;
     2. que ninguna superficie reimplante el retardo por su cuenta;
     3. que `bateria.html` decida el calefactor con la temperatura de BATERÍA.

   Lo 1 se comprueba con números; lo 2 y lo 3, leyendo el fuente — que aquí es
   legítimo porque lo que se persigue es un IDIOMA (`Math.min(1, dt/`), un
   literal en posición fija, no un símbolo que pueda escribirse de otra forma.
   Es la misma excepción que el guard de marcadores de conflicto.

   Uso:  node tools/carea_termica.mjs [--verboso]
*/
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const F = require(join(RAIZ, 'sim/fisica.js'));
const VERBOSO = process.argv.includes('--verboso');

const fallos = [];
const ok = (q, c) => { if (c) { if (VERBOSO) console.log('  ok  ' + q); } else fallos.push(q); };

/* ── 1 · la forma es la exacta, y NO se satura ─────────────────────────── */
if (typeof F.retardo1 !== 'function') {
  fallos.push('FISICA.retardo1 no existe: la regla ha vuelto a estar suelta');
} else {
  const tau = 1800;
  for (const dt of [60, 600, 1800, 3600, 36000]) {
    const esperado = 1 - Math.exp(-dt / tau);
    const medido = F.retardo1(0, 1, dt, tau);
    ok(`retardo1(0,1,${dt},${tau}) = ${esperado.toFixed(9)}`,
       Math.abs(medido - esperado) < 1e-12);
  }
  /* el mutante vivo: con Euler esto valdría 1 exacto y la inercia moriría */
  ok('a paso ≥ τ NO se satura (queda inercia)', F.retardo1(0, 1, 3600, 1800) < 0.9);
  ok('τ→0 es paso directo', Math.abs(F.retardo1(0, 1, 60, 1e-9) - 1) < 1e-9);
  ok('las dos constantes están en el canon',
     F.e.TAU_BAT_S > 0 && F.e.TAU_PCB_S > 0);
}

/* ── 2 · nadie reimplanta el retardo ──────────────────────────────────── */
const SUPERFICIES = ['sim/planta.js', 'bateria.html', 'sim/fisica.js'];
/* El patrón describe un RETARDO, no cualquier recorte: un paréntesis (la
   diferencia `objetivo − actual`) multiplicado por `Math.min(1, dt/τ)`. La
   primera versión buscaba `Math.min(1, x/y)` a secas y marcó en rojo un
   `Math.min(1, clouds/100+…)` que recorta una fracción de nubes — un guard que
   cría lobos se deja de leer, así que se estrecha en vez de añadirle una
   exención. */
const SATURANTE = /\)\s*\*\s*Math\.min\(\s*1\s*,[^)]*\//g;
for (const f of SUPERFICIES) {
  const src = readFileSync(join(RAIZ, f), 'utf8');
  const hits = (src.match(SATURANTE) || []);
  ok(`${f}: sin el idioma saturante Math.min(1, dt/τ)`, hits.length === 0);
  if (hits.length && VERBOSO) console.log('     ' + hits.join(' · '));
}

/* ── 3 · el calefactor de bateria.html decide con la BATERÍA ──────────── */
const BAT = readFileSync(join(RAIZ, 'bateria.html'), 'utf8');
ok('bateria.html integra la inercia con FISICA.retardo1',
   /FISICA\.retardo1\(\s*tBat\s*,\s*m\.temp/.test(BAT));
ok('bateria.html pasa tBat —no m.temp— a consumoTCU',
   /calefactada:prof\.heated,\s*tAmb:tBat/.test(BAT) && !/tAmb:m\.temp/.test(BAT));

/* ── veredicto ────────────────────────────────────────────────────────── */
if (fallos.length) {
  console.error(`\n✗ carea_termica: ${fallos.length} fallo(s)\n`);
  for (const f of fallos) console.error('  · ' + f);
  console.error('\n  La inercia térmica es UNA regla (FISICA.retardo1) y la consumen el');
  console.error('  gemelo y bateria.html. Si has separado las dos superficies a propósito,');
  console.error('  este arnés se retira CON la decisión escrita, no se ajusta.\n');
  process.exit(1);
}
console.log(`✓ carea_termica: inercia térmica unificada · ${SUPERFICIES.length} superficies · sin idioma saturante`);
