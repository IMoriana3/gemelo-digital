#!/usr/bin/env node
/* Prueba de humo del motor: recorre un día entero de planta y comprueba que lo
   que sale por los registros es lo que dice el mapa. Decodifica AL REVÉS que
   planta.js (como lo haría el colector de scada, no como lo escribió el motor):
   si un día alguien cambia el orden de palabra o una escala, esto se cae.

       node sim/prueba.mjs
*/
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SIM = require('./planta.js');

let fallos = 0, hechas = 0;
function ok(cond, que, detalle) {
  hechas++;
  if (!cond) { fallos++; console.log('  ✗ ' + que + (detalle ? '  → ' + detalle : '')); }
  else console.log('  ✓ ' + que + (detalle ? '  · ' + detalle : ''));
}
function casi(a, b, tol, que) { ok(Math.abs(a - b) <= tol, que, a.toFixed(3) + ' vs ' + b.toFixed(3)); }

/* --- decodificadores: los del colector (scada/collector/decode.py), a mano --- */
const f32de = (hi, lo) => { const b = new ArrayBuffer(4), d = new DataView(b); d.setUint16(0, hi); d.setUint16(2, lo); return d.getFloat32(0); };
const s16de = v => v >= 32768 ? v - 65536 : v;
const u32de = (hi, lo) => (hi * 65536 + lo) >>> 0;
const bitde = (w, lsb, msb) => (w >> lsb) & ((1 << (msb - lsb + 1)) - 1);
const bcdde = b => (b >> 4) * 10 + (b & 0x0F);

const P = new SIM.Planta({ nTcu: 12, nHsu: 2, nRep: 1, grupos: 4, dia: 172, hora: 6 });

console.log('\n── arranque: amanecer, sin viento ──');
for (let i = 0; i < 60 * 60; i += 10) P.paso(10);      /* hasta las 7:00 */
let t = P.tcu(1), R = P.regsNCU(), b = 30500;
casi(f32de(R[b + 6], R[b + 7]) * 180 / Math.PI, t.angulo, 0.01, 'ángulo del bloque compacto (F32 rad)');
casi(f32de(R[b + 10], R[b + 11]) * 180 / Math.PI, t.objetivo, 0.01, 'objetivo del bloque compacto');
ok(R[b + 13] === Math.round(t.soc), 'SoC en el byte bajo (erratum R7.1)', R[b + 13] + '%');
casi(R[b + 19] / 10 - 273.15, t.tPcb, 0.1, 'temperatura de PCB en K×10');
ok(bitde(R[b + 1], 8, 9) === t.modo, 'modo de operación en bits 9:8', SIM.MODO_TXT[t.modo]);

console.log('\n── mediodía SOLAR: seguimiento con backtracking ──');
/* ojo con la hora: en Gorraiz el mediodía solar cae sobre las 14:06 civiles
   (longitud −1,58° contra el huso +2 de verano). A las 12:00 del reloj el
   seguidor está a −30°, y eso es lo correcto. */
while (P.t.hora < 12) P.paso(30);
t = P.tcu(1);
ok(t.solar.dia, 'la TCU sabe que es de día');
ok(t.angulo < -20 && t.angulo > -40, 'a las 12:00 civiles mira al este (son las 9:53 solares)', t.angulo.toFixed(1) + '°');
while (P.t.hora < 14.1) P.paso(30);
t = P.tcu(1);
ok(Math.abs(t.angulo) < 4, 'en el mediodía solar sí está plano', t.angulo.toFixed(1) + '°');
let Rt = P.regsTCU(t);
casi(s16de(Rt[30111]) / 10, t.angulo, 0.05, 'tilt propio de la TCU (×10)');
casi(s16de(Rt[30117]) / 100, t.solar.real, 0.05, 'true tracking (×100)');
casi(s16de(Rt[30118]) / 100, t.solar.bt, 0.05, 'backtracking (×100)');
ok((Rt[30096] & 0xFF) === Math.round(t.soc) && (Rt[30096] >> 8) === Math.round(t.soh), 'SoC/SoH empaquetados en 30096');
const f = P.fechaSim();
ok(bcdde(Rt[30080] >> 8) === f.dia && bcdde(Rt[30080] & 0xFF) === f.hora, 'reloj BCD [día|hora] en 30080');

console.log('\n── viento: 65 km/h, abanderamiento total ──');
P.meteo.viento = 18.1;                                  /* 65 km/h */
for (let i = 0; i < 40 * 60; i += 5) P.paso(5);
t = P.tcu(1); R = P.regsNCU();
ok(P.ncu.nivelVientoGlobal === 2, 'la NCU ve nivel de viento 2', 'nivel ' + P.ncu.nivelVientoGlobal);
ok(bitde(R[30002], 2, 4) === 2, 'nivel más alto republicado en 30002 bits 4:2');
ok(t.sp === SIM.SP.VIENTO, 'la TCU entra en SP1 viento', t.estadoTxt());
/* el lazo para dentro de media banda muerta (0,65°), no clavado: perseguir el
   objetivo con más finura que el ruido del sensor es lo que lo hacía cacear */
ok(Math.abs(Math.abs(t.angulo) - 55) < 1.5, 'el seguidor llega a defensa ±55°', t.angulo.toFixed(1) + '°');
ok(bitde(P.regsTCU(t)[30001], 13, 15) === 1, 'safe position activa = 1 en bits 15:13');

console.log('\n── el lado se FIJA al abanderar ──');
/* lección de terreno.html: si abandera por la mañana mirando al este, se queda al
   este aunque el sol cruce el mediodía. Recalcular el lado a media bandera manda al
   seguidor a cruzar 110° con viento fuerte — justo lo que el abanderamiento evita. */
const pl = new SIM.Planta({ nTcu: 1, nHsu: 1, nRep: 0, dia: 172, hora: 9 });
pl.meteo.viento = 18.5;                                  /* 67 km/h desde el arranque */
for (let i = 0; i < 40 * 60; i += 10) pl.paso(10);
const ladoMañana = Math.sign(pl.tcu(1).anguloReal);
ok(pl.tcu(1).sp === SIM.SP.VIENTO, 'abandera por la mañana', pl.tcu(1).anguloReal.toFixed(0) + '°');
/* cara al SOL: por la mañana el sol está al este, así que la bandera va al este (θ<0).
   El canon usa azimut pvlib (90°=este) y aquí el azimut es 0 en el mediodía solar. */
ok(ladoMañana < 0, 'y lo hace hacia el ESTE, que es donde está el sol');
let cruce = 0, prevA = pl.tcu(1).anguloReal;
while (pl.t.hora < 17) {                                  /* cruzando el mediodía solar */
  pl.paso(30);
  cruce = Math.max(cruce, Math.abs(pl.tcu(1).anguloReal - prevA)); prevA = pl.tcu(1).anguloReal;
}
ok(Math.sign(pl.tcu(1).anguloReal) === ladoMañana,
   'sigue en el mismo lado después del mediodía solar', pl.tcu(1).anguloReal.toFixed(0) + '°');
ok(cruce < 1, 'y no ha dado ningún viaje al otro lado con el viento encima');

console.log('\n── la cuenta atrás para desabanderar ──');
/* Abanderado son DOS estados y confundirlos es lo que hace que nadie entienda por qué
   el campo sigue de canto con el día en calma: mientras sopla por encima del umbral la
   histéresis se REARMA en cada paso —eso es una alarma, no una espera— y solo cuando el
   viento baja empiezan a contar los 30 min de `destow_hold_minutes`. */
{
  const pc = new SIM.Planta({ nTcu: 1, nHsu: 1, nRep: 0, dia: 172, hora: 11 });
  pc.meteo.viento = 18.5;                                 /* 67 km/h */
  for (let i = 0; i < 10 * 60; i += 10) pc.paso(10);
  const c = pc.tcu(1);
  ok(c.stow === 2 && c.stowRearma === true,
     'con el viento por encima del umbral la bandera no espera: está en alarma',
     'estado ' + c.stow + ' · rearma ' + c.stowRearma);
  ok(c.stowCuenta === 0,
     'y no hay cuenta atrás que pintar: la histéresis se rearma en cada paso');
  /* y las dos posiciones ya no coinciden: eso es exactamente lo que la protección pisa */
  ok(Math.abs(c.objetivo - c.objetivoSolar) > 10,
     'el objetivo SOLAR sigue pidiendo seguimiento mientras el de verdad está en bandera',
     'solar ' + c.objetivoSolar.toFixed(1) + '° · manda ' + c.objetivo.toFixed(1) + '°');

  pc.meteo.viento = 2;                                    /* amaina de golpe: 7 km/h */
  pc.paso(10);
  ok(c.stowRearma === false && c.stowCuenta > 1700,
     'en cuanto baja, la cuenta atrás arranca entera', 'quedan ' + Math.round(c.stowCuenta) + ' s');
  const antes = c.stowCuenta;
  for (let i = 0; i < 300; i += 10) pc.paso(10);
  ok(c.stowCuenta < antes - 250 && c.stow === 2,
     'y descuenta de verdad sin soltar la bandera antes de tiempo',
     Math.round(antes) + ' → ' + Math.round(c.stowCuenta) + ' s');
  for (let i = 0; i < 30 * 60; i += 10) pc.paso(10);
  ok(c.stow === 0 && c.stowCuenta === 0,
     'pasada la histéresis suelta la bandera', 'estado ' + c.stow);
  casi(c.objetivo, c.objetivoSolar, 0.01,
       'y entonces las dos posiciones vuelven a ser la misma');
}

