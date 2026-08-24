/* ============================================================================
   viento.js — ABANDERAMIENTO CANÓNICO B2, en un solo sitio.

   Fichero COMPARTIDO entre repos (mismo criterio que seguidor.js): vive igual en
   gemelo-digital/sim/ y en cobertura-zigbee/. Si se toca en uno, se copia al otro.

   Las CUATRO estrategias canónicas de SolarGPT (solargpt_core/wind_stow_strategies.py,
   «Defaults canónicos (decisión EPC del proyecto)»), sobre dos ejes:

     · Eje 1 — hacia dónde mira la bandera:
         A · cara al VIENTO  (signo por el azimut del viento, de dónde VIENE)
         B · cara al SOL     (signo por el azimut solar)
     · Eje 2 — cuántos umbrales:
         1 · todo o nada: por encima de 40 km/h, bandera completa
         2 · dos umbrales con sector parcial e histéresis de 30 min

       A1 · viento · 1 umbral        B1 · sol · 1 umbral
       A2 · viento · 2 umbrales      B2 · sol · 2 umbrales   ← la de la casa

   Con dos umbrales:
     · 40 km/h → parcial   ·   60 km/h → total
     · Sector PARCIAL = [30°, 55°] del lado del sol. No es «irse a 30°»: es
       QUEDARSE DENTRO del sector. Si el seguimiento pide 42°, se queda en 42;
       si pide 10°, sube a 30. Sigue produciendo, pero ya no da la cara plana.
     · Histéresis de desabanderamiento: 30 minutos sin viento.

   Y una regla que NO está en el canon pero sí en el equipo real, aprendida en
   terreno.html: **el lado se fija al abanderar**. Si abandera por la mañana
   mirando al este, se queda al este aunque el sol cruce el mediodía. Recalcular
   el lado a media bandera manda al seguidor a cruzar 110° con viento fuerte, que
   es justo lo que un abanderamiento existe para evitar.

   ⚠ CONVENCIÓN DE SIGNO. El canon usa pvlib con eje a 0°, donde θ POSITIVO es cara
   al este. La casa (gemelo, terreno, simulador) usa lo contrario: θ NEGATIVO es
   este, positivo oeste. Este módulo devuelve ángulos en convención DE LA CASA, así
   que su signo es el opuesto al de wind_stow_strategies.py. Está a propósito.

   Uso:
       var ab = new Abanderamiento();                      // B2 por defecto
       var ab = new Abanderamiento({estrategia:'A2'});     // o cualquiera de las 4
       var r = ab.paso(dt, vientoMs, anguloSeguimiento, azimutSol, azimutViento);
       // r.estado 0 nada · 1 parcial · 2 total   ·   r.objetivo en grados
   ============================================================================ */
