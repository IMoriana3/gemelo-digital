#!/usr/bin/env node
/* INFORME DE IMPACTO — ¿cuánto cambia cada divergencia entre los dos cálculos?

   Tenemos dos físicas de batería en casa que no dicen lo mismo:

     · SolarGPT · solargpt_core/tcu_compare.py — port directo del cell §04.1d del
       notebook v16.2, «física conservada bit a bit», con las curvas digitalizadas
       de PS26002_RevA y de la campaña «Consumos motor_02».
     · bateria.html — el simulador de disponibilidad, con constantes planas.

   El simulador de planta replica hoy el segundo. Antes de alinear nada conviene
   saber cuánto pesa cada diferencia, que es lo que mide este script: coge un año
   simulado y recalcula el balance cambiando UNA cosa cada vez.

       node sim/impacto.mjs [días]        (por defecto 365)

   Aviso honesto sobre el método: las diferencias de ENERGÍA se miden en
   post-proceso sobre la misma serie de irradiancia, temperatura y movimiento —no
   se resimula el control—, así que capturan el efecto de primer orden y no la
   realimentación (menos carga → más horas en defensa → menos movimiento). Las
   diferencias de COMPORTAMIENTO (abanderamiento) sí se resimulan enteras.        */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SIM = require('./planta.js');
const F = require('./fisica.js');

const DIAS = parseInt(process.argv[2] || '365', 10);
const PASO = 300;                       /* 5 min: suficiente para energía diaria */

/* ═══════════ las curvas del motor canónico (tcu_compare.py) ═══════════ */
/* η del cargador digitalizada de PS26002_RevA: η(G) = 0,96·(1 − e^(−G/100)) */
function etaCargador(g) { return g <= 0 ? 0 : 0.96 * (1 - Math.exp(-Math.abs(g) / 100)); }
/* curva de motor MEDIDA (mA a 24 V) contra el ángulo absoluto */
const M_ANG = [0, 2.5, 7.5, 12.5, 17.5, 22.5, 27.5, 32.5, 37.5, 42.5, 47.5, 52.5, 55];
const M_MA = [1500, 1588, 1600, 1714, 1860, 1975, 2135, 2277, 2409, 2497, 2651, 2740, 2800];
function interp(x, xs, ys) {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  for (var i = 1; i < xs.length; i++) if (x <= xs[i]) {
    var f = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
    return ys[i - 1] + f * (ys[i] - ys[i - 1]);
  }
  return ys[ys.length - 1];
}
function motorW(ang) { return interp(Math.abs(ang), M_ANG, M_MA) / 1000 * 24.0; }

/* constantes del motor canónico que difieren de las del estudio.
   DOS de las que había aquí ya no divergen, y por eso están puestas al valor común:
     · el sleep, que tcu_compare.py tenía en 0,45 W frente a los 0,64 de tcu.py;
     · la velocidad del actuador, 0,16 °/s frente a los 0,17 medidos en campo
       (tracker.CANONICAL_SLEW_RATE_DEG_PER_S), que es la que usa todo lo demás.
   Se dejan los casos históricos abajo para poder ver qué compró cada arreglo, pero el
   contraste que importa —la curva de motor— se hace ya con la MISMA velocidad en los
   dos lados, que es la única forma de medir la curva y no la mezcla de las dos cosas. */
const C = {
  vMax: F.e.SLEW_DPS,   /* 0,17 °/s · el canónico, común a los dos lados */
  vMaxViejo: 0.16,           /* el que traía el port del cuaderno, para el caso histórico */
  pSleep: 0.64,              /* W de noche · idle = sleep, común a los dos lados */
  pSleepViejo: 0.45,         /* el que traía tcu_compare.py antes de alinearlo */
  pIdle: 0.64,
  vEmpty: 20.0, vFull: 29.2,
  iChMax: 1.2,           /* A — el límite de corriente de carga */
  etaString: 0.96,
  stringWake: 60,        /* W/m² de arranque del convertidor de string */
  gamma: -0.0035, dTnoct: 20, tRef: 25,
  pExt: 54.0
};