console.log('\n── el viento no salta, y las rachas rachean ──');
{
  const pv = new SIM.Planta({ nTcu: 1, nHsu: 1, nRep: 0, dia: 172, hora: 10 });
  pv.meteo.ponViento(0);
  pv.meteo.pideViento(27.8);                       /* 100 km/h pedidos */
  const t = [];
  for (let k = 0; k < 16; k++) { pv.paso(30); t.push(pv.meteo.viento * 3.6); }
  ok(t[0] < 25 && t[0] > 3, 'medio minuto después aún no ha llegado ni a un cuarto',
     t[0].toFixed(0) + ' km/h de 100');
  ok(t.every((v, i) => i === 0 || v > t[i - 1]), 'y sube de forma monótona, sin escalones');
  ok(t[15] > 80 && t[15] < 100, 'a los ocho minutos ronda el valor pedido',
     t[15].toFixed(0) + ' km/h');

  /* escribir `viento` a pelo SÍ salta: es lo que quiere una prueba que monta un temporal */
  pv.meteo.viento = 5;
  pv.paso(1);
  ok(Math.abs(pv.meteo.viento - 5) < 0.1, 'pero escribir meteo.viento a pelo sigue saltando',
     pv.meteo.viento.toFixed(1) + ' m/s');

  /* la racha es un PICO, no un porcentaje fijo: tiene que variar sola */
  pv.meteo.ponViento(12); pv.meteo.rachas = 0.4;
  for (let k = 0; k < 40; k++) pv.paso(5);
  const g = [];
  for (let k = 0; k < 60; k++) { pv.paso(5); g.push(+(pv.hsus[0].racha / pv.hsus[0].viento).toFixed(2)); }
  const distintos = new Set(g).size;
  ok(distintos > 10, 'la racha va y viene, no es un factor plano',
     distintos + ' valores distintos en 60 muestras');
  ok(Math.min.apply(null, g) >= 1 && Math.max.apply(null, g) > 1.1,
     'y siempre SUMA sobre la media, con picos por encima',
     '×' + Math.min.apply(null, g).toFixed(2) + ' … ×' + Math.max.apply(null, g).toFixed(2));

  /* El nivel lo decide la MEDIA, y la forma exacta de comprobarlo es que la turbulencia
     NO lo cambie: misma media, misma semilla, `rachas` de 0 a tope. Si lo decidiera el
     pico —como antes, con `max(media, racha)`— el equipo abanderaría del todo con cada
     ráfaga de tres segundos. Elegir un viento «lejos de los umbrales» no vale: la media
     de la propia estación varía un 18 % y siempre acaba pisando alguno. */
  const nivelCon = (rachas) => {
    const q = new SIM.Planta({ nTcu: 1, nHsu: 1, nRep: 0, dia: 172, hora: 10 });
    q.meteo.ponViento(12); q.meteo.rachas = rachas;
    const vistos = [];
    let picos = 0;
    for (let k = 0; k < 200; k++) {
      q.paso(5);
      vistos.push(q.hsus[0].nivel);
      if (q.hsus[0].racha >= SIM.K.WIND_T2) picos++;
    }
    return { niveles: vistos.join(''), picos: picos };
  };
  const sin = nivelCon(0), con = nivelCon(1);
  ok(con.picos > 0 && sin.picos === 0,
     'con la turbulencia al máximo hay rachas que pasan de 60 km/h y sin ella no',
     con.picos + ' contra ' + sin.picos + ' de 200 muestras');
  ok(sin.niveles === con.niveles,
     'y el NIVEL sale idéntico con y sin ráfagas: lo fija la media, no el pico');
}

console.log('\n── sector parcial: 40-60 km/h ──');
const pp = new SIM.Planta({ nTcu: 1, nHsu: 1, nRep: 0, dia: 172, hora: 10 });
pp.meteo.viento = 13;                                     /* 47 km/h → parcial */
for (let i = 0; i < 45 * 60; i += 10) pp.paso(10);
const tp = pp.tcu(1);
ok(tp.sp === SIM.SP.VIENTO && tp.stow === 1, 'entra en bandera PARCIAL, no total', 'estado ' + tp.stow);
ok(Math.abs(tp.anguloReal) >= 29 && Math.abs(tp.anguloReal) <= 56,
   'y se queda dentro del sector [30°, 55°]', tp.anguloReal.toFixed(1) + '°');
pp.meteo.viento = 18.5;
for (let i = 0; i < 40 * 60; i += 10) pp.paso(10);
ok(pp.tcu(1).stow === 2 && Math.abs(pp.tcu(1).anguloReal) > 53, 'y sube a total al pasar de 60 km/h',
   pp.tcu(1).anguloReal.toFixed(1) + '°');

console.log('\n── las cuatro estrategias del canon ──');
/* wind_stow_strategies.py define cuatro sobre dos ejes: cara al sol (B) o al viento
   (A), con uno o dos umbrales. El selector las ofrece igual que el de Streamlit. */
const AB = SIM.Abanderamiento;
ok(AB.ESTRATEGIAS.length === 4 && AB.ESTRATEGIAS.map(e => e.id).sort().join('') === 'A1A2B1B2',
   'están las cuatro', AB.ESTRATEGIAS.map(e => e.id).join(' '));
ok(AB.ESTRATEGIAS.filter(e => e.canon)[0].id === 'B2', 'y la marcada como canónica es B2');

/* mismo instante: sol al este (az 90), viento del oeste (az 270), 47 km/h */
const r = {};
for (const e of AB.ESTRATEGIAS) r[e.id] = new AB({ estrategia: e.id }).paso(60, 13, 20, 90, 270);
ok(r.B2.estado === 1 && r.A2.estado === 1, 'con dos umbrales, 47 km/h es bandera PARCIAL');
ok(r.B1.estado === 2 && r.A1.estado === 2, 'con un umbral, los mismos 47 km/h son bandera COMPLETA');
ok(r.B2.lado === -1 && r.B1.lado === -1, 'el eje B se orienta al SOL (este, θ<0)');
ok(r.A2.lado === 1 && r.A1.lado === 1, 'el eje A se orienta al VIENTO (del oeste, θ>0)');

/* un umbral no tiene histéresis: al bajar el viento vuelve al instante */
const a1 = new AB({ estrategia: 'B1' });
a1.paso(60, 18, 20, 90, 270);
ok(a1.paso(60, 5, 20, 90, 270).estado === 0, 'A1/B1 no llevan histéresis: sueltan al bajar del umbral');
const b2 = new AB({ estrategia: 'B2' });
b2.paso(60, 18, 20, 90, 270);
ok(b2.paso(60, 5, 20, 90, 270).estado === 2, 'B2 sí: mantiene la bandera durante el hold');

/* y la planta entera se puede montar con cualquiera */
const pA = new SIM.Planta({ nTcu: 2, nHsu: 1, nRep: 0, dia: 172, hora: 9, estrategiaViento: 'A2' });
pA.meteo.viento = 18.5; pA.meteo.dirViento = 270;
for (let i = 0; i < 40 * 60; i += 10) pA.paso(10);
ok(pA.tcu(1).ab.estrategia === 'A2' && pA.tcu(1).anguloReal > 50,
   'una planta con A2 abandera cara al viento del oeste', pA.tcu(1).anguloReal.toFixed(0) + '°');

console.log('\n── el viento manda sobre manual ──');
t.modo = SIM.MODO.MANUAL; t.manual = 0;
for (let i = 0; i < 20 * 60; i += 5) P.paso(5);
ok(t.sp === SIM.SP.VIENTO && Math.abs(t.angulo) > 50, 'en manual sigue abanderado', t.angulo.toFixed(1) + '°');

console.log('\n── calma: histéresis canónica antes de desabanderar ──');
/* DESTOW_HOLD_H sale de bateria.html vía fisica.js: 1 h, no los 30 min que yo había
   supuesto. Si allí cambia, esta prueba se ajusta sola. */
const holdMin = SIM.K.DESTOW_MIN;
P.meteo.viento = 2;
P.paso(60); ok(t.sp === SIM.SP.VIENTO, 'al minuto todavía abanderado');
for (let i = 0; i < (holdMin - 5) * 60; i += 30) P.paso(30);
ok(t.sp === SIM.SP.VIENTO, 'a falta de 5 min, todavía abanderado', 'hold de ' + holdMin + ' min');
for (let i = 0; i < 10 * 60; i += 30) P.paso(30);
ok(t.sp === SIM.SP.NINGUNA, 'pasado el hold, desabanderado', t.estadoTxt());
t.modo = SIM.MODO.AUTO;

console.log('\n── seta del TCU: entrada BINARIA, no una decisión ──');
t.setaLocal = true;
P.paso(0.02);
ok(!t.seta, 'antirrebote: un pulso de 20 ms no la dispara');
for (let i = 0; i < 15 * 60; i += 5) P.paso(5);
const antes = t.anguloReal, objSeta = t.objetivo;
for (let i = 0; i < 20 * 60; i += 5) P.paso(5);
ok(Math.abs(t.anguloReal - antes) < 0.01, 'con la seta pulsada la mesa no se mueve');
ok(!t.motorHabilitado, 'el puente en H queda sin alimentación');
ok(bitde(P.regsTCU(t)[30006], 11, 11) === 1, 'bit de motor bloqueado en 30006.11');
/* lo que distingue una entrada de hardware de una regla de la jerarquía: el
   algoritmo NO se para, sigue calculando objetivo y la desviación crece */
