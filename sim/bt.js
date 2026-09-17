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
/* La cola cierra con `})(this)` a propósito: es el patrón que el detector de
   ámbito de la casa reconoce (tools/ambito.mjs mira la cola, que es lo único
   decidible por texto) y el mismo que usa canon.js. Con un ternario delante
   —aunque funcione— este módulo salía en la lista de «desnudos» y el banco del
   navegador se ponía rojo, con razón: la regla es que se vea a simple vista. */

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
BT.prototype._construye = function (solJs, irrJs, htmlBt, htmlPr) {
  var i0 = htmlBt.indexOf(MARCA_INI), i1 = htmlBt.indexOf(MARCA_FIN);
  if (i0 < 0 || i1 < 0) throw new Error('backtracking.html sin los delimitadores ' + MARCA_INI + ' / FIN-FÍSICA');
  var fis = htmlBt.slice(htmlBt.lastIndexOf('/*', i0), i1);
  /* Y LA LÓGICA PURA DE produccion.html, para su `buildTReal`: la T de un
     levantamiento la arma esa página y armarla aquí serían dos geometrías. Se
     extrae con sus propios delimitadores, el mismo contrato que usa su banco.
     Comprobado que compila sin js/control_core.js: su única referencia al
     núcleo del lazo está guardada con un `typeof`. */
  var lg = null;
  if (htmlPr) {
    var j0 = htmlPr.indexOf('LÓGICA PURA'), j1 = htmlPr.indexOf('/* FIN-LÓGICA');
    if (j0 < 0 || j1 < 0) throw new Error('produccion.html sin los delimitadores LÓGICA PURA / FIN-LÓGICA');
    lg = htmlPr.slice(htmlPr.lastIndexOf('/*', j0), j1);
  }
  var f = new Function(solJs + '\n' + irrJs + '\n' + fis + '\n' +
    'return {policyAngles:policyAngles, anglesAstro:anglesAstro, poaPlant:poaPlant,' +
    ' pairsFromElev:pairsFromElev, pairsFromElevX:pairsFromElevX, plantFromCotas:plantFromCotas,' +
    ' nsSegments:nsSegments, policyAnglesSeg:policyAnglesSeg, poaPlantSeg:poaPlantSeg,' +
    ' anglesAstroSeg:anglesAstroSeg, anglesManual:anglesManual, surfaceOrient:surfaceOrient,' +
    ' clearskyIneichen:clearskyIneichen, skyWithClouds:skyWithClouds,' +
    ' westPorMesa:westPorMesa, ejesPorMesa:ejesPorMesa, Sol:Sol, Irr:Irr};');
  /* SE EVALÚA CONTRA EL GLOBAL DE VERDAD, no contra el `global` de este IIFE.
     `sol.js` e `irradiancia.js` se publican colgándose de su `this` (root.Sol =
     …) y el bloque del hermano los referencia como variables LIBRES, así que
     solo resuelven si ese `this` es el objeto global. Con el `global` del
     envoltorio —que en CommonJS es `module.exports`— salía «Sol is not
     defined». Es el mismo `.call(globalThis)` que usa el extractor de
     produccion.html y el banco del hermano. */
  var GLOBAL = (typeof globalThis !== 'undefined') ? globalThis : global;
  this.F = f.call(GLOBAL);
  if (lg) {
    var g2 = new Function(solJs + '\n' + irrJs + '\n' + fis + '\n' + lg + '\n' +
      'return {buildTReal:buildTReal, iamDe:iamDe, plantaCotas:(typeof plantaCotas!==\'undefined\')?plantaCotas:null,' +
      ' ncuPorCoordenadas:(typeof ncuPorCoordenadas!==\'undefined\')?ncuPorCoordenadas:null};');
    this.L = g2.call(GLOBAL);
  }
  this.estado = 'listo';
  this.detalle = 'FÍSICA PURA de ' + this.base + '/backtracking.html';
  return this.F;
};