/* ═══════════ 1 · serie de referencia ═══════════ */
function corre(cfg, dias, gancho) {
  const P = new SIM.Planta(Object.assign({ nTcu: 1, nHsu: 1, nRep: 0, dia: 1, hora: 0 }, cfg));
  P.meteo.nubes = 25; P.meteo.tMedia = 14; P.meteo.viento = 4;
  const t = P.tcu(1);
  const pasos = Math.round(dias * 86400 / PASO);
  for (let i = 0; i < pasos; i++) { P.paso(PASO); if (gancho) gancho(P, t, i); }
  return { P, t };
}

console.log('\n══ INFORME DE IMPACTO · ' + DIAS + ' días simulados, paso de ' + (PASO / 60) + ' min ══\n');
console.log('Perfil de referencia: ' + F.perfilPorDefecto + ' · estrategia oficial activa\n');

/* serie: por paso guardamos lo que hace falta para recalcular el balance */
const serie = [];
let anguloPrev = null;
const base = corre({ perfil: F.perfilPorDefecto }, DIAS, (P, t) => {
  const mov = anguloPrev === null ? 0 : Math.abs(t.anguloReal - anguloPrev);
  anguloPrev = t.anguloReal;
  serie.push({
    poa: t.poa || 0, ghi: t.ghi || 0, tAmb: t.tBat, dia: (t.ghi || 0) > 10,
    mov: mov, ang: Math.abs(t.anguloReal), soc: t.soc,
    whCarga: t.whCarga, whConsumo: t.whConsumo, calef: t.calefactor
  });
});
const pf = base.t.perfil, capWh = pf.wh, dtH = PASO / 3600;

/* ═══════════ 2 · el balance, con una variante cada vez ═══════════ */
/* Rehace el año entero integrando el SoC con el modelo que se le pase. Devuelve
   los indicadores que de verdad se miran en el estudio. */
function balance(nombre, opts) {
  opts = opts || {};
  let soc = 0.80, socMin = 1, whMotorTotal = 0, whCargaTotal = 0, hParked = 0, hInhib = 0;
  let parked = false;
  const E = base.P.cfg.estrategia;
  for (let i = 0; i < serie.length; i++) {
    const s = serie[i];
    /* --- entrada --- */
    let pEnt;
    if (opts.etaCurva) {
      const tc = s.tAmb + (s.poa / 1000) * C.dTnoct;
      const pPv = Math.max(0, (s.poa / 1000) * pf.chgW * (1 + (opts.gamma ? C.gamma : 0) * (tc - C.tRef)));
      pEnt = pPv * etaCargador(s.poa);
    } else {
      pEnt = pf.chgW * Math.min(s.poa / 1000, 1) * F.e.ETA_CHG;
    }
    /* --- consumo ---
       La REFERENCIA no se calcula aquí: sale de consumoTCU, el módulo de gestión de
       batería. Lo que se calcula a mano es solo la VARIANTE que se está contrastando
       (la curva medida I(θ)), que es de lo que va el informe. */
    let mov = s.mov;
    if (E.winter) mov *= F.e.DEG_H_WINTER / F.e.DEG_H_NORMAL;
    const canon = F.consumoTCU({ dtH: dtH, dia: s.dia, mov: mov, pos: s.ang,
                                 motorModel: 'factiun', calefactada: s.calef, tAmb: s.tAmb });
    let whMot = canon.motor;
    if (opts.motorCurva) whMot = motorW(s.ang) * (mov / (opts.slew16 ? C.vMaxViejo : C.vMax)) / 3600;
    /* el sleep viejo es lo único que puede apartarse de lo que dice el módulo */
    const whBase = opts.sleep45 && !s.dia ? C.pSleepViejo * dtH : canon.base;
    const whCal = canon.heat;
    const whCons = whBase + whMot + whCal;
    whMotorTotal += whMot;
    /* --- admisión --- */
    const tEf = canon.tEff;
    let whChg = 0;
    if (s.dia && tEf >= E.tMin && s.poa >= (opts.etaCurva ? 0.5 : E.poaMin)) {
      let pAdm = Math.min(pEnt, F.cRateSafeLFP(tEf) * F.hotDerate(tEf) * capWh);
      if (opts.limiteCorriente) {
        const vBat = C.vEmpty + (C.vFull - C.vEmpty) * soc;
        pAdm = Math.min(pAdm, C.iChMax * vBat);
      }
      whChg = Math.max(0, pAdm) * dtH;
    } else if (s.poa >= E.poaMin && tEf < E.tMin) hInhib += dtH;
    /* --- techo y culombios --- */
    const techo = E.activa ? (E.socTgt / 100) : 1;
    const hueco = Math.max(0, techo - soc) * capWh + whCons;
    const whEf = Math.min(whChg, hueco);
    whCargaTotal += whEf;
    soc = Math.max(0, Math.min(1, soc + (whEf - whCons) / capWh));
    socMin = Math.min(socMin, soc);
    if (!parked && soc * 100 < E.socCrit) parked = true;
    else if (parked && soc * 100 >= E.socCrit + 2) parked = false;
    if (parked) hParked += dtH;
  }
  return {
    nombre: nombre,
    socMin: socMin * 100,
    whMotorDia: whMotorTotal / DIAS,
    whCargaDia: whCargaTotal / DIAS,
    hParked: hParked,
    pctNoDisp: 100 * hParked / (DIAS * 24),
    hInhib: hInhib
  };
}

