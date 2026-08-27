#!/usr/bin/env node
/* CAREO DE LA TRANSPOSICIÓN QUE DECIDE (GEM-CIELO-01 → 02)
   =========================================================
   `TCU.poaDe` (sim/planta.js) le da a la política de difusa la función θ → POA
   con la que PUNTÚA candidatos, y de ahí sale el ángulo al que apunta el
   seguidor. El core puntúa esa MISMA decisión con Perez 1990
   (`poa_switch_flat_mode` → `_poa_perez_for_theta`, solargpt_core/poa.py).

   HASTA GEM-CIELO-02 `poaAt` repartía la difusa de forma ISÓTROPA. Este arnés
   nació midiendo ese hueco —8,43 % de las condiciones de cielo cerrado decidían
   distinto, con el hueco medio del cociente a ×2 de la banda de histéresis— y
   fijándolo para que no creciera en silencio. Portado Perez, ese hueco es CERO
   y el arnés cambia de trabajo: ya no mide una separación, CAREA `poaAt` contra
   pvlib. Los listones de entonces se pusieron para ponerse rojos justo cuando
   alguien portara Perez; se pusieron rojos, y aquí están sustituidos.

   Lo que se comprueba ahora, en este orden:
     1. `poaAt` reproduce pvlib en 27 anclas — la única verdad EXTERNA del
        fichero, y la que caza un error conceptual compartido;
     2. las dos copias de `poaAt` (sim/fisica.js y bateria.html) son la misma;
     3. el día del año se USA de verdad — si no, Perez pierde hasta 2,39 %;
     4. y sobre 6930 condiciones, `poaAt` y una implementación INDEPENDIENTE de
        Perez escrita aquí deciden lo mismo. Es el careo de espejo: textos
        distintos, misma física.

       node tools/carea_difusa.mjs
*/
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const F = require('../sim/fisica.js');
const poaAt = F.poaAt;
const D2R = Math.PI / 180, ALB = 0.2;

let ok = 0, ko = 0;
const check = (n, c, x) => { if (c) { ok++; console.log('  ✓ ' + n); }
  else { ko++; console.log('  ✗ ' + n + (x ? '  → ' + x : '')); } };

/* ── Perez 1990 (allsitescomposite1990), portado del motor de la ficha
      `comparador-estructuras.html`, que ya se carea contra el core. Aquí es
      ORÁCULO, no espejo: no se le pide que se parezca a poaAt, se le pide que
      reproduzca pvlib, y las anclas de abajo lo comprueban. ── */
const PEREZ_F = [
  [1.065, -0.008, 0.588, -0.062, -0.060, 0.072, -0.022],
  [1.230, 0.130, 0.683, -0.151, -0.019, 0.066, -0.029],
  [1.500, 0.330, 0.487, -0.221, 0.055, -0.064, -0.026],
  [1.950, 0.568, 0.187, -0.295, 0.109, -0.152, -0.014],
  [2.800, 0.873, -0.392, -0.362, 0.226, -0.462, 0.001],
  [4.500, 1.132, -1.237, -0.412, 0.288, -0.823, 0.056],
  [6.200, 1.060, -1.600, -0.359, 0.264, -1.127, 0.131],
  [Infinity, 0.678, -0.327, -0.250, 0.156, -1.377, 0.251],
];
function perezSky(dhi, dni, e0, zenDeg, am, cosAOI, tiltDeg) {
  if (!(dhi > 0) || !isFinite(am)) return 0;
  const z = zenDeg * D2R, k = 1.041;
  const eps = ((dhi + Math.max(0, dni)) / dhi + k * z * z * z) / (1 + k * z * z * z);
  const delta = dhi * am / Math.max(e0, 1);
  let r = PEREZ_F[PEREZ_F.length - 1];
  for (const row of PEREZ_F) if (eps < row[0]) { r = row; break; }
  const F1 = Math.max(0, r[1] + r[2] * delta + r[3] * z);
  const F2 = r[4] + r[5] * delta + r[6] * z;
  const A = Math.max(0, cosAOI), B = Math.max(Math.cos(85 * D2R), Math.cos(z));
  const cb = Math.cos(tiltDeg * D2R), sb = Math.sin(tiltDeg * D2R);
  return dhi * 0.5 * (1 - F1) * (1 + cb) + dhi * F1 * A / B + dhi * F2 * sb;
}
const cosAOIde = (zenDeg, azNdeg, tiltDeg, sazDeg) =>
  Math.cos(zenDeg * D2R) * Math.cos(tiltDeg * D2R) +
  Math.sin(zenDeg * D2R) * Math.sin(tiltDeg * D2R) * Math.cos((azNdeg - sazDeg) * D2R);
function poaPerez(zenDeg, azNdeg, tiltDeg, sazDeg, ghi, dni, dhi, e0, am) {
  const c = cosAOIde(zenDeg, azNdeg, tiltDeg, sazDeg);
  const cb = Math.cos(tiltDeg * D2R);
  return Math.max(0, dni * Math.max(0, c)) +
         perezSky(dhi, dni, e0, zenDeg, am, c, tiltDeg) +
         ALB * Math.max(0, ghi) * (1 - cb) / 2;
}