/* ── EL TERRENO MEDIDO (cotas) ───────────────────────────────────────────────
   Con el BT compartido el gemelo ya usa el algoritmo bueno, pero se lo comía en
   una planta LLANA de pitch canónico: el `Tllana` de planta.js. Y la mitad del
   valor del bt3d está en el terreno — medido por el propio careo, con medio
   metro de desnivel por vano el hermano se aparta hasta 23,71° del número único.

   Las cotas son del hermano (`<planta>_cotas.json`, levantamiento real) y la T
   la arma ÉL: `plantFromCotas` de su FÍSICA PURA más `buildTReal` de la LÓGICA
   PURA de produccion.html. Aquí no se arma ninguna T a mano, y el motivo tiene
   nombre: el canario de esa página se quedó CIEGO una vez porque su generador
   usaba su propia copia de la geometría. La T real trae lo que el llano no
   tiene — pitch por vano, pendiente por pareja, tilt por fila, y el
   ACCIONAMIENTO (`groups`/`drive`: bifila en Ayora, quebrado en San José), que
   es lo que acopla las mesas de un mismo motor al mismo θ.

   Lo que eso cambia, medido a las 08:00 del 21-jun en Ayora (79 líneas del
   levantamiento): la consigna de pairwise va de −3° a +55°, o sea 58° de
   REPARTO, con 75 de las 79 líneas por debajo de 40°. Los +55 son las filas de
   BORDE, que no tienen vecino que las sombree. Eso es lo que un ángulo común
   no puede representar, y es justo lo que un gemelo por equipo necesita.

   ⚠ QUÉ ES Y QUÉ NO ES EL REPARTO POR EQUIPO. Cada TCU recibe el ángulo de UNA
   línea real, repartiendo los equipos en orden entre las líneas del bloque
   cargado. Eso da la DISTRIBUCIÓN verdadera de consignas —bordes, interiores,
   pendientes— que es lo que mueve las estadísticas de flota (batería, energía
   de motor, alarmas). Lo que NO hace es afirmar que el TCU 7 sea el tracker que
   está en tal x: esa identificación geométrica necesita casar el layout con las
   cotas, que el hermano ya sabe hacer (`ncuPorCoordenadas`, con tolerancias de
   3 m en x y 8 m en norte) pero en el marco del LAYOUT, mientras el `pos[]` del
   gemelo va centrado en la planta. Es un paso aparte y no se finge aquí. */
BT.prototype.cotasSync = function (planta, maxLineas) {
  if (!this.listo()) throw new Error('el BT del hermano no está cargado: ' + this.detalle);
  try {
    var fs = require('fs'), path = require('path');
    var j = JSON.parse(fs.readFileSync(path.join(this.base, planta + '_cotas.json'), 'utf8'));
    return this.Tdesde(j, maxLineas);
  } catch (e) {
    this.detalleCotas = 'sin cotas de ' + planta + ': ' + e.message;
    return null;
  }
};

BT.prototype.cotas = function (planta, maxLineas) {
  var self = this;
  return fetch(this.base + '/' + planta + '_cotas.json', { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (j) { return self.Tdesde(j, maxLineas); })
    .catch(function (e) {
      self.detalleCotas = 'sin cotas de ' + planta + ': ' + e.message;
      return null;
    });
};

/* La T del levantamiento, con LOS CONSTRUCTORES DEL HERMANO y nada más. */
BT.prototype.Tdesde = function (cotas, maxLineas) {
  if (!this.listo()) throw new Error('el BT del hermano no está cargado');
  var P = this.F.plantFromCotas(cotas, maxLineas || 80, null);
  var T = this.L.buildTReal(this.F, { iamb0: 0.05 }, P);
  T.nLineas = P.lineX.length;
  return T;
};

/* En Node (los arneses y el servidor de escenarios): síncrono, del hermano al
   lado. En el navegador no existe fs, así que esta rama no se compila allí. */
BT.prototype.cargaSync = function (base) {
  this.base = base || this.base;
  try {
    var fs = require('fs'), path = require('path');
    var r = function (f) { return fs.readFileSync(path.join(base || BASE, f), 'utf8'); };
    return this._construye(r('sol.js'), r('irradiancia.js'), r('backtracking.html'), r('produccion.html'));
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
  return Promise.all([pide('sol.js'), pide('irradiancia.js'), pide('backtracking.html'),
                      pide('produccion.html')])
    .then(function (t) { return self._construye(t[0], t[1], t[2], t[3]); })
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

})(this);