const casos = [
  balance('REFERENCIA · como está hoy (bateria.html)', {}),
  balance('A · η del cargador: curva η(G) de PS26002', { etaCurva: true }),
  balance('B · motor: curva medida I(θ) — YA ADOPTADA', { motorCurva: true }),
  balance('C · límite por corriente de carga (1,2 A)', { limiteCorriente: true }),
  balance('D · coef. térmico del panel (γ=−0,0035)', { etaCurva: true, gamma: true }),
  balance('TODO · lo que sigue abierto, junto', {
    etaCurva: true, gamma: true, limiteCorriente: true }),
  balance('· (ya resuelto) sleep 0,45 W como estaba', { sleep45: true }),
  balance('· (ya resuelto) 0,16 °/s + la curva de motor', { motorCurva: true, slew16: true })
];

const ref = casos[0];
const fmt = (v, d) => (v >= 0 ? '+' : '') + v.toFixed(d == null ? 1 : d);
console.log('┌─ ENERGÍA (post-proceso sobre la misma serie) ' + '─'.repeat(46));
console.log('│ ' + 'variante'.padEnd(46) + 'SoC mín'.padStart(9) + 'motor/día'.padStart(12) +
            'carga/día'.padStart(12) + '% no disp.'.padStart(12));
for (const c of casos) {
  const esRef = c === ref;
  console.log('│ ' + c.nombre.padEnd(46) +
    (c.socMin.toFixed(1) + '%').padStart(9) +
    (c.whMotorDia.toFixed(2) + ' Wh').padStart(12) +
    (c.whCargaDia.toFixed(1) + ' Wh').padStart(12) +
    (c.pctNoDisp.toFixed(2) + ' %').padStart(12) +
    (esRef ? '' : '   →  ' + fmt(c.socMin - ref.socMin) + ' pp SoC · ' +
      fmt(100 * (c.whMotorDia / ref.whMotorDia - 1), 0) + ' % motor · ' +
      fmt(100 * (c.whCargaDia / ref.whCargaDia - 1), 0) + ' % carga'));
}
console.log('└' + '─'.repeat(90));

/* ═══════════ 3 · abanderamiento: cuatro criterios, la misma serie de viento ═══════════
   Aquí no vale el post-proceso: son máquinas de estado distintas. Se pasa la MISMA
   serie de viento por cada una y se cuentan horas y transiciones — cada transición
   es un viaje completo del seguidor, que es de donde sale el coste de motor. */
console.log('\n┌─ ABANDERAMIENTO · misma serie de viento por cada criterio ' + '─'.repeat(33));