const ANCLAS = JSON.parse(fs.readFileSync(new URL('./_anclas_perez.json', import.meta.url)));
/* puente: las anclas hablan en (tilt, surface_azimuth) y `poaAt` en rotación de
   eje N-S. θ NEGATIVO mira al ESTE (surface_azimuth 90) — comprobado contra
   pvlib.tracking.singleaxis, no deducido. Las anclas van con E0 = 1367, así que
   se llama SIN día para no meter el factor orbital en el careo. */
const anclaAPoaAt = (c) => {
  const R = c.tilt === 0 ? 0 : (c.saz === 90 ? -c.tilt : c.tilt);
  const el = (90 - c.zen) * D2R, az = (c.azN - 180) * D2R;
  return poaAt(R, el, az, c.dni * Math.cos(c.zen * D2R), c.dhi, c.ghi);
};

console.log('\n1) `poaAt` contra pvlib — la única verdad EXTERNA del fichero');
{
  let peorP = 0, peorO = 0, arg = null;
  for (const c of ANCLAS.casos) {
    const dP = Math.abs(anclaAPoaAt(c) - c.poa) / Math.max(c.poa, 1);
    const dO = Math.abs(poaPerez(c.zen, c.azN, c.tilt, c.saz, c.ghi, c.dni, c.dhi, c.e0, c.am) - c.poa) / Math.max(c.poa, 1);
    if (dP > peorP) { peorP = dP; arg = c; }
    if (dO > peorO) peorO = dO;
  }
  check('`poaAt` reproduce pvlib en las ' + ANCLAS.casos.length + ' anclas (peor ' +
    (100 * peorP).toFixed(4) + ' %)', peorP < 1e-3,
    arg ? 'peor en zen=' + arg.zen + ' tilt=' + arg.tilt + ' saz=' + arg.saz : '');
  check('y el oráculo independiente también (peor ' + (100 * peorO).toFixed(4) + ' %)',
    peorO < 1e-3);
}

console.log('\n1b) las DOS copias de poaAt, y el día del año');
{
  const txt = f => {
    const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
    const i = src.indexOf('function poaAt(');
    let d = 0, j = src.indexOf('{', i);
    for (let k = j; k < src.length; k++) {
      if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); }
    }
  };
  check('sim/fisica.js y bateria.html llevan la MISMA poaAt, carácter a carácter',
    txt('../sim/fisica.js') === txt('../bateria.html'),
    'dos copias que se separan son dos físicas');
  /* Si el día se ignorase, esto daría 0 y nadie se enteraría: el factor orbital
     es pequeño y mudo. Medido sobre el peor caso conocido, 2,39 %. */
  const c = ANCLAS.casos.find(x => x.tilt === 30);
  const sinDia = anclaAPoaAt(c);
  const enero = poaAt(-c.tilt, (90 - c.zen) * D2R, (c.azN - 180) * D2R,
    c.dni * Math.cos(c.zen * D2R), c.dhi, c.ghi, 3);
  check('el día del año se USA (sin día ' + sinDia.toFixed(3) + ' · en perihelio ' +
    enero.toFixed(3) + ')', Math.abs(enero - sinDia) > 1e-6,
    'si son iguales, el parámetro está muerto y Perez pierde hasta 2,39 %');
}

/* ── la rejilla donde la política de difusa vive: cielo cerrado ── */
const ENTRA = 1.02;          // poa_switch_enter_ratio del core (tracker.py)
const GCR = 2.382 / 6.0, AXIS_MAX = 55;
function thetaBt(elRad, azRad) {
  const sx = Math.cos(elRad) * Math.sin(azRad), sz = Math.sin(elRad);
  const Rt = Math.atan2(sx, sz);
  const t = Math.min(1, (1 / GCR) * Math.cos(Rt));
  return Math.max(-AXIS_MAX, Math.min(AXIS_MAX, (Rt - Math.sign(Rt) * Math.acos(t)) / D2R));
}
function erbsKd(kt) {          // Erbs 1982, el mismo reparto que usa el gemelo
  if (kt <= 0.22) return 1 - 0.09 * kt;
  if (kt <= 0.80) return 0.9511 - 0.1604 * kt + 4.388 * kt ** 2 - 16.638 * kt ** 3 + 12.336 * kt ** 4;
  return 0.165;
}
const malla = [];
for (let elev = 5; elev <= 85; elev += 2.5)
  for (let kt = 0.05; kt <= 0.78; kt += 0.025)
    for (const azS of [-90, -60, -30, 0, 30, 60, 90]) {
      const zen = 90 - elev, e0 = 1367;
      const ghi = e0 * Math.cos(zen * D2R) * kt; if (ghi <= 5) continue;
      const dhi = ghi * erbsKd(kt), bh = ghi - dhi;
      const dni = bh / Math.max(Math.cos(zen * D2R), 1e-6);
      const am = 1 / (Math.cos(zen * D2R) + 0.50572 * Math.pow(96.07995 - zen, -1.6364));
      const azG = azS * D2R, azN = azS + 180, el = elev * D2R;
      const th = thetaBt(el, azG);
      const iT = poaAt(th, el, azG, bh, dhi, ghi), iF = poaAt(0, el, azG, bh, dhi, ghi);
      /* signo: en pvlib θ NEGATIVO mira al ESTE (surface_azimuth 90) y positivo al
         OESTE (270) — comprobado contra pvlib.tracking.singleaxis, no deducido.
         Con el mapeo al revés la POA isótropa salía un 422 % de la de Perez. */
      const pT = poaPerez(zen, azN, Math.abs(th), th >= 0 ? 270 : 90, ghi, dni, dhi, e0, am);
      const pF = poaPerez(zen, azN, 0, 180, ghi, dni, dhi, e0, am);
      if (iT < 1 || pT < 1) continue;
      malla.push({ elev, kt, azS, th, rIso: iF / iT, rPz: pF / pT, iT, pT, poaAtT: iT });
    }
