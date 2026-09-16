/* ═══════════════════════════════════════════════════════════════════════════
 * carea_bt.mjs — UN SOLO BACKTRACKING, Y SE COMPRUEBA.
 *
 * El gemelo tenía su propio backtracking (`angulos()` de sim/planta.js: la
 * fórmula de Anderson-Mikofski con un GCR único y el terreno llano) y la casa
 * tiene el suyo en el bloque FÍSICA PURA de cobertura-zigbee/backtracking.html,
 * con nueve políticas y el terreno medido pareja a pareja. Este arnés carea los
 * dos y vigila que el gemelo NO se quede con una versión propia.
 *
 * QUÉ SE CAREA, y por qué así:
 *
 *   1. EL SOL SE COMPARTE. Se alimenta el bloque del hermano con la posición
 *      solar del PROPIO gemelo, no con la del hermano. Si se usaran los dos
 *      soles, la diferencia que saliera sería la de los relojes y no la del
 *      backtracking — y eso ya me pasó: mezclando husos (la `loc` lleva
 *      dst:true, o sea UTC+2 en junio, y yo resté 1) salía un desfase de 13°
 *      que parecía un defecto del algoritmo y era mío.
 *
 *   2. EN LLANO TIENEN QUE COINCIDIR. Con el terreno a cero y el mismo GCR, la
 *      fórmula del gemelo y el `pairwise` del hermano son la misma matemática,
 *      así que el careo es exigente: TOL_LLANO.
 *
 *   3. EN PENDIENTE TIENEN QUE SEPARARSE. Con terreno, el hermano reparte un
 *      ángulo distinto por pareja y el gemelo no puede seguirlo con un número
 *      único: si esto NO se separase, sería que el terreno no está entrando y
 *      el careo no vigila nada. Se exige separación MÍNIMA.
 *
 *   4. LAS NUEVE POLÍTICAS ESTÁN. Se comprueba que las claves que publica
 *      sim/bt.js son exactamente las del selector de produccion.html, leídas
 *      de su fuente: si allí se añade una décima y aquí no, esto canta.
 *
 *     node tools/carea_bt.mjs [--hermano=<ruta a cobertura-zigbee>]
 * ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SIM = require('../sim/planta.js');
const BT = require('../sim/bt.js');

const arg = (n) => (process.argv.find((a) => a.startsWith('--' + n + '=')) || '').split('=')[1];

/* El hermano: la ruta que se pida, o el clon de al lado. Una ruta EXPLÍCITA que
   no existe es un ERROR y no una sugerencia — si cayera al de al lado, CI
   carearía contra un fichero que no es el del pin y daría verde por casualidad.
   Esto ya me morció una vez en carea_lazo.mjs. */
let HERM = arg('hermano');
if (HERM) {
  if (!fs.existsSync(path.join(HERM, 'backtracking.html'))) {
    console.error(`--hermano=${HERM} no tiene backtracking.html: no carearía contra el pin.`);
    process.exit(2);
  }
} else {
  HERM = ['../cobertura-zigbee', '../Cobertura-Zigbee']
    .find((d) => fs.existsSync(path.join(d, 'backtracking.html')));
  if (!HERM) {
    console.error('no encuentro cobertura-zigbee. Tenlo al lado, o pasa --hermano=<ruta>.');
    process.exit(2);
  }
}

let ok = 0, ko = 0;
const t = (nm, fn) => {
  try { fn(); ok++; console.log('  ✓ ' + nm); }
  catch (e) { ko++; console.log('  ✗ ' + nm + ' — ' + e.message); }
};

const bt = new BT();
if (!bt.cargaSync(HERM)) { console.error(bt.motivo()); process.exit(2); }
console.log('hermano: ' + bt.motivo());

/* ── el sitio y el día del careo ──────────────────────────────────────────── */
const LOC = { n: 'Ayora', lat: 39.06, lon: -1.05, tz: 1, dst: true };
const DOY = 172, N_FILAS = 10, PITCH = 6.0;
const CW = +(SIM.K.GCR * PITCH).toFixed(6);       /* la cuerda que da el GCR del gemelo */
const TOL_LLANO = 0.02;                           /* ° — misma matemática, mismo sol */
const SEPARA_MIN = 0.30;                          /* ° que el terreno TIENE que mover */

/* La T del hermano, con SUS funciones: armarla a mano es como el canario de
   produccion.html se quedó ciego una vez (el generador usaba su propia copia de
   la geometría). `pendiente` es el desnivel entre filas consecutivas, en metros. */
function Tde(pendiente) {
  const xs = Array.from({ length: N_FILAS }, (_, i) => i * PITCH);
  const z = xs.map((_, i) => i * pendiente);
  return { pairs: bt.F.pairsFromElevX(z, xs, new Array(N_FILAS).fill(0)), cw: CW, axisAz: 0, axisTilt: 0,
           maxAngle: SIM.K.AXIS_MAX, gcr: CW / PITCH,
           rowTilt: new Array(N_FILAS).fill(0), groups: null, drive: null };
}

/* Las horas del día en las que el BT manda de verdad: con el sol alto no hay
   backtracking y cualquier fórmula coincide con cualquier otra. */
const HORAS = [];
for (let h = 5; h <= 21; h += 0.25) HORAS.push(h);

/* El sol del GEMELO, que es el que se le da al hermano (punto 1 de arriba).
   ⚠ Y CON SU AZIMUT TRADUCIDO. El gemelo mide el azimut desde el SUR (0 = sur,
   negativo al este) y el bloque del hermano lo espera como pvlib, desde el
   NORTE en sentido horario (90 = este, 180 = sur). Sin el +180 el careo salía
   separándose 110°, que es el signo dado la vuelta —los dos extremos del
   recorrido— y parecía que el gemelo tenía otra fórmula. La tenía igual; era
   la convención. */
