/* ============================================================================
   difusa.js — SEGUIMIENTO CON CIELO CUBIERTO (overcast), en un solo sitio.

   Fichero COMPARTIDO entre repos, mismo criterio que viento.js y seguidor.js.

   Con cielo cubierto casi toda la irradiancia es DIFUSA, y la difusa no viene de
   donde está el sol: viene de todo el cielo. Apuntar al sol deja de ser lo mejor,
   porque un plano inclinado ve menos cielo que uno tumbado. Las cuatro políticas
   canónicas de SolarGPT (solargpt_core/tracker.py) hacen algo con eso:

     · none        no toca nada. La referencia.
     · flat        si el plano llano recoge un 2 % más, se tumba. Sin memoria.
     · continuous  barre α ∈ {0, ¼, ½, ¾, 1}, θ = (1−α)·θ_bt, y se queda con el
                   mejor POA. Es el techo matemático: nunca peor que `flat`,
                   porque `flat` es α = 1.
     · limited     mantiene el ángulo ANTERIOR mientras no pierda POA. No busca
                   ganancia: busca no moverse. Menos maniobras, menos motor.
     · poa_switch  como `flat` pero con máquina de estados: 30 min confirmando
                   antes de entrar y 90 min de permanencia mínima. Es la que se
                   parece a un equipo real, porque un tracker que se tumba y se
                   levanta cada vez que pasa una nube se rompe.

   DOS REGLAS QUE NO SE NEGOCIAN, las dos aprendidas a base de disgusto:

   1. PROTECCIÓN POR ENCIMA DE OPTIMIZACIÓN. Donde hay abanderamiento, latch de
      noche o congelado por batería, la difusa NO TOCA EL ÁNGULO. En SolarGPT
      esto se cazó en producción: con 90 km/h el motor devolvía `stow_active=1`
      y a la vez θ=0° porque el plano llano recogía un 2 % más. O sea el tracker
      tumbado en pleno vendaval, y el registro diciendo que estaba abanderado.

   2. CLAMP AL BACKTRACKING: |θ| nunca puede pasar de |θ_bt|. El backtracking ya
      recortó el ángulo para no sombrear la fila de al lado; dejar que la difusa
      lo abra otra vez es inventarse energía que se la come el vecino.

   Las ventanas van en MINUTOS y no en pasos, que es lo que las hace independientes
   del paso de simulación — el canon lo dice explícitamente (schema 2.1.0). Aquí se
   acumulan minutos de reloj simulado en vez de contar pasos, que es lo mismo en el
   límite continuo y lo correcto cuando el paso es variable.

   Uso:
       var d = new Difusa({ politica: 'poa_switch' });
       var r = d.paso(dtMin, ghi, thetaBt, function (th) { return poaDe(th); }, protegido);
       // r.theta  ángulo a ejecutar   ·   r.activa  ¿ha intervenido?
   ============================================================================ */
