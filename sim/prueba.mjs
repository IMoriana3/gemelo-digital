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

console.log('\n── seta: entrada BINARIA, no una decisión ──');
P.ncu.seta = true;
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
ok(bitde(P.regsNCU()[30100], 13, 13) === 1, 'seta también en la entrada digital de la NCU');
ok(t.salud() === 'alarma', 'salud del TCU = alarma');

console.log('\n── … y va ENCLAVADA ──');
P.ncu.seta = false;
for (let i = 0; i < 5 * 60; i += 5) P.paso(5);
ok(!t.motorHabilitado, 'soltar la seta NO rearma el motor: la alarma sigue enclavada');
ok(t.alarmaMotorEnclavada, 'y se ve en el estado del equipo', t.estadoTxt());
t.limpiaAlarmas();                                  /* 40007 bit 13, como la toolbox */
P.paso(5);
ok(t.motorHabilitado, 'solo lo rearma limpiar alarmas (40007 bit 13)');
P.ncu.seta = true; for (let i = 0; i < 60; i += 5) P.paso(5);
t.limpiaAlarmas(); P.paso(5);
ok(!t.motorHabilitado, 'y limpiar con la seta AÚN pulsada no sirve de nada');
P.ncu.seta = false; for (let i = 0; i < 60; i += 5) P.paso(5);
t.limpiaAlarmas();
for (let i = 0; i < 30 * 60; i += 5) P.paso(5);
ok(t.motorHabilitado && Math.abs(t.objetivo - t.anguloReal) < 3, 'rearmado, recupera su posición');

/* la seta del armario enclava la flota ENTERA, no solo el equipo que se mira: por
   eso la toolbox limpia alarmas por rango y no de una en una */
ok(P.seguidores().filter(x => x.alarmaMotorEnclavada).length === P.seguidores().length - 1,
   'la seta del armario dejó enclavada a toda la flota, no solo a la TCU 1');
P.tcus.forEach(x => x.limpiaAlarmas());
for (let i = 0; i < 20 * 60; i += 10) P.paso(10);

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
ok(Math.abs(ti.objetivo - ti.angulo) < 1.5, 'el TCU se cree que está donde le mandan',
   'desviación que publica: ' + (ti.objetivo - ti.angulo).toFixed(2) + '°');
ok(Math.abs(ti.objetivo - ti.anguloReal) > 2, '…pero la mesa está a 3° de donde debería',
   'error real: ' + (ti.objetivo - ti.anguloReal).toFixed(2) + '°');
ok(ti.salud() === 'ok', 'y el SCADA lo ve todo verde — este es el fallo que no se ve en pantalla');
/* calibrarlo con 41058 lo arregla */
ti.sensor.offsetCfg = 3.0;
for (let i = 0; i < 30 * 60; i += 10) P.paso(10);
ok(Math.abs(ti.objetivo - ti.anguloReal) < 1.5, 'compensado en 41058, la mesa vuelve a su sitio',
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
ok(Math.abs(g2[0].anguloReal) < 0.5, 'limpieza deja el seguidor horizontal', g2[0].anguloReal.toFixed(2) + '°');
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

console.log('\n' + (fallos ? '✗ ' + fallos + ' fallos de ' + hechas : '✓ ' + hechas + ' comprobaciones, todas bien') + '\n');
process.exit(fallos ? 1 : 0);