const solGemelo = (h) => {
  const P = SIM.posicionSolar(LOC, DOY, h);
  return { zen: P.zen * 180 / Math.PI, az: 180 + P.az * 180 / Math.PI,
           elev: P.el * 180 / Math.PI };
};

console.log('');
t('en LLANO el bt del gemelo y el pairwise del hermano son el mismo ángulo', () => {
  const T = Tde(0);
  let peor = 0, peorH = 0, n = 0;
  for (const h of HORAS) {
    const s = solGemelo(h);
    if (!(s.zen < 90)) continue;
    const g = SIM.angulos(LOC, DOY, h);            /* el del gemelo, en signo de la casa */
    const irr = bt.F.clearskyIneichen(s.zen, DOY, 700, 3.5);
    const a = bt.angulos('pairwise', s.zen, s.az, T, irr, DOY, 0.2);
    const d = Math.abs(g.sel - a[0]);
    n++;
    if (d > peor) { peor = d; peorH = h; }
  }
  if (n < 30) throw new Error(`solo ${n} instantes con sol: el careo no mira nada`);
  if (peor > TOL_LLANO)
    throw new Error(`se separan ${peor.toFixed(4)}° a las ${peorH} h (tope ${TOL_LLANO}°) — ` +
                    'o el gemelo tiene otra fórmula, o el GCR no es el mismo');
  console.log(`      (${n} instantes · peor ${peor.toFixed(4)}°)`);
});

t('y el hermano en PENDIENTE se separa, que es lo que el gemelo no sabe hacer', () => {
  const T = Tde(0.5);                              /* medio metro por vano ≈ 4,8° */
  let peor = 0, reparto = 0;
  for (const h of HORAS) {
    const s = solGemelo(h);
    if (!(s.zen < 90)) continue;
    const g = SIM.angulos(LOC, DOY, h);
    const irr = bt.F.clearskyIneichen(s.zen, DOY, 700, 3.5);
    const a = bt.angulos('pairwise', s.zen, s.az, T, irr, DOY, 0.2);
    peor = Math.max(peor, ...a.map((v) => Math.abs(v - g.sel)));
    reparto = Math.max(reparto, Math.max(...a) - Math.min(...a));
  }
  if (peor < SEPARA_MIN)
    throw new Error(`con pendiente el hermano solo se aparta ${peor.toFixed(3)}°: ` +
                    'el terreno no está entrando en la T y este careo no vigila nada');
  console.log(`      (peor ${peor.toFixed(2)}° · reparto entre filas hasta ${reparto.toFixed(2)}°)`);
});

t('las NUEVE políticas son las del selector de produccion.html, leídas de su fuente', () => {
  const html = fs.readFileSync(path.join(HERM, 'produccion.html'), 'utf8');
  const i0 = html.indexOf('const POLS=');
  if (i0 < 0) throw new Error('produccion.html ya no declara POLS: el careo de políticas se queda ciego');
  const trozo = html.slice(i0, html.indexOf('];', i0));
  const suyas = [...trozo.matchAll(/key:'([a-z0-9]+)'/g)].map((m) => m[1]);
  const mias = BT.POLITICAS.map((p) => p.key);
  if (suyas.join(',') !== mias.join(','))
    throw new Error(`el hermano ofrece [${suyas.join(' ')}] y sim/bt.js [${mias.join(' ')}]`);
  console.log(`      (${mias.length}: ${mias.join(' ')})`);
});

t('y todas responden con un ángulo por fila, sin NaN', () => {
  const T = Tde(0.2);
  const s = solGemelo(9);
  const irr = bt.F.clearskyIneichen(s.zen, DOY, 700, 3.5);
  for (const p of BT.POLITICAS) {
    const a = bt.angulos(p.key, s.zen, s.az, T, irr, DOY, 0.2);
    if (a.length !== N_FILAS) throw new Error(`${p.key} devuelve ${a.length} ángulos y hay ${N_FILAS} filas`);
    for (const v of a)
      if (!isFinite(v) || Math.abs(v) > SIM.K.AXIS_MAX + 1e-9)
        throw new Error(`${p.key} devuelve ${v}, fuera del tope ±${SIM.K.AXIS_MAX}`);
  }
});

/* MUTANTE: si alguien vuelve a poner una fórmula propia en el gemelo —aunque sea
   «casi igual»—, el careo del llano tiene que cazarlo. Se comprueba que la
   tolerancia es lo bastante fina moviendo el GCR un 2 %. */
t('mutante: con el GCR movido un 2 % el careo del llano se pone rojo', () => {
  const T = Tde(0);
  const Tm = { ...T, cw: CW * 1.02, gcr: (CW * 1.02) / PITCH };
  let peor = 0;
  for (const h of HORAS) {
    const s = solGemelo(h);
    if (!(s.zen < 90)) continue;
    const g = SIM.angulos(LOC, DOY, h);
    const irr = bt.F.clearskyIneichen(s.zen, DOY, 700, 3.5);
    const a = bt.angulos('pairwise', s.zen, s.az, Tm, irr, DOY, 0.2);
    peor = Math.max(peor, Math.abs(g.sel - a[0]));
  }
  if (peor <= TOL_LLANO)
    throw new Error(`con el GCR un 2 % distinto solo se separa ${peor.toFixed(4)}°: la tolerancia es ciega`);
  console.log(`      (se separa ${peor.toFixed(3)}°, muy por encima del tope ${TOL_LLANO}°)`);
});

console.log('');
console.log(ko === 0 ? `OK — ${ok} careos del BT` : `${ko} FALLOS de ${ok + ko}`);
process.exit(ko === 0 ? 0 : 1);
