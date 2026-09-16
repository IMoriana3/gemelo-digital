#!/usr/bin/env node
/* ARNÉS: ¿el lazo del gemelo dice lo mismo que el núcleo compartido?
 *
 * El gemelo es la CUARTA cabeza de la misma ley de control. Las otras tres son
 * `solargpt_core/direction.py` (la autoridad declarada), `js/control_core.js` de
 * cobertura-zigbee (el que comen produccion.html y el simulador de BT 3D) y
 * `overcast.html`. Un defecto que comparten todas no lo caza un careo entre
 * ellas —eso ya pasó: las cuatro paraban en la consigna y nadie lo vio hasta que
 * alguien leyó una columna de desalineo que no cambiaba de signo—, pero una
 * DIVERGENCIA sí, y esto es lo que la caza.
 *
 * Y tiene que declarar en qué se diferencian POR FÍSICA, porque el careo sin eso
 * sería un número sin significado. Son dos cosas, las dos medidas:
 *
 *   1. EL MARGEN DEL GEMELO ESTÁ CUANTIZADO A PULSOS. El firmware guarda la banda
 *      muerta en 41060/41061 en pulsos enteros, y 1,00° no es representable: son
 *      35 pulsos = 1,0079°. El núcleo trabaja en grados y usa 1,0000. Así que el
 *      paso del gemelo mide dos veces SU margen, no dos veces el del núcleo.
 *   2. EL GEMELO CIERRA EL LAZO SOBRE SU INCLINÓMETRO, no sobre la realidad: mide,
 *      luego decide. Eso es un ciclo de retraso, y a 0,17 °/s con ciclo de 1 s son
 *      0,17° de desfase. No es un error: es lo que hace un TCU de verdad, y el
 *      núcleo no lo tiene porque no tiene sensor.
 *
 * Por eso el careo es de LEY y no de trayectoria bit a bit: se neutraliza la
 * cadena del sensor (ruido, desajuste, offset, deriva y filtro) y se exige que las
 * dos trayectorias no se separen más que ese ciclo de retraso más la
 * cuantización. Si alguien cambia la ley en un lado, el desvío se va mucho más
 * arriba que eso y esto lo dice.
 *
 *     node tools/carea_lazo.mjs [--nucleo=<ruta a control_core.js>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SIM = require('../sim/planta.js');

const arg = n => (process.argv.find(a => a.startsWith('--' + n + '=')) || '').split('=')[1];
const resuelve = c => path.isAbsolute(c) ? c
  : path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', c);
/* el núcleo vive en cobertura-zigbee, al lado. No se vendoriza: una copia sería
   una quinta cabeza, que es justo lo que este arnés existe para evitar. */
let ruta = null;
/* UN `--nucleo=` QUE NO EXISTE ES UN ERROR, NO UNA SUGERENCIA. Aquí había un
   respaldo que se tragaba la ruta pedida y caía al clon de al lado, y me mordió a
   mí mismo en la primera verificación: pedí carear contra el núcleo del commit
   pinado —donde este fichero NO existe todavía, el pin es anterior al núcleo
   compartido— y el arnés dio VERDE careando contra mi árbol de trabajo. Un careo
   que mide otro fichero del que se le pidió no es un careo: es un verde que no
   puede ser otra cosa. Si se pide una ruta, es ésa o nada. */
const pedido = arg('nucleo');
if (pedido) {
  ruta = resuelve(pedido);
  if (!fs.existsSync(ruta)) {
    console.error('el --nucleo pedido no existe: ' + ruta);
    console.error('no hay respaldo a propósito: carear contra otro fichero del pedido sería un verde falso.');
    process.exit(2);
  }
} else {
  for (const c of ['../cobertura-zigbee/js/control_core.js', '../Cobertura-Zigbee/js/control_core.js']) {
    const r = resuelve(c);
    if (fs.existsSync(r)) { ruta = r; break; }
  }
  if (!ruta) {
    console.error('no encuentro js/control_core.js. Ten cobertura-zigbee al lado, o pasa --nucleo=<ruta>.');
    process.exit(2);
  }
}
new Function(fs.readFileSync(ruta, 'utf-8'))();
const C = globalThis.CTRLCORE;
if (!C || typeof C.step !== 'function') { console.error('ese fichero no publica CTRLCORE.step'); process.exit(2); }

