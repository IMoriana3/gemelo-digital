#!/usr/bin/env node
/* Prueba de humo del motor: recorre un día entero de planta y comprueba que lo
   que sale por los registros es lo que dice el mapa. Decodifica AL REVÉS que
   planta.js (como lo haría el colector de scada, no como lo escribió el motor):
   si un día alguien cambia el orden de palabra o una escala, esto se cae.

       node sim/prueba.mjs
*/
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
ok(Math.abs(Math.abs(t.angulo) - 55) < 1, 'el seguidor llega a defensa ±55°', t.angulo.toFixed(1) + '°');
ok(bitde(P.regsTCU(t)[30001], 13, 15) === 1, 'safe position activa = 1 en bits 15:13');

console.log('\n── el viento manda sobre manual ──');
t.modo = SIM.MODO.MANUAL; t.manual = 0;
for (let i = 0; i < 20 * 60; i += 5) P.paso(5);
ok(t.sp === SIM.SP.VIENTO && Math.abs(t.angulo) > 50, 'en manual sigue abanderado', t.angulo.toFixed(1) + '°');

console.log('\n── calma: histéresis de 30 min antes de desabanderar ──');
P.meteo.viento = 2;
P.paso(60); ok(t.sp === SIM.SP.VIENTO, 'al minuto todavía abanderado');
for (let i = 0; i < 35 * 60; i += 30) P.paso(30);
ok(t.sp === SIM.SP.NINGUNA, 'pasados 30 min, desabanderado', t.estadoTxt());
t.modo = SIM.MODO.AUTO;

console.log('\n── seta de emergencia ──');
P.ncu.seta = true; const antes = t.angulo;
for (let i = 0; i < 15 * 60; i += 5) P.paso(5);
ok(Math.abs(t.angulo - antes) < 0.05, 'con la seta pulsada el seguidor no se mueve');
ok(bitde(P.regsTCU(t)[30002], 4, 4) === 1, 'bit de seta en alarmas 1 (30002.4)');
ok(bitde(P.regsTCU(t)[30006], 15, 15) === 0, 'system_ok cae a 0');
ok(bitde(P.regsNCU()[30100], 13, 13) === 1, 'seta también en la entrada digital de la NCU');
ok(t.salud() === 'alarma', 'salud del TCU = alarma');
P.ncu.seta = false;

console.log('\n── limpieza del grupo 2 ──');
P.ncu.limpieza[1] = true;
for (let i = 0; i < 30 * 60; i += 10) P.paso(10);
const g2 = P.seguidores().filter(x => x.grupo === 2), g1 = P.seguidores().filter(x => x.grupo === 1);
ok(g2.every(x => x.sp === SIM.SP.LIMPIEZA), 'todo el grupo 2 en SP4 limpieza');
ok(g1.every(x => x.sp === SIM.SP.NINGUNA), 'el grupo 1 sigue a lo suyo');
ok(Math.abs(g2[0].angulo) < 0.5, 'limpieza deja el seguidor horizontal', g2[0].angulo.toFixed(2) + '°');
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
ok(rep && Math.abs(rep.angulo) < 0.01, 'el repetidor no se mueve');
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
const sp = noche('SP_45W_3Ah'), st = noche('STRING_60W_3Ah'), ac = noche('AC_6Ah');
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
ok(ac.soc > 79 && ac.soc <= 80.01, 'el TCU de alterna se queda clavado en el techo de la estrategia', ac.soc.toFixed(1) + '%');

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
ok(Math.abs(sp.ah - 3) < 0.01 && Math.abs(ac.ah - 6) < 0.01, 'la capacidad sale del perfil (3 Ah / 6 Ah)');
const pSp = new SIM.Planta({ nTcu: 1, nHsu: 1, nRep: 0, perfil: 'SP_60W_6Ah' });
ok(bitde(pSp.regsTCU(pSp.tcu(1))[30000], 0, 3) === SIM.TIPO_REG.sp, 'un TCU autoalimentado se declara tipo BAT en 30000');

const pAc = new SIM.Planta({ nTcu: 2, nHsu: 1, nRep: 0, perfil: 'AC_6Ah', dia: 200, hora: 22 });
ok(bitde(pAc.regsTCU(pAc.tcu(1))[30000], 0, 3) === SIM.TIPO_REG.ac, 'un TCU de alterna se declara tipo AC en 30000');
pAc.ncu.acFallo = true;
for (let i = 0; i < 120; i++) pAc.paso(60);          /* 2 h de corte, de noche */
ok(pAc.tcu(1).iBat < 0, 'con la alterna cortada tira de la batería de respaldo', pAc.tcu(1).iBat.toFixed(0) + ' mA');
ok(pAc.tcu(1).soc < 100, 'y el SoC empieza a bajar', pAc.tcu(1).soc.toFixed(2) + '%');

const pSin = new SIM.Planta({ nTcu: 1, nHsu: 1, nRep: 0, perfil: 'AC_SIN_BAT', dia: 200, hora: 22 });
ok(bitde(pSin.regsTCU(pSin.tcu(1))[30002], 10, 10) === 1, 'sin batería levanta el bit «battery not connected»');
pSin.ncu.acFallo = true; pSin.paso(60);
ok(pSin.tcu(1).salud() === 'offline', 'sin batería y sin alterna, el TCU se cae', pSin.tcu(1).estadoTxt());
pSin.ncu.acFallo = false; pSin.paso(60);
ok(pSin.tcu(1).salud() !== 'offline', 'y vuelve al volver la red');

console.log('\n── un día entero sin explotar ──');
const P2 = new SIM.Planta({ nTcu: 6, nHsu: 1, nRep: 0, dia: 15, hora: 0 });
let socMin = 100, malos = 0;
for (let i = 0; i < 24 * 60; i++) {
  P2.paso(60);
  for (const x of P2.tcus) {
    socMin = Math.min(socMin, x.soc);
    if (!isFinite(x.angulo) || !isFinite(x.soc) || Math.abs(x.angulo) > 55.001) malos++;
  }
}
ok(malos === 0, 'ni un NaN ni un ángulo fuera de ±55° en 1.440 pasos');
ok(socMin > 40, 'la batería aguanta el día de invierno', 'SoC mínimo ' + socMin.toFixed(1) + '%');
const RT = P2.regsTCU(P2.tcu(1));
ok(Object.keys(RT).length > 60, 'la imagen de registros de la TCU está poblada', Object.keys(RT).length + ' registros');
ok(Object.keys(P2.regsNCU()).length > 100, 'y la de la NCU también', Object.keys(P2.regsNCU()).length + ' registros');

console.log('\n' + (fallos ? '✗ ' + fallos + ' fallos de ' + hechas : '✓ ' + hechas + ' comprobaciones, todas bien') + '\n');
process.exit(fallos ? 1 : 0);
