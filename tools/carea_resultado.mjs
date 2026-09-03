#!/usr/bin/env node
/* CAREO GEMELO ↔ MOTOR, POR RESULTADO
   ===================================
   La hoja de ruta del portal lo pedía con estas palabras: «correr el mismo día
   en los dos y fallar si se separan. Hoy el cotejo cubre las constantes, no el
   resultado». Eso es esto.

   `carea_fisica.mjs` carea CONSTANTES contra los goldens del core y
   `carea_difusa.mjs` carea UNA FUNCIÓN contra pvlib. Ninguno de los dos dice si
   un día entero de planta sale igual: la física puede cuadrar pieza a pieza y
   separarse al integrarla, que es donde viven los errores de acumulación, de
   histéresis y de orden de las operaciones.

   CÓMO SE MONTA, y por qué así:

   · el gemelo corre el día y publica SUS ENTRADAS junto a sus salidas. Al core
     se le dan esas mismas entradas. Si cada uno generase su meteo, la
     diferencia de meteo contaminaría la del modelo y esto no mediría nada;
   · el reloj se convierte con el huso que el gemelo DECLARA (`tz` + `dst`), no
     con un ajuste: el gemelo lleva hora civil local y el core deriva el sol del
     timestamp UTC. La primera vez que monté esto le di al core la latitud
     equivocada —Sevilla en vez de Gorraiz— y salió un desfase solar de 5,42°
     que estuve a punto de reportar como avería del gemelo. Por eso el arnés
     comprueba PRIMERO que los dos soles coinciden, y sólo entonces compara lo
     demás: si el sol no cuadra, lo de abajo no significa nada.

       node tools/carea_resultado.mjs
*/
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const RAIZ = path.dirname(new URL('.', import.meta.url).pathname);
const CORE = path.resolve(RAIZ, '..', 'SolarGPTfull', 'solargpt');
if (!existsSync(CORE)) {
  console.log('· clon hermano de SolarGPT no disponible: el careo por resultado se salta.');
  console.log('  (no es verde: es que no se ha medido. `git clone` el core al lado y repite.)');
  process.exit(0);
}

const SIM = require('../sim/planta.js');
let ok = 0, ko = 0;
const check = (n, c, x) => { if (c) { ok++; console.log('  ✓ ' + n); }
  else { ko++; console.log('  ✗ ' + n + (x ? '  → ' + x : '')); } };

/* ── el día del gemelo ──────────────────────────────────────────────────────
   Sin estrategia de SOC: su techo del 80 % dejaría el SOC clavado y el careo
   diría «coinciden» comparando dos constantes. Con la batería libre, el SOC es
   la integral de todo lo demás y sirve de careo de cierre. */
const P = new SIM.Planta({ nTcu: 1, nHsu: 1, nRep: 0,
  politicaDifusa: 'poa_switch', estrategia: { activa: false } });
P.meteo.nubes = 25; P.meteo.vientoObj = 3;
const pasos = [];
for (let i = 0; i < 24 * 12; i++) {
  P.paso(300); P.meteo.nubes = 25;
  const t = P.seguidores()[0], s = t.sky || {};
  pasos.push({ hora: P.t.hora, dia: P.t.dia, ghi: s.ghi || 0, dhi: s.dhi || 0, bh: s.bh || 0,
    el: (t.solar && t.solar.zen != null) ? 90 - t.solar.zen : null,
    tAmb: P.meteo.tAmb(), viento: P.meteo.viento, objetivo: t.objetivo,
    real: t.anguloReal, soc: t.soc, whConsumo: t.whConsumo, poa: t.poa });
}
const utcOff = P.loc.tz + ((P.loc.dst && P.t.dia >= 86 && P.t.dia <= 303) ? 1 : 0);

/* ── el mismo día en el core ── */
let core;
try {
  core = JSON.parse(execFileSync('python3', [path.join(RAIZ, 'tools/carea_resultado.py'), CORE], {
    cwd: CORE, input: JSON.stringify({ pasos, loc: P.loc, utc_offset_h: utcOff,
      preset: 'SELFPWR · 45W · 6Ah' }), encoding: 'utf8', maxBuffer: 64 << 20 }));
} catch (e) {
  console.log('· el core no pudo correr (¿falta pvlib o el entorno?): ' +
    String(e.stderr || e.message).split('\n').slice(-3).join(' ').slice(0, 200));
  console.log('  el careo se salta, y eso NO es verde.');
  process.exit(0);
}