let fallos = 0;
const ok = (cond, que, det) => {
  if (!cond) { fallos++; console.log('  ✗ ' + que + (det ? '  → ' + det : '')); }
  else console.log('  ✓ ' + que + (det ? '  · ' + det : ''));
};

/* ── el banco: un TCU con la cadena del sensor neutralizada ─────────────────── */
function tcuLimpio() {
  const p = new SIM.Planta({ nTcu: 1, nHsu: 1, nRep: 0, dia: 172, hora: 10, averias: false });
  const t = p.tcu(1), S = t.sensor;
  S.ruidoRms = 0; S.desajuste = 0; S.offsetCfg = 0; S.deriva = 0; S.tau = 1e-9;
  t.tPcb = 25; S.filtrado = 0; S.crudo = 0;
  t.anguloReal = 0; t.angulo = 0; t.park = null; t.dirUlt = 0; t.moviendo = 0;
  t.modo = SIM.MODO.AUTO;
  return t;
}
/* SERIES QUE EL ACTUADOR PUEDE SEGUIR. Ahí la trayectoria la decide la LEY, así
   que se carea contra el núcleo con la cota estrecha. Una serie que el actuador
   NO puede seguir —la rampa de abajo— va aparte y con otro invariante, porque en
   saturación la ley no se observa: manda el hierro. */
const SERIES = {
  'sube y se queda': k => (k < 30 ? 0.05 * k : 1.5),
  'sube, se queda y RETROCEDE': k => (k < 30 ? 0.05 * k : (k < 60 ? 1.5 : (k < 90 ? 1.5 - 0.05 * (k - 60) : 0))),
  'deriva como el sol': k => 0.01 * k,
};

console.log('careo del lazo: gemelo ↔ núcleo compartido');
console.log('  núcleo: ' + ruta);

for (const [nombre, f] of Object.entries(SERIES)) {
  const t = tcuLimpio();
  const dead = t.cfgTcu.dbPulsosOeste / t.sensor.pulsosGrado;   /* SU margen, en pulsos */
  const n = 120, cons = [];
  for (let k = 0; k < n; k++) cons.push(f(k));
  t.anguloReal = cons[0]; t.angulo = cons[0];
  const gem = [];
  for (const c of cons) { t.mide(1); t.objetivo = c; t.sp = SIM.SP.NINGUNA; t.criterio = SIM.CRIT.SEGUIMIENTO; t.mueve(1, false); gem.push(t.anguloReal); }

  const loop = { deadbandDeg: dead, slewDegS: SIM.K ? SIM.K.SLEW_DPS : 0.17, maxAngle: 55, modo: 'libre', cicloSeg: 1 };
  if (!(loop.slewDegS > 0)) loop.slewDegS = 0.17;
  let th = cons[0], dir = 0, park = null, dirUlt = 0;
  const nuc = [];
  for (const c of cons) {
    const r = C.step(th, c, 1, loop, false, dir, park, dirUlt);
    th = r.theta; dir = r.dir; park = r.park; dirUlt = r.dirUlt; nuc.push(th);
  }
  /* la cota: un ciclo de retraso de medida más la resolución del sensor */
  const cota = loop.slewDegS * 1 + 1 / t.sensor.pulsosGrado + 1e-9;
  let peor = 0, ip = -1;
  for (let i = 0; i < n; i++) { const d = Math.abs(gem[i] - nuc[i]); if (d > peor) { peor = d; ip = i; } }
  ok(peor <= cota, `«${nombre}»: la misma ley`,
     `peor desvío ${peor.toFixed(4)}° en el paso ${ip} (cota ${cota.toFixed(4)}°: un ciclo de ` +
     `actuador + ${(1 / t.sensor.pulsosGrado).toFixed(4)}° de resolución)`);
}

