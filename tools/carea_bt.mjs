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

/* ── EL TERRENO MEDIDO ──────────────────────────────────────────────────────
   Que el gemelo use el BT del hermano ya está careado arriba. Esto vigila lo
   otro: que use su TERRENO, y que el terreno haga lo que el terreno hace.
   Sin esto, el gemelo podría cargar las cotas y seguir dando un ángulo común
   sin que nadie se enterase — que es exactamente de dónde venimos. */
console.log('');
t('la T del levantamiento la arma el HERMANO, y trae lo que el llano no tiene', () => {
  const T = bt.cotasSync('ayora', 80);
  if (!T) throw new Error('no he podido armar la T de Ayora: ' + (bt.detalleCotas || '?'));
  if (!(T.nLineas > 40)) throw new Error(`solo ${T.nLineas} líneas: el bloque cargado es demasiado pequeño`);
  /* el ACCIONAMIENTO real, que es lo que acopla las mesas de un motor al mismo
     θ: sin él el BT sería un pariente del de la página, no el mismo */
  if (T.drive !== 'bifila') throw new Error(`Ayora tiene accionamiento bifila y la T dice «${T.drive}»`);
  if (!T.groups || T.groups.length < 20)
    throw new Error(`la T no trae los grupos de motor (${T.groups ? T.groups.length : 0})`);
  /* pitch por VANO y pendiente por PAREJA: el llano tiene un número y ya */
  const pit = T.pairs.map((p) => p.pitch), pen = T.pairs.map((p) => p.slope);
  const varPitch = Math.max(...pit) - Math.min(...pit);
  const varPend = Math.max(...pen) - Math.min(...pen);
  if (!(varPitch > 0.2)) throw new Error(`el pitch no varía por vano (${varPitch.toFixed(3)} m): no es un levantamiento`);
  if (!(varPend > 2)) throw new Error(`la pendiente no varía por pareja (${varPend.toFixed(2)}°)`);
  console.log(`      (${T.nLineas} líneas · ${T.groups.length} grupos · pitch ${Math.min(...pit).toFixed(2)}–${Math.max(...pit).toFixed(2)} m · pendiente ${Math.min(...pen).toFixed(2)}–${Math.max(...pen).toFixed(2)}°)`);
});

t('con terreno los equipos NO van todos al mismo θ, y en llano SÍ', () => {
  const thDe = (cotas) => {
    const P = new SIM.Planta({ nTcu: 12, nHsu: 1, nRep: 0, dia: DOY, hora: 8,
                               averias: false, loc: LOC, cotas: cotas });
    const v = [];
    for (let i = 1; i <= 12; i++) { const q = P.tcu(i); if (!q.repetidor) v.push(q.objetivoSolar); }
    return v;
  };
  const llano = thDe(null), real = thDe('ayora');
  const rep = (v) => Math.max(...v) - Math.min(...v);
  if (rep(llano) > 1e-9)
    throw new Error(`en llano los 12 equipos tendrían que compartir θ y reparten ${rep(llano).toFixed(3)}°`);
  if (!(rep(real) > 20))
    throw new Error(`con el terreno de Ayora el reparto tendría que ser grande y es ${rep(real).toFixed(2)}° — ` +
                    '¿se está cargando la T de verdad?');
  console.log(`      (llano ${rep(llano).toFixed(2)}° · Ayora ${rep(real).toFixed(2)}° de reparto entre 12 equipos)`);
});

t('y ese θ es EXACTAMENTE el que da el hermano para esa línea', () => {
  const T = bt.cotasSync('ayora', 80);
  const P = new SIM.Planta({ nTcu: 12, nHsu: 1, nRep: 0, dia: DOY, hora: 8,
                             averias: false, loc: LOC, cotas: 'ayora' });
  /* EN LA HORA REAL DE LA PLANTA, no en la que se le pidió: el constructor
     avanza un `paso(0.001)` para que el estado derivado exista, así que su
     reloj está 1 ms más allá. Comparando contra las 8 en punto el careo
     fallaba por 0,000006°, que es justo lo que el sol se mueve en ese
     milisegundo (≈0,004 °/s). No era el reparto: era el reloj. */
  const s = solGemelo(P.t.hora);
  const irr = bt.F.clearskyIneichen(s.zen, DOY, 700, 3.5);
  const a = bt.angulos(P.cfg.polBT, s.zen, s.az, T, irr, DOY, 0.2);
  let peor = 0, n = 0;
  for (let i = 1; i <= 12; i++) {
    const q = P.tcu(i);
    if (q.repetidor) continue;
    n++;
    peor = Math.max(peor, Math.abs(q.objetivoSolar - a[q.fila || 0]));
  }
  if (n < 10) throw new Error(`solo ${n} equipos mirados`);
  if (peor > 1e-9)
    throw new Error(`un equipo se aparta ${peor.toFixed(6)}° del θ de su línea: el reparto no está leyendo la T`);
  console.log(`      (${n} equipos, cada uno en el θ de su línea al bit)`);
});

t('sin cotas no se finge terreno: se queda en llano y lo dice', () => {
  const T = bt.cotasSync('planta-que-no-existe', 80);
  if (T !== null) throw new Error('una planta sin levantamiento tendría que dar null');
  if (!/sin cotas/.test(bt.detalleCotas || ''))
    throw new Error(`y decirlo: «${bt.detalleCotas}»`);
  const P = new SIM.Planta({ nTcu: 4, nHsu: 1, nRep: 0, dia: DOY, hora: 8,
                             averias: false, loc: LOC, cotas: 'planta-que-no-existe' });
  if (P.Tbt) throw new Error('la planta se ha quedado con una T inventada');
  if (!P.avisoBT) throw new Error('y sin avisar de que no hay terreno');
});

console.log('');
console.log(ko === 0 ? `OK — ${ok} careos del BT` : `${ko} FALLOS de ${ok + ko}`);
process.exit(ko === 0 ? 0 : 1);
