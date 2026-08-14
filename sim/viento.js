/* ============================================================================
   viento.js — ABANDERAMIENTO CANÓNICO B2, en un solo sitio.

   Fichero COMPARTIDO entre repos (mismo criterio que seguidor.js): vive igual en
   gemelo-digital/sim/ y en cobertura-zigbee/. Si se toca en uno, se copia al otro.

   La estrategia es la B2 de SolarGPT (solargpt_core/wind_stow_strategies.py,
   «Defaults canónicos (decisión EPC del proyecto)»):

     · DOS umbrales:  40 km/h → parcial   ·   60 km/h → total
     · Cara al SOL (eje B; el eje A sería cara al viento, y no es el nuestro)
     · Sector PARCIAL = [30°, 55°] del lado del sol. No es «irse a 30°»: es
       QUEDARSE DENTRO del sector. Si el seguimiento pide 42°, se queda en 42;
       si pide 10°, sube a 30. Sigue produciendo, pero ya no da la cara plana.
     · Histéresis de desabanderamiento: 30 minutos sin viento.

   Y una regla que NO está en el canon pero sí en el equipo real, aprendida en
   terreno.html: **el lado se fija al abanderar**. Si abandera por la mañana
   mirando al este, se queda al este aunque el sol cruce el mediodía. Recalcular
   el lado a media bandera manda al seguidor a cruzar 110° con viento fuerte, que
   es justo lo que un abanderamiento existe para evitar.

   Uso:
       var ab = new Abanderamiento();                  // o new Abanderamiento({t1:…})
       var r = ab.paso(dt, vientoMs, anguloSeguimiento, azimutSolGrados);
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

function Abanderamiento(cfg) {
  cfg = cfg || {};
  this.t1 = cfg.t1 != null ? cfg.t1 : CANON.t1;
  this.t2 = cfg.t2 != null ? cfg.t2 : CANON.t2;
  this.parcialMin = cfg.parcialMin != null ? cfg.parcialMin : CANON.parcialMin;
  this.total = cfg.total != null ? cfg.total : CANON.total;
  this.holdS = (cfg.holdMin != null ? cfg.holdMin : CANON.holdMin) * 60;
  this.estado = 0;      /* 0 seguimiento · 1 parcial · 2 total */
  this.hold = 0;        /* segundos que quedan de histéresis */
  this.lado = 0;        /* signo fijado al abanderar: −1 este, +1 oeste */
}

/* Lado del sol: azimut < 180° (mañana) → el seguidor mira al ESTE, θ negativo. */
Abanderamiento.prototype.ladoDelSol = function (azimutSolDeg) {
  var az = ((azimutSolDeg % 360) + 360) % 360;
  return az < 180 ? -1 : 1;
};

/* dt en segundos · viento en m/s · ángulo de seguimiento y azimut solar en grados */
Abanderamiento.prototype.paso = function (dt, vientoMs, anguloSeguimiento, azimutSolDeg) {
  var antes = this.estado;
  if (vientoMs >= this.t2) { this.estado = 2; this.hold = this.holdS; }
  else if (vientoMs >= this.t1) { this.estado = Math.max(this.estado, 1); this.hold = this.holdS; }
  else if (this.hold > 0) { this.hold -= dt; }
  else { this.estado = 0; }

  /* el lado se fija en el momento de abanderar y no se vuelve a tocar hasta que
     se desabandera del todo */
  if (this.estado > 0 && antes === 0) this.lado = this.ladoDelSol(azimutSolDeg);
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
    txt: this.estado === 2 ? 'bandera total' : (this.estado === 1 ? 'bandera parcial' : '')
  };
};

Abanderamiento.CANON = CANON;
if (typeof window !== 'undefined') window.Abanderamiento = Abanderamiento;
if (typeof module !== 'undefined') module.exports = Abanderamiento;
})(this);