ok(Math.abs(t.objetivo - objSeta) > 0.5, 'el algoritmo sigue calculando objetivo por debajo',
   'objetivo ' + t.objetivo.toFixed(1) + '° contra ' + t.anguloReal.toFixed(1) + '° reales');
ok(Math.abs(s16de(P.regsTCU(t)[30110]) / 10) > 1, 'y 30110 (objetivo − real) se va abriendo',
   (s16de(P.regsTCU(t)[30110]) / 10).toFixed(1) + '°');
ok(bitde(P.regsTCU(t)[30002], 4, 4) === 1, 'bit de seta en alarmas 1 (30002.4)');
ok(bitde(P.regsTCU(t)[30006], 15, 15) === 0, 'system_ok cae a 0');
ok(bitde(P.regsNCU()[30100], 13, 13) === 0,
   '30100.13 sigue a 0: la NCU no tiene seta ni pulsador de parada, y no hay nada cableado a esa entrada');
ok(t.salud() === 'alarma', 'salud del TCU = alarma');

console.log('\n── … y va ENCLAVADA ──');
t.setaLocal = false;
for (let i = 0; i < 5 * 60; i += 5) P.paso(5);
ok(!t.motorHabilitado, 'soltar la seta NO rearma el motor: la alarma sigue enclavada');
ok(t.alarmaMotorEnclavada, 'y se ve en el estado del equipo', t.estadoTxt());
t.limpiaAlarmas();                                  /* 40007 bit 13, como la toolbox */
P.paso(5);
ok(t.motorHabilitado, 'solo lo rearma limpiar alarmas (40007 bit 13)');
t.setaLocal = true; for (let i = 0; i < 60; i += 5) P.paso(5);
t.limpiaAlarmas(); P.paso(5);
ok(!t.motorHabilitado, 'y limpiar con la seta AÚN pulsada no sirve de nada');
t.setaLocal = false; for (let i = 0; i < 60; i += 5) P.paso(5);
t.limpiaAlarmas();
for (let i = 0; i < 30 * 60; i += 5) P.paso(5);
ok(t.motorHabilitado && Math.abs(t.objetivo - t.anguloReal) < 3, 'rearmado, recupera su posición');

/* la seta es DE SU EQUIPO: enclava ese y no la flota. Aquí estuvo simulada una seta de
   armario de la NCU que cortaba la planta entera — no existe tal pulsador. */
ok(P.seguidores().filter(x => x.alarmaMotorEnclavada).length === 0,
   'la seta de la TCU 1 no enclavó a nadie más: no hay parada de planta desde la NCU');
P.tcus.forEach(x => x.limpiaAlarmas());
for (let i = 0; i < 20 * 60; i += 10) P.paso(10);

console.log('\n── el tope mecánico no es un eje bloqueado ──');
/* en el tope, el ruido del sensor mantiene un error pequeño contra un objetivo que
   ya no se puede alcanzar. Con un umbral de llegada más fino que el ruido, el lazo
   persigue su propio ruido y acaba autodiagnosticándose eje bloqueado — pasaba. */
const ptop = new SIM.Planta({ nTcu: 1, nHsu: 1, nRep: 0, dia: 1, hora: 0 });
ptop.meteo.nubes = 25;
for (let i = 0; i < 288 * 10; i++) ptop.paso(300);
ok(!ptop.tcu(1).ejeBloqueado && ptop.tcu(1).motorHabilitado,
   'diez días seguidos sin enclavar el motor solo', ptop.tcu(1).estadoTxt());
ok(ptop.tcu(1).salud() !== 'alarma', 'y sin quedarse en alarma');

console.log('\n── inclinómetro: entrada ANALÓGICA ──');
const ti = P.tcu(3);
ok(Math.abs(ti.angulo - ti.anguloReal) < 0.3 && ti.angulo !== ti.anguloReal,
   'lo que mide no es exactamente dónde está la mesa (ruido y cuantización)',
   'real ' + ti.anguloReal.toFixed(3) + '° · medido ' + ti.angulo.toFixed(3) + '°');
const paso1 = 1 / ti.sensor.pulsosGrado;
ok(Math.abs(ti.sensor.crudo / paso1 - Math.round(ti.sensor.crudo / paso1)) < 1e-9,
   'la medida cruda está cuantizada a pulsos', (1 / paso1).toFixed(1) + ' pulsos/°');

/* el defecto que persigue el ensayo D.1.1: el sensor mal calibrado. La mesa está
   torcida, el TCU dice que está perfecta, y el SCADA se lo cree. */
ti.sensor.desajuste = 3.0;                     /* el sensor va montado 3° torcido */
ti.sensor.offsetCfg = 0;                       /* y nadie lo ha compensado en 41058 */
for (let i = 0; i < 30 * 60; i += 10) P.paso(10);
/* El lazo es de banda muerta: no corrige hasta pasarse de ella, así que siguiendo un
   objetivo que se mueve la desviación publicada va en diente de sierra entre 0 y la
   banda. Lo que se comprueba es que se queda DENTRO de la banda —o sea que el TCU se
   cree en su sitio— no un valor concreto: eso último es una foto de un instante del
   diente, y salta a la mínima que se toque cualquier cosa aguas arriba. */
const bandaMuerta = P.cfg.deadband != null ? P.cfg.deadband : SIM.K.DB_PULSOS / ti.sensor.pulsosGrado;
ok(Math.abs(ti.objetivo - ti.angulo) <= bandaMuerta + 0.2, 'el TCU se cree que está donde le mandan',
   'desviación que publica: ' + (ti.objetivo - ti.angulo).toFixed(2) + '° · banda muerta ' + bandaMuerta + '°');
ok(Math.abs(ti.objetivo - ti.anguloReal) > 2, '…pero la mesa está a 3° de donde debería',
   'error real: ' + (ti.objetivo - ti.anguloReal).toFixed(2) + '°');
ok(ti.salud() === 'ok', 'y el SCADA lo ve todo verde — este es el fallo que no se ve en pantalla');
/* calibrarlo con 41058 lo arregla */
ti.sensor.offsetCfg = 3.0;
for (let i = 0; i < 30 * 60; i += 10) P.paso(10);
/* siguiendo un objetivo que se mueve, el retraso normal es banda muerta (1,3°)
   más la banda de llegada (0,65°) */
ok(Math.abs(ti.objetivo - ti.anguloReal) < 3, 'compensado en 41058, la mesa vuelve a su sitio',
   (ti.objetivo - ti.anguloReal).toFixed(2) + '°');
casi(f32de(P.regsTCU(ti)[41058], P.regsTCU(ti)[41059]) * 180 / Math.PI, 3.0, 0.01,
   'el offset se publica en 41058 (f32 rad)');
ti.sensor.desajuste = 0; ti.sensor.offsetCfg = 0;

/* acelerómetro muerto: la medida se congela y salta el bit de IC defectuoso */
const tf = P.tcu(6); tf.sensor.ok = false;
const congelado = tf.angulo;
for (let i = 0; i < 20 * 60; i += 10) P.paso(10);
ok(tf.angulo === congelado, 'con el acelerómetro muerto la medida se queda congelada');
ok(bitde(P.regsTCU(tf)[30004], 5, 5) === 1, 'y levanta 30004.5 «accelerometer is defective»');
ok(bitde(P.regsTCU(tf)[30005], 8, 8) === 1, 'que arrastra el resumen de IC defectuoso (30005.8)');
tf.sensor.ok = true;

console.log('\n── eje en apuros: el firmware lo DEDUCE, no se lo dicen ──');
/* rotor CALADO: no gira y pega el pico de corriente → sobrecorriente inmediata */
const te = P.tcu(7);
/* hacia el este: a estas alturas de la prueba el seguidor está en el tope oeste,
   y una consigna que se recorta contra el límite no manda mover nada */
te.modo = SIM.MODO.MANUAL; te.manual = te.anguloReal - 25;
te.ejeAtascado = true;
const realAntes = te.anguloReal;
P.paso(5);
ok(te.iMotor > 7000, 'calado, el motor pega corriente de calado', te.iMotor.toFixed(0) + ' mA');
ok(te.sobrecorriente, 'y salta la sobrecorriente software de 41040 (7000 mA)');
P.paso(5);
ok(!te.motorHabilitado, 'el motor se corta al momento, sin esperar a los reintentos');
ok(bitde(P.regsTCU(te)[30003], 5, 5) === 1, 'bit de sobrecorriente en 30003.5');
ok(Math.abs(te.anguloReal - realAntes) < 0.01, 'la mesa no se ha movido nada');
te.ejeAtascado = false; te.limpiaAlarmas();

/* eje DURO: gira, pero arrastrándose. No dispara la corriente, así que hay que
   cazarlo por la vía lenta — que es para lo que existen 41039 y 41065. */
const td = P.tcu(8);
td.modo = SIM.MODO.MANUAL; td.manual = td.anguloReal - 30;
td.ejeDuro = true;
P.paso(5);
ok(!td.ejeBloqueado && !td.sobrecorriente, 'duro: al primer intento no canta nada');
ok(td.iMotor > 4000 && td.iMotor < 7000, 'consume de más, pero sin llegar al disparo',
   td.iMotor.toFixed(0) + ' mA');