(function (global) {
'use strict';

/* Los valores por defecto son los canónicos. Si la página carga fisica.js (que los
   genera del propio módulo de SolarGPT), se toman de ahí. */
var F = (typeof window !== 'undefined' && window.FISICA) ||
        (typeof require === 'function' ? (function () { try { return require('./fisica.js'); } catch (e) { return null; } })() : null);

var CANON = {
  t1: F ? F.e.WIND_T1 : 11.111,               /* m/s · 40 km/h → parcial */
  t2: F ? F.e.WIND_T2 : 16.667,               /* m/s · 60 km/h → total */
  parcialMin: F ? F.e.PARTIAL_STOW_DEG : 30,  /* ° mínimos del sector parcial */
  total: F ? F.e.DEFENSE_POS : 55,            /* ° de la bandera completa */
  holdMin: F ? (F.e.DESTOW_HOLD_MIN != null ? F.e.DESTOW_HOLD_MIN : 30) : 30
};

/* Las cuatro, con su etiqueta para pintarlas en un selector. */
var ESTRATEGIAS = [
  { id: 'B2', eje: 'sol',    umbrales: 2, n: 'B2 · cara al sol · 2 umbrales + sector parcial', canon: true },
  { id: 'B1', eje: 'sol',    umbrales: 1, n: 'B1 · cara al sol · 1 umbral (todo o nada)' },
  { id: 'A2', eje: 'viento', umbrales: 2, n: 'A2 · cara al viento · 2 umbrales + sector parcial' },
  { id: 'A1', eje: 'viento', umbrales: 1, n: 'A1 · cara al viento · 1 umbral (todo o nada)' }
];
function estrategiaDe(id) {
  for (var i = 0; i < ESTRATEGIAS.length; i++) if (ESTRATEGIAS[i].id === id) return ESTRATEGIAS[i];
  return ESTRATEGIAS[0];
}

function Abanderamiento(cfg) {
  cfg = cfg || {};
  var E = estrategiaDe(cfg.estrategia || 'B2');
  this.estrategia = E.id;
  this.eje = E.eje;                 /* 'sol' (B) o 'viento' (A) */
  this.umbrales = E.umbrales;       /* 1 o 2 */
  this.t1 = cfg.t1 != null ? cfg.t1 : CANON.t1;
  this.t2 = cfg.t2 != null ? cfg.t2 : CANON.t2;
  this.parcialMin = cfg.parcialMin != null ? cfg.parcialMin : CANON.parcialMin;
  this.total = cfg.total != null ? cfg.total : CANON.total;
  this.holdS = (cfg.holdMin != null ? cfg.holdMin : CANON.holdMin) * 60;
  this.estado = 0;      /* 0 seguimiento · 1 parcial · 2 total */
  this.hold = 0;        /* segundos que quedan de histéresis */
  this.lado = 0;        /* signo fijado al abanderar: −1 este, +1 oeste */
}

/* Signo de la bandera a partir de un azimut. Azimut < 180° (este) → el seguidor
   mira al ESTE, que en la convención de la casa es θ NEGATIVO. Sirve igual para el
   azimut solar (eje B) que para el del viento (eje A, de dónde VIENE el viento,
   convención meteorológica: 90° = del este, 270° = del oeste). */
Abanderamiento.prototype.ladoDe = function (azimutDeg) {
  if (azimutDeg == null || isNaN(azimutDeg)) return -1;      /* por defecto, este */
  var az = ((azimutDeg % 360) + 360) % 360;
  return az < 180 ? -1 : 1;
};
Abanderamiento.prototype.ladoDelSol = function (az) { return this.ladoDe(az); };

/* dt en segundos · viento en m/s · ángulo de seguimiento y azimut solar en grados */
Abanderamiento.prototype.paso = function (dt, vientoMs, anguloSeguimiento, azimutSolDeg, azimutVientoDeg) {
  var antes = this.estado;
  /* ¿sigue soplando por encima del umbral que abandera? Es la diferencia entre «está
     abanderado y esperando» y «está abanderado porque el viento no para»: mientras esto
     sea cierto la histéresis se REARMA en cada paso, así que no hay cuenta atrás que
     valga — sale entera una y otra vez. */
  var sobre = this.umbrales === 1 ? vientoMs > this.t1 : vientoMs >= this.t1;
  if (this.umbrales === 1) {
    /* A1/B1: todo o nada, y sin histéresis — así lo define el canon */
    this.estado = vientoMs > this.t1 ? 2 : 0;
  } else {
    if (vientoMs >= this.t2) { this.estado = 2; this.hold = this.holdS; }
    else if (vientoMs >= this.t1) { this.estado = Math.max(this.estado, 1); this.hold = this.holdS; }
    else if (this.hold > 0) { this.hold -= dt; }
    else { this.estado = 0; }
  }

  /* el lado se fija en el momento de abanderar y no se vuelve a tocar hasta que
     se desabandera del todo */
  if (this.estado > 0 && antes === 0) {
    this.lado = this.ladoDe(this.eje === 'viento' ? azimutVientoDeg : azimutSolDeg);
  }
  if (this.estado === 0) this.lado = 0;

  var obj;
  if (this.estado === 2) {
    obj = this.lado * this.total;
  } else if (this.estado === 1) {
    /* clip al sector, no salto al mínimo */
    obj = this.lado > 0
      ? Math.min(Math.max(anguloSeguimiento, this.parcialMin), this.total)
      : Math.max(Math.min(anguloSeguimiento, -this.parcialMin), -this.total);
  } else {
    obj = anguloSeguimiento;
  }
  return {
    estado: this.estado,
    objetivo: obj,
    lado: this.lado,
    holdRestante: Math.max(0, this.hold),
    /* lo que hace falta para pintar la espera de verdad */
    sobreUmbral: sobre,
    /* segundos que faltan para soltar la bandera. Solo cuenta cuando el viento YA ha
       bajado: si sigue por encima no es una cuenta atrás, es una alarma. Y con un solo
       umbral no hay histéresis, así que tampoco hay nada que contar. */
    cuenta: (this.estado > 0 && !sobre && this.umbrales === 2) ? Math.max(0, this.hold) : 0,
    histeresis: this.umbrales === 2 ? this.holdS : 0,
    txt: this.estado === 2 ? 'bandera total' : (this.estado === 1 ? 'bandera parcial' : '')
  };
};

Abanderamiento.CANON = CANON;
Abanderamiento.ESTRATEGIAS = ESTRATEGIAS;
if (typeof window !== 'undefined') window.Abanderamiento = Abanderamiento;
if (typeof module !== 'undefined') module.exports = Abanderamiento;
})(this);