/* ── LA CONSIGNA QUE EL ACTUADOR NO PUEDE SEGUIR ────────────────────────────
   0,2 °/s contra los 0,17 del actuador: el eje va SATURADO y no alcanza nunca la
   consigna. Ahí la trayectoria la dicta el hierro, no la ley, así que carearla
   con la cota estrecha no mide lo que dice medir — MEDIDO: los dos van a tope y
   se separan 0,4162°, un hueco que viene del arranque (el gemelo decide sobre la
   medida del ciclo anterior y su margen está cuantizado a pulsos) y que la
   saturación ya no deja cerrar.
   El invariante que SÍ vale aquí es otro, y es más fuerte: el hueco no puede
   CRECER. Un hueco constante es el desfase del arranque; un hueco que crece sería
   una velocidad distinta, o sea una ley distinta. */
{
  const t = tcuLimpio();
  const dead = t.cfgTcu.dbPulsosOeste / t.sensor.pulsosGrado;
  const cons = []; for (let k = 0; k < 120; k++) cons.push(k < 60 ? -40 - 0.2 * k : 0);
  t.anguloReal = -40; t.angulo = -40; t.sensor.filtrado = -40; t.sensor.crudo = -40;
  const gem = [];
  for (const c of cons) { t.mide(1); t.objetivo = c; t.sp = SIM.SP.NINGUNA; t.criterio = SIM.CRIT.SEGUIMIENTO; t.mueve(1, false); gem.push(t.anguloReal); }
  let th = -40, dir = 0, park = null, dirUlt = 0; const nuc = [];
  for (const c of cons) {
    const r = C.step(th, c, 1, { deadbandDeg: dead, slewDegS: 0.17, maxAngle: 55, modo: 'libre', cicloSeg: 1 },
                     false, dir, park, dirUlt);
    th = r.theta; dir = r.dir; park = r.park; dirUlt = r.dirUlt; nuc.push(th);
  }
  /* los dos, a tope mientras la consigna corre más que el actuador */
  let aTopeGem = 0, aTopeNuc = 0;
  for (let i = 11; i < 55; i++) {
    if (Math.abs(gem[i] - gem[i - 1]) > 0.17 - 1e-6) aTopeGem++;
    if (Math.abs(nuc[i] - nuc[i - 1]) > 0.17 - 1e-6) aTopeNuc++;
  }
  /* uno de diferencia es el ciclo de retraso de la medida, no una discrepancia:
     el gemelo arranca sobre la medida del ciclo anterior */
  ok(Math.abs(aTopeGem - aTopeNuc) <= 1 && aTopeGem >= 40,
     'saturados los dos: la consigna corre más que el actuador',
     `${aTopeGem} pasos a tope en el gemelo y ${aTopeNuc} en el núcleo`);
  /* Y EL HUECO SOLO CRECE A SALTOS DE UN CICLO, nunca de forma continua. MEDIDO:
     en la rampa crece dos veces, un ciclo de actuador cada vez (0,1700°), y entre
     salto y salto se queda plano — cada salto es un re-enclavamiento donde el
     gemelo decide sobre la medida del ciclo anterior y paga un ciclo. Una
     VELOCIDAD distinta —o sea una ley distinta— crecería en TODOS los pasos, y
     eso es lo que este invariante caza: no es una tolerancia, es la forma de la
     discrepancia. */
  const hueco = i => Math.abs(gem[i] - nuc[i]);
  let peorCrecida = 0, saltos = 0, crecidas = 0;
  for (let i = 12; i < 55; i++) {
    const d = hueco(i) - hueco(i - 1);
    if (d > 1e-9) { crecidas++; peorCrecida = Math.max(peorCrecida, d); if (d > 1e-6) saltos++; }
  }
  ok(peorCrecida <= 0.17 + 1e-9,
     'el hueco crece como mucho UN ciclo de actuador de golpe',
     `peor crecida ${peorCrecida.toFixed(4)}° · ${saltos} saltos en 43 pasos`);
  /* el discriminador no es el número exacto —medido, 4 de 43 pasos— sino el
     ORDEN: un puñado contra todos. Con otra velocidad crecería en los 43. */
  ok(crecidas <= 10 && crecidas < 0.25 * 43 && hueco(54) <= 3 * 0.17,
     'y crece en unos pocos saltos, no en todos los pasos: no es otra velocidad',
     `${crecidas} pasos en los que crece · hueco final ${hueco(54).toFixed(4)}° ` +
     `(${(hueco(54) / 0.17).toFixed(1)} ciclos)`);
}