for (let i = 0; i < 8; i++) P.paso(5);
ok(td.velocidadBaja || td.ejeBloqueado, 'detecta que va más lento de lo mandado (30003.14)');
ok(td.ejeBloqueado, 'y tras los reintentos de 41065 levanta eje bloqueado', 'reintentos ' + td.reintentos);
ok(bitde(P.regsTCU(td)[30003], 8, 8) === 1, 'que sale en el registro 30003.8');
ok(!td.motorHabilitado, 'el motor queda enclavado, no reintentando para siempre');
td.ejeDuro = false; td.limpiaAlarmas(); td.modo = SIM.MODO.AUTO;
te.modo = SIM.MODO.AUTO;

console.log('\n── limpieza del grupo 2 ──');
P.ncu.limpieza[1] = true;
for (let i = 0; i < 30 * 60; i += 10) P.paso(10);
const g2 = P.seguidores().filter(x => x.grupo === 2), g1 = P.seguidores().filter(x => x.grupo === 1);
ok(g2.every(x => x.sp === SIM.SP.LIMPIEZA), 'todo el grupo 2 en SP4 limpieza');
ok(g1.every(x => x.sp === SIM.SP.NINGUNA), 'el grupo 1 sigue a lo suyo');
/* «horizontal» con la banda muerta del firmware (1,3°) y la de llegada (0,65°) no
   es 0,00°: es 0 ± ~1°. Un seguidor real tampoco se queda clavado en el cero. */
ok(Math.abs(g2[0].anguloReal) < 1.5, 'limpieza deja el seguidor horizontal', g2[0].anguloReal.toFixed(2) + '°');
ok(bitde(P.regsNCU()[30100], 4, 4) === 1, 'interruptor de limpieza 2 en la entrada digital');
P.ncu.limpieza[1] = false;

console.log('\n── nieve ──');
P.meteo.nieve = 0.05;
for (let i = 0; i < 30 * 60; i += 10) P.paso(10);
ok(P.ncu.alarmaNieve, 'la NCU agrega la alarma de nieve');
ok(t.sp === SIM.SP.NIEVE, 'la TCU entra en SP3 nieve', t.estadoTxt());
P.meteo.nieve = 0;

console.log('\n── forzado de posición segura por Modbus (grupo 3) ──');
P.ncu.fuerza(SIM.SP.NIEVE, 3, true);
P.paso(60);
const g3 = P.seguidores().filter(x => x.grupo === 3);
ok(g3.every(x => x.sp === SIM.SP.NIEVE), 'el forzado alcanza solo al grupo 3');
ok((P.regsNCU()[40003] & 0b100) === 0b100, 'force_sp_3 con el bit del grupo 3 puesto');
P.ncu.fuerza(SIM.SP.NIEVE, 3, false);

console.log('\n── batería: bajada a crítico ──');
const tb = P.tcu(2); tb.soc = 20;                        /* por debajo de L3 = 25 % */
P.paso(60);
ok(tb.bajaCapacidad === 3, 'modo de capacidad crítica', 'nivel ' + tb.bajaCapacidad);
ok(bitde(P.regsTCU(tb)[30002], 12, 12) === 1, 'bit L3 en alarmas 1');
ok(bitde(P.regsTCU(tb)[30001], 1, 2) === 3, 'low capacity mode en bits 2:1');
tb.soc = 27; P.paso(60);
ok(tb.bajaCapacidad === 3, 'con rearme de 5 %, a 27 % sigue en crítico (no rebota)');
tb.soc = 31; P.paso(60);
ok(tb.bajaCapacidad === 2, 'a 31 % sube a muy baja');

console.log('\n── TCU sin comunicación ──');
const tm = P.tcu(4); tm.online = false;
const marca = tm.ultimoContacto;
for (let i = 0; i < 45 * 60; i += 60) P.paso(60);
R = P.regsNCU();
const lc = u32de(R[29500 + 3 * 2], R[29500 + 3 * 2 + 1]);
ok(lc === marca, 'el último contacto se congela en 29500+', 'edad ' + (P.t.epoch - lc) + ' s');
ok(tm.salud() === 'offline', 'salud = offline');
ok(P.tcu(5).salud() !== 'offline', 'sus vecinas no se contagian');

console.log('\n── repetidor ──');
const rep = P.tcus.find(x => x.repetidor);
ok(rep && Math.abs(rep.anguloReal) < 0.01, 'el repetidor no se mueve');
ok(P.seguidores().length === 12, 'no cuenta como seguidor en la flota', P.seguidores().length + ' seguidores');

console.log('\n── alimentación: SP contra STRING contra AC ──');
/* mismo día, mismo sitio, misma meteo: lo único que cambia es de qué come el TCU */
function noche(perfil, opts = {}) {
  const p = new SIM.Planta({ nTcu: 1, nHsu: 1, nRep: 0, dia: 350, hora: 8, perfil });
  p.meteo.nubes = 70; p.tcu(1).soc = 60;
  if (opts.corte) p.ncu.acFallo = true;
  for (let i = 0; i < 24 * 60; i++) p.paso(60);      /* 24 h */
  return p.tcu(1);
}
const sp = noche('SP_45W_3Ah'), st = noche('STRING_60W_3Ah'), ac = noche('AC_grid');
console.log('   SoC tras 24 h de invierno nublado — SP:', sp.soc.toFixed(1) + '%',
            '· STRING:', st.soc.toFixed(1) + '%', '· AC:', ac.soc.toFixed(1) + '%');
/* con la estrategia puesta los tres topan en el mismo techo del 80 %, así que para
   ver la diferencia entre fuentes hay que apretar: tres días muy cerrados */
function apretado(perfil) {
  const p = new SIM.Planta({ nTcu: 1, nHsu: 1, nRep: 0, dia: 350, hora: 8, perfil,
                             estrategia: { activa: false } });
  p.meteo.nubes = 92; p.tcu(1).soc = 60;
  for (let i = 0; i < 3 * 24 * 60; i++) p.paso(60);
  return p.tcu(1).soc;
}
const spA = apretado('SP_45W_3Ah'), stA = apretado('STRING_60W_3Ah');
console.log('   tres días al 92 % de nubes — SP:', spA.toFixed(1) + '% · STRING:', stA.toFixed(1) + '%');
ok(stA > spA + 5, 'con poca luz, el STRING aguanta bastante mejor que el panel propio');
ok(ac.soc === 100 && ac.ah === 0, 'el perfil de alterna del canon va sin batería y no tiene SoC que gestionar');

/* la regla auditada de tcu.py sobre qué tiene sentido enseñar de cada variante */
const vis = SIM.FISICA.visibilidad;
ok(vis.sp.show_panel && vis.sp.show_battery && vis.sp.show_soc, 'SELF enseña panel, batería y SoC');
ok(!vis.string.show_panel && vis.string.show_battery && vis.string.show_soc,
   'STRING esconde el panel pero mantiene batería y SoC');
ok(!vis.ac.show_panel && !vis.ac.show_battery && !vis.ac.show_soc && !vis.ac.show_calibration,
   'AC no enseña nada de energía: ni panel, ni batería, ni SoC, ni calibración');

console.log('\n── estrategia oficial SUNNER (la de bateria.html) ──');
function conEstrategia(e, dias = 2, perfil = 'SP_60W_6Ah') {
  const p = new SIM.Planta({ nTcu: 1, nHsu: 1, nRep: 0, dia: 172, hora: 6, perfil, estrategia: e });
  p.meteo.nubes = 5;
  const serie = [];
  for (let i = 0; i < dias * 24 * 60; i++) { p.paso(60); if (i % 60 === 0) serie.push(p.tcu(1).soc); }
  return { t: p.tcu(1), p, max: Math.max(...serie), serie };
}
const techo = conEstrategia({ activa: true, socTgt: 80, fcDays: 5 });
ok(techo.max <= 80.5, 'con la estrategia, la batería NO pasa del SOC objetivo', 'máximo ' + techo.max.toFixed(1) + '%');
const sinE = conEstrategia({ activa: false });
ok(sinE.max > 95, 'sin estrategia sí se va al 100 %', 'máximo ' + sinE.max.toFixed(1) + '%');
const fc = conEstrategia({ activa: true, socTgt: 80, fcDays: 1 });   /* todos los días son de carga completa */
ok(fc.max > 95, 'el día de carga completa sí sube por encima del techo', 'máximo ' + fc.max.toFixed(1) + '%');

/* de noche, para que la comprobación del rearme no se la lleve por delante el sol
   cargando la batería a mitad de prueba */
const pCrit = new SIM.Planta({ nTcu: 1, nHsu: 1, nRep: 0, dia: 172, hora: 22,
                               estrategia: { activa: true, socCrit: 30 } });
pCrit.tcu(1).soc = 28; pCrit.paso(60);
ok(pCrit.tcu(1).parked, 'bajo el SOC crítico entra en defensa');
for (let i = 0; i < 30; i++) pCrit.paso(60);
ok(Math.abs(pCrit.tcu(1).objetivo) === 55, 'y el objetivo pasa a defensa 55°', pCrit.tcu(1).objetivo + '°');
ok(pCrit.resumen().noDisponibles === 1, 'cuenta como no disponible en el resumen de flota');
pCrit.tcu(1).soc = 31; pCrit.paso(60);
ok(pCrit.tcu(1).parked, 'a 31 % sigue en defensa (rearme +2 %)');
pCrit.tcu(1).soc = 33; pCrit.paso(60);
ok(!pCrit.tcu(1).parked, 'a 33 % rearma y vuelve a seguir');

