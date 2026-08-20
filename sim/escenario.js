/* ============================================================================
   escenario.js — UNA SITUACIÓN QUE SE PUEDE REPETIR.

   Para probar cualquier cosa había que ir moviendo controles a mano: subir el
   viento, esperar, meter nieve, pulsar la seta, limpiar alarmas. Todas las veces.
   Un escenario es esa secuencia escrita una vez: se graba mientras trasteas, se
   reproduce igual, y se comparte por URL.

   Con eso pasan tres cosas:
     · reproducir un incidente de planta se vuelve trivial — lo describes una vez y
       lo abre cualquiera con el enlace;
     · sirve de prueba de regresión: el mismo escenario después de cada cambio;
     · y los ensayos del Anexo 4 dejan de ser un PDF y pasan a ser algo que se
       ejecuta.

   Los eventos son de tres clases y no más, a propósito:

     meteo  lo que hace el tiempo — viento, rachas, dirección, nubes, nieve, Tª
     w      una ESCRITURA Modbus, que es como se manda de verdad a un equipo
     av     una avería física: eje calado, eje duro, radio caída, seta, cable roto

   Que las órdenes sean escrituras y no atajos internos es lo que hace que un
   escenario grabado aquí se parezca a un log de la toolbox y no a un guion de esta
   página en concreto.
   ============================================================================ */