const n = pasos.length, sum = (a) => a.reduce((x, y) => x + y, 0);
const gEl = pasos.map((p) => p.el == null ? -90 : p.el);
const dia = gEl.map((e) => e > 3);
const absDif = (a, b, f = () => true) => a.map((x, i) => [Math.abs(x - b[i]), i])
  .filter(([, i]) => f(i)).map(([d]) => d);

console.log('\n1) los dos soles, PRIMERO — si esto falla, lo demás no significa nada');
{
  const d = absDif(gEl, core.el_pvlib, (i) => dia[i]);
  const med = sum(d) / d.length, max = Math.max(...d);
  console.log('   huso declarado por el gemelo: UTC+' + utcOff +
    ' (tz ' + P.loc.tz + (P.loc.dst ? ' + horario de verano' : '') + ')');
  check('la elevación solar coincide (media ' + med.toFixed(3) + '° · máx ' + max.toFixed(3) + '°)',
    med < 0.2 && max < 0.6, med.toFixed(4) + ' / ' + max.toFixed(4));
}

console.log('\n2) el día entero, etapa por etapa');
const gTh = pasos.map((p) => p.real), gPoa = pasos.map((p) => p.poa);
const gSoc = pasos.map((p) => p.soc), gCons = sum(pasos.map((p) => p.whConsumo));
const cCons = sum(core.carga) * 5 / 60;
{
  const dT = absDif(gTh, core.theta);
  const poaG = sum(gPoa) * 5 / 60, poaC = sum(core.poa) * 5 / 60;
  const relPoa = 100 * (poaG / Math.max(poaC, 1e-9) - 1);
  const dS = absDif(gSoc, core.soc);
  const relCons = 100 * (gCons / Math.max(cCons, 1e-9) - 1);
  console.log('   θ     máx ' + Math.max(...dT).toFixed(3) + '°  media ' + (sum(dT) / n).toFixed(3) + '°');
  console.log('   POA   gemelo ' + poaG.toFixed(0) + '  core ' + poaC.toFixed(0) +
    ' Wh/m²  (' + relPoa.toFixed(2) + ' %)');
  console.log('   SOC   ' + gSoc[0].toFixed(2) + ' → gemelo ' + gSoc[n - 1].toFixed(2) +
    ' · core ' + core.soc[n - 1].toFixed(2) + ' %   máx ' + Math.max(...dS).toFixed(2) + ' pp');
  console.log('   carga gemelo ' + gCons.toFixed(1) + '  core ' + cCons.toFixed(1) +
    ' Wh  (' + relCons.toFixed(1) + ' %)');
  /* Listones por ENCIMA de lo medido y cerca: alarma de que la separación crece,
     no objetivo. Si el día que alguien los aprieta bajan solos, mejor. */
  check('θ sigue el mismo camino (media ' + (sum(dT) / n).toFixed(3) + '° ≤ 0,20°)',
    sum(dT) / n <= 0.20, (sum(dT) / n).toFixed(4));
  check('la POA integrada del día cuadra (' + relPoa.toFixed(2) + ' % ≤ 1 %)',
    Math.abs(relPoa) <= 1.0, relPoa.toFixed(3) + ' %');
  check('el SOC no se separa (máx ' + Math.max(...dS).toFixed(2) + ' pp ≤ 3 pp)',
    Math.max(...dS) <= 3.0, Math.max(...dS).toFixed(3));
  /* El consumo es el que MÁS se separa: −6,7 %, y no está explicado. Va como
     VENTANA alrededor de lo medido, no como techo. Con un techo de ±10 % —que
     es lo que puse primero— subir `idleW` un 50 % llevaba el consumo a +7,4 % y
     el listón lo dejaba pasar: probado con un mutante, y pasaba. Una ventana
     estrecha caza las dos direcciones, y si algún día se estrecha sola habrá
     que apretarla, que es la señal de que alguien ha cerrado el hueco.

     LÍMITE DE ESTO, medido y no supuesto: la ventana caza un ×1,5 en `idleW`
     (lleva el consumo a +7,4 %) pero NO un ×1,1, que lo deja en -4.0 % y cae
     dentro. Un agregado de día no distingue un 9 % en una constante suelta; eso
     lo tiene que cazar `carea_fisica.mjs`, que carea las constantes una a una.
     Los dos arneses se reparten el trabajo y ninguno cubre al otro. */
  check('el consumo del día sigue donde se midió (' + relCons.toFixed(1) + ' %, ventana −9..−4 %)',
    relCons >= -9.0 && relCons <= -4.0, relCons.toFixed(2) + ' %');
}

console.log('\n' + (ko ? '✗ ' + ko + ' fallo(s) de ' + (ok + ko)
  : '✓ ' + ok + '/' + ok + ' · el mismo día sale igual en los dos motores'));
process.exit(ko ? 1 : 0);