/* La política del modo sale del canon (tcu.py), no de un número escrito aquí:
   verano 80 %/5 d · invierno 90 %/3 d. El winter mode NO es solo mover menos. */
const pol = SIM.FISICA.politica;
const pVer = new SIM.Planta({ nTcu: 1, nHsu: 1, nRep: 0 });
ok(pVer.cfg.estrategia.socTgt === pol.verano.socMax && pVer.cfg.estrategia.fcDays === pol.verano.calibDias,
   'en verano, techo y calibración canónicos', pol.verano.socMax + ' % / ' + pol.verano.calibDias + ' d');
const pInv = new SIM.Planta({ nTcu: 1, nHsu: 1, nRep: 0, estrategia: { winter: true } });
ok(pInv.cfg.estrategia.socTgt === pol.invierno.socMax && pInv.cfg.estrategia.fcDays === pol.invierno.calibDias,
   'el winter mode sube el techo y calibra más a menudo', pol.invierno.socMax + ' % / ' + pol.invierno.calibDias + ' d');
ok(pol.invierno.socMax > pol.verano.socMax && pol.invierno.calibDias < pol.verano.calibDias,
   'y el canon dice que invierno es más alto y más frecuente que verano');
const pMano = new SIM.Planta({ nTcu: 1, nHsu: 1, nRep: 0, estrategia: { socTgt: 65 } });
pMano.paso(60);
ok(pMano.cfg.estrategia.socTgt === 65, 'un techo puesto a mano no lo pisa la política automática');

/* winter mode: mismo día, mismo sol, un tercio de correcciones */
function motorDia(winter) {
  const p = new SIM.Planta({ nTcu: 1, nHsu: 1, nRep: 0, dia: 172, hora: 5,
                             estrategia: { activa: true, winter } });
  p.meteo.nubes = 5;
  for (let i = 0; i < 16 * 60; i++) p.paso(60);
  return p.tcu(1).energiaMotorHoy / 3600;
}
const whNormal = motorDia(false), whWinter = motorDia(true);
console.log('   energía de motor en un día — normal:', whNormal.toFixed(2), 'Wh · winter:', whWinter.toFixed(2), 'Wh');
ok(whWinter < whNormal, 'el winter mode gasta menos motor que el modo normal');

/* C-rate y JEITA: las curvas canónicas, comprobadas en sus puntos */
ok(SIM.cRateSafeLFP(30) === 1 && Math.abs(SIM.cRateSafeLFP(10) - 0.5) < 1e-9 &&
   Math.abs(SIM.cRateSafeLFP(0) - 0.2) < 1e-9 && SIM.cRateSafeLFP(-20) === 0.05,
   'C-rate seguro LiFePO4 en sus puntos de quiebre (25/10/0/−10 °C)');
ok(SIM.hotDerate(30) === 1 && SIM.hotDerate(46) === 0 && Math.abs(SIM.hotDerate(40) - 0.65) < 1e-9,
   'JEITA caliente: entero hasta 35 °C, 0 a partir de 45');
ok(Math.abs(SIM.heaterW(-10) - 2.5) < 1e-9 && SIM.heaterW(5) === 0, 'calefactor LT: 1 + 0,15·|T| bajo cero');

/* frío: a −5 °C sin calefactar no entra carga; la versión LT sí carga */
function frio(perfil) {
  const p = new SIM.Planta({ nTcu: 1, nHsu: 1, nRep: 0, dia: 15, hora: 12, perfil });
  p.meteo.tMedia = -12; p.meteo.nubes = 0; p.tcu(1).soc = 50; p.tcu(1).tBat = -5;
  for (let i = 0; i < 180; i++) p.paso(60);
  return p.tcu(1);
}
const sinLt = frio('SP_45W_6Ah'), conLt = frio('SP_45W_6Ah_LT');
console.log('   3 h a −5 °C — sin LT:', sinLt.soc.toFixed(2) + '% · con LT:', conLt.soc.toFixed(2) + '%');
ok(sinLt.soc < 50, 'sin calefactar, a −5 °C no carga y el SoC baja');
ok(conLt.soc > sinLt.soc, 'la versión LT calefactada sí consigue cargar', 'calefactor ' + (conLt.calefactor ? 'ON' : 'off'));

console.log('\n── un día entero sin explotar ──');
ok(sp.ah === 3 && st.ah === 3 && ac.ah === 0, 'la capacidad sale del perfil canónico (3 Ah · 3 Ah · sin batería)');
ok(SIM.PERFILES.length === 8 && SIM.PERFILES.every(p => p.id && p.wh >= 0 && ['sp', 'string', 'ac'].includes(p.tipo)),
   'los 8 perfiles vienen de PROFILES de solargpt_core/tcu.py', SIM.PERFILES.map(p => p.id).join(', '));
const pSp = new SIM.Planta({ nTcu: 1, nHsu: 1, nRep: 0, perfil: 'SP_60W_6Ah' });
ok(bitde(pSp.regsTCU(pSp.tcu(1))[30000], 0, 3) === SIM.TIPO_REG.sp, 'un TCU autoalimentado se declara tipo BAT en 30000');

const pAc = new SIM.Planta({ nTcu: 2, nHsu: 1, nRep: 0, perfil: 'AC_grid', dia: 200, hora: 22 });
ok(bitde(pAc.regsTCU(pAc.tcu(1))[30000], 0, 3) === SIM.TIPO_REG.ac, 'un TCU de alterna se declara tipo AC en 30000');
ok(bitde(pAc.regsTCU(pAc.tcu(1))[30002], 10, 10) === 1, 'sin batería levanta el bit «battery not connected»');
pAc.ncu.acFallo = true; pAc.paso(60);
ok(pAc.tcu(1).salud() === 'offline', 'sin batería y sin alterna, el TCU se cae', pAc.tcu(1).estadoTxt());
pAc.ncu.acFallo = false; pAc.paso(60);
ok(pAc.tcu(1).salud() !== 'offline', 'y vuelve al volver la red');

console.log('\n── un día entero sin explotar ──');
const P2 = new SIM.Planta({ nTcu: 6, nHsu: 1, nRep: 0, dia: 15, hora: 0 });
let socMin = 100, malos = 0;
for (let i = 0; i < 24 * 60; i++) {
  P2.paso(60);
  for (const x of P2.tcus) {
    socMin = Math.min(socMin, x.soc);
    if (!isFinite(x.anguloReal) || !isFinite(x.soc) || Math.abs(x.anguloReal) > 55.001) malos++;
  }
}
ok(malos === 0, 'ni un NaN ni un ángulo fuera de ±55° en 1.440 pasos');
ok(socMin > 40, 'la batería aguanta el día de invierno', 'SoC mínimo ' + socMin.toFixed(1) + '%');
const RT = P2.regsTCU(P2.tcu(1));
ok(Object.keys(RT).length > 60, 'la imagen de registros de la TCU está poblada', Object.keys(RT).length + ' registros');
ok(Object.keys(P2.regsNCU()).length > 100, 'y la de la NCU también', Object.keys(P2.regsNCU()).length + ' registros');

/* ───────── todo es configurable ─────────
   El canon es el valor por defecto, no un dogma: se puede apartar en caliente y se
   vuelve. Lo que NO puede es apartarse sin enterarse nadie, ni aceptar basura. */
ok(SIM.PARAMS.length === Object.keys(SIM.K).length,
   'el catálogo de parámetros cubre todo K', SIM.PARAMS.length + ' parámetros');
ok(SIM.PARAMS.every(p => Object.prototype.hasOwnProperty.call(SIM.K_CANON, p.k)),
   'y ninguno del catálogo se ha quedado sin constante');
ok(SIM.K.SLEW_DPS === 0.17, 'la velocidad del actuador es la medida en campo', SIM.K.SLEW_DPS + ' °/s');

const cambios = SIM.ajusta({ SLEW_DPS: 0.16, WIND_T1: 8 });
ok(cambios.SLEW_DPS === 0.16 && SIM.K.SLEW_DPS === 0.16, 'ajustar un parámetro lo cambia de verdad');
const marcados = SIM.tocados();
ok(marcados.SLEW_DPS && marcados.SLEW_DPS.canon === 0.17,
   'y queda marcado con su valor canónico al lado', 'canon ' + marcados.SLEW_DPS.canon);

/* el umbral nuevo tiene que llegar a la máquina de abanderamiento YA montada */
const Pc = new SIM.Planta({ nTCU: 2, nHSU: 1, perfil: 'SP_45W_6Ah', hora: 11, dia: 172,
                            lat: 42.82, lon: -1.60, tz: 1 });
Pc.meteo.viento = 9; Pc.meteo.rachas = 0;    /* 32 km/h: bajo el umbral canónico, sobre el ajustado */
Pc.paso(1); Pc.paso(1);
ok(Pc.tcu(1).stow > 0, 'un umbral de viento bajado abandera con menos viento', '9 m/s con T1 = 8');

let pegas = 0;
try { SIM.ajusta({ NO_EXISTE: 1 }); } catch (e) { pegas++; }
try { SIM.ajusta({ SLEW_DPS: 'rápido' }); } catch (e) { pegas++; }
ok(pegas === 2, 'rechaza parámetros inventados y valores que no son números');
ok(SIM.K.SLEW_DPS === 0.16, 'y un ajuste rechazado no deja el motor a medias');

