/* ============================================================================
   careo.js — CONTRA UN EQUIPO DE VERDAD.

   Toda la arquitectura de este simulador persigue no divergir de SolarGPT. Pero
   SolarGPT es otro modelo: que los dos digan lo mismo no demuestra que ninguno se
   parezca a un TCU en un poste. Eso solo lo dice una captura de campo.

   Esto carga un CSV de la TCU Toolbox y lo superpone a la traza simulada. Con eso
   se pasa de «creemos que se comporta así» a «se comporta así ±X», que es una frase
   distinta y es la que hará falta con los datos de El Burgo y Ayora.

   Del formato de la toolbox se aprovecha una cosa: sus columnas llevan la dirección
   DELANTE — «30111 tilt_angle [deg]», «30093 corriente_bateria [mA]». Así que el
   lector no necesita conocer los nombres, solo leer el número de delante. Un export
   con columnas nuevas se lee igual sin tocar nada aquí.

   Lo que NO hace: alinear relojes por su cuenta. Si la captura viene con otra hora
   —huso, deriva del reloj del TCU— se dice y se deja ajustar a mano. Un careo que
   «encaja» las curvas moviéndolas hasta que casan no está midiendo nada.
   ============================================================================ */
(function (global) {
'use strict';

/* ── lectura ────────────────────────────────────────────────────────────────── */
function parsea(texto) {
  var avisos = [];
  var lineas = String(texto || '').split(/\r?\n/).filter(function (l) { return l.trim(); });
  if (lineas.length < 2) return { cols: [], filas: [], avisos: ['el fichero no tiene filas'] };

  /* separador: el que más veces aparezca en la cabecera. La toolbox usa «;» pero un
     Excel en inglés escribe «,» y no hay motivo para rechazarlo por eso. */
  var cab = lineas[0];
  var sep = [';', ',', '\t'].map(function (s) { return { s: s, n: cab.split(s).length }; })
                            .sort(function (a, b) { return b.n - a.n; })[0].s;
  var nombres = cab.split(sep).map(function (x) { return x.replace(/^"|"$/g, '').trim(); });

  /* columna de tiempo: la primera que se parezca a fecha/hora */
  var iT = -1;
  for (var i = 0; i < nombres.length; i++) {
    if (/fecha|hora|time|timestamp|ts\b/i.test(nombres[i])) { iT = i; break; }
  }
  if (iT < 0) avisos.push('no encuentro columna de fecha/hora: se usará el número de fila');

  /* columnas con dirección delante */
  var cols = [];
  nombres.forEach(function (n, idx) {
    var m = n.match(/^\s*(\d{5})\s+(.+?)\s*(?:\[([^\]]+)\])?\s*$/);
    if (m) cols.push({ i: idx, addr: +m[1], nombre: m[2], uni: m[3] || '' });
  });
  if (!cols.length) avisos.push('ninguna columna lleva la dirección delante («30111 tilt_angle [deg]»)');

  var filas = [];
  for (var l = 1; l < lineas.length; l++) {
    var p = lineas[l].split(sep);
    var f = { t: null, h: null, v: {} };
    if (iT >= 0) {
      var d = fecha(p[iT]);
      if (d) { f.t = d.getTime() / 1000; f.h = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; }
    }
    if (f.t == null) { f.t = l * 60; f.h = (l / 60) % 24; }
    for (var c = 0; c < cols.length; c++) {
      var raw = (p[cols[c].i] || '').replace(/^"|"$/g, '').trim().replace(',', '.');
      var v = parseFloat(raw);
      if (isFinite(v)) f.v[cols[c].addr] = v;
    }
    filas.push(f);
  }
  return { cols: cols, filas: filas, avisos: avisos, sep: sep };
}

/* fechas como las escriben la toolbox y Excel, sin inventar formatos raros */
function fecha(s) {
  s = String(s || '').replace(/^"|"$/g, '').trim();
  if (!s) return null;
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})[ ,]+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0));
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/* ── careo ──────────────────────────────────────────────────────────────────
   Compara por HORA CIVIL, que es lo único que las dos series comparten sin
   suposiciones. `desfaseMin` lo mueve el usuario a mano si su captura viene con
   otro huso: se dice cuánto se ha movido, no se busca el que mejor case. */
function compara(captura, muestras, addr, campo, opt) {
  opt = opt || {};
  var esc = opt.escala == null ? 1 : opt.escala;     /* p. ej. tilt ×10 → grados */
  var desf = (opt.desfaseMin || 0) / 60;
  var banda = opt.banda == null ? 1 : opt.banda;     /* qué se considera «igual» */
  if (!captura || !captura.filas.length || !muestras.length) return null;

  var pares = [], sinPar = 0;
  for (var i = 0; i < captura.filas.length; i++) {
    var f = captura.filas[i];
    if (f.v[addr] == null) continue;
    var h = ((f.h + desf) % 24 + 24) % 24;
    var s = masCercana(muestras, h);
    if (!s) { sinPar++; continue; }
    if (Math.abs(dif(s.h, h)) > 10 / 60) { sinPar++; continue; }   /* > 10 min: no es par */
    pares.push({ h: h, real: f.v[addr] / esc, sim: s[campo] });
  }
  if (!pares.length) return { n: 0, sinPar: sinPar, pares: [] };

  var sum = 0, sum2 = 0, max = 0, dentro = 0, iMax = 0;
  pares.forEach(function (p, k) {
    var e = p.sim - p.real;
    sum += e; sum2 += e * e;
    if (Math.abs(e) > Math.abs(max)) { max = e; iMax = k; }
    if (Math.abs(e) <= banda) dentro++;
  });
  return {
    n: pares.length, sinPar: sinPar, pares: pares,
    medio: sum / pares.length,
    rms: Math.sqrt(sum2 / pares.length),
    max: max, hMax: pares[iMax].h,
    dentroPct: dentro / pares.length * 100, banda: banda
  };
}
function dif(a, b) { var d = (a - b + 36) % 24 - 12; return d; }
function masCercana(m, h) {
  var mejor = null, dmin = 1e9;
  for (var i = 0; i < m.length; i++) {
    var d = Math.abs(dif(m[i].h, h));
    if (d < dmin) { dmin = d; mejor = m[i]; }
  }
  return mejor;
}

/* qué registros de la captura sabemos carear contra qué curva de la traza */
var CAREABLES = [
  { addr: 30111, campo: 'med', esc: 10, n: 'tilt medido (30111)', uni: '°', banda: 1 },
  { addr: 30112, campo: 'obj', esc: 10, n: 'ángulo objetivo (30112)', uni: '°', banda: 1 },
  { addr: 30096, campo: 'soc', esc: 1, n: 'estado de carga (30096)', uni: '%', banda: 5 },
  { addr: 30011, campo: null, esc: 1, n: 'corriente de motor (30011)', uni: 'mA', banda: 200 }
];

var API = { parsea: parsea, compara: compara, CAREABLES: CAREABLES, fecha: fecha };
if (typeof window !== 'undefined') window.Careo = API;
if (typeof module !== 'undefined') module.exports = API;
})(this);
