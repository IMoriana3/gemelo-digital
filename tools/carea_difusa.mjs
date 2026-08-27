#!/usr/bin/env node
/* CAREO DE LA TRANSPOSICIÓN QUE DECIDE (GEM-CIELO-01)
   ===================================================
   `TCU.poaDe` (sim/planta.js) le da a la política de difusa la función θ → POA
   con la que PUNTÚA candidatos, y de ahí sale el ángulo al que apunta el
   seguidor. Esa función es `poaAt`, y `poaAt` transpone la difusa de forma
   ISÓTROPA — lo dice su propio comentario en `bateria.html`.

   El core toma esa MISMA decisión con Perez: `poa_switch_flat_mode` puntúa con
   `_poa_perez_for_theta` (solargpt_core/poa.py), y eso está en `main` hoy.

   POR QUÉ NO LO VEÍA NADIE. `tools/carea_fisica.mjs` deja `poaAt` fuera con la
   nota «contraparte solo en tcu_availability (sin mergear)». Es cierto para su
   uso como auxiliar de disponibilidad de batería. Pero `poaAt` tiene DOS usos,
   y el otro —puntuar la decisión de difusa— sí tiene contraparte en `main`. La
   exención es por FUNCIÓN y el hueco es por USO, así que la mitad que sí se
   puede vigilar llevaba sin vigilarse.

   ESTO NO CAMBIA LA FÍSICA. Mide la separación y la fija, para que deje de
   crecer en silencio y para que la decisión de portar Perez al gemelo se tome
   con el número delante, no de oído.

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

console.log('\n1) el oráculo contra pvlib — si esto falla, lo de abajo no dice nada');
{
  const A = JSON.parse(fs.readFileSync(new URL('./_anclas_perez.json', import.meta.url)));
  let peor = 0, arg = null;
  for (const c of A.casos) {
    const got = poaPerez(c.zen, c.azN, c.tilt, c.saz, c.ghi, c.dni, c.dhi, c.e0, c.am);
    const d = Math.abs(got - c.poa) / Math.max(c.poa, 1);
    if (d > peor) { peor = d; arg = [c, got]; }
  }
  check('Perez portado reproduce pvlib en las ' + A.casos.length + ' anclas (peor ' +
    (100 * peor).toFixed(4) + ' %)', peor < 1e-3,
    arg ? arg[1].toFixed(3) + ' vs ' + arg[0].poa.toFixed(3) : '');
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
      malla.push({ elev, kt, azS, th, rIso: iF / iT, rPz: pF / pT, iT, pT });
    }
const disc = malla.filter(m => (m.rIso >= ENTRA) !== (m.rPz >= ENTRA));
const nIso = malla.filter(m => m.rIso >= ENTRA).length;
const nPz = malla.filter(m => m.rPz >= ENTRA).length;
const gapMax = Math.max(...malla.map(m => Math.abs(m.rIso - m.rPz)));
const gapMed = malla.reduce((a, m) => a + Math.abs(m.rIso - m.rPz), 0) / malla.length;
const gapsOrd = malla.map(m => Math.abs(m.rIso - m.rPz)).sort((x, y) => x - y);
const gapP95 = gapsOrd[Math.floor(0.95 * gapsOrd.length)];
const pctDisc = 100 * disc.length / malla.length;

console.log('\n2) la separación, medida — no cambia nada, la fija');
console.log('   rejilla: ' + malla.length + ' combinaciones (elev 5..85°, kt 0,05..0,78, 7 azimutes)');
console.log('   entra en PLANO:  isótropa ' + nIso + '   ·   Perez ' + nPz);
console.log('   decisiones que difieren: ' + disc.length + '  (' + pctDisc.toFixed(1) + ' %)');
console.log('   |r_iso − r_perez|: máx ' + gapMax.toFixed(3) + ' · media ' + gapMed.toFixed(3) +
  '   (la banda de histéresis mide 0,02)');

const soloIso = disc.filter(m => m.rIso >= ENTRA).length;
const soloPz = disc.filter(m => m.rPz >= ENTRA).length;
const ktMax = Math.max(...disc.map(m => m.kt));
console.log('   y va en las DOS direcciones: la isótropa aplana y Perez no en ' + soloIso +
  ' · al revés en ' + soloPz);
console.log('   todos con kt ≤ ' + ktMax.toFixed(2) + ' — cielo cerrado, que es donde vive la política');
/* Los listones van POR ENCIMA de lo medido hoy y CERCA: no son un objetivo, son
   una alarma de que la separación CRECE. Si alguien porta Perez al gemelo se
   desploman, y entonces hay que apretarlos — igual que en CENTINELA-01. */
check('la separación de decisión no ha crecido (' + pctDisc.toFixed(2) + ' % ≤ 12 %)',
  pctDisc <= 12, pctDisc.toFixed(2) + ' %');
/* Lo que convierte esto en un hallazgo y no en ruido: el hueco MEDIO del
   cociente es mayor que la banda de histéresis entera sobre la que la política
   está afinada. O sea que no es un temblor dentro del margen — mueve la
   decisión. */
check('el hueco medio (' + gapMed.toFixed(4) + ') SUPERA la banda de histéresis (0,0200): ×' +
  (gapMed / 0.02).toFixed(1), gapMed > 0.02 && gapMed <= 0.08,
  gapMed.toFixed(4) + ' contra 0,0200');
check('el p95 del hueco es ' + (gapP95 / 0.02).toFixed(1) + '× la banda (' + gapP95.toFixed(4) + ')',
  gapP95 > 0.02 && gapP95 <= 0.30, gapP95.toFixed(4));
/* El desacuerdo NO es sistemático en un sentido: si lo fuera bastaría un sesgo
   constante para taparlo, y no basta. Van los dos sentidos. */
check('el desacuerdo va en las dos direcciones (' + soloIso + ' / ' + soloPz + ')',
  soloIso > 0 && soloPz > 0);
check('y está confinado al cielo CERRADO (kt ≤ ' + ktMax.toFixed(2) + ' ≤ 0,45)',
  ktMax <= 0.45, 'kt máximo con desacuerdo ' + ktMax.toFixed(3));

console.log('\n3) y en cielo DESPEJADO la separación es de energía, no de decisión');
{
  const claros = malla.filter(m => m.kt >= 0.70);
  const rel = claros.map(m => (m.iT - m.pT) / m.pT);
  const med = rel.reduce((a, b) => a + b, 0) / rel.length;
  const discClaro = claros.filter(m => (m.rIso >= ENTRA) !== (m.rPz >= ENTRA)).length;
  console.log('   kt ≥ 0,70: ' + claros.length + ' pasos · la isótropa da ' +
    (100 * med).toFixed(2) + ' % de POA (se deja el circunsolar)');
  check('con cielo claro casi no cambia la DECISIÓN (' + discClaro + ' de ' + claros.length + ')',
    discClaro / claros.length < 0.15, discClaro + '/' + claros.length);
  check('pero sí la ENERGÍA, y siempre por debajo (' + (100 * med).toFixed(2) + ' %)',
    med < 0 && med > -0.15, (100 * med).toFixed(2) + ' %');
}

console.log('\n' + (ko ? 'FALLOS: ' + ko + ' (de ' + (ok + ko) + ')'
  : 'OK — ' + ok + '/' + ok + ' · la separación está medida y fijada, no corregida'));
process.exit(ko ? 1 : 0);