const vuelta = SIM.restauraCanon();
ok(vuelta.SLEW_DPS === 0.17 && Object.keys(SIM.tocados()).length === 0,
   'volver al canon devuelve TODO', Object.keys(vuelta).length + ' parámetros restaurados');
const Pd = new SIM.Planta({ nTCU: 2, nHSU: 1, perfil: 'SP_45W_6Ah', hora: 11, dia: 172,
                            lat: 42.82, lon: -1.60, tz: 1 });
Pd.meteo.viento = 9; Pd.meteo.rachas = 0; Pd.paso(1); Pd.paso(1);
ok(Pd.tcu(1).stow === 0, 'y con el canon puesto, 9 m/s ya no abandera');

/* ───────── el consumo lo pone el módulo de gestión de batería ─────────
   Ni el gemelo ni el informe de impacto lo calculan: los tres llaman a la misma
   función, copiada íntegra de bateria.html por el generador. Dos versiones de esto
   es exactamente lo que hubo que medir cuando los Wh de motor no cuadraban. */
ok(typeof SIM.FISICA.consumoTCU === 'function',
   'el módulo de batería expone el consumo del TCU');
const fuentePlanta = fs.readFileSync(new URL('./planta.js', import.meta.url), 'utf8');
ok(!/MOT_K0\s*\+\s*K\.MOT_K1/.test(fuentePlanta) && !/K\.IDLE_W\s*:\s*K\.SLEEP_W/.test(fuentePlanta),
   'y el gemelo ya no lleva su propia copia de la fórmula');

/* lo que el gemelo gasta moviendo tiene que ser LO QUE DICE el módulo.
   Se le manda a mano lejos para que el paso mueva de verdad: en seguimiento normal
   el lazo pasa la mayor parte del tiempo dentro de la banda muerta y no movería. */
function unPasoMoviendo() {
  const P = new SIM.Planta({ nTCU: 1, nHSU: 1, perfil: 'SP_45W_6Ah', hora: 10, dia: 172,
                             lat: 42.82, lon: -1.60, tz: 1 });
  const t = P.tcu(1);
  t.modo = SIM.MODO.MANUAL; t.manual = 40;
  const a0 = t.anguloReal;
  P.paso(60);
  return { t: t, mov: Math.abs(t.anguloReal - a0), medio: (t.anguloReal + a0) / 2,
           wh: t.energiaMotorHoy / 3600 };
}
const p1 = unPasoMoviendo();
ok(p1.mov > 0.5, 'el TCU se mueve en el paso de prueba', p1.mov.toFixed(2) + '°');
const esperado = SIM.FISICA.consumoTCU({
  dtH: 60 / 3600, dia: true, mov: p1.mov, pos: p1.medio,
  motorModel: 'factiun', calefactada: false, tAmb: 20 }).motor;
ok(Math.abs(p1.wh - esperado) < 1e-12,
   'los Wh de motor del gemelo son los del módulo, al bit', p1.wh.toFixed(6) + ' Wh');

/* NO hay tope de potencia. El «peak limit» de 50 W de las constantes canónicas es un
   envolvente de diseño, no una lectura del ensayo: la curva medida llega a 67,2 W a 55°,
   así que recortar a 50 truncaba consumo real. El límite por paso lo pone la velocidad. */
ok(SIM.K.MOTOR_PEAK_W === undefined, 'no hay tope de potencia de motor en el motor de planta');
ok(Math.abs(SIM.FISICA.motorW(55) - 2800 / 1000 * 24) < 1e-9,
   'y la curva medida llega a 67,2 W a 55°, por encima del envolvente de 50',
   SIM.FISICA.motorW(55).toFixed(1) + ' W');
ok(SIM.FISICA.motorW(0) < SIM.FISICA.motorW(30) && SIM.FISICA.motorW(30) < SIM.FISICA.motorW(55),
   'la curva de motor crece con el ángulo, que es de lo que iba');

/* y los parámetros del motor tienen que seguir teniendo efecto a través del módulo:
   moverlos sin que el consumo cambie sería peor que no poder moverlos */
SIM.ajusta({ MOT_K0: SIM.K_CANON.MOT_K0 / 2 });
const p2 = unPasoMoviendo();
ok(p2.wh < p1.wh * 0.9, 'bajar K0 baja lo que gasta el motor, pasando por el módulo',
   p1.wh.toFixed(4) + ' → ' + p2.wh.toFixed(4) + ' Wh');
SIM.restauraCanon();
ok(Math.abs(unPasoMoviendo().wh - p1.wh) < 1e-12, 'y volver al canon lo devuelve exacto');

/* ───────── cielo cubierto (overcast) ─────────
   Las cuatro políticas de DiffuseConfig, en su módulo. Lo que se comprueba no es
   que «hagan algo», es que hagan lo suyo: con sol no tocan nada, con el cielo
   cerrado tumban el seguidor, y NUNCA por encima de una maniobra de protección. */
function diaDe(pol, nubes, extra) {
  const P = new SIM.Planta(Object.assign({
    nTCU: 2, nHSU: 1, perfil: 'SP_45W_6Ah', hora: 6, dia: 172,
    lat: 42.82, lon: -1.60, tz: 1, politicaDifusa: pol }, extra || {}));
  P.meteo.nubes = nubes;
  let act = 0, plano = 0, dia = 0;
  for (let i = 0; i < 14 * 60; i++) {
    P.paso(60);
    const t = P.tcu(1);
    if (!t.solar.dia) continue;
    dia++;
    if (t.difusaActiva) { act++; if (Math.abs(t.objetivo) < 0.5) plano++; }
  }
  return { P: P, act: act, plano: plano, dia: dia, motorWh: P.tcu(1).energiaMotorHoy / 3600 };
}

/* la descomposición es la canónica, no una regla lineal inventada */
ok(Math.abs(SIM.Cielo.fraccionDifusaErbs(0.15) - (1 - 0.09 * 0.15)) < 1e-12,
   'Erbs: con el cielo cerrado (kt 0,15) casi todo es difusa',
   (SIM.Cielo.fraccionDifusaErbs(0.15) * 100).toFixed(1) + ' %');
ok(SIM.Cielo.fraccionDifusaErbs(0.9) === 0.165,
   'y con el cielo limpio se queda en el 16,5 % de la rama alta de Erbs');

const sol = diaDe('poa_switch', 0);
ok(sol.act === 0, 'con sol la política de difusa no toca NADA', sol.dia + ' min de día');

const gris = diaDe('poa_switch', 95);
ok(gris.act > 300 && gris.plano === gris.act,
   'con el cielo cerrado poa_switch se tumba y se queda', gris.act + ' min al plano');
ok(gris.motorWh < diaDe('none', 95).motorWh * 0.6,
   'y eso le ahorra motor, que es de lo que va en un equipo a batería',
   gris.motorWh.toFixed(2) + ' Wh frente a ' + diaDe('none', 95).motorWh.toFixed(2));

/* continua ≥ flat: el canon lo dice —flat es el candidato α = 1 de continua— */
ok(diaDe('continuous', 95).act >= diaDe('flat', 95).act,
   'la política continua nunca interviene menos que flat, como manda el canon');

/* LA REGLA QUE NO SE NEGOCIA: protección por encima de optimización */
const vendaval = diaDe('flat', 95);
vendaval.P.meteo.viento = 20; vendaval.P.meteo.rachas = 0;   /* 72 km/h */
let tumbados = 0, abanderados = 0;
for (let i = 0; i < 120; i++) {
  vendaval.P.paso(60);
  const t = vendaval.P.tcu(1);
  if (t.stow > 0) { abanderados++; if (t.difusaActiva || Math.abs(t.objetivo) < 30) tumbados++; }
}
ok(abanderados > 60, 'con 72 km/h el seguidor abandera', abanderados + ' min');
ok(tumbados === 0,
   'y la difusa NO lo tumba estando abanderado — protección por encima de optimización');

/* el clamp al backtracking tampoco se negocia */
const d = new SIM.Difusa({ politica: 'flat' });
const rC = d.paso(1, 800, 20, function (th) { return Math.abs(th) > 30 ? 9999 : 100; }, false);
ok(Math.abs(rC.theta) <= 20 + 1e-6,
   'la difusa nunca abre más ángulo del que dejó el backtracking',
   rC.theta.toFixed(1) + '° con seguimiento en 20°');

/* ───────── el algoritmo se LEE del motor ─────────
   Sin servicio no se puede probar la llamada, pero sí lo que importa: que cuando hay
   trayectoria el gemelo la EJECUTA y calla su propio algoritmo, y que sin ella la
   planta sigue andando con el modelo del navegador. */
const Canon = (await import('./canon.js')).default;
const falso = new Canon();
falso.serie = {                                   /* trayectoria de mentira, a mano */
  hora: [0, 6, 9, 12, 15, 18, 23],
  theta: [-5, -5, -40, 0, 40, 5, -5],
  objetivo: [-5, -5, -40, 0, 40, 5, -5],
  difusa: [0, 0, 0, 1, 0, 0, 0], alpha: [0, 0, 0, 1, 0, 0, 0],
  motor: 'de prueba', paso: 180
};
ok(falso.hayTrayectoria(), 'el cliente reconoce que tiene trayectoria');
ok(Math.abs(falso.en(9).objetivo - (-40)) < 1e-9,
   'y la consulta por hora da el punto exacto cuando cae justo', falso.en(9).objetivo + '°');