(function (global) {
'use strict';

var F = (typeof window !== 'undefined' && window.FISICA) ||
        (typeof require === 'function' ? (function () { try { return require('./fisica.js'); } catch (e) { return null; } })() : null);

/* Los valores por defecto son los de DiffuseConfig. Si la página carga fisica.js
   (que los genera del propio tracker.py), se toman de ahí. */
var D = (F && F.difusa) || {
  ghiMin: 50, flatEnter: 1.02, limitedHold: 1.0,
  alphas: [0, 0.25, 0.5, 0.75, 1],
  switchEnter: 1.02, switchExit: 1.0,
  switchConfirmMin: 30, switchDwellMin: 90
};

var POLITICAS = [
  { id: 'none',        n: 'Ninguna · seguimiento puro' },
  { id: 'poa_switch',  n: 'POA switch · plano con 30 min de confirmación y 90 de permanencia', real: true },
  { id: 'flat',        n: 'Flat · al plano en cuanto recoja más (sin memoria)' },
  { id: 'continuous',  n: 'Continua · barrido de α, el mejor POA (techo teórico)' },
  { id: 'limited',     n: 'Limitada · mantener el ángulo mientras no pierda POA' }
];

function Difusa(cfg) {
  cfg = cfg || {};
  this.politica = cfg.politica || 'none';
  this.ghiMin = cfg.ghiMin != null ? cfg.ghiMin : D.ghiMin;
  this.flatEnter = cfg.flatEnter != null ? cfg.flatEnter : D.flatEnter;
  this.limitedHold = cfg.limitedHold != null ? cfg.limitedHold : D.limitedHold;
  this.alphas = cfg.alphas || D.alphas;
  this.switchEnter = cfg.switchEnter != null ? cfg.switchEnter : D.switchEnter;
  this.switchExit = cfg.switchExit != null ? cfg.switchExit : D.switchExit;
  this.confirmMin = cfg.confirmMin != null ? cfg.confirmMin : D.switchConfirmMin;
  this.dwellMin = cfg.dwellMin != null ? cfg.dwellMin : D.switchDwellMin;
  this.reinicia();
}
Difusa.prototype.reinicia = function () {
  this.plano = false;        /* estado de poa_switch */
  this.entrando = 0;         /* minutos acumulados confirmando la entrada */
  this.saliendo = 0;         /* ídem la salida */
  this.desde = 1e9;          /* minutos en el estado actual (arranca «hace mucho») */
  this.previo = null;        /* ángulo anterior, para `limited` */
  this.activa = false;
  this.alpha = 0;
};

/* |θ| nunca por encima de |θ_bt|, conservando el signo. Copia exacta del
   clamp_to_backtrack canónico, que allí se declara «non-negotiable». */
function clampBt(th, thN) {
  var aN = Math.abs(thN), aO = Math.abs(th);
  if (aO <= aN + 1e-6) return th;
  var s = th === 0 ? (thN >= 0 ? 1 : -1) : (th > 0 ? 1 : -1);
  return s * aN;
}

/* dtMin  minutos simulados del paso
   ghi    W/m² globales horizontales
   thetaN ángulo que pide el seguimiento (ya con backtracking)
   poaDe  función θ → POA, la del propio simulador
   protegido  ¿hay abanderamiento, noche o congelado por batería? */
Difusa.prototype.paso = function (dtMin, ghi, thetaN, poaDe, protegido) {
  var dia = ghi > this.ghiMin;

  /* REGLA 1: la maniobra de protección manda. Y además se olvida el estado: si
     el equipo ha estado abanderado media hora, la confirmación que llevara
     acumulada ya no vale de nada. */
  if (protegido || !dia || this.politica === 'none') {
    if (protegido || !dia) { this.plano = false; this.entrando = 0; this.saliendo = 0; this.desde = 1e9; }
    this.previo = thetaN;
    this.activa = false; this.alpha = 0;
    return { theta: thetaN, activa: false, alpha: 0, modo: '' };
  }

  var poaN = poaDe(thetaN), th = thetaN, activa = false, alpha = 0, modo = '';

  if (this.politica === 'flat') {
    var poaPlano = poaDe(0);
    if (poaPlano > this.flatEnter * poaN) { th = 0; activa = true; alpha = 1; modo = 'al plano'; }

  } else if (this.politica === 'continuous') {
    var mejorPoa = poaN, mejorTh = thetaN, mejorA = 0;
    for (var i = 0; i < this.alphas.length; i++) {
      var a = this.alphas[i];
      if (a === 0) continue;
      var cand = (1 - a) * thetaN, p = poaDe(cand);
      if (p > mejorPoa) { mejorPoa = p; mejorTh = cand; mejorA = a; }
    }
    th = mejorTh; alpha = mejorA;
    activa = Math.abs(th - thetaN) > 0.5;      /* el canon considera activa >0,5° */
    if (activa) modo = 'α = ' + alpha;

  } else if (this.politica === 'limited') {
    /* mantener el ángulo anterior mientras no cueste POA. Ojo: el candidato se
       recorta ANTES de evaluarlo, que es lo que hace el canon — si no, se
       compara contra un ángulo que no se podría ejecutar. */
    if (this.previo != null) {
      var tp = clampBt(this.previo, thetaN);
      if (poaDe(tp) >= this.limitedHold * poaN) { th = tp; activa = true; modo = 'manteniendo'; }
    }

  } else if (this.politica === 'poa_switch') {
    var poaP = poaDe(0);
    if (!this.plano) {
      this.entrando = poaP > this.switchEnter * poaN ? this.entrando + dtMin : 0;
      if (this.entrando >= this.confirmMin && this.desde >= this.dwellMin) {
        this.plano = true; this.entrando = 0; this.saliendo = 0; this.desde = 0;
      }
    } else {
      this.saliendo = poaP < this.switchExit * poaN ? this.saliendo + dtMin : 0;
      if (this.saliendo >= this.confirmMin && this.desde >= this.dwellMin) {
        this.plano = false; this.entrando = 0; this.saliendo = 0; this.desde = 0;
      }
    }
    this.desde += dtMin;
    if (this.plano) { th = 0; activa = true; alpha = 1; modo = 'al plano'; }
  }

  /* REGLA 2 */
  th = clampBt(th, thetaN);
  this.previo = th;
  this.activa = activa; this.alpha = alpha;
  return { theta: th, activa: activa, alpha: alpha, modo: modo,
           confirmando: this.entrando, permanencia: this.desde };
};

Difusa.CANON = D;
Difusa.POLITICAS = POLITICAS;
if (typeof window !== 'undefined') window.Difusa = Difusa;
if (typeof module !== 'undefined') module.exports = Difusa;
})(this);
