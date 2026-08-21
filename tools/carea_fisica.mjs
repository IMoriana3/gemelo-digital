#!/usr/bin/env node
/* ARNÉS: ¿dice `sim/fisica.js` lo mismo que el core Python?

   Hasta B4 este fichero lo ESCRIBÍA `tools/extrae_fisica.mjs`, que leía el
   Python y generaba el JS. Eso es transpilación: herramienta propia, frágil, y
   atada a que el extractor supiera parsear cada cambio del core. Y sobre todo,
   no comprobaba nada — garantizaba la copia el día que corría, y ni un minuto
   más.

   Ahora `fisica.js` es un ESPEJO MANTENIDO A MANO que declara en su cabecera
   que el Python manda, y este arnés comprueba que los dos digan lo mismo sobre
   los mismos casos. El extractor era una promesa; esto es un mecanismo. Misma
   evolución que la copia del gemelo en H2.

   Los goldens (`sim/goldens-fisica.json`) los genera el core:

       python solargpt/scripts/genera_goldens_fisica.py <ruta>/sim/goldens-fisica.json

   Uso:
       node tools/carea_fisica.mjs            # sale 1 si algo difiere
       node tools/carea_fisica.mjs --verboso  # imprime cada caso

   COBERTURA: hoy son 4 de las 7 funciones de fisica.js, y el arnés lo IMPRIME.
   Un arnés que cubre la mitad sin decirlo convierte su verde en «todo careado»,
   que es mentira. Las otras tres entran cuando el core publique su contraparte.
*/
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const F = require(join(RAIZ, 'sim/fisica.js'));
const G = JSON.parse(readFileSync(join(RAIZ, 'sim/goldens-fisica.json'), 'utf8'));

const VERBOSO = process.argv.includes('--verboso');
const TOL = 1e-9;                    /* espejo, no aproximación: al bit */

let fallos = [], n = 0;

function careo(etiqueta, esperado, obtenido) {
  n++;
  const d = Math.abs(esperado - obtenido);
  const ok = Number.isFinite(d) && d <= TOL * Math.max(1, Math.abs(esperado));
  if (!ok) fallos.push(`${etiqueta}: core ${esperado} · js ${obtenido} · Δ ${d}`);
  else if (VERBOSO) console.log(`  ok  ${etiqueta} = ${obtenido}`);
  return ok;
}

/* ── constantes: si éstas se separan, todo lo demás es ruido ──

   El mapa clave-del-core → RUTA-en-el-JS va explícito y en un solo sitio. La
   primera versión de este arnés buscaba el slew en `F.slewDps` y en
   `F.SLEW_DPS`, y como vive en `F.e.SLEW_DPS` cantó «el JS no la expone» sobre
   un fichero que la exponía perfectamente. Estuve a un paso de «arreglar» el
   espejo para complacer al arnés. Un buscador que falla dice «no está», no «no
   lo encuentro», y las dos frases se parecen demasiado: por eso la ruta se
   declara aquí en vez de adivinarse con una cascada de tanteos. */
const RUTA = {
  'motor.K0': ['motor', 'K0'],
  'motor.K1': ['motor', 'K1'],
  idleW: ['idleW'],
  sleepW: ['sleepW'],
  vNom: ['vNom'],
  slewDps: ['e', 'SLEW_DPS'],
};
for (const [k, v] of Object.entries(G.constantes)) {
  const ruta = RUTA[k];
  if (!ruta) { fallos.push(`constante ${k}: sin ruta declarada en el arnés`); n++; continue; }
  const val = ruta.reduce((o, p) => (o == null ? undefined : o[p]), F);
  if (val === undefined) {
    fallos.push(`constante ${k}: no está en F.${ruta.join('.')} (core dice ${v})`);
    n++;
  } else careo(`constante ${k} (F.${ruta.join('.')})`, v, val);
}

/* ── las tres funciones vigiladas ── */
for (const c of G.casos.motorW)  careo(`motorW(${c.ang})`,  c.W, F.motorW(c.ang));
for (const c of G.casos.heaterW) careo(`heaterW(${c.t})`,   c.W, F.heaterW(c.t));
for (const c of G.casos.etaCharger) careo(`etaCharger(${c.G})`, c.eta, F.etaCharger(c.G));

for (const c of G.casos.consumoTCU) {
  const r = F.consumoTCU({ ...c.in, calefactada: false });
  for (const k of ['base', 'motor', 'heat', 'total'])
    careo(`consumoTCU[${JSON.stringify(c.in.motorModel)} mov=${c.in.mov}].${k}`,
          c.out[k], r[k]);
}

/* ── N declarado: un conjunto vacío que «no encuentra diferencias» es la
      verdad vacua, no una verificación. Con 0 casos esto revienta. ── */
const N_ESPERADO = G.n_casos + Object.keys(G.constantes).length
                 + G.casos.consumoTCU.length * 3;   /* consumoTCU aporta 4, no 1 */
if (n === 0) {
  console.error('ARNÉS VACÍO: 0 careos. Un verde sin casos no verifica nada.');
  process.exit(2);
}
if (n !== N_ESPERADO) {
  fallos.push(`nº de careos ${n}, esperados ${N_ESPERADO}: faltan o sobran casos`);
}

/* ── informe ── */
console.log(`\nfisica.js ↔ core · ${n} careos · tolerancia ${TOL}`);
console.log(`cobertura: ${G.cobertura.vigiladas.join(', ')}  (${G.cobertura.vigiladas.length}/7)`);
for (const [f, motivo] of Object.entries(G.cobertura.sin_vigilar))
  console.log(`   SIN VIGILAR  ${f} — ${motivo}`);

if (fallos.length) {
  console.error(`\n${fallos.length} DIFERENCIA(S):`);
  for (const f of fallos) console.error(`  · ${f}`);
  console.error('\nEl Python es la fuente de autoridad: se corrige el JS, no el golden.');
  console.error('Si el core cambió a propósito, regenera los goldens con');
  console.error('  python solargpt/scripts/genera_goldens_fisica.py <ruta>/sim/goldens-fisica.json');
  process.exit(1);
}
console.log('\nOK — el espejo dice lo mismo que el core.');