ok(falso.en(10.5).objetivo > -40 && falso.en(10.5).objetivo < 0,
   'e interpola entre puntos', falso.en(10.5).objetivo.toFixed(1) + '° a las 10:30');
ok(falso.en(12).difusa === true, 'y trae si el motor dijo que la difusa estaba activa');

const Pk = new SIM.Planta({ nTCU: 2, nHSU: 1, perfil: 'SP_45W_6Ah', hora: 9, dia: 172,
                            lat: 42.82, lon: -1.60, tz: 1, canon: falso });
for (let i = 0; i < 5; i++) Pk.paso(60);
ok(Pk.tcu(1).motorCanon === true, 'la planta ejecuta el ángulo del motor, no el suyo');
ok(Math.abs(Pk.tcu(1).objetivo - falso.en(Pk.t.hora).objetivo) < 1e-6,
   'y el objetivo es exactamente el que dijo el motor',
   Pk.tcu(1).objetivo.toFixed(2) + '°');

/* sin motor, el gemelo sigue andando con lo suyo — y lo sabe */
const Ps = new SIM.Planta({ nTCU: 2, nHSU: 1, perfil: 'SP_45W_6Ah', hora: 9, dia: 172,
                            lat: 42.82, lon: -1.60, tz: 1 });
for (let i = 0; i < 5; i++) Ps.paso(60);
ok(Ps.canonEn(9) === null && Ps.tcu(1).motorCanon === false,
   'sin motor cae al modelo del navegador, y queda marcado como tal');

/* una maniobra de protección sigue mandando sobre el motor */
Pk.meteo.viento = 20; Pk.meteo.rachas = 0;
for (let i = 0; i < 90; i++) Pk.paso(60);
ok(Pk.tcu(1).stow > 0 && Math.abs(Pk.tcu(1).objetivo) >= 30,
   'y con viento fuerte manda el abanderamiento, no la trayectoria del motor',
   Pk.tcu(1).objetivo.toFixed(1) + '°');

/* ───────── escritura del mapa ─────────
   Hasta ahora el gemelo se mandaba las órdenes por dentro. Un equipo real no tiene
   esa puerta: todo entra escribiendo registros, y por eso la toolbox puede hacer lo
   que hace. Lo que se comprueba es que la puerta se comporta como la del equipo:
   aplica, RELEE lo escrito, y rechaza lo que el firmware rechazaría. */
function f32aRegs(x) {
  const dv = new DataView(new ArrayBuffer(4));
  dv.setFloat32(0, x, false);
  return [dv.getUint16(0, false), dv.getUint16(2, false)];
}
function regsAf32(a, b) {
  const dv = new DataView(new ArrayBuffer(4));
  dv.setUint16(0, a, false); dv.setUint16(2, b, false);
  return dv.getFloat32(0, false);
}
const Pw = new SIM.Planta({ nTCU: 6, nHSU: 2, grupos: 4, perfil: 'SP_45W_6Ah',
                            hora: 11, dia: 172, lat: 42.82, lon: -1.60, tz: 1 });

/* 1 · un comando cambia el modo de verdad */
ok(Pw.escribe('tcu', 1, 40000, [2]).ok && Pw.tcu(1).modo === SIM.MODO.MANUAL,
   '40000 = 2 pone el equipo en MANUAL');

/* 2 · el mando del motor mueve la consigna, como desde la toolbox */
const m0 = Pw.tcu(1).manual;
Pw.escribe('tcu', 1, 40017, [2]);                     /* 2 = oeste */
for (let i = 0; i < 30; i++) Pw.paso(10);
ok(Pw.tcu(1).manual > m0 + 5, '40017 mueve el motor a mano',
   m0.toFixed(1) + '° → ' + Pw.tcu(1).manual.toFixed(1) + '°');
Pw.escribe('tcu', 1, 40017, [0]);

/* 3 · el offset del inclinómetro: el registro del ensayo D.1.1 */
Pw.escribe('tcu', 1, 41058, f32aRegs(3 * Math.PI / 180));
ok(Math.abs(Pw.tcu(1).sensor.offsetCfg - 3) < 1e-6,
   '41058 calibra el inclinómetro de verdad', Pw.tcu(1).sensor.offsetCfg.toFixed(3) + '°');

/* 4 · lo escrito SE RELEE: sin esto no se puede verificar una puesta en marcha */
Pw.escribe('tcu', 1, 41040, [5500]); Pw.escribe('tcu', 1, 41065, [7]);
Pw.paso(1);
const Rw = Pw.regsTCU(Pw.tcu(1));
ok(Rw[41040] === 5500 && Rw[41065] === 7, 'la configuración escrita se relee igual');
ok(Math.abs(regsAf32(Rw[41058], Rw[41059]) * 180 / Math.PI - 3) < 1e-4,
   'y el f32 vuelve con su valor, no con el de fábrica');

/* 5 · y TIENE EFECTO: bajar la sobrecorriente hace saltar antes la alarma */
ok(Pw.tcu(1).cfgTcu.iMotorMax === 5500, 'el límite de sobrecorriente es el del equipo, no el de la planta');
Pw.escribe('tcu', 2, 41037, [900]);                   /* tope oeste a ~26° */
ok(Math.abs(Pw.tcu(2).cfgTcu.topeOeste - 900 / Pw.tcu(2).sensor.pulsosGrado) < 1e-6,
   '41037 recorta el tope de eje del equipo',
   Pw.tcu(2).cfgTcu.topeOeste.toFixed(1) + '°');
Pw.escribe('tcu', 2, 40000, [2]); Pw.escribe('tcu', 2, 40017, [2]);
for (let i = 0; i < 400; i++) Pw.paso(10);
ok(Pw.tcu(2).anguloReal <= Pw.tcu(2).cfgTcu.topeOeste + 0.2,
   'y el seguidor se para en ese tope, no en los 55° de fábrica',
   Pw.tcu(2).anguloReal.toFixed(1) + '°');

/* 6 · rechaza lo que el equipo rechazaría */
ok(!Pw.escribe('tcu', 1, 30001, [1]).ok, 'un registro de SOLO LECTURA se rechaza');
ok(!Pw.escribe('tcu', 1, 41040, [99999]).ok, 'y un valor fuera de rango también');
ok(!Pw.escribe('tcu', 1, 47777, [1]).ok, 'y una dirección que no existe');

/* 7 · los forzados de la NCU son un mapa de bits POR GRUPO */
Pw.escribe('ncu', 0, 40001, [0b0011]);                /* SP1 a los grupos 1 y 2 */
Pw.paso(1);
ok(Pw.tcu(1).sp === SIM.SP.VIENTO && Pw.tcu(3).sp !== SIM.SP.VIENTO,
   'force_sp_1 llega solo a los grupos de su máscara');
Pw.escribe('ncu', 0, 40001, [0]);
Pw.paso(1);
ok(Pw.tcu(1).sp !== SIM.SP.VIENTO, 'y escribir 0 lo suelta');

/* 8 · limpiar alarmas por 40007.13, que es como se hace de verdad */
Pw.tcu(1).alarmaMotorEnclavada = true;
Pw.escribe('tcu', 1, 40007, [1 << 13]);
ok(!Pw.tcu(1).alarmaMotorEnclavada, '40007 bit 13 limpia las alarmas enclavadas');

/* ───────── escenarios ─────────
   Una situación escrita una vez tiene que dar lo mismo cada vez que se corre. Si no,
   no sirve ni para reproducir un incidente ni como prueba de regresión. */
const Escenario = (await import('./escenario.js')).default;

function corre(esc, horas) {
  const P = new SIM.Planta({ nTCU: 4, nHSU: 1, perfil: 'SP_45W_6Ah',
                             hora: esc.hora, dia: esc.dia, lat: 42.82, lon: -1.60, tz: 1 });
  esc.rebobina();
  const disparos = [];
  for (let i = 0; i < horas * 60; i++) {
    P.paso(60);
    esc.paso(P, P.t.hora).forEach(x => disparos.push(x));
  }
  return { P: P, disparos: disparos };
}

const eTemporal = new Escenario(Escenario.EJEMPLOS[1]);
const r1 = corre(eTemporal, 9);
ok(r1.disparos.length === 4 && r1.disparos.every(d => d.r.ok),
   'el escenario del temporal dispara sus cuatro eventos y todos se aplican');

/* ídem, otra vez: mismo resultado. Es lo que lo hace una prueba y no una anécdota */
const r2 = corre(new Escenario(Escenario.EJEMPLOS[1]), 9);
ok(Math.abs(r1.P.tcu(1).anguloReal - r2.P.tcu(1).anguloReal) < 1e-9,
   'y correrlo dos veces da exactamente lo mismo',
   r1.P.tcu(1).anguloReal.toFixed(4) + '°');

/* el de la seta: el motor se corta en toda la planta y soltarla NO rearma */
const eSeta = new Escenario(Escenario.EJEMPLOS[2]);
const P3 = new SIM.Planta({ nTCU: 4, nHSU: 1, perfil: 'SP_45W_6Ah',
                            hora: eSeta.hora, dia: eSeta.dia, lat: 42.82, lon: -1.60, tz: 1 });
