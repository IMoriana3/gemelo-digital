/* ============================================================================
   historia.js — LO QUE HA PASADO, no solo lo que pasa.

   El simulador enseñaba el instante. Cuando algo salía raro no había forma de
   rebobinar: tocaba volver a montar la situación a mano y esperar a que se
   repitiera. Esto graba la traza mientras corre y la pinta.

   Qué se graba y por qué justo eso:

     · objetivo · real · medido — las TRES, porque la gracia del simulador es que
       no son la misma. Entre objetivo y real está la banda muerta; entre real y
       medido, el inclinómetro. Ver las tres juntas es ver el lazo entero.
     · SoC y viento — las dos magnitudes que hacen que el seguidor deje de seguir.
     · eventos — abanderamientos, setas, averías, escrituras. Sin ellos la traza
       dice QUÉ pasó pero no POR QUÉ.

   Es un anillo: cuando se llena, tira lo más viejo. Un simulador que se queda sin
   memoria a las tres horas no sirve para mirar un año.
   ============================================================================ */
(function (global) {
'use strict';

function Historia(cfg) {
  cfg = cfg || {};
  this.max = cfg.max || 4000;          /* muestras guardadas */
  this.cadaS = cfg.cadaS || 60;        /* segundos SIMULADOS entre muestras */
  this.maxEventos = cfg.maxEventos || 400;
  this.limpia();
}

Historia.prototype.limpia = function () {
  this.m = [];                          /* muestras */
  this.ev = [];                         /* eventos */
  this.tUlt = null;
  this._prev = null;
};

/* Se llama en cada paso; ella decide si toca muestrear. `sel` es el TCU que se está
   mirando: la traza es de UNO, porque una traza de 2.000 no se lee. */
Historia.prototype.paso = function (P, sel) {
  var t = P.t.epoch, hc = P.t.hora, tcu = P.tcu(sel) || P.tcus[0];
  if (!tcu) return;

  /* eventos: lo que CAMBIA de estado, no lo que está */
  var ahora = {
    sp: tcu.sp, crit: tcu.criterio, seta: tcu.seta, modo: tcu.modo,
    bloq: tcu.ejeBloqueado, sobre: tcu.sobrecorriente, online: tcu.online,
    parked: tcu.parked, stow: tcu.stow
  };
  var p = this._prev;
  if (p) {
    if (ahora.sp !== p.sp) this.evento(t, ahora.sp ? 'posición segura ' + ahora.sp : 'suelta la posición segura', 'sp', hc);
    if (ahora.seta !== p.seta) this.evento(t, ahora.seta ? 'SETA pulsada' : 'seta suelta (sigue enclavada)', 'seta', hc);
    if (ahora.modo !== p.modo) this.evento(t, 'modo → ' + ['OFF', 'MANUAL', 'AUTO', '?'][ahora.modo], 'modo', hc);
    if (ahora.bloq && !p.bloq) this.evento(t, 'eje bloqueado', 'alarma', hc);
    if (ahora.sobre && !p.sobre) this.evento(t, 'sobrecorriente de motor', 'alarma', hc);
    if (ahora.online !== p.online) this.evento(t, ahora.online ? 'vuelve la comunicación' : 'sin comunicación', 'com', hc);
    if (ahora.parked !== p.parked) this.evento(t, ahora.parked ? 'defensa por batería' : 'sale de defensa', 'bat', hc);
    if (ahora.stow !== p.stow) this.evento(t, ahora.stow ? 'abandera (' + (ahora.stow === 2 ? 'total' : 'parcial') + ')' : 'desabandera', 'viento', hc);
  }
  this._prev = ahora;

  if (this.tUlt != null && t - this.tUlt < this.cadaS) return;
  this.tUlt = t;
  this.m.push({
    t: t, h: P.t.hora,
    obj: tcu.objetivo, real: tcu.anguloReal, med: tcu.angulo,
    soc: tcu.soc, viento: P.ncu.vientoMax * 3.6, ghi: tcu.sky ? tcu.sky.ghi : 0,
    crit: tcu.criterio, sp: tcu.sp, seta: tcu.seta ? 1 : 0, id: tcu.id
  });
  if (this.m.length > this.max) this.m.splice(0, this.m.length - this.max);
};

/* El evento guarda la hora CIVIL además del epoch: el eje de la gráfica va en hora
   civil, y etiquetar los eventos con la hora UTC los deja descolocados respecto a la
   traza que están explicando. */
Historia.prototype.evento = function (t, txt, tipo, hora) {
  this.ev.push({ t: t, h: hora, txt: txt, tipo: tipo || '' });
  if (this.ev.length > this.maxEventos) this.ev.splice(0, this.ev.length - this.maxEventos);
};

/* ── pintado ────────────────────────────────────────────────────────────────
   Dos bandas: ángulos arriba (con más sitio, que es lo que se mira) y SoC/viento
   abajo. Los eventos son líneas verticales, porque una traza sin el «por qué» al
   lado obliga a adivinar. */
Historia.prototype.pinta = function (cv, opt) {
  opt = opt || {};
  var ctx = cv.getContext('2d');
  var W = cv.clientWidth || 900, H = cv.clientHeight || 260;
  var dpr = Math.min(2, global.devicePixelRatio || 1);
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  var C = opt.colores || {
    fondo: '#0f1620', reja: '#1e2a38', tx: '#8aa0b4',
    obj: '#e0a52b', real: '#36D399', med: '#6fb7ff', soc: '#b98cff', viento: '#5e7388', ev: '#e2574c'
  };
  ctx.fillStyle = C.fondo; ctx.fillRect(0, 0, W, H);

  var m = this.m;
  if (m.length < 2) {
    ctx.fillStyle = C.tx; ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('Aún no hay traza. Dale a ▶ y se va grabando.', 14, H / 2);
    return;
  }
  var pad = { l: 40, r: 46, t: 10, b: 18 };
  var t0 = m[0].t, t1 = m[m.length - 1].t, dt = Math.max(1, t1 - t0);
  var hAng = Math.round((H - pad.t - pad.b) * 0.62), hBaj = (H - pad.t - pad.b) - hAng - 8;
  var yAng = pad.t, yBaj = pad.t + hAng + 8;
  var x = function (t) { return pad.l + (t - t0) / dt * (W - pad.l - pad.r); };
  var tope = Math.max(60, Math.ceil(Math.max.apply(null, m.map(function (s) {
    return Math.max(Math.abs(s.obj), Math.abs(s.real), Math.abs(s.med));
  })) / 10) * 10);
  var yA = function (v) { return yAng + hAng / 2 - (v / tope) * (hAng / 2); };
  var yB = function (v) { return yBaj + hBaj - (v / 100) * hBaj; };

  /* reja */
  ctx.strokeStyle = C.reja; ctx.lineWidth = 1;
  ctx.beginPath();
  [-tope, -tope / 2, 0, tope / 2, tope].forEach(function (v) {
    ctx.moveTo(pad.l, Math.round(yA(v)) + 0.5); ctx.lineTo(W - pad.r, Math.round(yA(v)) + 0.5);
  });
  [0, 50, 100].forEach(function (v) {
    ctx.moveTo(pad.l, Math.round(yB(v)) + 0.5); ctx.lineTo(W - pad.r, Math.round(yB(v)) + 0.5);
  });
  ctx.stroke();
  ctx.fillStyle = C.tx; ctx.font = '10px ui-monospace, monospace'; ctx.textAlign = 'right';
  ctx.fillText('+' + tope + '°', pad.l - 5, yA(tope) + 3);
  ctx.fillText('0°', pad.l - 5, yA(0) + 3);
  ctx.fillText('−' + tope + '°', pad.l - 5, yA(-tope) + 3);
  ctx.fillText('100%', pad.l - 5, yB(100) + 3);
  ctx.fillText('0', pad.l - 5, yB(0) + 3);

  /* eventos, por detrás de las curvas */
  var yo = this;
  this.ev.forEach(function (e) {
    if (e.t < t0 || e.t > t1) return;
    var xx = Math.round(x(e.t)) + 0.5;
    ctx.strokeStyle = 'rgba(226,87,76,.45)'; ctx.beginPath();
    ctx.moveTo(xx, pad.t); ctx.lineTo(xx, H - pad.b); ctx.stroke();
  });

  function curva(campo, color, yFn, ancho) {
    ctx.strokeStyle = color; ctx.lineWidth = ancho || 1.5; ctx.beginPath();
    for (var i = 0; i < m.length; i++) {
      var px = x(m[i].t), py = yFn(m[i][campo]);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  /* orden: objetivo debajo, real encima, medido finito por delante — así se ve el
     retraso del lazo y, si el sensor miente, la separación entre real y medido */
  curva('obj', C.obj, yA, 1.2);
  curva('real', C.real, yA, 1.8);
  curva('med', C.med, yA, 1);
  curva('soc', C.soc, yB, 1.6);
  ctx.strokeStyle = C.viento; ctx.lineWidth = 1.2; ctx.beginPath();
  for (var i = 0; i < m.length; i++) {
    var py = yBaj + hBaj - Math.min(1, m[i].viento / 120) * hBaj;
    if (i === 0) ctx.moveTo(x(m[i].t), py); else ctx.lineTo(x(m[i].t), py);
  }
  ctx.stroke();

  /* horas */
  ctx.textAlign = 'center'; ctx.fillStyle = C.tx;
  var pasos = 6;
  for (var k = 0; k <= pasos; k++) {
    var tt = t0 + dt * k / pasos, s = m[Math.min(m.length - 1, Math.round((m.length - 1) * k / pasos))];
    ctx.fillText(dosD(Math.floor(s.h)) + ':' + dosD(Math.floor((s.h % 1) * 60)), x(tt), H - 5);
  }
  ctx.textAlign = 'left';
  function dosD(n) { return (n < 10 ? '0' : '') + n; }
};

/* la última traza como CSV, para llevársela */
Historia.prototype.csv = function () {
  var l = ['epoch;hora;objetivo_deg;real_deg;medido_deg;soc_pct;viento_kmh;ghi_wm2'];
  this.m.forEach(function (s) {
    l.push([s.t, s.h.toFixed(4), s.obj.toFixed(3), s.real.toFixed(3), s.med.toFixed(3),
            s.soc.toFixed(2), s.viento.toFixed(1), s.ghi.toFixed(0)].join(';'));
  });
  return l.join('\n');
};

if (typeof window !== 'undefined') window.Historia = Historia;
if (typeof module !== 'undefined') module.exports = Historia;
})(this);