/* y el MUTANTE: si el núcleo parase en la consigna —la ley vieja—, el careo tiene
   que ponerse rojo. Se simula llamando al núcleo con banda 0, que es un eje sin
   histéresis y por tanto sin adelanto. */
{
  const t = tcuLimpio();
  const dead = t.cfgTcu.dbPulsosOeste / t.sensor.pulsosGrado;
  const cons = []; for (let k = 0; k < 120; k++) cons.push(k < 30 ? 0.05 * k : 1.5);
  t.anguloReal = 0; t.angulo = 0;
  const gem = [];
  for (const c of cons) { t.mide(1); t.objetivo = c; t.sp = SIM.SP.NINGUNA; t.criterio = SIM.CRIT.SEGUIMIENTO; t.mueve(1, false); gem.push(t.anguloReal); }
  let th = 0, dir = 0, park = null, dirUlt = 0; const sinAdelanto = [];
  for (const c of cons) {
    const r = C.step(th, c, 1, { deadbandDeg: 0, slewDegS: 0.17, maxAngle: 55, modo: 'libre', cicloSeg: 1 },
                     false, dir, park, dirUlt);
    th = r.theta; dir = r.dir; park = r.park; dirUlt = r.dirUlt; sinAdelanto.push(th);
  }
  let peor = 0;
  for (let i = 0; i < cons.length; i++) peor = Math.max(peor, Math.abs(gem[i] - sinAdelanto[i]));
  const cota = 0.17 + 1 / t.sensor.pulsosGrado;
  ok(peor > cota, 'el careo PUEDE ponerse rojo: contra un eje sin adelanto se separa',
     `peor desvío ${peor.toFixed(4)}° contra la cota de ${cota.toFixed(4)}°`);
  /* EL ADELANTO ES SOBRE LA CONSIGNA DEL ARRANQUE, no sobre la final: el destino
     se ENCLAVA al arrancar («vete a la consigna de AHORA más un margen») y la
     consigna sigue subiendo después. Compararlo con la consigna final fue mi
     primer error aquí: daba 2,04° contra 2,51° y parecía un fallo del gemelo. */
  let arranca = -1;
  for (let i = 1; i < gem.length; i++) if (Math.abs(gem[i] - gem[i - 1]) > 1e-9) { arranca = i; break; }
  const consArranque = cons[arranca];
  ok(arranca > 0 && Math.abs(gem[gem.length - 1] - (consArranque + dead)) < 0.17 + 1e-9,
     'el gemelo aparca UN MARGEN (el suyo, en pulsos) más allá de la consigna del ARRANQUE',
     `θ ${gem[gem.length - 1].toFixed(4)}° · consigna al arrancar ${consArranque.toFixed(4)}° ` +
     `+ margen ${dead.toFixed(4)}° = ${(consArranque + dead).toFixed(4)}°`);
}

console.log('');
if (fallos) { console.error(`✗ ${fallos} fallos`); process.exit(1); }
console.log('✓ el gemelo y el núcleo dicen la misma ley');