eSeta.rebobina();
let conSeta = 0, trasSoltar = null;
for (let i = 0; i < 5 * 60; i++) {
  P3.paso(60); eSeta.paso(P3, P3.t.hora);
  if (P3.tcu(1).seta) conSeta++;
  if (P3.t.hora > 12.6 && P3.t.hora < 12.9 && trasSoltar === null) trasSoltar = P3.tcu(1).alarmaMotorEnclavada;
}
ok(conSeta > 60, 'el escenario de la seta la mantiene pulsada hora y media', conSeta + ' min');
ok(trasSoltar === true, 'y al soltarla la alarma sigue ENCLAVADA, como el equipo real');

/* ida y vuelta por URL: el enlace ES el escenario */
const u = eTemporal.aURL('http://x/simulador.html');
const vuelto = Escenario.deURL(u);
ok(vuelto && vuelto.eventos.length === eTemporal.eventos.length && vuelto.n === eTemporal.n,
   'un escenario va y vuelve por la URL sin perder nada', u.length + ' caracteres');
ok(u.indexOf('#esc=') > 0, 'y viaja en el hash, así que no hace falta servidor');

/* los eventos se ordenan por hora, se graben en el orden que se graben */
const eo = new Escenario({ n: 'orden' });
eo.añade(14, { t: 'meteo', k: 'viento', v: 10 });
eo.añade(9, { t: 'meteo', k: 'viento', v: 40 });
eo.añade(11, { t: 'meteo', k: 'viento', v: 70 });
ok(eo.eventos.map(e => e.h).join(',') === '9,11,14',
   'el guion se ordena por hora aunque se grabe a saltos');

/* ───────── averías por tasa ─────────
   Lo que se le pide a esto no es que rompa cosas: es que las rompa de forma REPETIBLE.
   Si dos corridas del mismo día malo no dan lo mismo, no se puede comparar nada. */
function diaMalo() {
  const P = new SIM.Planta({ nTcu: 200, nHsu: 4, perfil: 'SP_45W_6Ah', hora: 6, dia: 172,
    lat: 42.82, lon: -1.60, tz: 1,
    averias: { activo: true, comsMtbfH: 40, comsMin: 15, duroMtbfD: 20,
               caladoMtbfD: 60, reparaH: 6, desajusteSig: 0.8 } });
  let maxOff = 0, maxAv = 0;
  for (let i = 0; i < 16 * 60; i++) {
    P.paso(60);
    maxOff = Math.max(maxOff, P.tcus.filter(t => !t.online).length);
    maxAv = Math.max(maxAv, P.tcus.filter(t => t.ejeDuro || t.ejeAtascado).length);
  }
  const r = P.resumen();
  return { maxOff, maxAv, r, peor: Math.max.apply(null, P.tcus.map(t => Math.abs(t.sensor.desajuste))) };
}
const d1 = diaMalo(), d2 = diaMalo();
ok(d1.maxOff > 0 && d1.maxAv > 0, 'un día malo produce caídas de radio Y ejes averiados',
   d1.maxOff + ' sin comms · ' + d1.maxAv + ' ejes');
ok(d1.maxOff === d2.maxOff && d1.maxAv === d2.maxAv && d1.r.alarma === d2.r.alarma,
   'y dos corridas iguales dan exactamente lo mismo: se puede comparar');
ok(d1.peor > 1 && d1.peor < 4, 'los inclinómetros salen torcidos, unos más que otros',
   'el peor a ' + d1.peor.toFixed(2) + '°');

/* apagadas, no pasa nada: no se rompe solo el que no lo pide */
const Ptr = new SIM.Planta({ nTcu: 50, nHsu: 1, perfil: 'SP_45W_6Ah', hora: 6, dia: 172,
                             lat: 42.82, lon: -1.60, tz: 1 });
for (let i = 0; i < 12 * 60; i++) Ptr.paso(60);
ok(Ptr.tcus.every(t => t.online && !t.ejeDuro && !t.ejeAtascado),
   'con las averías apagadas la planta no se rompe sola');

/* ───────── careo contra capturas ─────────
   Que el gemelo y SolarGPT digan lo mismo no demuestra que ninguno se parezca a un
   TCU en un poste. Lo que se comprueba aquí es que el careo MIDE: si a la captura se
   le mete un sesgo conocido, tiene que salir ese sesgo y no otro. */
const Careo = (await import('./careo.js')).default;
const Historia = (await import('./historia.js')).default;

const Pcar = new SIM.Planta({ nTcu: 2, nHsu: 1, perfil: 'SP_45W_6Ah', hora: 6, dia: 172,
                            lat: 42.82, lon: -1.60, tz: 1 });
const hcar = new Historia({ cadaS: 300 });
const filasCar = ['Fecha;30111 tilt_angle [deg];30096 soc [%]'];
const SESGO_CAR = 0.7;
for (let i = 0; i < 14 * 60; i++) {
  Pcar.paso(60); hcar.paso(Pcar, 1);
  if (i % 5 === 0) {
    const t = Pcar.tcu(1), hh = Pcar.t.hora;
    const hs = String(Math.floor(hh)).padStart(2, '0') + ':' + String(Math.floor(hh % 1 * 60)).padStart(2, '0');
    filasCar.push('2026-06-21 ' + hs + ':00;' + Math.round((t.angulo + SESGO_CAR) * 10) + ';' + Math.round(t.soc));
  }
}
const capCar = Careo.parsea(filasCar.join('\n'));
ok(capCar.cols.length === 2 && capCar.cols[0].addr === 30111,
   'las columnas se leen por la dirección de delante, sin saberse los nombres',
   capCar.cols.map(c => c.addr).join(', '));
ok(capCar.filas.length === filasCar.length - 1 && !capCar.avisos.length,
   'y la captura entera se lee sin avisos', capCar.filas.length + ' filas');

const carRes = Careo.compara(capCar, hcar.m, 30111, 'med', { escala: 10, banda: 1 });
ok(Math.abs(carRes.medio + SESGO_CAR) < 0.02,
   'el careo mide el sesgo que se le metió, no otro',
   'inyectado ' + SESGO_CAR + '° · medido ' + (-carRes.medio).toFixed(3) + '°');
ok(carRes.n === capCar.filas.length && carRes.dentroPct === 100,
   'empareja todos los puntos y los sitúa dentro de la banda');

/* separador y formato de fecha: un Excel en inglés no es motivo para rechazar nada */
const capComaCar = Careo.parsea('timestamp,30111 tilt [deg]\n21/06/2026 10:00,123\n21/06/2026 10:05,140');
ok(capComaCar.filas.length === 2 && capComaCar.filas[0].v[30111] === 123,
   'lee igual con comas y con fecha dd/mm/aaaa');

/* sin pareja de hora no se inventa un careo */
const lejosCar = Careo.compara(Careo.parsea('Fecha;30111 t [deg]\n2026-06-21 03:00:00;100'),
                            hcar.m, 30111, 'med', { escala: 10 });
ok(lejosCar.n === 0 && lejosCar.sinPar === 1,
   'un punto sin muestra a esa hora se descarta, no se estira la curva para que case');

/* ── el canon interpola, no redondea al vecino ─────────────────────────────
   `Canon.en(h)` tomaba la muestra MÁS PRÓXIMA y la SIGUIENTE, no el intervalo
   que encierra la hora. En la segunda mitad de cada intervalo el par elegido
   dejaba fuera a `h`, el factor salía negativo y el clamp a [0,1] lo tapaba:
   devolvía la muestra más próxima tal cual. Con 10:00→0° y 11:00→10°, las
   10:45 daban 10° en vez de 7,5°. Mudo, y sólo en media rampa. */
console.log('\n── el canon interpola de verdad ──');
const serieCanon = (hora, theta) => {
  const c = Object.create(Canon.prototype);
  c.serie = { hora, theta, objetivo: theta, difusa: null, alpha: null, ghi: null };
  return c;
};

const canonRampa = serieCanon([10, 11, 12], [0, 10, 20]);
casi(canonRampa.en(10.25).theta, 2.5, 1e-9, 'primer cuarto del intervalo');
casi(canonRampa.en(10.5).theta, 5.0, 1e-9, 'mitad del intervalo');
casi(canonRampa.en(10.75).theta, 7.5, 1e-9,
     'y el ÚLTIMO cuarto —el que se redondeaba al vecino— también');
casi(canonRampa.en(11).theta, 10.0, 1e-9, 'el nodo cae en su propia muestra');

/* la serie da la vuelta al día: 23 h → 0 h es un intervalo, no un salto */
const canonVuelta = serieCanon([23, 0], [0, 10]);
casi(canonVuelta.en(23.75).theta, 7.5, 1e-9,
     'interpola también cruzando la medianoche');

/* con huso no nulo la serie NO está ordenada por hora civil */
const canonHuso = serieCanon([22, 23, 0, 1], [0, 10, 20, 30]);
casi(canonHuso.en(0.5).theta, 25.0, 1e-9,
     'y con la serie desordenada por hora civil sigue cogiendo su intervalo');

/* una sola muestra no tiene intervalo: se devuelve tal cual, sin dividir por cero */
ok(serieCanon([7], [42]).en(13).theta === 42,
   'con una sola muestra devuelve su valor, no NaN');

console.log('\n' + (fallos ? '✗ ' + fallos + ' fallos de ' + hechas : '✓ ' + hechas + ' comprobaciones, todas bien') + '\n');
process.exit(fallos ? 1 : 0);
