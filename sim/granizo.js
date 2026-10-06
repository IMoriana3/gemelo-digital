/* ============================================================================
   granizo.js — CICLO OPERATIVO DE GRANIZO PARA EL GEMELO DE PLANTA.

   Este módulo NO inventa un registro Modbus de hail stow. El firmware/mapa R7
   disponible no documenta uno. Modela la capa de decisión/ejecución del gemelo:
   forecast → orden de protección → distribución NCU/red → ejecución TCU.

   Contrato hoy:
     · gate severo: tamaño >= 19 mm Y probabilidad >= 30 %
     · lead de defensa: ETA <= 60 min
     · señal tras impacto: 15 min
     · retención tras all-clear: 60 min
     · sin dato NUNCA equivale a all-clear
     · si un reforecast aleja ETA después de activar, NO desescala
     · reaparición durante hold cancela la salida
     · segundo episodio después de LIBERADO genera una orden nueva

   Los valores son configurables; los defaults son los que usa sim-viento.html.
   La equivalencia se vigila desde los arneses del repositorio.
   ============================================================================ */
(function (global) {
'use strict';

var CANON = {
  mm: 19,
  probPct: 30,
  leadMin: 60,
  afterMin: 15,
  holdMin: 60,
  defensaDeg: 55,
  preMin: 30,
  windPreKmh: 40,
  windStowKmh: 60
};

function n(v, d) { v = Number(v); return isFinite(v) ? v : d; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function copia(o) { var q = {}; for (var k in (o || {})) q[k] = o[k]; return q; }

function gate(f, cfg) {
  cfg = cfg || CANON; f = f || {};
  var mm = Math.max(0, n(f.mm, 0)), pr = clamp(n(f.prob_pct, 0), 0, 100);
  if (f.known === false) return { activa: false, conocida: false, motivo: 'sin dato de granizo' };
  if (!f.on) return { activa: false, conocida: true, motivo: 'señal de granizo apagada' };
  if (mm < cfg.mm) return { activa: false, conocida: true, motivo: mm.toFixed(1) + ' mm < ' + cfg.mm + ' mm' };
  if (pr < cfg.probPct) return { activa: false, conocida: true, motivo: pr.toFixed(1) + ' % < ' + cfg.probPct + ' %' };
  return { activa: true, conocida: true, motivo: mm.toFixed(1) + ' mm · ' + pr.toFixed(1) + ' %' };
}

/* Convención DEL GEMELO: theta negativo = este, positivo = oeste.
   "dar la espalda al viento": viento del oeste (270°) → tumbar al este (−). */
function ladoEspaldaAlViento(az) {
  az = n(az, NaN);
  if (!isFinite(az)) return 0;
  az = ((az % 360) + 360) % 360;
  if (az > 180) return -1;
  if (az > 0 && az < 180) return 1;
  return 0;                         /* norte/sur puro: sin componente E/O */
}
function ladoMasCercano(theta) { return n(theta, 0) < 0 ? -1 : 1; }

/* Decide el TARGET al INICIO de un episodio. Después se enclava en cada TCU.
   El viento sigue teniendo prioridad de tránsito: por encima de 40/60 km/h no
   se ordena un cruce de granizo distinto. */
function objetivo(theta, forecast, opt) {
  opt = opt || {}; forecast = forecast || {};
  var def = Math.abs(n(opt.defensaDeg, CANON.defensaDeg));
  var pre = Math.abs(n(opt.preMin, CANON.preMin));
  var wp = n(opt.windPreKmh, CANON.windPreKmh);
  var ws = n(opt.windStowKmh, CANON.windStowKmh);
  var v = Math.max(0, n(opt.windKmh, 0));
  var th = n(theta, 0), cerca = ladoMasCercano(th) * def;

  if (v >= ws) return { caso: 4, target: cerca, manda: 'viento',
    motivo: 'viento >= ' + ws + ' km/h: segura más cercana' };

  if (v > wp) {
    var mag = Math.min(def, Math.max(pre, Math.abs(th)));
    return { caso: 4, target: (th < 0 ? -1 : 1) * mag, manda: 'viento',
      motivo: 'viento > ' + wp + ' km/h: no se cruza la banda' };
  }

  var eta = forecast.eta_min == null ? null : Math.max(0, n(forecast.eta_min, 0));
  var lead = Math.max(0, n(opt.leadMin, CANON.leadMin));
  if (eta !== null && eta < lead) return { caso: 3, target: cerca, manda: 'granizo',
    motivo: 'granizo dentro del lead: máxima inclinación más cercana' };

  var lado = ladoEspaldaAlViento(forecast.dir_deg);
  var target = lado ? lado * def : cerca;
  return { caso: 1, target: target, manda: 'granizo',
    motivo: lado ? 'lead suficiente: lado favorable, espalda al viento previsto'
                 : 'sin componente E/O prevista: máxima inclinación más cercana' };
}

function Granizo(cfg) {
  cfg = cfg || {};
  this.cfg = {
    mm: n(cfg.mm, CANON.mm),
    probPct: n(cfg.probPct, CANON.probPct),
    leadMin: n(cfg.leadMin, CANON.leadMin),
    afterMin: n(cfg.afterMin, CANON.afterMin),
    holdMin: n(cfg.holdMin, CANON.holdMin),
    defensaDeg: n(cfg.defensaDeg, CANON.defensaDeg),
    preMin: n(cfg.preMin, CANON.preMin),
    windPreKmh: n(cfg.windPreKmh, CANON.windPreKmh),
    windStowKmh: n(cfg.windStowKmh, CANON.windStowKmh)
  };
  this.known = true;
  this.on = false;
  this.mm = 0;
  this.probPct = 0;
  this.etaS = null;
  this.dirDeg = 270;
  this.postS = 0;
  this.revision = 0;
  this.commandId = 0;
  this.episode = 0;
  this.defensa = false;
  this.holdS = 0;
  this.released = false;
  this.phase = 'SIN_SEÑAL';
  this.ultimaCausa = 'sin señal';
}

Granizo.prototype._gate = function () {
  return gate({ known: this.known, on: this.on, mm: this.mm, prob_pct: this.probPct }, this.cfg);
};
Granizo.prototype._fase = function () {
  var g = this._gate();
  if (!this.known) return this.defensa ? 'SIN_DATO_PROTEGIDO' : 'SIN_DATO';
  if (g.activa) {
    if (!this.defensa) return 'VIGILANCIA';
    return this.etaS !== null && this.etaS <= 0 ? 'IMPACTO' : 'DEFENSA';
  }
  if (this.defensa) return 'RETENCION';
  if (this.released) return 'LIBERADO';
  if (this.on) return 'BAJO_UMBRAL';
  return 'SIN_SEÑAL';
};
Granizo.prototype._evalua = function (dt) {
  dt = Math.max(0, n(dt, 0));
  var g = this._gate();
  if (!this.known) {
    if (this.defensa) this.holdS = 0;       /* no hay evidencia válida de all-clear */
  } else if (g.activa) {
    if (!this.defensa && this.etaS !== null && this.etaS <= this.cfg.leadMin * 60) {
      this.defensa = true;
      this.released = false;
      this.holdS = 0;
      this.commandId++;
      this.episode++;
      this.ultimaCausa = 'entra en lead';
    } else if (this.defensa) {
      this.holdS = 0;                       /* reforecast válido cancela salida */
    }
  } else if (this.defensa) {
    this.holdS += dt;
    if (this.holdS >= this.cfg.holdMin * 60) {
      this.holdS = this.cfg.holdMin * 60;
      this.defensa = false;
      this.released = true;
      this.commandId++;
      this.ultimaCausa = 'hold de salida cumplido';
    }
  }
  this.phase = this._fase();
};

Granizo.prototype.paso = function (dt) {
  dt = Math.max(0, n(dt, 0));

  if (this.known && this.on) {
    var queda = dt;
    if (this.etaS !== null && this.etaS > 0) {
      var a = Math.min(queda, this.etaS);
      this.etaS -= a; queda -= a;
    }
    if (this.etaS !== null && this.etaS <= 0 && queda > 0) {
      this.postS += queda;
      if (this.postS >= this.cfg.afterMin * 60) {
        this.on = false;
        this.postS = this.cfg.afterMin * 60;
        this.revision++;
        this.ultimaCausa = 'fin automático de señal tras impacto';
      }
    }
  }

  this._evalua(dt);
  return this.snapshot();
};

Granizo.prototype.actualiza = function (f) {
  f = f || {};
  this.known = true;
  this.on = f.on == null ? true : !!f.on;
  if (f.mm != null) this.mm = Math.max(0, n(f.mm, this.mm));
  if (f.prob_pct != null) this.probPct = clamp(n(f.prob_pct, this.probPct), 0, 100);
  if (f.eta_min != null) this.etaS = Math.max(0, n(f.eta_min, 0)) * 60;
  if (f.dir_deg != null) this.dirDeg = ((n(f.dir_deg, this.dirDeg) % 360) + 360) % 360;
  this.postS = 0;
  this.revision++;
  this.ultimaCausa = 'reforecast';
  this._evalua(0);
  return this.snapshot();
};
Granizo.prototype.retira = function () {
  this.known = true; this.on = false; this.revision++; this.ultimaCausa = 'retirada explícita';
  this._evalua(0); return this.snapshot();
};
Granizo.prototype.sinDato = function () {
  this.known = false; this.revision++; this.ultimaCausa = 'dato ausente';
  this._evalua(0); return this.snapshot();
};
Granizo.prototype.restauraDato = function () {
  this.known = true; this.revision++; this.ultimaCausa = 'dato restablecido';
  this._evalua(0); return this.snapshot();
};
Granizo.prototype.reinicia = function () {
  var c = copia(this.cfg);
  Granizo.call(this, c);
  return this.snapshot();
};
Granizo.prototype.snapshot = function () {
  var g = this._gate();
  return {
    known: this.known, on: this.on, mm: this.mm, prob_pct: this.probPct,
    eta_min: this.etaS == null ? null : Math.max(0, this.etaS / 60),
    dir_deg: this.dirDeg, revision: this.revision, command_id: this.commandId,
    episode: this.episode, gate: g.activa, gate_reason: g.motivo,
    defensa: this.defensa, phase: this.phase,
    hold_elapsed_min: this.defensa && !g.activa && this.known ? this.holdS / 60 : null,
    hold_remaining_min: this.defensa && !g.activa && this.known
      ? Math.max(0, this.cfg.holdMin - this.holdS / 60) : null,
    lead_min: this.cfg.leadMin, hold_min: this.cfg.holdMin,
    after_min: this.cfg.afterMin, causa: this.ultimaCausa
  };
};

Granizo.CANON = CANON;
Granizo.gate = gate;
Granizo.objetivo = objetivo;
Granizo.ladoEspaldaAlViento = ladoEspaldaAlViento;

if (typeof window !== 'undefined') window.Granizo = Granizo;
if (typeof module !== 'undefined') module.exports = Granizo;
})(this);
