/* ============================================================================
   bt.js — EL BACKTRACKING NO SE ESCRIBE AQUÍ: SE CARGA EL DE COBERTURA-ZIGBEE.

   El gemelo tenía su propio backtracking —`angulos()` en planta.js, la fórmula
   de Anderson-Mikofski con UN SOLO GCR y el terreno llano— mientras que el
   backtracking de la casa vive en el bloque FÍSICA PURA de
   `cobertura-zigbee/backtracking.html`, con sus NUEVE políticas, el terreno
   medido pareja a pareja y el acople por accionamiento. Dos BT distintos para
   la misma planta, y el de aquí era el pobre.

   LO QUE CUESTA ESO, medido y no supuesto: el careo «terreno real frente a
   considerarlo todo plano» de `produccion.html` sobre San José NCU 14 del
   21-jun da un total de planta de +0,28 % y sin embargo un string pierde
   2,83 % y otro gana 2,22 %. O sea que tratar la planta como llana acierta la
   cifra global y NO DICE NADA del reparto — que es justo lo que un gemelo por
   equipo tiene que acertar, porque cada TCU es un equipo.

   Así que aquí no se calcula nada: se CARGA. Es el mismo patrón que usa
   `produccion.html`, que extrae ese bloque en caliente y no guarda copia —
   «cero copias»—, y el mismo motivo que `canon.js` escribió en su cabecera:
   portar el algoritmo es lo que crea dos versiones que divergen sin que nadie
   se entere. Ya pasó con el sleep (0,45 contra 0,64 W) y con la velocidad del
   actuador (0,16 contra 0,17 °/s).

   DE DÓNDE. Del hermano al lado, en `../cobertura-zigbee`: la misma ruta
   relativa que `simulador.html` ya usa para enlazar su ficha Modbus, y el
   mismo origen en Pages (imoriana3.github.io/cobertura-zigbee/…). El bloque
   necesita exactamente dos ficheros más, comprobado llamada a llamada:
   `sol.js` (Sol.solarPos · singleaxis · trueTrackAngle · refraction ·
   cloudToIrr) e `irradiancia.js` (Irr.clearskyIneichen · dniExtra · airmassKY ·
   surfaceOrient). Nada de three.js ni del resto de la página.

   SI NO ESTÁ, SE DICE. No hay modelo de repuesto: un backtracking de primer
   orden que parece el canónico es peor que no tener backtracking, y esa regla
   ya está escrita en canon.js. `listo()` dice si se puede seguir y `motivo()`
   por qué no.

   ⚠ SIGNO. El bloque trabaja en convención pvlib con el eje a 0°: θ>0 mira al
   ESTE (medido: surfaceOrient(+5,0,0) da azimut de superficie 90). La casa usa
   lo contrario. La conversión se hace UNA VEZ, aquí, en `aCasa()`/`aPvlib()`,
   igual que canon.js la hace una vez al recibir la serie del motor.
   ============================================================================ */