(function (global) {
'use strict';

var VERSION = 1;

function Escenario(o) {
  o = o || {};
  this.v = VERSION;
  this.n = o.n || 'sin nombre';
  this.desc = o.desc || '';
  this.loc = o.loc != null ? o.loc : null;      /* índice de emplazamiento */
  this.dia = o.dia != null ? o.dia : null;      /* día del año de arranque */
  this.hora = o.hora != null ? o.hora : null;   /* hora civil de arranque */
  this.eventos = (o.eventos || []).slice();
  this.i = 0;                                   /* por dónde va la reproducción */
}

/* Los eventos se guardan ORDENADOS por hora: si se graban a saltos (porque el
   operador rebobinó), reproducirlos en orden de grabación daría otra cosa. */
Escenario.prototype.añade = function (h, ev) {
  ev = Object.assign({ h: h }, ev);
  this.eventos.push(ev);
  this.eventos.sort(function (a, b) { return a.h - b.h; });
  return ev;
};

Escenario.prototype.rebobina = function () { this.i = 0; };

/* Se llama en cada paso. Dispara todo lo que quede pendiente hasta la hora actual.
   Ojo con el salto de medianoche: un escenario es de UN día, así que si la hora
   retrocede se entiende que ha dado la vuelta y se rebobina. */
Escenario.prototype.paso = function (P, hora) {
  if (this._hUlt != null && hora < this._hUlt - 1) this.rebobina();
  this._hUlt = hora;
  var hechos = [];
  while (this.i < this.eventos.length && this.eventos[this.i].h <= hora) {
    var e = this.eventos[this.i++];
    var r = aplica(P, e);
    hechos.push({ ev: e, r: r });
  }
  return hechos;
};

function aplica(P, e) {
  if (e.t === 'meteo') {
    if (e.k === 'viento') P.meteo.viento = e.v / 3.6;        /* se escribe en km/h */
    else if (e.k === 'rachas') P.meteo.rachas = e.v / 100;
    else if (e.k === 'dir') P.meteo.dirViento = e.v;
    else if (e.k === 'nubes') P.meteo.nubes = e.v;
    else if (e.k === 'nieve') P.meteo.nieve = e.v / 100;     /* cm → m */
    else if (e.k === 'temp') P.meteo.tMedia = e.v;
    else return { ok: false, avisos: ['meteo desconocida: ' + e.k] };
    return { ok: true, aplicados: [e.k + ' = ' + e.v] };
  }
  if (e.t === 'w') return P.escribe(e.dev || 'tcu', e.id || 1, e.dir, e.vals || [e.v || 0]);
  if (e.t === 'av') {
    var tc = P.tcu(e.id || 1);
    if (!tc) return { ok: false, avisos: ['no hay TCU ' + e.id] };
    var on = !!e.on;
    if (e.k === 'atasco') tc.ejeAtascado = on;
    else if (e.k === 'duro') tc.ejeDuro = on;
    else if (e.k === 'off') tc.online = !on;
    else if (e.k === 'seta') tc.setaLocal = on;
    else if (e.k === 'cable') tc.cableSetaCortado = on;
    else if (e.k === 'setancu') P.ncu.seta = on;
    else if (e.k === 'accel') tc.avAccel = on;
    else return { ok: false, avisos: ['avería desconocida: ' + e.k] };
    return { ok: true, aplicados: [e.k + (on ? ' ON' : ' OFF') + ' en TCU ' + tc.id] };
  }
  return { ok: false, avisos: ['tipo de evento desconocido: ' + e.t] };
}

/* Texto corto de un evento, para listarlo. */
Escenario.prototype.txt = function (e) { return textoDe(e); };
function textoDe(e) {
  var h = Math.floor(e.h), mi = Math.floor((e.h % 1) * 60);
  var hh = (h < 10 ? '0' : '') + h + ':' + (mi < 10 ? '0' : '') + mi;
  if (e.t === 'meteo') {
    var uni = { viento: ' km/h', rachas: ' %', dir: '°', nubes: ' %', nieve: ' cm', temp: ' °C' }[e.k] || '';
    return hh + ' · ' + e.k + ' ' + e.v + uni;
  }
  if (e.t === 'w') return hh + ' · escribe ' + (e.dev || 'tcu').toUpperCase() +
    (e.dev === 'ncu' ? '' : ' ' + (e.id || 1)) + ' ' + e.dir + ' = ' + (e.vals ? e.vals.join(',') : e.v);
  if (e.t === 'av') return hh + ' · ' + e.k + (e.on ? ' ON' : ' OFF') + ' en TCU ' + (e.id || 1);
  return hh + ' · ?';
}

/* ── llevárselo y traerlo ──
   Se comprime a un JSON corto y se mete en el hash de la URL. Nada de servidor:
   el enlace ES el escenario, y por eso se puede pegar en un correo. */
Escenario.prototype.aJSON = function () {
  return JSON.stringify({ v: this.v, n: this.n, desc: this.desc,
                          loc: this.loc, dia: this.dia, hora: this.hora, eventos: this.eventos });
};
Escenario.prototype.aURL = function (base) {
  var b = (base || (typeof location !== 'undefined' ? location.href : '')).split('#')[0];
  return b + '#esc=' + encodeURIComponent(b64(this.aJSON()));
};
Escenario.deJSON = function (s) {
  var o = typeof s === 'string' ? JSON.parse(s) : s;
  if (!o || o.v > VERSION) throw new Error('escenario de una versión posterior (' + (o && o.v) + ')');
  return new Escenario(o);
};
Escenario.deURL = function (href) {
  var h = (href || (typeof location !== 'undefined' ? location.href : '')).split('#')[1] || '';
  var m = h.match(/(?:^|&)esc=([^&]+)/);
  if (!m) return null;
  try { return Escenario.deJSON(deB64(decodeURIComponent(m[1]))); } catch (e) { return null; }
};

/* base64 que aguanta acentos: los nombres de escenario los escribe una persona */
function b64(s) {
  if (typeof btoa === 'function') return btoa(unescape(encodeURIComponent(s)));
  return Buffer.from(s, 'utf8').toString('base64');
}
function deB64(s) {
  if (typeof atob === 'function') return decodeURIComponent(escape(atob(s)));
  return Buffer.from(s, 'base64').toString('utf8');
}

/* ── los de la casa ──
   Tres situaciones que se prueban una y otra vez, ya escritas. La primera es
   literalmente el ensayo D.1.1 del Anexo 4. */
var EJEMPLOS = [
  { n: 'D.1.1 · inclinómetro descalibrado', dia: 172, hora: 8,
    desc: 'El sensor va montado 3° torcido y nadie lo ha compensado. El TCU publica que está en su objetivo mientras la mesa está torcida, y el SCADA lo ve todo verde. A las 11:00 se calibra con 41058 y se endereza.',
    eventos: [
      { h: 8.5, t: 'w', dev: 'tcu', id: 1, dir: 40000, vals: [3] },
      { h: 11, t: 'w', dev: 'tcu', id: 1, dir: 41058, vals: [15753, 3229] }
    ] },
  { n: 'Temporal: parcial, total y vuelta', dia: 172, hora: 9,
    desc: 'Sube a 45 km/h (bandera parcial), luego a 70 (total) y cae. Se ve la histéresis de 30 minutos antes de desabanderar.',
    eventos: [
      { h: 10, t: 'meteo', k: 'viento', v: 45 },
      { h: 11.5, t: 'meteo', k: 'viento', v: 70 },
      { h: 13, t: 'meteo', k: 'viento', v: 10 },
      { h: 15, t: 'meteo', k: 'viento', v: 0 }
    ] },
  { n: 'Seta del armario y rearme', dia: 172, hora: 10,
    desc: 'Alguien pulsa la seta del armario de la NCU. El motor se corta en toda la planta, el algoritmo sigue calculando por debajo y 30110 se va abriendo. Soltarla no rearma: hay que limpiar con 40007.13.',
    eventos: [
      { h: 11, t: 'av', k: 'setancu', on: true },
      { h: 12.5, t: 'av', k: 'setancu', on: false },
      { h: 13, t: 'w', dev: 'tcu', id: 1, dir: 40007, vals: [8192] }
    ] },
  { n: 'Eje duro: la vía lenta', dia: 172, hora: 9,
    desc: 'El eje gira arrastrándose sin llegar al disparo de sobrecorriente. El firmware tarda en darse cuenta: ventana de 41039 y tres reintentos de 41065 hasta declarar eje bloqueado.',
    eventos: [
      { h: 10, t: 'av', k: 'duro', id: 1, on: true },
      { h: 14, t: 'av', k: 'duro', id: 1, on: false },
      { h: 14.2, t: 'w', dev: 'tcu', id: 1, dir: 40007, vals: [8192] }
    ] }
];

Escenario.EJEMPLOS = EJEMPLOS;
Escenario.textoDe = textoDe;
Escenario.VERSION = VERSION;
if (typeof window !== 'undefined') window.Escenario = Escenario;
if (typeof module !== 'undefined') module.exports = Escenario;
})(this);
