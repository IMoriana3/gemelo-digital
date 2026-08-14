/* ============================================================================
   cielo.js — DESCOMPOSICIÓN DE LA GLOBAL EN DIRECTA Y DIFUSA.

   Fichero COMPARTIDO entre repos, mismo criterio que viento.js y difusa.js.

   Antes esto era una regla inventada: `dhi = ghi · (0,12 + 0,6·nubes)`. Con el
   cielo cerrado del todo daba un 72 % de difusa, o sea que se quedaba un 28 % de
   directa que en un día encapotado de verdad no existe. Y eso hacía imposible
   probar la política de cielo cubierto: como siempre quedaba directa, apuntar al
   sol siempre ganaba, y la política no se disparaba nunca.

   La descomposición canónica del proyecto es **Erbs (1982)**, que es el modelo por
   defecto de `solargpt_core.meteo.decompose_ghi` («erbs, default robusto») y el que
   implementa `pvlib.irradiance.erbs`. Depende de una sola variable, el índice de
   claridad kt = GHI / (I0 · cos z), que es justo lo que un modelo de nubes produce:

       kt ≤ 0,22    kd = 1 − 0,09·kt                              casi todo difusa
       0,22 < kt ≤ 0,80  kd = 0,9511 − 0,1604kt + 4,388kt²
                              − 16,638kt³ + 12,336kt⁴
       kt > 0,80    kd = 0,165                                    cielo limpio

   Con el cielo cerrado (kt ≈ 0,15) sale kd ≈ 0,99: la difusa es TODO. Que es lo
   que hace que tumbar el seguidor tenga sentido, porque un plano llano ve más
   cielo que uno de canto.
   ============================================================================ */
(function (global) {
'use strict';

var CONST_SOLAR = 1366.1;      /* W/m² · la que usa pvlib por defecto */

/* Irradiancia extraterrestre sobre plano normal, con la corrección de excentricidad
   de la órbita (Spencer, la aproximación de pvlib «spencer»). N = día del año. */
function extraterrestre(N) {
  var b = 2 * Math.PI * (N - 1) / 365;
  var e = 1.00011 + 0.034221 * Math.cos(b) + 0.00128 * Math.sin(b) +
          0.000719 * Math.cos(2 * b) + 0.000077 * Math.sin(2 * b);
  return CONST_SOLAR * e;
}

/* Fracción difusa de Erbs. kt es el índice de claridad. */
function fraccionDifusaErbs(kt) {
  if (!(kt > 0)) return 1;
  if (kt <= 0.22) return 1 - 0.09 * kt;
  if (kt <= 0.80) {
    return 0.9511 - 0.1604 * kt + 4.388 * kt * kt -
           16.638 * kt * kt * kt + 12.336 * kt * kt * kt * kt;
  }
  return 0.165;
}

/* ghi en W/m², elevación solar en RADIANES.
   Devuelve global, difusa y directa horizontal, más el kt y la fracción difusa
   para poder enseñarlos (que en un cielo cubierto es lo que explica todo). */
function descompon(ghi, elevRad, N) {
  var sinEl = Math.sin(Math.max(0, elevRad));
  if (!(ghi > 0) || sinEl <= 0.0001) {
    return { ghi: 0, dhi: 0, bh: 0, kt: 0, kd: 1, dia: false };
  }
  var i0h = extraterrestre(N || 172) * sinEl;        /* extraterrestre HORIZONTAL */
  var kt = Math.min(1, ghi / Math.max(1e-6, i0h));
  var kd = fraccionDifusaErbs(kt);
  var dhi = Math.min(ghi, ghi * kd);
  return { ghi: ghi, dhi: dhi, bh: Math.max(0, ghi - dhi), kt: kt, kd: kd, dia: ghi > 10 };
}

var API = { descompon: descompon, fraccionDifusaErbs: fraccionDifusaErbs,
            extraterrestre: extraterrestre, CONST_SOLAR: CONST_SOLAR };
if (typeof window !== 'undefined') window.Cielo = API;
if (typeof module !== 'undefined') module.exports = API;
})(this);