(function (global) {
'use strict';

var BASE = '../cobertura-zigbee';
var MARCA_INI = 'FÍSICA PURA', MARCA_FIN = '/* FIN-FÍSICA';

/* Las nueve políticas, con el MISMO nombre y el mismo orden que el selector de
   produccion.html: si allí se añade una, aquí no hay que tocar nada más que
   esta lista (y el arnés canta si se desincronizan). */
var POLITICAS = [
  { key: 'pairwise', nm: 'Pairwise' },
  { key: 'true3d',   nm: 'True-3D' },
  { key: 'row',      nm: 'Row' },
  { key: 'global',   nm: 'Global' },
  { key: 'bt2d',     nm: 'BT2D plano' },
  { key: 'mgl',      nm: 'Min ground light' },
  { key: 'optimal',  nm: 'Energy-optimal' },
  { key: 'optfree',  nm: 'Óptimo libre' },
  { key: 'astro',    nm: 'Astronómico' }
];

function BT() {
  this.base = BASE;
  this.estado = 'sin cargar';     /* sin cargar · listo · ausente */
  this.detalle = '';
  this.F = null;                  /* el bloque, tal cual */
}

BT.POLITICAS = POLITICAS;
BT.BASE = BASE;

BT.prototype.listo = function () { return this.estado === 'listo' && !!this.F; };
BT.prototype.motivo = function () { return this.detalle; };

/* El bloque se evalúa con sus dependencias delante y devuelve SUS nombres. No se
   toca ni una línea de lo que viene: si el hermano cambia la física, aquí cambia
   sola, que es el propósito. */
BT.prototype._construye = function (solJs, irrJs, htmlBt) {
  var i0 = htmlBt.indexOf(MARCA_INI), i1 = htmlBt.indexOf(MARCA_FIN);
  if (i0 < 0 || i1 < 0) throw new Error('backtracking.html sin los delimitadores ' + MARCA_INI + ' / FIN-FÍSICA');
  var fis = htmlBt.slice(htmlBt.lastIndexOf('/*', i0), i1);
  var f = new Function(solJs + '\n' + irrJs + '\n' + fis + '\n' +
    'return {policyAngles:policyAngles, anglesAstro:anglesAstro, poaPlant:poaPlant,' +
    ' pairsFromElev:pairsFromElev, pairsFromElevX:pairsFromElevX, plantFromCotas:plantFromCotas,' +
    ' nsSegments:nsSegments, policyAnglesSeg:policyAnglesSeg, poaPlantSeg:poaPlantSeg,' +
    ' anglesAstroSeg:anglesAstroSeg, anglesManual:anglesManual, surfaceOrient:surfaceOrient,' +
    ' clearskyIneichen:clearskyIneichen, skyWithClouds:skyWithClouds,' +
    ' westPorMesa:westPorMesa, ejesPorMesa:ejesPorMesa, Sol:Sol, Irr:Irr};');
  this.F = f.call(global);
  this.estado = 'listo';
  this.detalle = 'FÍSICA PURA de ' + this.base + '/backtracking.html';
  return this.F;
};

/* En Node (los arneses y el servidor de escenarios): síncrono, del hermano al
   lado. En el navegador no existe fs, así que esta rama no se compila allí. */
BT.prototype.cargaSync = function (base) {
  this.base = base || this.base;
  try {
    var fs = require('fs'), path = require('path');
    var r = function (f) { return fs.readFileSync(path.join(base || BASE, f), 'utf8'); };
    return this._construye(r('sol.js'), r('irradiancia.js'), r('backtracking.html'));
  } catch (e) {
    this.estado = 'ausente';
    this.detalle = 'no encuentro el hermano en ' + (base || BASE) + ': ' + e.message;
    return null;
  }
};

/* En el navegador: fetch de los tres ficheros. Mismo origen en Pages. */
BT.prototype.carga = function (base) {
  var self = this;
  this.base = base || this.base;
  var pide = function (f) {
    return fetch(self.base + '/' + f, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(f + ': HTTP ' + r.status);
      return r.text();
    });
  };
  return Promise.all([pide('sol.js'), pide('irradiancia.js'), pide('backtracking.html')])
    .then(function (t) { return self._construye(t[0], t[1], t[2]); })
    .catch(function (e) {
      self.estado = 'ausente';
      self.detalle = 'no he podido cargar el BT de ' + self.base + ': ' + e.message;
      return null;
    });
};

/* ── el signo, una sola vez ─────────────────────────────────────────────────
   pvlib con eje a 0°: θ>0 al ESTE. La casa: θ<0 al este. */
function aCasa(th) { return -th; }
function aPvlib(th) { return -th; }

/* LOS ÁNGULOS DE LA PLANTA, por línea, en convención de la casa. `T` es el
   terreno del hermano (lo arma quien tenga el levantamiento: plantFromCotas +
   el constructor de la página) y `pol` una de las nueve. */
BT.prototype.angulos = function (pol, zen, az, T, irr, doy, albedo) {
  if (!this.listo()) throw new Error('el BT del hermano no está cargado: ' + this.detalle);
  var a = this.F.policyAngles(pol || 'pairwise', zen, az, T, irr, doy, albedo);
  return (a.angles || a).map(aCasa);
};

/* El sol, del MISMO módulo que usa el BT: pedirle la posición a otro sitio es
   volver a tener dos versiones de algo (y ya me costó 13° de desfase en una
   sonda por mezclar relojes). */
BT.prototype.solarPos = function (ms, lat, lon) {
  if (!this.listo()) throw new Error('el BT del hermano no está cargado: ' + this.detalle);
  return this.F.Sol.solarPos(ms, lat, lon, { refract: true });
};

BT.aCasa = aCasa;
BT.aPvlib = aPvlib;

if (typeof module !== 'undefined' && module.exports) module.exports = BT;
else global.BT = BT;

})(typeof globalThis !== 'undefined' ? globalThis : this);