const DIAS_V = Math.min(DIAS, 120);
const vientoSerie = [];
for (let i = 0; i < DIAS_V * 86400 / PASO; i++) {
  const tt = i * PASO;
  vientoSerie.push(4 + 9 * Math.max(0, Math.sin(tt / 43200) + Math.sin(tt / 9000) * 0.6));
}

/* B2 canónico y la variante con hold de 1 h: dos umbrales + histéresis TEMPORAL */
function corrreB2(holdMin) {
  let estado = 0, hold = 0, hParcial = 0, hTotal = 0, trans = 0, prev = 0;
  for (const v of vientoSerie) {
    if (v >= F.e.WIND_T2) { estado = 2; hold = holdMin * 60; }
    else if (v >= F.e.WIND_T1) { estado = Math.max(estado, 1); hold = holdMin * 60; }
    else if (hold > 0) hold -= PASO;
    else estado = 0;
    if (estado === 2) hTotal += PASO / 3600; else if (estado === 1) hParcial += PASO / 3600;
    if (estado !== prev) { trans++; prev = estado; }
  }
  return { hParcial, hTotal, trans };
}
/* el del SCADA: histéresis Schmitt sobre el VALOR de viento, un solo estado */
function corrreSchmitt(entra, sale) {
  let dentro = false, h = 0, trans = 0;
  for (const v of vientoSerie) {
    const k = v * 3.6;
    if (!dentro && k >= entra) { dentro = true; trans++; }
    else if (dentro && k <= sale) { dentro = false; trans++; }
    if (dentro) h += PASO / 3600;
  }
  return { hParcial: 0, hTotal: h, trans };
}

const filas = [
  ['B2 canónico EPC · 40/60 km/h, hold 30 min', corrreB2(30)],
  ['lo que tenía el simulador · hold de 1 h', corrreB2(60)],
  ['el del SCADA · Schmitt 60 entra / 40 sale', corrreSchmitt(60, 40)]
];
console.log('│ ' + 'criterio'.padEnd(44) + 'h parcial'.padStart(11) + 'h total'.padStart(10) +
            'h abanderado'.padStart(14) + 'transiciones'.padStart(14));
for (const [n, r] of filas) {
  console.log('│ ' + n.padEnd(44) + (r.hParcial.toFixed(0) + ' h').padStart(11) +
    (r.hTotal.toFixed(0) + ' h').padStart(10) +
    ((r.hParcial + r.hTotal).toFixed(0) + ' h').padStart(14) + String(r.trans).padStart(14));
}
console.log('└' + '─'.repeat(90));
console.log('\nSobre ' + DIAS_V + ' días. El criterio del SCADA solo abandera por encima de 60 km/h,');
console.log('así que pasa mucho menos tiempo en bandera — pero cada viaje suyo es a ±55° completos,');
console.log('mientras que B2 se queda en el sector parcial (≥30°) buena parte del tiempo.\n');

console.log('┌─ LA CURVA DE MOTOR: RESUELTA ' + '─'.repeat(61));
console.log('│ Ya no es una decisión abierta. bateria.html adoptó la tabla medida I(θ) —13 puntos,');
console.log('│ 1.500→2.800 mA, «Consumos motor_02.xlsx», TCU 33— y retiró el tope de 50 W por ser');
console.log('│ un envolvente de diseño y no una lectura del ensayo (la curva llega a 67,2 W).');
console.log('│');
console.log('│ Esta medición se hizo por separado y CONCUERDA: +14 % de consumo de motor frente al');
console.log('│ ajuste lineal, dentro del «9-16 % por debajo» que declara el propio fichero. Dos');
console.log('│ caminos distintos dando el mismo número es lo más parecido a una confirmación que');
console.log('│ hay sin datos de campo.');
console.log('│');
console.log('│ Lo que siguen esperando El Burgo y Ayora es la VALIDACIÓN: la curva es del banco,');
console.log('│ no de una planta. Los Wh de motor por día y por TCU medidos en campo son lo que');
console.log('│ dirá si el banco se parece a la realidad.');
console.log('└' + '─'.repeat(90) + '\n');