const disc = malla.filter(m => (m.rIso >= ENTRA) !== (m.rPz >= ENTRA));
const nIso = malla.filter(m => m.rIso >= ENTRA).length;
const nPz = malla.filter(m => m.rPz >= ENTRA).length;
const gapMax = Math.max(...malla.map(m => Math.abs(m.rIso - m.rPz)));
const gapMed = malla.reduce((a, m) => a + Math.abs(m.rIso - m.rPz), 0) / malla.length;
const gapsOrd = malla.map(m => Math.abs(m.rIso - m.rPz)).sort((x, y) => x - y);
const gapP95 = gapsOrd[Math.floor(0.95 * gapsOrd.length)];
const pctDisc = 100 * disc.length / malla.length;

console.log('\n2) careo de espejo: `poaAt` contra la implementación independiente');
console.log('   rejilla: ' + malla.length + ' combinaciones (elev 5..85°, kt 0,05..0,78, 7 azimutes)');
console.log('   entra en PLANO:  poaAt ' + nIso + '   ·   oráculo ' + nPz);
console.log('   decisiones que difieren: ' + disc.length + '  (' + pctDisc.toFixed(2) + ' %)');
console.log('   |r_poaAt − r_oráculo|: máx ' + gapMax.toFixed(6) + ' · media ' + gapMed.toFixed(6));
/* Antes de GEM-CIELO-02 esto medía un hueco de 8,43 % de decisiones y lo fijaba
   por arriba para que no creciera. Portado Perez el hueco es CERO, así que el
   listón se da la vuelta: ya no acota cuánto puede separarse, exige que NO se
   separe. Dos textos distintos, la misma física — que es lo que pide el espejo. */
check('ninguna de las ' + malla.length + ' condiciones decide distinto (' + disc.length + ')',
  disc.length === 0, disc.length + ' desacuerdos: el porte de Perez está incompleto');
check('y el cociente coincide hasta ' + gapMax.toExponential(1) + ' (≤ 1e-9)',
  gapMax <= 1e-9, gapMax.toExponential(3));

console.log('\n3) el circunsolar está DENTRO, que era el 3,67 % que faltaba');
{
  /* La prueba de que el porte sigue puesto no es que Perez y Perez coincidan
     —eso lo haría también si alguien revirtiera las DOS copias a la vez—, sino
     que `poaAt` está POR ENCIMA de un cielo isótropo en la medida conocida. La
     isótropa se calcula aquí, y es literalmente el término que se sustituyó. */
  const claros = malla.filter(m => m.kt >= 0.70);
  let suma = 0;
  for (const m of claros) {
    const z = 90 - m.elev, e0 = 1367, ghi = e0 * Math.cos(z * D2R) * m.kt;
    const dhi = ghi * erbsKd(m.kt), bh = ghi - dhi;
    const azG = m.azS * D2R, el = m.elev * D2R;
    const R = m.th * D2R, sx = Math.cos(el) * Math.sin(azG), sz = Math.sin(el);
    const cosAOI = Math.max(0, sx * Math.sin(R) + sz * Math.cos(R));
    const cb = Math.cos(Math.abs(R));
    const iso = Math.max(0, bh) * cosAOI / Math.max(Math.sin(el), 0.087) +
                Math.max(0, dhi) * (1 + cb) / 2 + ALB * Math.max(0, ghi) * (1 - cb) / 2;
    suma += (m.poaAtT - iso) / iso;
  }
  const med = 100 * suma / claros.length;
  console.log('   kt ≥ 0,70: ' + claros.length + ' pasos · `poaAt` da ' + med.toFixed(2) +
    ' % más que el cielo isótropo que había antes');
  check('el circunsolar aporta lo medido en GEM-CIELO-01 (+' + med.toFixed(2) + ' %, esperado ~+3,8 %)',
    med > 3.0 && med < 4.5, med.toFixed(3) + ' %');
}

console.log('\n' + (ko ? 'FALLOS: ' + ko + ' (de ' + (ok + ko) + ')'
  : 'OK — ' + ok + '/' + ok + ' · `poaAt` es Perez, y lo dice pvlib'));
process.exit(ko ? 1 : 0);
