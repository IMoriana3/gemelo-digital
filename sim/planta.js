/* ============================================================================
   planta.js — motor del GEMELO TOTAL: una planta entera de seguidores Factiun
   simulada equipo a equipo (NCU + TCUs + HSUs + repetidores), con el mismo
   comportamiento y los MISMOS REGISTROS MODBUS que el hierro real.

   Qué simula cada equipo
   ----------------------
   · TCU  — algoritmo solar (posición del sol, true tracking y backtracking),
            jerarquía de control completa, motor con velocidad real y deadband,
            batería LiFePO4 por conteo de culombios, temperaturas, alarmas y
            enlace Zigbee con la NCU.
   · HSU  — viento (media + rachas) con sus niveles y umbrales, dirección,
            nieve acumulada, irradiancia GHI/POA y sus alarmas.
   · NCU  — reloj, entradas digitales (seta y los 10 interruptores de limpieza),
            agregación meteo de todas las HSU, forzados de posición segura y
            cambios de modo por grupo, y la caché donde republica a sus TCU/HSU.

   Jerarquía de control del TCU (de más a menos prioritaria)
   --------------------------------------------------------
     0. SETA de emergencia (pulsador local o seta de la NCU) → motor inhibido.
     1. SP1 VIENTO   — nivel de viento de la HSU o forzado de la NCU.
                       Abanderamiento B2: parcial ≥40 km/h, total ≥60 km/h,
                       histéresis de desabanderamiento de 30 min.
     2. SP3 NIEVE    — alarma de nieve o forzado.
     3. SP4 LIMPIEZA — interruptor de limpieza del grupo o forzado.
     4. SP2/5/6/7    — forzados genéricos de la NCU.
     5. BATERÍA      — SoC bajo L3 (crítico) manda a defensa; bajo L2 congela el
                       seguimiento; bajo L1 lo hace a pasos gruesos (winter mode).
     6. MANUAL       — consigna del operador (modo 1).
     7. AUTO         — seguimiento solar con backtracking (modo 2); de noche, a
                       la posición nocturna. En modo 0 (OFF) el TCU no se mueve.

   Procedencia de los números
   --------------------------
   · Mapa y bits: sim/modbus-map.js (generado de la ficha de cobertura-zigbee,
     que transcribe NCU_Modbus_Map_R7 · SUNNER_TCU_ModbusMap_v6 · HSU R23).
   · Escalas de los registros propios de la TCU: las que usa la TCU Toolbox
     (scada/tools/tcu-toolbox) contra equipo real — tilt ×10, ángulos solares
     ×100, temperaturas ×10, tensiones mV, corrientes mA, reloj en BCD.
   · Física y umbrales: los mismos que bateria.html (estudio de disponibilidad
     de batería SUNNER + física canónica de SolarGPT).

   Lo que NO es
   ------------
   Esto no habla Modbus por la red: genera la IMAGEN de registros que el equipo
   serviría. Para ejercitar el transporte de verdad está scada/tools/ncu_simulada.py.
   Y no es un modelo bancable de producción: es un banco de pruebas de control.
   ============================================================================ */
(function (global) {
'use strict';

var D2R = Math.PI / 180, R2D = 180 / Math.PI;

/* ═══════════════════ física canónica ═══════════════════
   NO se copia aquí: se lee de sim/fisica.js, que un generador saca de sus fuentes
   (solargpt_core/tcu.py, tfm_constants.py y el bloque canónico de bateria.html) y
   se niega a escribir si las tres no dicen lo mismo. Si mañana se toca la gestión
   de batería en SolarGPT, aquí llega con `node tools/extrae_fisica.mjs`, sin que
   nadie tenga que acordarse de actualizar una constante a mano. */
var F = (typeof window !== 'undefined' && window.FISICA) ||
        (typeof require === 'function' ? require('./fisica.js') : null);
if (!F) throw new Error('falta sim/fisica.js — genéralo con: node tools/extrae_fisica.mjs');

var K = {
  /* ---- del canon (fisica.js) ---- */
  AXIS_MAX: F.e.AXIS_MAX,       /* tope mecánico ±55° */
  GCR: F.e.GCR,                 /* cuerda/pitch de la 1V bífila */
  NIGHT_POS: F.e.NIGHT_POS,     /* posición nocturna */
  DEFENSE_POS: F.e.DEFENSE_POS, /* defensa por batería */
  SLEW_DPS: F.e.SLEW_DPS,       /* velocidad real de giro (°/s) */
  HYST_DEG: F.e.HYST_DEG,       /* deadband del lazo */
  WIND_T1: F.e.WIND_T1,         /* 40 km/h → abanderamiento parcial */
  WIND_T2: F.e.WIND_T2,         /* 60 km/h → abanderamiento total */
  PARTIAL_STOW: F.e.PARTIAL_STOW_DEG,
  DESTOW_MIN: F.e.DESTOW_HOLD_MIN,        /* histéresis de desabanderamiento (min) — canon EPC */
  IDLE_W: F.idleW, SLEEP_W: F.sleepW,     /* electrónica, de día y de noche (W) */
  MOT_K0: F.motor.K0, MOT_K1: F.motor.K1, /* motor: Wh/° = K0 + K1·|θ| */
  ETA_CHG: F.e.ETA_CHG,                   /* rendimiento de la carga */
  DEG_H_NORMAL: F.e.DEG_H_NORMAL, DEG_H_WINTER: F.e.DEG_H_WINTER,
  ALBEDO: F.e.ALBEDO,
  JEITA_T3: F.e.JEITA_T3, JEITA_T4: F.e.JEITA_T4,
  V_NOM: F.vNom,                          /* tensión nominal del bus */

  /* ---- propio del simulador: no está en el canon porque el estudio de batería no
     lo necesita, pero un gemelo que sirve registros Modbus sí ---- */
  SNOW_ALARM_M: 0.03,           /* 3 cm de nieve → alarma de nieve */
  /* ---- entradas físicas del TCU (ver el bloque de más abajo) ---- */
  PULSOS_TOPE: 1910,            /* 41037/41038: ±1910 pulsos = ±55° → 34,7 pulsos/° */
  DB_PULSOS: 45,                /* 41060/41061: deadband normal, en pulsos */
  DB_PULSOS_BAJA: 90,           /* 41063: deadband con alarma de baja capacidad */
  ANTIRREBOTE_S: 0.05,          /* la línea de la seta tiene que estar estable 50 ms */
  EVAL_MOTOR_S: 5,              /* 41039: ventana para juzgar si el motor se mueve */
  REINTENTOS_MOTOR: 3,          /* 41065: reintentos antes de enclavar el eje bloqueado */
  VEL_SIN_CARGA: 0.2,           /* 41067: velocidad del motor en vacío (°/s) */
  V_MIN: 24.0, V_MAX: 27.2,     /* curva de tensión 8S LiFePO4, para el registro 30094 */
  V_ABS: 27.0,                  /* tensión de absorción */
  T_CHG_MIN: 0,                 /* bajo 0 °C no se carga (salvo versión calefactada) */
  SOC_L1: 50, SOC_L2: 35, SOC_L3: 25,  /* umbrales de ALARMA del firmware (41081) */
  SOC_REARME: 5                 /* histéresis de salida de los modos de batería (%) */
};
/* ── TODO es configurable ────────────────────────────────────────────────────
   K sale del canon, pero ninguna de sus constantes está clavada: son valores por
   defecto, no dogma. Se guarda una copia intacta (K_CANON) y se pueden pisar en
   caliente con SIM.ajusta({...}); SIM.restauraCanon() las devuelve.

   Se pisa el MISMO objeto K, no una copia, porque todo el motor lee `K.LO_QUE_SEA`
   en el momento de usarlo: cambiar un valor con la planta andando surte efecto en
   el siguiente paso, sin rehacer nada. Lo único que hay que refrescar a mano son
   las máquinas de abanderamiento, que se construyen con sus umbrales dentro — de
   eso se encarga `refrescaViento` más abajo. */
var K_CANON = {};
for (var _k in K) if (Object.prototype.hasOwnProperty.call(K, _k)) K_CANON[_k] = K[_k];

function ajusta(cambios) {
  var hechos = {}, malas = [];
  for (var c in cambios) {
    if (!Object.prototype.hasOwnProperty.call(cambios, c)) continue;
    if (!Object.prototype.hasOwnProperty.call(K_CANON, c)) { malas.push(c); continue; }
    var v = Number(cambios[c]);
    if (!isFinite(v)) { malas.push(c); continue; }
    if (K[c] !== v) { K[c] = v; hechos[c] = v; }
  }
  if (malas.length) throw new Error('parámetros que no existen o no son números: ' + malas.join(', '));
  return hechos;
}
function restauraCanon() {
  var vuelta = {};
  for (var c in K_CANON) if (K[c] !== K_CANON[c]) { K[c] = K_CANON[c]; vuelta[c] = K_CANON[c]; }
  return vuelta;
}
/* Catálogo de lo que se puede tocar: etiqueta, unidad, decimales, grupo y de dónde
   sale el valor por defecto (`canon` = generado de SolarGPT, `sim` = propio del gemelo,
   porque el estudio de batería no lo necesita pero un equipo que sirve Modbus sí).
   Existe para que la interfaz pinte los controles SOLA: si mañana entra una constante
   nueva en K, se añade aquí y aparece en el panel sin tocar el HTML. */
var PARAMS = [
  { k: 'AXIS_MAX',      n: 'Tope mecánico del eje',        u: '°',     d: 1, g: 'Geometría y movimiento', o: 'canon' },
  { k: 'GCR',           n: 'GCR (cuerda/paso)',            u: '',      d: 3, g: 'Geometría y movimiento', o: 'canon' },
  { k: 'NIGHT_POS',     n: 'Posición nocturna',            u: '°',     d: 1, g: 'Geometría y movimiento', o: 'canon' },
  { k: 'DEFENSE_POS',   n: 'Defensa por batería',          u: '°',     d: 1, g: 'Geometría y movimiento', o: 'canon' },
  { k: 'SLEW_DPS',      n: 'Velocidad del actuador',       u: '°/s',   d: 3, g: 'Geometría y movimiento', o: 'canon' },
  { k: 'HYST_DEG',      n: 'Banda muerta del lazo',        u: '°',     d: 2, g: 'Geometría y movimiento', o: 'canon' },
  { k: 'VEL_SIN_CARGA', n: 'Velocidad del motor en vacío', u: '°/s',   d: 2, g: 'Geometría y movimiento', o: 'sim' },
  { k: 'DEG_H_NORMAL',  n: 'Ritmo de seguimiento',         u: '°/h',   d: 1, g: 'Geometría y movimiento', o: 'canon' },
  { k: 'DEG_H_WINTER',  n: 'Ritmo en modo invierno',       u: '°/h',   d: 1, g: 'Geometría y movimiento', o: 'canon' },

  { k: 'WIND_T1',       n: 'Umbral parcial',               u: 'm/s',   d: 3, g: 'Abanderamiento', o: 'canon' },
  { k: 'WIND_T2',       n: 'Umbral total',                 u: 'm/s',   d: 3, g: 'Abanderamiento', o: 'canon' },
  { k: 'PARTIAL_STOW',  n: 'Mínimo del sector parcial',    u: '°',     d: 1, g: 'Abanderamiento', o: 'canon' },
  { k: 'DESTOW_MIN',    n: 'Histéresis de desabanderar',   u: 'min',   d: 0, g: 'Abanderamiento', o: 'canon' },
  { k: 'SNOW_ALARM_M',  n: 'Nieve que dispara la alarma',  u: 'm',     d: 3, g: 'Abanderamiento', o: 'sim' },

  { k: 'IDLE_W',        n: 'Consumo de electrónica (día)', u: 'W',     d: 2, g: 'Energía', o: 'canon' },
  { k: 'SLEEP_W',       n: 'Consumo de reposo (noche)',    u: 'W',     d: 2, g: 'Energía', o: 'canon' },
  { k: 'MOT_K0',        n: 'Motor · K0',                   u: 'Wh/°',  d: 4, g: 'Energía', o: 'canon' },
  { k: 'MOT_K1',        n: 'Motor · K1',                   u: 'Wh/°²', d: 6, g: 'Energía', o: 'canon' },
  { k: 'ETA_CHG',       n: 'Rendimiento de carga',         u: '',      d: 3, g: 'Energía', o: 'canon' },
  { k: 'V_NOM',         n: 'Tensión nominal del bus',      u: 'V',     d: 2, g: 'Energía', o: 'canon' },
  { k: 'ALBEDO',        n: 'Albedo del suelo',             u: '',      d: 2, g: 'Energía', o: 'canon' },

  { k: 'JEITA_T3',      n: 'JEITA T3 (reduce carga)',      u: '°C',    d: 1, g: 'Batería', o: 'canon' },
  { k: 'JEITA_T4',      n: 'JEITA T4 (bloquea carga)',     u: '°C',    d: 1, g: 'Batería', o: 'canon' },
  { k: 'T_CHG_MIN',     n: 'Mínima para cargar',           u: '°C',    d: 1, g: 'Batería', o: 'sim' },
  { k: 'V_MIN',         n: 'Tensión a SoC 0',              u: 'V',     d: 2, g: 'Batería', o: 'sim' },
  { k: 'V_MAX',         n: 'Tensión a SoC 100',            u: 'V',     d: 2, g: 'Batería', o: 'sim' },
  { k: 'V_ABS',         n: 'Tensión de absorción',         u: 'V',     d: 2, g: 'Batería', o: 'sim' },
  { k: 'SOC_L1',        n: 'Alarma L1',                    u: '%',     d: 0, g: 'Batería', o: 'sim' },
  { k: 'SOC_L2',        n: 'Alarma L2 (congela)',          u: '%',     d: 0, g: 'Batería', o: 'sim' },
  { k: 'SOC_L3',        n: 'Alarma L3',                    u: '%',     d: 0, g: 'Batería', o: 'sim' },
  { k: 'SOC_REARME',    n: 'Rearme de los modos',          u: '%',     d: 0, g: 'Batería', o: 'sim' },

  { k: 'PULSOS_TOPE',      n: 'Pulsos a tope de eje',         u: 'pulsos', d: 0, g: 'Entradas físicas y firmware', o: 'sim' },
  { k: 'DB_PULSOS',        n: 'Banda muerta normal',          u: 'pulsos', d: 0, g: 'Entradas físicas y firmware', o: 'sim' },
  { k: 'DB_PULSOS_BAJA',   n: 'Banda muerta en baja carga',   u: 'pulsos', d: 0, g: 'Entradas físicas y firmware', o: 'sim' },
  { k: 'ANTIRREBOTE_S',    n: 'Antirrebote de la seta',       u: 's',      d: 3, g: 'Entradas físicas y firmware', o: 'sim' },
  { k: 'EVAL_MOTOR_S',     n: 'Ventana de juicio del motor',  u: 's',      d: 1, g: 'Entradas físicas y firmware', o: 'sim' },
  { k: 'REINTENTOS_MOTOR', n: 'Reintentos antes de enclavar', u: '',       d: 0, g: 'Entradas físicas y firmware', o: 'sim' }
];
/* que el catálogo y K no se separen: si entra una constante y nadie la cataloga, salta */
(function () {
  var vistos = {}, faltan = [];
  for (var i = 0; i < PARAMS.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(K, PARAMS[i].k)) faltan.push(PARAMS[i].k + ' (catalogado y no existe)');
    vistos[PARAMS[i].k] = true;
  }
  for (var c in K) if (!vistos[c]) faltan.push(c + ' (existe y no está catalogado)');
  if (faltan.length) throw new Error('PARAMS y K no cuadran: ' + faltan.join(', '));
})();

/* Qué se ha tocado respecto al canon: lo usa la interfaz para marcarlo. */
function tocados() {
  var t = {};
  for (var c in K_CANON) if (K[c] !== K_CANON[c]) t[c] = { canon: K_CANON[c], ahora: K[c] };
  return t;
}

/* las cuatro curvas, tal cual salen de bateria.html */
var cRateSafeLFP = F.cRateSafeLFP, hotDerate = F.hotDerate, heaterW = F.heaterW, poaAt = F.poaAt;
/* y el consumo de un TCU en un paso, que es del módulo de gestión de batería */
var consumoTCU = F.consumoTCU;

/* El abanderamiento vive en su propio módulo compartido (sim/viento.js), que es el
   mismo fichero que usan el gemelo 3D y el visor de terreno. Una sola implementación
   de la estrategia B2 para toda la casa. */
var Abanderamiento = (typeof window !== 'undefined' && window.Abanderamiento) ||
        (typeof require === 'function' ? require('./viento.js') : null);
if (!Abanderamiento) throw new Error('falta sim/viento.js');

/* Y el seguimiento con cielo cubierto, en el suyo (sim/difusa.js): las cuatro
   políticas de DiffuseConfig, tal cual las define solargpt_core/tracker.py. */
var Difusa = (typeof window !== 'undefined' && window.Difusa) ||
        (typeof require === 'function' ? require('./difusa.js') : null);
if (!Difusa) throw new Error('falta sim/difusa.js');

/* Y la descomposición de la global en directa y difusa (Erbs, el modelo por defecto
   de solargpt_core.meteo.decompose_ghi) en sim/cielo.js. */
var Cielo = (typeof window !== 'undefined' && window.Cielo) ||
        (typeof require === 'function' ? require('./cielo.js') : null);
if (!Cielo) throw new Error('falta sim/cielo.js');

/* Una bandera nueva con los umbrales que haya AHORA en K (que pueden no ser los del
   canon si se han ajustado). `sincronizaBandera` los refresca en una ya montada, sin
   perderle el estado: es lo que permite mover un umbral con la planta en marcha. */
function nuevaBandera(estrategia) {
  var ab = new Abanderamiento({ estrategia: estrategia });
  sincronizaBandera(ab);
  return ab;
}
function sincronizaBandera(ab) {
  ab.t1 = K.WIND_T1; ab.t2 = K.WIND_T2;
  ab.parcialMin = K.PARTIAL_STOW; ab.total = K.AXIS_MAX;
  ab.holdS = K.DESTOW_MIN * 60;
  return ab;
}

/* ── Alimentación y gestión de batería ──────────────────────────────────────
   Un TCU no siempre come de lo mismo, y eso cambia por completo su gestión de
   energía. Los tres tipos que hay en planta:

     · SP (self-powered) — panel auxiliar propio de 45 o 60 W colgado del propio
       seguidor. Es el caso duro: lo que entra depende del ÁNGULO REAL, así que
       abanderar o quedarse parado también cuesta carga. Es el que estudia el
       Battery Availability Study.
     · STRING — se alimenta del propio string FV a través de un regulador de 60 W.
       Con sol hay potencia de sobra (el string son kW, no 60 W): el regulador
       satura en su tope y la batería carga a lo que le dejan la temperatura y el
       C-rate. Sigue dependiendo del sol —de noche descarga igual— pero no del
       ángulo, salvo por lo que baja el propio string al abanderar.
     · AC — alimentado de alterna (TCU tipo AC del registro 30000). En el canon el
       perfil de alterna va SIN batería: si se corta la red, el TCU se cae. Es el
       ensayo que interesa poder provocar.

   El tipo va en el mapa: 30000 bits 3:0 «TCU type (BAT/AC/Unknown)» y, en el
   bloque completo de la NCU, «Power supply voltage (in the self-powered TCU, it
   is the dedicated solar panel voltage)» — el mismo registro sirve a los tres.

   Los perfiles NO se escriben aquí: son los ocho de PROFILES de solargpt_core/tcu.py
   («single source of truth», dice el propio fichero), con su capacidad, su potencia
   de carga y su variante calefactada. */
var PERFILES = F.perfiles;
function perfilDe(id) {
  var i;
  for (i = 0; i < PERFILES.length; i++) if (PERFILES[i].id === id) return PERFILES[i];
  for (i = 0; i < PERFILES.length; i++) if (PERFILES[i].id === F.perfilPorDefecto) return PERFILES[i];
  return PERFILES[0];
}
/* Código de tipo del registro 30000 (bits 3:0). ⚠ El documento nombra el campo
   «TCU type (BAT/AC/Unknown)» pero no transcribe sus valores: esta asignación es
   del simulador, y va marcada como tal en el visor. */
var TIPO_REG = { desconocido: 0, sp: 1, string: 1, ac: 2 };

/* Modo de operación (30001 bits 9:8) y estados del cargador (30153) */
var MODO = { OFF: 0, MANUAL: 1, AUTO: 2 };
var MODO_TXT = ['OFF', 'MANUAL', 'AUTO', '?'];
var CHARGER_TXT = ['—', 'Estado inicial', 'Batería aislada', 'Batería conectada', 'Inicializando BQ'];

/* Posiciones de seguridad: los números 1/3/4 los fija el mapa R7 de la NCU
   (Force Safe Position 1 = Wind, 3 = Snow, 4 = Cleaning). El 2, 5, 6 y 7 son
   genéricos: el documento no les da uso, así que aquí son forzados sin más. */
var SP = { NINGUNA: 0, VIENTO: 1, GENERICA2: 2, NIEVE: 3, LIMPIEZA: 4, G5: 5, G6: 6, G7: 7 };
var SP_TXT = ['—', 'SP1 viento', 'SP2', 'SP3 nieve', 'SP4 limpieza', 'SP5', 'SP6', 'SP7'];

/* Criterio del ángulo objetivo (30113) y fuente de la posición segura (30114).
   ⚠ El documento nombra los dos registros pero NO transcribe su enumerado: esta
   codificación es del simulador. Va marcada como tal en el visor. */
var CRIT = { SEGUIMIENTO: 0, BACKTRACKING: 1, MANUAL: 2, SEGURIDAD: 3, LIMITE: 4,
             NOCHE: 5, BATERIA: 6, INHIBIDO: 7, DIFUSA: 8 };
var CRIT_TXT = ['Seguimiento', 'Backtracking', 'Manual', 'Posición de seguridad',
                'Límite de tilt', 'Noche', 'Restricción de batería', 'Motor inhibido',
                'Cielo cubierto'];
var FUENTE_SP = { NINGUNA: 0, HSU: 1, NCU: 2, LOCAL: 3 };
var FUENTE_TXT = ['—', 'meteo de la HSU', 'forzado de la NCU', 'decisión local'];

/* ═══════════════════ utilidades ═══════════════════ */
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function signo(v) { return v < 0 ? -1 : 1; }

/* Ruido reproducible: mismo semilla → misma planta, que es lo que permite
   comparar dos ejecuciones y no perseguir fantasmas. */
function Rnd(semilla) { this.s = semilla >>> 0 || 1; }
Rnd.prototype.next = function () {
  this.s ^= this.s << 13; this.s >>>= 0;
  this.s ^= this.s >> 17;
  this.s ^= this.s << 5;  this.s >>>= 0;
  return this.s / 4294967296;
};
Rnd.prototype.entre = function (a, b) { return a + (b - a) * this.next(); };

/* ═══════════════════ sol y seguimiento ═══════════════════
   Las mismas fórmulas del gemelo (index.html): hora CIVIL → hora solar con
   longitud, huso, DST europeo y ecuación del tiempo. */
function declinacion(N) { return 23.45 * Math.sin(2 * Math.PI * (284 + (N || 1)) / 365) * D2R; }
function husoDe(loc, N) { return loc.tz + ((loc.dst && N >= 86 && N <= 303) ? 1 : 0); }
function desfaseSolar(loc, N) {
  var LSTM = 15 * husoDe(loc, N), B = 2 * Math.PI / 365 * ((N || 1) - 81);
  var EoT = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  return (4 * (loc.lon - LSTM) + EoT) / 60;
}
function posicionSolar(loc, N, h) {
  var dec = declinacion(N), latR = loc.lat * D2R;
  var hs = h + desfaseSolar(loc, N), w = (hs - 12) * 15 * D2R;
  var sinEl = Math.sin(latR) * Math.sin(dec) + Math.cos(latR) * Math.cos(dec) * Math.cos(w);
  var el = Math.asin(clamp(sinEl, -1, 1));
  var caz = (sinEl * Math.sin(latR) - Math.sin(dec)) / Math.max(1e-6, Math.cos(el) * Math.cos(latR));
  var az = Math.acos(clamp(caz, -1, 1)); if (w < 0) az = -az;   /* − este (mañana), + oeste (tarde) */
  return { el: el, az: az, zen: Math.PI / 2 - el };
}
/* True tracking + backtracking (Anderson-Mikofski) sobre eje N-S. */
function angulos(loc, N, h) {
  var P = posicionSolar(loc, N, h);
  if (P.el <= 0.0001) return { sol: P, dia: false, real: 0, bt: 0, sel: K.NIGHT_POS, btActivo: false, ghi: 0 };
  var sx = Math.cos(P.el) * Math.sin(P.az), sz = Math.sin(P.el);
  var tt = Math.atan2(sx, sz);
  var temp = Math.min(1, (1 / K.GCR) * Math.cos(tt));
  var bt = tt - signo(tt) * Math.acos(temp);
  var ttD = clamp(tt * R2D, -K.AXIS_MAX, K.AXIS_MAX), btD = clamp(bt * R2D, -K.AXIS_MAX, K.AXIS_MAX);
  return { sol: P, dia: true, real: ttD, bt: btD, sel: btD,
           btActivo: Math.abs(btD) < Math.abs(ttD) - 1e-3 };
}
/* Coseno del ángulo de incidencia con el ángulo REAL del seguidor: si está
   abanderado o parado, la captación cae — que es justo lo que interesa medir. */
function cosAOI(P, tiltDeg) {
  if (P.el <= 0) return 0;
  var sx = Math.cos(P.el) * Math.sin(P.az), sz = Math.max(0, Math.sin(P.el)), r = tiltDeg * D2R;
  return Math.max(0, sx * Math.sin(r) + sz * Math.cos(r));
}

/* Las cuatro curvas que fijan cuánta carga admite la batería —cRateSafeLFP,
   hotDerate, heaterW y poaAt— no viven aquí: llegan de fisica.js, que las trae
   íntegras de bateria.html. Son la diferencia entre un modelo que dice «hay sol,
   luego carga» y uno que sabe que a −5 °C no carga casi nada. */

/* ═══════════════════ codificación Modbus ═══════════════════ */
function u16(v) { return Math.round(v) & 0xFFFF; }
function s16(v) { v = Math.round(v); return (v < 0 ? v + 65536 : v) & 0xFFFF; }
function u32(v, wo) { v = Math.round(v) >>> 0; var hi = (v >>> 16) & 0xFFFF, lo = v & 0xFFFF; return wo === 'little' ? [lo, hi] : [hi, lo]; }
function f32(v, wo) {
  var b = new ArrayBuffer(4), dv = new DataView(b);
  dv.setFloat32(0, v, false);
  var hi = dv.getUint16(0), lo = dv.getUint16(2);
  return wo === 'little' ? [lo, hi] : [hi, lo];
}
function kx10(c) { return u16((c + 273.15) * 10); }      /* temperatura en K×10 */
function bcd(n) { n = Math.round(n) % 100; return ((Math.floor(n / 10) << 4) | (n % 10)) & 0xFF; }
/* Compone una palabra a partir de {nombre:[lsb,msb]} y {nombre: valor}. */
function bits(campos, valores) {
  var w = 0;
  for (var n in campos) {
    if (!(n in valores)) continue;
    var lsb = campos[n][0], msb = campos[n][1], anc = msb - lsb + 1;
    w = (w & ~((((1 << anc) - 1) << lsb))) | ((valores[n] << lsb) & (((1 << anc) - 1) << lsb));
  }
  return w & 0xFFFF;
}

/* ═══════════════════ HSU — estación meteo ═══════════════════ */
function HSU(id, planta) {
  this.id = id; this.p = planta;
  this.rnd = new Rnd(9000 + id * 7);
  this.viento = 3; this.racha = 3; this.dir = 200 + id * 15;
  this.nieve = 0; this.ghi = 0; this.poa = 0; this.difusa = 0;
  this.nivel = 0; this.vBat = 13200;
  this.online = true; this.ultimoContacto = planta.t.epoch;
  this.falloVientoSensor = false; this.falloNieveSensor = false;
  this.tSuavizado = 0;
}
HSU.prototype.paso = function (dt) {
  var m = this.p.meteo;
  /* viento: media de planta + una racha por HSU que va y viene (cada estación ve
     su propio viento; por eso la NCU se queda con el nivel MÁS ALTO de todas) */
  this.tSuavizado += dt;
  var f = Math.sin(this.tSuavizado / 47 + this.id) * 0.5 + Math.sin(this.tSuavizado / 13 + this.id * 2) * 0.3;
  this.viento = Math.max(0, m.viento * (1 + 0.18 * f) + this.rnd.entre(-0.4, 0.4));
  this.racha = Math.max(this.viento, this.viento * (1 + m.rachas * 0.45));
  this.dir = (m.dirViento + Math.sin(this.tSuavizado / 90 + this.id) * 12 + 360) % 360;
  this.nieve = m.nieve;
  var P = posicionSolar(this.p.loc, this.p.t.dia, this.p.t.hora);
  var claro = Math.max(0, Math.sin(Math.max(0, P.el))) * m.transmitancia();
  this.ghi = 1000 * claro;
  this.difusa = this.ghi * (0.12 + 0.6 * (m.nubes / 100));
  this.poa = this.ghi * 1.12;               /* POA de un seguidor de referencia */
  /* nivel de viento (bits 2:0 del MSR): 0 calma · 1 aviso ≥40 km/h · 2 alarma ≥60 km/h */
  var v = Math.max(this.viento, this.racha);
  this.nivel = v >= K.WIND_T2 ? 2 : (v >= K.WIND_T1 ? 1 : 0);
  if (this.online) this.ultimoContacto = this.p.t.epoch;
};
HSU.prototype.alarmaViento = function () { return this.nivel >= 2; };
HSU.prototype.alarmaNieve = function () { return this.nieve >= K.SNOW_ALARM_M; };
HSU.prototype.alarmaRacha = function () { return this.racha >= K.WIND_T2; };
HSU.prototype.salud = function () {
  if (!this.online) return 'offline';
  if (this.alarmaViento() || this.alarmaNieve() || this.falloVientoSensor || this.falloNieveSensor) return 'alarma';
  if (this.nivel > 0) return 'aviso';
  return 'ok';
};

/* ═══════════════════ ENTRADAS FÍSICAS DEL TCU ═══════════════════
   Las dos entradas que de verdad mandan sobre el seguidor no se parecen en nada, y
   modelarlas igual es lo que hacía que este simulador no supiera representar los
   fallos que más se ven en planta:

   · El INCLINÓMETRO es ANALÓGICO. No devuelve «el ángulo»: devuelve una medida, con
     su ruido, su deriva con la temperatura, su cuantización y su desajuste de cero.
     El TCU cierra el lazo y publica los registros con ESA medida, no con la posición
     real de la mesa. De ahí sale el defecto clásico: un TCU que dice 0° con la mesa
     a 3°, el SCADA viéndolo todo verde y la producción sin aparecer — justo lo que
     persigue el ensayo D.1.1 del Anexo 4. El offset con el que se compensa vive en
     41058 (f32 rad, rango ±π/4) y la cuantización sale de 41037/41038: ±1910 pulsos
     para ±55°, o sea 34,7 pulsos por grado.

   · La SETA es BINARIA. Es una línea de contacto, no una decisión de software: corta
     la alimentación del puente en H. Tiene antirrebote, va enclavada (soltarla no
     basta: hay que limpiar la alarma con 40007 bit 13, que es lo que hace el botón
     «LIMPIAR ALARMAS» de la toolbox) y se cablea en NORMALMENTE CERRADO, de modo que
     un cable cortado se lee como pulsada. Un lazo de seguridad que fallara al revés
     no sería un lazo de seguridad.

   La consecuencia de fondo: mientras la seta está pulsada el algoritmo SIGUE
   calculando su objetivo, así que 30110 (diferencia objetivo − real) crece y crece.
   Eso es exactamente lo que ve el operario, y con la seta modelada como una regla de
   la jerarquía no pasaba.                                                          */

/* Ruido ~gaussiano barato (suma de tres uniformes), en grados RMS. */
function ruidoGauss(rnd, rms) { return (rnd.next() + rnd.next() + rnd.next() - 1.5) * 1.63 * rms; }

/* ═══════════════════ TCU — unidad de control del seguidor ═══════════════════ */
function TCU(id, planta, opts) {
  opts = opts || {};
  this.id = id; this.p = planta;
  this.grupo = opts.grupo || 1;
  this.repetidor = !!opts.repetidor;      /* un repetidor es una TCU fija: misma
                                             electrónica y batería, sin seguidor */
  this.rnd = new Rnd(1000 + id * 13);
  /* de qué come este TCU: perfil de planta salvo que se le fije uno propio */
  this.perfil = perfilDe(opts.perfil || (planta.cfg && planta.cfg.perfil));
  this.ah = this.perfil.ah;                /* 3 Ah o 6 Ah según el perfil; 0 si no lleva batería */
  this.acOk = true;

  /* un repetidor nace plano y ahí se queda: no tiene seguidor ni motor que mover */
  this.anguloReal = this.repetidor ? 0 : K.NIGHT_POS;   /* la MESA: solo lo sabe el simulador */
  this.angulo = this.anguloReal;                        /* lo que MIDE el TCU y publica */
  this.objetivo = this.anguloReal;

  this.forzadoLocal = 0;             /* 40000 = 11..17: forzado escrito a ESTE equipo */
  this.jog = 0;                      /* 40017: mando manual del motor (−1 este, +1 oeste) */
  this.escrito = {};                 /* lo que se le ha escrito, para releerlo tal cual */

  /* --- CONFIGURACIÓN DEL PROPIO EQUIPO ---
     Hasta ahora estos valores salían de K, o sea que eran de la planta entera y no
     se podían tocar más que desde el panel. Un TCU real los lleva EN SUS REGISTROS
     y se cambian escribiéndolos, uno a uno, con la toolbox. Aquí igual: cada TCU
     tiene los suyos, `escribe()` los cambia y `regsTCU()` los publica de vuelta. */
  this.cfgTcu = {
    topeOeste: K.AXIS_MAX, topeEste: -K.AXIS_MAX,   /* 41037 / 41038, en grados */
    evalMotorS: K.EVAL_MOTOR_S,                     /* 41039 */
    iMotorMax: (planta.cfg && planta.cfg.iMotorMax) || 7000,  /* 41040 */
    nightPos: K.NIGHT_POS,                          /* 41042 */
    dbPulsos: K.DB_PULSOS,                          /* 41060 / 41061 */
    dbPulsosBaja: K.DB_PULSOS_BAJA,                 /* 41062 / 41063 */
    reintentos: K.REINTENTOS_MOTOR,                 /* 41065 */
    velSinCarga: K.VEL_SIN_CARGA,                   /* 41067 */
    spTilt: ((planta.cfg && planta.cfg.spTilt) || []).slice(),   /* 41044…41056 */
    jeita: [K.T_CHG_MIN, K.JEITA_T3, K.JEITA_T3, K.JEITA_T4],    /* 40008…40011 */
    heaterT: 0                                      /* 40035 */
  };

  /* --- inclinómetro: entrada analógica --- */
  this.sensor = {
    desajuste: 0,                    /* error de montaje REAL del sensor (°) */
    offsetCfg: 0,                    /* 41058: lo que el instalador cree que hay que compensar */
    ruidoRms: 0.04,                  /* ruido del MEMS (° RMS) */
    deriva: 0.004,                   /* deriva térmica del cero (°/°C sobre 25 °C) */
    pulsosGrado: K.PULSOS_TOPE / K.AXIS_MAX,
    tau: 3,                          /* constante del filtro de la medida (s) */
    ok: true,                        /* acelerómetro sano (30004.5) */
    crudo: this.anguloReal, filtrado: this.anguloReal
  };
  /* --- seta: entrada binaria --- */
  this.setaLocal = false;            /* el pulsador de la propia TCU */
  this.cableSetaCortado = false;     /* lazo NC abierto: se lee como pulsada */
  this.setaBruta = false; this.setaDeb = 0; this.paro = false;        /* 30100.13 «Stop button» — NO es una seta: ver nota */
  this.alarmaMotorEnclavada = false; /* solo la limpia 40007 bit 13 */
  this.motorHabilitado = true;
  /* --- eje: la avería es FÍSICA; el bit de alarma lo DEDUCE el firmware. Y hay dos
     averías distintas, que el equipo distingue por caminos distintos:
       · ATASCADO (rotor calado): no gira nada y el motor pega un pico de corriente,
         así que salta la sobrecorriente software (30003.5) casi al instante.
       · DURO (fricción alta, hielo, rodamiento seco): gira, pero más despacio de lo
         mandado y sin llegar al disparo. Eso es lo que caza la detección lenta:
         41039 de ventana, 41065 reintentos, y entonces eje bloqueado (30003.8). --- */
  this.ejeAtascado = false;
  this.ejeDuro = false;
  this.tSinMoverse = 0; this.reintentos = 0;
  this.modo = MODO.AUTO; this.manual = 0;
  this.sp = SP.NINGUNA; this.fuenteSp = FUENTE_SP.NINGUNA; this.criterio = CRIT.NOCHE;
  this.bt = false; this.moviendo = 0;      /* −1 este · 0 parado · +1 oeste */

  this.soc = opts.soc != null ? opts.soc : (this.perfil.tipo === 'ac' ? 100 : 78 + this.rnd.entre(-8, 12));
  this.soh = 100 - Math.floor(this.rnd.entre(0, 6));
  this.vBat = 0; this.iBat = 0; this.vPanel = 0; this.iPanel = 0;
  this.tBat = 18; this.tPcb = 20;
  this.iMotor = 0; this.iMotorPico = 0; this.vMotor = 0;
  this.energiaMotorHoy = 0; this.energiaMotorTotal = this.rnd.entre(2e5, 9e5);
  this.ciclos = Math.floor(this.rnd.entre(40, 200));
  this.diasPreservacion = 0; this.cargador = 3; this.calefactor = false;
  this.bajaCapacidad = 0;                  /* 0 normal · 1 baja · 2 muy baja · 3 crítica */
  this.parked = false;                     /* defensa por SOC crítico (estrategia) */
  this.techoSoc = 100; this.cargaCompletaHoy = false;
  this.whCarga = 0; this.whConsumo = 0;

  /* nace hablando: si el último contacto arrancara en 0, el SCADA vería una planta
     entera con 56 años de antigüedad de comunicaciones */
  this.online = true; this.ultimoContacto = planta.t.epoch;
  this.ejeBloqueado = false;               /* la ALARMA (30003.8), deducida — no la avería */
  this.sobrecorriente = false;
  this.fueraRango = false; this.limiteOeste = false; this.limiteEste = false;
  this.velocidadBaja = false; this.relajacion = false;

  /* los umbrales se le pasan desde K, no se los busca él en el canon: así el
     abanderamiento también se puede reconfigurar en caliente como todo lo demás */
  this.ab = nuevaBandera((planta.cfg && planta.cfg.estrategiaViento) || 'B2');
  this.dif = new Difusa({ politica: (planta.cfg && planta.cfg.politicaDifusa) || 'none' });
  this.difusaActiva = false; this.difusaAlpha = 0; this.difusaTxt = '';
  this.zbCanal = 15; this.zbAddr = 0x1000 + id;
  this.serie = 'TCU' + String(2400000 + id * 37);
  this.mac = 0x0013A200 * 1 + id;
  this.fwMayor = 1; this.fwMenor = 4; this.fwParche = 3;   /* FW v1.4.3 */
  this.comisionado = 0;                    /* 0 comisionado (3 fábrica) */
  this.solar = { real: 0, bt: 0, zen: 0, az: 0, dia: false };
}

/* Entradas que llegan de fuera del TCU en este instante. */
TCU.prototype.entradas = function () {
  var n = this.p.ncu, g = this.grupo;
  return {
    seta: this.seta,                       /* ya filtrada por el antirrebote */
    nivelViento: n.nivelVientoGlobal,
    vientoInvertido: n.vientoInvertido,
    nieve: n.alarmaNieve,
    limpieza: n.limpieza[g - 1],
    /* el forzado puede venir de la NCU (a todo el grupo) o del propio equipo, si
       alguien le ha escrito 40000 con 11..17. Gana el local, que es el más cercano. */
    forzado: this.forzadoLocal || n.forzadoDe(g),
    comNcu: this.online
  };
};

/* ---- ENTRADA ANALÓGICA: el inclinómetro ----
   El TCU no sabe dónde está la mesa: sabe lo que le dice el sensor. Y lo que le dice
   el sensor es la posición real MÁS el desajuste de montaje, MENOS el offset con el
   que se le ha calibrado (41058), más la deriva térmica del cero y su ruido, todo
   cuantizado a pulsos y pasado por el filtro. Sobre esa medida se cierra el lazo y
   se rellenan los registros. */
TCU.prototype.mide = function (dt) {
  var s = this.sensor;
  if (!s.ok) return;                    /* acelerómetro muerto: se queda con lo último */
  var cero = s.desajuste - s.offsetCfg + s.deriva * (this.tPcb - 25);
  var crudo = this.anguloReal + cero + ruidoGauss(this.rnd, s.ruidoRms);
  s.crudo = Math.round(crudo * s.pulsosGrado) / s.pulsosGrado;   /* resolución del sensor */
  s.filtrado += (s.crudo - s.filtrado) * Math.min(1, dt / s.tau);
  this.angulo = s.filtrado;
};

/* ---- ENTRADA BINARIA: la seta ----
   OJO CON LOS NOMBRES, que no son lo mismo y yo los mezclé:
     · la SETA de emergencia es del TCU — 30002.4, que el R7 llama `AlarmStopButton`:
       «Set if the emergency push button is pressed». Esa sí es una seta, con su lazo
       normalmente cerrado.
     · la NCU NO tiene seta. Lo que tiene es una entrada digital, 30100.13 `Stop button`,
       y el documento solo dice «True if the stop button was pressed». Ni dónde está el
       pulsador ni qué efecto tiene.
   Que ese pulsador inhiba el motor de la planta entera, y enclavado, es SUPOSICIÓN de
   este simulador. Está marcado como tal en pantalla y pendiente de confirmar.

   Línea de contacto en normalmente cerrado: pulsador local de la seta, pulsador de parada de la
   NCU o cable cortado, las tres la activan. Con antirrebote —una línea que rebota no
   debe disparar— y ENCLAVADA: al soltarla la alarma sigue puesta hasta que alguien
   la limpia con 40007 bit 13. */
TCU.prototype.leeSeta = function (dt) {
  var bruta = this.setaLocal || this.cableSetaCortado || this.p.ncu.paro;
  if (bruta !== this.setaBruta) { this.setaBruta = bruta; this.setaDeb = 0; }
  else if (this.setaDeb < K.ANTIRREBOTE_S) {
    this.setaDeb += dt;
    if (this.setaDeb >= K.ANTIRREBOTE_S) this.seta = bruta;
  }
  if (this.seta) this.alarmaMotorEnclavada = true;
  /* el puente en H queda sin alimentación mientras la seta esté pulsada o la alarma
     de motor siga enclavada. Ojo: esto NO es una decisión del algoritmo. */
  this.motorHabilitado = !this.seta && !this.alarmaMotorEnclavada;
};

/* 40007 bit 13 — «clear locked motor alarms». No limpia lo que sigue pasando: si la
   seta está pulsada de verdad, se vuelve a enclavar en el mismo paso. */
TCU.prototype.limpiaAlarmas = function () {
  this.alarmaMotorEnclavada = false;
  this.ejeBloqueado = false;
  this.sobrecorriente = false;
  this.velocidadBaja = false;
  this.reintentos = 0; this.tSinMoverse = 0;
  this.iMotorPico = 0;
};

/* ---- la jerarquía, en un solo sitio y en orden ---- */
TCU.prototype.decide = function (dt, ang) {
  var e = this.entradas(), cfg = this.p.cfg, obj, sp = SP.NINGUNA,
      fuente = FUENTE_SP.NINGUNA, crit, inhibido = false;

  /* abanderamiento: lo resuelve el módulo compartido con el viento REAL que ve la
     NCU (la HSU de más viento) y el azimut del sol, no con el nivel ya digerido */
  /* el canon usa azimut pvlib (90° = este al amanecer, 270° = oeste al atardecer) y
     aquí el azimut es 0 en el mediodía solar, negativo al este: az_pvlib = 180 + az */
  var azSol = ang.dia ? (180 + ang.sol.az * R2D) : 180;
  /* el eje A necesita además de dónde VIENE el viento, que es lo que miden las HSU */
  /* los umbrales se releen de K en cada paso: así mover uno con la planta en marcha
     surte efecto ya, sin perderle el estado a la máquina (ni el lado abanderado) */
  var rAb = sincronizaBandera(this.ab).paso(dt, this.p.ncu.vientoMax, ang.sel, azSol, this.p.ncu.dirVientoMax);
  this.stow = rAb.estado;

  /* modos de batería (L1 baja · L2 muy baja · L3 crítica) con rearme: se entra al
     cruzar el umbral hacia abajo y no se sale hasta superarlo por SOC_REARME, para
     que un TCU al filo del umbral no entre y salga cada minuto */
  var s = this.soc, nivelBat;
  if (s < K.SOC_L3) nivelBat = 3;
  else if (s < K.SOC_L2) nivelBat = 2;
  else if (s < K.SOC_L1) nivelBat = 1;
  else nivelBat = 0;
  var salida = [0, K.SOC_L1, K.SOC_L2, K.SOC_L3];
  if (nivelBat < this.bajaCapacidad && s < salida[this.bajaCapacidad] + K.SOC_REARME) nivelBat = this.bajaCapacidad;
  this.bajaCapacidad = nivelBat;

  /* signo de las posiciones de seguridad que no son la de viento: cara al sol. La
     de viento la resuelve el módulo, que además FIJA el lado al abanderar. */
  var sSol = ang.dia ? (ang.sol.az < 0 ? -1 : 1) : 1;
  if (e.vientoInvertido) sSol = -sSol;

  /* La SETA ya no aparece aquí: no decide el objetivo, corta el motor. El algoritmo
     sigue calculando adónde debería ir el seguidor —y por eso la diferencia de 30110
     crece mientras está pulsada—, pero el puente en H está sin alimentación. */

  /* 1 — SP1 VIENTO */
  if (this.stow > 0 || e.forzado === SP.VIENTO) {
    sp = SP.VIENTO;
    fuente = e.forzado === SP.VIENTO ? FUENTE_SP.NCU : FUENTE_SP.HSU;
    /* forzado por Modbus = bandera completa; si viene del viento, el objetivo lo
       da el módulo (sector parcial incluido, y con el lado ya fijado) */
    obj = (e.forzado === SP.VIENTO && this.stow === 0)
      ? sSol * Math.abs(cfg.spTilt[1])
      : rAb.objetivo;
    crit = CRIT.SEGURIDAD;

  /* 2 — SP3 NIEVE */
  } else if (e.nieve || e.forzado === SP.NIEVE) {
    sp = SP.NIEVE; fuente = e.forzado === SP.NIEVE ? FUENTE_SP.NCU : FUENTE_SP.HSU;
    obj = sSol * Math.abs(cfg.spTilt[3]); crit = CRIT.SEGURIDAD;

  /* 3 — SP4 LIMPIEZA */
  } else if (e.limpieza || e.forzado === SP.LIMPIEZA) {
    /* el interruptor de limpieza es una entrada física del armario de la NCU, así
       que su origen es el mismo que el de un forzado por Modbus */
    sp = SP.LIMPIEZA; fuente = FUENTE_SP.NCU;
    obj = cfg.spTilt[4]; crit = CRIT.SEGURIDAD;

  /* 4 — forzados genéricos (SP2/5/6/7) */
  } else if (e.forzado) {
    sp = e.forzado; fuente = FUENTE_SP.NCU;
    obj = cfg.spTilt[e.forzado]; crit = CRIT.SEGURIDAD;

  /* 5 — BATERÍA. Dos cosas distintas que caen en el mismo escalón:
     · la ESTRATEGIA (SOC < crítico) manda el seguidor a defensa y lo cuenta como
       no disponible — es el CASO 3 del estudio de disponibilidad;
     · los modos de baja capacidad del FIRMWARE (L1/L2/L3, umbrales configurables
       del propio TCU) que, por debajo de L2, congelan el seguimiento donde esté. */
  } else if (this.parked || this.bajaCapacidad === 3) {
    obj = signo(this.angulo || 1) * Math.abs(cfg.defensaTilt); crit = CRIT.BATERIA;
    fuente = FUENTE_SP.LOCAL;
  } else if (this.bajaCapacidad === 2) {
    obj = this.angulo; crit = CRIT.BATERIA;

  /* 6 — MANUAL. Con 40017 escrito, el operador está dando al motor a mano: la
     consigna se arrastra en esa dirección mientras el registro siga puesto, que es
     como se mueve un seguidor desde la toolbox. */
  } else if (this.modo === MODO.MANUAL) {
    if (this.jog) this.manual = clamp(this.manual + this.jog * K.SLEW_DPS * dt,
                                      this.cfgTcu.topeEste, this.cfgTcu.topeOeste);
    obj = this.manual; crit = CRIT.MANUAL;

  /* 7 — AUTO (o parado en OFF) */
  } else if (this.modo === MODO.OFF) {
    obj = this.angulo; crit = CRIT.INHIBIDO; inhibido = true;
  } else if (!ang.dia) {
    obj = this.cfgTcu.nightPos; crit = CRIT.NOCHE;
  } else if (this.p.canonEn(this.p.t.hora)) {
    /* EL ALGORITMO ES DEL MOTOR. Aquí no se decide el ángulo de seguimiento: se
       ejecuta el que ha calculado SolarGPT, con su backtracking y su política de
       cielo cubierto ya dentro. El gemelo pone lo que es suyo —la banda muerta en
       pulsos, el inclinómetro que miente, el motor que consume— pero no una segunda
       versión del algoritmo. */
    var C = this.p.canonEn(this.p.t.hora);
    obj = C.objetivo;
    crit = C.difusa ? CRIT.DIFUSA : (Math.abs(C.objetivo) < Math.abs(ang.real) - 1e-3
                                     ? CRIT.BACKTRACKING : CRIT.SEGUIMIENTO);
    this.difusaActiva = C.difusa; this.difusaAlpha = C.alpha;
    this.difusaTxt = C.difusa ? 'del motor canónico' : '';
    this.motorCanon = true;
  } else {
    obj = ang.sel; crit = ang.btActivo ? CRIT.BACKTRACKING : CRIT.SEGUIMIENTO;
    this.motorCanon = false;
  }

  /* ── CIELO CUBIERTO ────────────────────────────────────────────────────────
     La política de difusa solo puede tocar el ángulo cuando la decisión de arriba
     ha sido SEGUIR AL SOL. Si ha ganado cualquier otra —abanderamiento, nieve,
     limpieza, un forzado, la defensa por batería, manual, noche o el equipo en
     OFF— es protección o es una orden, y ahí no se optimiza: se obedece.

     Es la regla que SolarGPT cazó en producción al revés: la difusa corría DESPUÉS
     y con 90 km/h devolvía «abanderado» y θ=0° a la vez, porque el plano llano
     recogía un 2 % más. El tracker tumbado en pleno vendaval con el registro
     diciendo que estaba aparcado. Por eso aquí la difusa se pregunta primero si
     puede hablar, y casi siempre la respuesta es que no. */
  var protegido = (crit !== CRIT.SEGUIMIENTO && crit !== CRIT.BACKTRACKING) ||
                  this.repetidor || this.motorCanon;
  var rD = this.dif.paso(dt / 60, ang.ghi, obj, this.poaDe(ang), protegido);
  this.difusaActiva = rD.activa; this.difusaAlpha = rD.alpha; this.difusaTxt = rD.modo;
  if (rD.activa) { obj = rD.theta; crit = CRIT.DIFUSA; }

  /* el repetidor no tiene seguidor que mover: se queda plano y solo repite señal */
  if (this.repetidor) { obj = 0; crit = CRIT.INHIBIDO; inhibido = true; sp = SP.NINGUNA; }

  var top = clamp(obj, this.cfgTcu.topeEste, this.cfgTcu.topeOeste);
  if (top !== obj) crit = CRIT.LIMITE;
  this.objetivo = top; this.sp = sp; this.fuenteSp = fuente; this.criterio = crit;
  this.bt = (crit === CRIT.BACKTRACKING);
  return inhibido;
};

/* ---- motor: velocidad real, deadband y consumo ----
   Devuelve los Wh gastados en este paso, con el modelo elegido en la estrategia:
   la medición de Factiun (Wh/° = K0 + K1·|θ|, con el ángulo MEDIO del movimiento y
   tope de 50 W) o el consumo SUNNER en mA medios × tiempo de giro. */
TCU.prototype.mueve = function (dt, inhibido) {
  /* el error se calcula contra lo que el TCU MIDE, no contra dónde está la mesa: si
     el inclinómetro miente, el lazo persigue el objetivo equivocado y tan contento */
  var err = this.objetivo - this.angulo, E = this.p.cfg.estrategia;
  /* deadband en PULSOS, como el firmware: 45 normal (41060/41061) y 90 con alarma de
     baja capacidad (41063) — el propio equipo engorda el lazo cuando va justo de
     batería, que es la versión de fábrica del winter mode */
  var C = this.cfgTcu;
  var pulsos = this.bajaCapacidad > 0 ? C.dbPulsosBaja : C.dbPulsos;
  var dead = this.p.cfg.deadband != null ? this.p.cfg.deadband : pulsos / this.sensor.pulsosGrado;
  /* en seguimiento solo corrige si el error supera el deadband; en posición de
     seguridad va sin histéresis (la orden es de seguridad, no de precisión) */
  var urgente = (this.sp !== SP.NINGUNA) || this.criterio === CRIT.BATERIA;
  /* sin motor no hay movimiento: seta pulsada, alarma enclavada o modo que no manda */
  if (!this.motorHabilitado || inhibido ||
      (!urgente && Math.abs(err) < dead && this.moviendo === 0)) {
    this.moviendo = 0; this.iMotor = 0; this.vMotor = 0;
    this.tSinMoverse = 0;
    return 0;
  }
  /* LLEGADA: se da por llegado al entrar en la banda muerta, nunca en un umbral
     más fino que el propio ruido del sensor. Con un criterio de 0,02° y un ruido de
     0,04° el seguidor persigue su propio ruido: no llega jamás, sigue mandando
     micro-movimientos y acaba autodiagnosticándose un eje bloqueado. */
  var llegada = Math.max(dead * 0.5, 3 * this.sensor.ruidoRms, 2 / this.sensor.pulsosGrado);
  if (Math.abs(err) <= llegada) { this.moviendo = 0; this.iMotor = 0; this.vMotor = 0; this.tSinMoverse = 0; return 0; }

  var dir = signo(err), antes = this.anguloReal;
  var esperado = Math.min(Math.abs(err), K.SLEW_DPS * dt);   /* lo que se le MANDA girar */
  /* EL EJE ATASCADO ES FÍSICO: el motor tira, consume, y la mesa no se mueve. El bit
     de alarma no se pone aquí — lo deduce el firmware unas líneas más abajo. */
  if (!this.ejeAtascado) {
    var real = this.ejeDuro ? esperado * 0.2 : esperado;   /* el eje duro se arrastra */
    this.anguloReal = clamp(this.anguloReal + dir * real, C.topeEste, C.topeOeste);
  }
  var mov = Math.abs(this.anguloReal - antes);
  this.moviendo = dir;                    /* está MANDADO a moverse, se mueva o no */

  /* --- diagnóstico del firmware: ¿se está moviendo lo que debería? (41039 / 41065) ---
     La comparación es contra el paso MANDADO, no contra la velocidad máxima: si no,
     cualquier corrección pequeña —que por definición mueve poco— se diagnosticaría
     como eje bloqueado. Es justo el fallo que esconde un modelo sin sensor. */
  /* si lo que impide moverse es el TOPE MECÁNICO, no es un eje bloqueado: es un
     final de carrera, y el equipo lo sabe por sus propios límites (30006 bits 0 y 1) */
  var enTope = (dir > 0 && antes >= C.topeOeste - 1e-6) || (dir < 0 && antes <= C.topeEste + 1e-6);
  if (!enTope && esperado > 1e-3 && mov < esperado * 0.5) {
    this.tSinMoverse += dt;
    if (this.tSinMoverse >= C.evalMotorS) {
      this.velocidadBaja = true;          /* 30003.14 «motor moves at a lower speed» */
      this.tSinMoverse = 0;
      if (++this.reintentos > C.reintentos) {
        this.ejeBloqueado = true;         /* 30003.8, y queda enclavada */
        this.alarmaMotorEnclavada = true;
      }
    }
  } else { this.tSinMoverse = 0; this.velocidadBaja = false; }

  var medio = (this.anguloReal + antes) / 2, dtH = dt / 3600, wh;
  /* WINTER MODE (11.5b): el seguidor sigue yendo al mismo sitio, pero con un paso
     tan grueso que consume como si corrigiera 3 °/h en vez de 10 °/h. Se contabiliza
     igual que en el simulador de batería: sobre los grados EFECTIVOS, no sobre el
     recorrido real, y solo mientras se está siguiendo al sol (una orden de seguridad
     o una defensa por batería se ejecutan enteras, con winter mode o sin él). */
  var efec = mov;
  if (E.winter && this.sp === SP.NINGUNA && !this.parked) efec *= K.DEG_H_WINTER / K.DEG_H_NORMAL;
  /* el consumo NO se calcula aquí: lo da el módulo de gestión de batería (consumoTCU,
     copiado íntegro de bateria.html por el generador). Este simulador decide cuánto se
     mueve y en qué ángulo; cuántos Wh cuesta eso lo dice el canon. */
  wh = consumoTCU({ dtH: dtH, dia: true, mov: efec, pos: medio,
                    motorModel: this.p.cfg.motorModel, calefactada: false, tAmb: 20,
                    k0: K.MOT_K0, k1: K.MOT_K1,
                    vNom: K.V_NOM, slew: K.SLEW_DPS }).motor;
  /* con el eje en apuros el motor no consume menos: consume MÁS. Calado, corriente de
     calado y salta 41040; duro, corriente alta pero por debajo del disparo — que es
     lo que obliga al firmware a darse cuenta por la vía lenta. */
  if (this.ejeAtascado) wh = (this.p.cfg.iCalado / 1000) * this.vBat * dtH;
  else if (this.ejeDuro) wh = (this.p.cfg.iDuro / 1000) * this.vBat * dtH;

  this.energiaMotorHoy += wh * 3600; this.energiaMotorTotal += wh * 3600;   /* J */
  this.vMotor = this.vBat * 1000;
  var w = dtH > 0 ? wh / dtH : 0;
  this.iMotor = this.vBat > 1 ? (w / this.vBat) * 1000 : 0;                 /* mA */
  if (this.iMotor > this.iMotorPico) this.iMotorPico = this.iMotor;
  /* los finales de carrera los ve el TCU con SU medida, no con la mesa */
  this.limiteOeste = this.angulo >= C.topeOeste - 0.01;
  this.limiteEste = this.angulo <= C.topeEste + 0.01;
  return wh;
};

/* ═══ GESTIÓN DE BATERÍA — la misma que bateria.html ═══════════════════════════
   Balance en Wh sobre la capacidad del perfil, no en amperios-hora sueltos, con
   los cuatro elementos que hacen que el resultado se parezca al de planta:

     1. La carga entra por el POA de la posición REAL (transposición isotrópica),
        no por «hay sol». Abanderado o en defensa se carga menos, y ese es el
        coste oculto de cada abanderamiento.
     2. Techo de carga: con la estrategia activa la batería NO sube del SOC
        objetivo (80 %) salvo el día de carga completa (uno de cada cinco), que es
        lo que evita tenerla siempre al 100 % envejeciendo.
     3. Límite real de admisión: rendimiento de carga, C-rate seguro LiFePO4 según
        temperatura, JEITA por el lado caliente y cut-in del regulador.
     4. Consumo: electrónica + motor (medición Factiun o mA SUNNER) + calefactor
        de las versiones LT, que gasta pero desbloquea la carga en frío.       */
/* ── irradiancia del sitio y POA de un ángulo cualquiera ──
   Se calcula una sola vez por paso porque la usan dos: la política de difusa, para
   decidir si vale la pena tumbarse, y el balance de energía, para saber qué entra.
   La proporción de difusa sube con la nubosidad, que es exactamente de lo que va la
   política: con el cielo cerrado casi todo lo que llega es difusa. */
TCU.prototype.cielo = function (ang) {
  var m = this.p.meteo;
  var ghi = 1000 * Math.max(0, Math.sin(Math.max(0, ang.sol.el))) * m.transmitancia();
  /* el reparto entre directa y difusa NO se inventa: sale de Erbs, que es lo que
     usa el canon. Con el cielo cerrado da ~99 % de difusa, no el 72 % que daba la
     regla lineal que había aquí */
  this.sky = Cielo.descompon(ghi, ang.sol.el, this.p.t.dia);
  ang.ghi = ghi;
  return this.sky;
};
/* devuelve la función θ → POA que la política de difusa necesita para puntuar
   candidatos. La transposición es la canónica (poaAt, de bateria.html). */
TCU.prototype.poaDe = function (ang) {
  var s = this.sky, sol = ang.sol;
  return function (th) { return poaAt(th, sol.el, sol.az, s.bh, s.dhi, s.ghi); };
};

TCU.prototype.energia = function (dt, ang, whMotor) {
  var m = this.p.meteo, pf = this.perfil, E = this.p.cfg.estrategia;
  var dtH = dt / 3600, capWh = pf.wh;
  this.vBat = K.V_MIN + (this.soc / 100) * (K.V_MAX - K.V_MIN);

  /* temperaturas: siguen a la ambiente con inercia; la PCB, un poco por encima */
  var tAmb = m.tAmb();
  this.tBat += (tAmb - this.tBat) * Math.min(1, dt / 1800);
  this.tPcb += (tAmb + (this.moviendo ? 6 : 2) - this.tPcb) * Math.min(1, dt / 600);

  /* la irradiancia ya la calculó cielo() al principio del paso */
  var ghi = this.sky.ghi, dhi = this.sky.dhi, bh = this.sky.bh, dia = this.sky.dia;

  /* ── CONSUMO ──
     Tampoco se calcula aquí. La electrónica y el calefactor los da el mismo consumoTCU
     del módulo de batería; el motor entra ya hecho porque el movimiento lo decide este
     simulador (y porque un eje calado o duro consume lo que consume la avería, que es
     cosa del gemelo y no de la gestión de batería).
     La temperatura que decide el calefactor es la de la BATERÍA, no la ambiente: es la
     que el equipo mide y la que limita la carga. */
  var cons = consumoTCU({ dtH: dtH, dia: dia, mov: 0, pos: 0,
                          motorModel: this.p.cfg.motorModel,
                          calefactada: !!pf.heated, tAmb: this.tBat,
                          idleW: K.IDLE_W, sleepW: K.SLEEP_W });
  this.calefactor = cons.heat > 0;
  var whCal = cons.heat, tEf = cons.tEff, whBase = cons.base;
  var whCons = cons.total + whMotor;

  /* ── ENTRADA, según de qué come este TCU ── */
  var poaChg, pEntrada;
  if (pf.tipo === 'ac') {
    /* alterna: la fuente da su potencia nominal haya sol o no. Si se corta la red,
       el TCU pasa a vivir de la batería de respaldo — y el que no la lleva, se apaga. */
    this.acOk = !this.p.ncu.acFallo;
    poaChg = this.acOk ? 1000 : 0;
    /* el perfil de alterna del canon declara chgW = 0 («Grid (unlimited)»): no es que
       no dé potencia, es que no tiene un cargador con tope — da lo que se le pida */
    pEntrada = this.acOk ? (pf.chgW > 0 ? pf.chgW * K.ETA_CHG : (dtH > 0 ? whCons / dtH : 0)) : 0;
    this.vPanel = this.acOk ? 30000 : 0;
  } else {
    /* SP y STRING ven el mismo sol y el mismo ángulo; lo que cambia es el tamaño
       de la fuente. El panel auxiliar escala con la irradiancia que le llega; el
       string es tan grande que el regulador satura en su tope en cuanto amanece
       del todo, y solo se queda corto con muy poca luz. */
    /* la irradiancia la recoge la MESA, no lo que el TCU cree que mide */
    poaChg = poaAt(this.repetidor ? 0 : this.anguloReal, ang.sol.el, ang.sol.az, bh, dhi, ghi);
    if (m.nieve >= 0.02) poaChg *= 0.05;         /* panel o módulos nevados */
    var frac = pf.tipo === 'string' ? Math.min(poaChg / 150, 1) : Math.min(poaChg / 1000, 1);
    pEntrada = pf.chgW * frac * K.ETA_CHG;
    this.vPanel = (poaChg > 5 ? 30 + this.rnd.entre(-1, 1) : 0) * 1000;
  }

  /* instrumentación: la irradiancia y la POA de este paso quedan visibles para que
     se puedan analizar desde fuera sin duplicar aquí el modelo de meteo */
  this.ghi = ghi; this.dhi = dhi; this.poa = poaChg; this.pEntrada = pEntrada;

  /* ── ADMISIÓN de la batería: C-rate seguro y JEITA, y el cut-in del regulador ── */
  var whChg = 0, bloqueoT = false;
  if (this.ah > 0) {
    if ((dia || pf.tipo === 'ac') && tEf >= E.tMin && poaChg >= E.poaMin) {
      var pAdm = Math.min(pEntrada, cRateSafeLFP(tEf) * hotDerate(tEf) * capWh);
      whChg = Math.max(0, pAdm) * dtH;
    } else if (poaChg >= E.poaMin && tEf < E.tMin) bloqueoT = true;
  }

  /* ── TECHO: SOC objetivo, salvo el día de carga completa (uno de cada fcDays) ── */
  var diaIdx = Math.floor(this.p.t.epoch / 86400) - this.p.diaBase;
  this.cargaCompletaHoy = E.activa ? (((diaIdx % E.fcDays) + E.fcDays) % E.fcDays === E.fcDays - 1) : true;
  var techo = E.activa ? (this.cargaCompletaHoy ? 1.0 : E.socTgt / 100) : 1.0;
  this.techoSoc = techo * 100;

  if (this.ah > 0) {
    var socF = this.soc / 100;
    /* hueco disponible hasta el techo, contando que el consumo también hace sitio */
    var hueco = Math.max(0, techo - socF) * capWh + whCons;
    var whEf = Math.min(whChg, hueco);
    this.soc = clamp((socF + (whEf - whCons) / capWh) * 100, 0, 100);
    this.whCarga = whEf; this.whConsumo = whCons;
    this.iBat = (this.vBat > 1 && dtH > 0) ? ((whEf - whCons) / dtH / this.vBat) * 1000 : 0;
    this.iPanel = (this.vBat > 1 && dtH > 0) ? ((whEf / dtH) / this.vBat) * 1000 : 0;
  } else {
    /* sin batería (AC puro): no hay SoC que contar ni culombios que sumar */
    this.soc = this.acOk ? 100 : 0;
    this.iBat = 0;
    this.iPanel = this.acOk ? (pEntrada / Math.max(this.vBat, 1)) * 1000 : 0;
    this.whCarga = 0; this.whConsumo = whCons;
  }

  /* ── ESTRATEGIA: por debajo del SOC crítico el seguidor va a defensa y cuenta
     como NO DISPONIBLE. Rearme con +2 %, que es lo que evita el baile de entrar y
     salir cada paso al rozar el umbral. ── */
  if (E.activa && this.ah > 0) {
    if (!this.parked && this.soc < E.socCrit) this.parked = true;
    else if (this.parked && this.soc >= E.socCrit + 2) this.parked = false;
  } else this.parked = false;

  this.cargador = bloqueoT ? 2 : (whChg > 0 ? 3 : 1);
  this.relajacion = !this.moviendo && Math.abs(this.iBat) < 30;
  if (!dia && this.p.t.hora < 0.02) this.energiaMotorHoy = 0;                /* corte diario */
};

TCU.prototype.paso = function (dt) {
  /* sin batería y sin alterna no hay TCU: ni control ni radio. Es el escenario que
     distingue de verdad un equipo AC de uno autoalimentado. */
  this.sinAlimentacion = (this.perfil.tipo === 'ac' && this.p.ncu.acFallo && this.ah <= 0);
  if (this.sinAlimentacion) {
    this.moviendo = 0; this.iMotor = 0; this.soc = 0; this.iBat = 0; this.vPanel = 0;
    return;
  }
  var ang = angulos(this.p.loc, this.p.t.dia, this.p.t.hora);
  this.cielo(ang);            /* la irradiancia del sitio, UNA vez por paso */
  this.solar = { real: ang.real, bt: ang.bt, zen: ang.sol.zen * R2D, az: ang.sol.az * R2D, dia: ang.dia };
  /* el orden importa: primero se LEEN las entradas (medida analógica y línea binaria),
     después se decide con lo leído, y solo entonces se actúa */
  this.mide(dt);
  this.leeSeta(dt);
  var inhibido = this.decide(dt, ang);
  var whMotor = this.mueve(dt, inhibido);
  this.energia(dt, ang, whMotor);
  /* 30002.2: «tilt fuera de rango» compara la MEDIDA contra el límite SW más 5° */
  this.fueraRango = this.angulo > this.cfgTcu.topeOeste + 5 || this.angulo < this.cfgTcu.topeEste - 5;
  /* la sobrecorriente ENCLAVA: si solo mirase la corriente instantánea, el bit se
     borraría en el mismo paso en que el propio disparo corta el motor y la alarma no
     llegaría ni al siguiente ciclo de lectura del SCADA */
  if (this.iMotor > this.cfgTcu.iMotorMax) {
    this.sobrecorriente = true;
    this.alarmaMotorEnclavada = true;
  }
  if (this.online) this.ultimoContacto = this.p.t.epoch;
};

/* Alarmas y estado, en el mismo criterio que el SCADA y la toolbox:
   eje bloqueado, sobrecorriente, batería crítica, seta o fuera de rango ⇒ ALARMA;
   el resto de bits, system_ok=0 o desviación >5° ⇒ AVISO. */
TCU.prototype.alarmas = function () {
  var e = this.entradas(), conBat = this.ah > 0;
  return {
    seta: e.seta,
    motorEnclavado: this.alarmaMotorEnclavada,
    inclinometro: !this.sensor.ok,           /* 30004.5 «accelerometer is defective» */
    fueraRango: this.fueraRango,
    sinBateria: !conBat,                       /* 30002.10 «battery is not connected» */
    sinAlimentacion: !!this.sinAlimentacion,
    /* los umbrales de SoC solo tienen sentido si hay batería que descargar */
    socL1: conBat && this.soc < K.SOC_L1,
    socL2: conBat && this.soc < K.SOC_L2,
    socL3: conBat && this.soc < K.SOC_L3,
    socCritica: conBat && this.soc < 10,
    ejeBloqueado: this.ejeBloqueado,
    sobrecorriente: this.sobrecorriente,
    comNcu: !this.online,
    velocidadBaja: this.velocidadBaja,
    zigbee: !this.online
  };
};
TCU.prototype.desviacion = function () { return Math.abs(this.objetivo - this.angulo); };
TCU.prototype.systemOk = function () {
  var a = this.alarmas();
  for (var k in a) if (a[k]) return false;
  return true;
};
TCU.prototype.salud = function () {
  if (!this.online || this.sinAlimentacion) return 'offline';
  var a = this.alarmas();
  if (a.ejeBloqueado || a.sobrecorriente || a.socCritica || a.socL3 || a.seta || a.fueraRango ||
      a.motorEnclavado || a.inclinometro) return 'alarma';
  if (!this.systemOk() || this.desviacion() > 5) return 'aviso';
  return 'ok';
};
TCU.prototype.modoTxt = function () { return MODO_TXT[this.modo]; };
TCU.prototype.estadoTxt = function () {
  if (this.sinAlimentacion) return 'sin alimentación';
  if (!this.online) return 'sin comunicación';
  if (this.seta) return 'SETA pulsada';
  if (this.alarmaMotorEnclavada) return 'motor enclavado';
  if (this.sp) return SP_TXT[this.sp];
  if (this.parked) return 'defensa por batería';
  return CRIT_TXT[this.criterio];
};

/* ═══════════════════ NCU — controlador de red ═══════════════════ */
function NCU(planta) {
  this.p = planta;
  this.paro = false;        /* 30100.13 «Stop button» — NO es una seta: ver nota */                       /* seta de emergencia del armario */
  this.limpieza = [];                      /* 10 interruptores, uno por grupo */
  for (var i = 0; i < 10; i++) this.limpieza.push(false);
  this.forzados = {};                      /* {sp: máscara de 10 bits por grupo} */
  for (var s = 1; s <= 7; s++) this.forzados[s] = 0;
  this.upsFallo = false; this.upsBateriaBaja = false;
  this.acFallo = false;                    /* corte de alterna en planta: solo lo notan los TCU tipo AC */
  this.gw1Alarma = false; this.gw2Alarma = false;
  this.nivelVientoGlobal = 0; this.vientoMax = 0;   /* m/s de la HSU que más sopla */
  this.dirVientoMax = 180;                          /* y de dónde viene, para el eje A */
  this.alarmaViento = false; this.alarmaNieve = false;
  this.alarmaRacha = false; this.falloWs = false; this.falloSs = false;
  this.vientoInvertido = false;
  this.timeoutPosicion = 3600;             /* 40080: vuelta a automático (s) */
}
/* Devuelve la safe position forzada a un grupo (la de más prioridad si hay varias). */
NCU.prototype.forzadoDe = function (grupo) {
  var bit = 1 << (grupo - 1), orden = [SP.VIENTO, SP.NIEVE, SP.LIMPIEZA, 2, 5, 6, 7];
  for (var i = 0; i < orden.length; i++) if (this.forzados[orden[i]] & bit) return orden[i];
  return 0;
};
NCU.prototype.fuerza = function (sp, grupo, on) {
  var bit = 1 << (grupo - 1);
  this.forzados[sp] = on ? (this.forzados[sp] | bit) : (this.forzados[sp] & ~bit);
};
NCU.prototype.paso = function () {
  /* la NCU se queda con el nivel MÁS ALTO de todas sus HSU y con el «o» de sus alarmas */
  var n = 0, av = false, an = false, ar = false, fw = false, fs = false, este = false, vmax = 0, dmax = 180;
  var H = this.p.hsus;
  for (var i = 0; i < H.length; i++) {
    var h = H[i];
    if (!h.online) { fw = true; fs = true; continue; }
    if (h.nivel > n) n = h.nivel;
    /* para decidir un abanderamiento, el peor dato es el que cuenta (CONTRATO.md) */
    if (Math.max(h.viento, h.racha) > vmax) { vmax = Math.max(h.viento, h.racha); dmax = h.dir; }
    av = av || h.alarmaViento(); an = an || h.alarmaNieve(); ar = ar || h.alarmaRacha();
    fw = fw || h.falloVientoSensor; fs = fs || h.falloNieveSensor;
    /* dirección de viento del ESTE (45°–135°): el R7 lo republica como «inverted wind» */
    if (h.nivel > 0 && h.dir > 45 && h.dir < 135) este = true;
  }
  this.nivelVientoGlobal = n; this.vientoMax = vmax; this.dirVientoMax = dmax;
  this.alarmaViento = av; this.alarmaNieve = an;
  this.alarmaRacha = ar; this.falloWs = fw; this.falloSs = fs; this.vientoInvertido = este;
};

/* ═══════════════════ meteorología de la planta ═══════════════════ */
function Meteo() {
  this.nubes = 15;        /* % */
  this.viento = 3;        /* m/s medios */
  this.rachas = 0.2;      /* factor de racha 0..1 */
  this.dirViento = 200;   /* ° */
  this.nieve = 0;         /* m acumulados */
  this.tMedia = 14; this.tAmplitud = 9;
  this.p = null;
}
Meteo.prototype.transmitancia = function () { return Math.max(0.08, 1 - (this.nubes / 100) * 0.85); };
Meteo.prototype.tAmb = function () {
  /* día sinusoidal con mínimo al alba y máximo a media tarde */
  var h = this.p ? this.p.t.hora : 12, d = this.p ? this.p.t.dia : 172;
  var est = -8 * Math.cos(2 * Math.PI * (d - 15) / 365);
  return this.tMedia + est + this.tAmplitud * Math.sin(2 * Math.PI * (h - 9) / 24) - (this.nubes / 100) * 3;
};

/* ═══════════════════ la planta ═══════════════════ */
/* La trayectoria canónica, si la hay, consultada por hora civil. Devuelve null
   cuando no hay motor: es lo que hace que el gemelo caiga a su modelo de navegador
   —y lo que la interfaz enseña, para que nadie confunda uno con otro. */
Planta.prototype.canonEn = function (hora) {
  var c = this.cfg.canon;
  return (c && c.hayTrayectoria && c.hayTrayectoria()) ? c.en(hora) : null;
};

function Planta(cfg) {
  cfg = cfg || {};
  this.cfg = {
    nTcu: cfg.nTcu || 24,
    nHsu: cfg.nHsu || 2,
    nRep: cfg.nRep || 1,
    grupos: cfg.grupos || 4,
    deadband: cfg.deadband != null ? cfg.deadband : K.HYST_DEG,
    iMotorMax: cfg.iMotorMax || 7000,        /* 41040: sobrecorriente por software (mA) */
    iCalado: cfg.iCalado || 9000,            /* corriente de calado con el eje atascado (mA) */
    iDuro: cfg.iDuro || 5000,                /* corriente con el eje duro: alta, pero sin disparar */
    perfil: cfg.perfil || F.perfilPorDefecto, /* alimentación y batería (SP · STRING · AC) */
    /* modelo de consumo del motor: 'factiun' (Wh/° medidos) o los mA medios de
       SUNNER a 25,6 V (2500 / 3250 / 4000), como en bateria.html */
    motorModel: cfg.motorModel || 'factiun',
    estrategiaViento: cfg.estrategiaViento || 'B2',   /* A1 · A2 · B1 · B2 */
    /* averías por tasa: apagadas salvo que se pidan */
    averias: cfg.averias || { activo: false, comsMtbfH: 0, comsMin: 10,
                              duroMtbfD: 0, caladoMtbfD: 0, reparaH: 8, desajusteSig: 0 },
    politicaDifusa: cfg.politicaDifusa || 'none',     /* none · flat · continuous · limited · poa_switch */
    /* Trayectoria del ángulo calculada por el MOTOR canónico (SolarGPT, POST /tracker).
       Si está, el gemelo la EJECUTA y no calcula ni el backtracking ni la política de
       cielo cubierto: el algoritmo es de allí. Si no está, se usa el modelo del
       navegador —que es de primer orden— y se dice en pantalla. */
    canon: cfg.canon || null,
    /* ESTRATEGIA de gestión de batería — los mismos parámetros y los mismos valores
       por defecto que el simulador de batería (estrategia oficial SUNNER) */
    estrategia: {
      activa:  cfg.estrategia && cfg.estrategia.activa  != null ? cfg.estrategia.activa  : true,
      socCrit: cfg.estrategia && cfg.estrategia.socCrit != null ? cfg.estrategia.socCrit : 30,  /* defensa (%) */
      winter:  cfg.estrategia && cfg.estrategia.winter  != null ? cfg.estrategia.winter  : false,
      tMin:    cfg.estrategia && cfg.estrategia.tMin    != null ? cfg.estrategia.tMin    : 0,   /* T mínima de carga (°C) */
      poaMin:  cfg.estrategia && cfg.estrategia.poaMin  != null ? cfg.estrategia.poaMin  : 50,  /* cut-in del regulador (W/m²) */
      /* El techo de SOC y cada cuánto se calibra NO son valores sueltos: son la
         política canónica del modo (verano 80 %/5 d · invierno 90 %/3 d, de tcu.py).
         Con politicaAuto los toma del canon según el modo; se pone en false en cuanto
         alguien mueve el valor a mano para hacer un «¿y si…?». */
      politicaAuto: (cfg.estrategia && cfg.estrategia.politicaAuto != null)
        ? cfg.estrategia.politicaAuto
        : !(cfg.estrategia && (cfg.estrategia.socTgt != null || cfg.estrategia.fcDays != null)),
      socTgt:  cfg.estrategia && cfg.estrategia.socTgt  != null ? cfg.estrategia.socTgt  : F.politica.verano.socMax,
      fcDays:  cfg.estrategia && cfg.estrategia.fcDays  != null ? cfg.estrategia.fcDays  : F.politica.verano.calibDias
    },
    defensaTilt: cfg.defensaTilt != null ? cfg.defensaTilt : 55,
    /* tilt de cada posición de seguridad (registros 41044…41056 de la TCU) */
    spTilt: cfg.spTilt || [0, 55, 0, 55, 0, 0, 0, 0],
    wordOrder: cfg.wordOrder || 'big'
  };
  this.loc = cfg.loc || { n: 'Gorraiz', lat: 42.81, lon: -1.58, tz: 1, dst: true };
  this.t = { dia: cfg.dia || 172, hora: cfg.hora != null ? cfg.hora : 9, epoch: Math.floor(Date.now() / 1000) };
  this.tResto = 0;
  this.rndAv = new Rnd(90210);      /* averías por tasa: con semilla, para poder repetir */
  /* día 0 del contador de cargas completas: la de «una cada cinco días» se cuenta
     desde que arranca la planta, igual que en el simulador de batería */
  this.diaBase = Math.floor(this.t.epoch / 86400);
  this.meteo = new Meteo(); this.meteo.p = this;
  this.ncu = new NCU(this);
  this.hsus = []; this.tcus = [];
  var i;
  for (i = 1; i <= this.cfg.nHsu; i++) this.hsus.push(new HSU(i, this));
  for (i = 1; i <= this.cfg.nTcu; i++) {
    this.tcus.push(new TCU(i, this, { grupo: 1 + ((i - 1) % this.cfg.grupos) }));
  }
  for (i = 1; i <= this.cfg.nRep; i++) {
    this.tcus.push(new TCU(this.cfg.nTcu + i, this, { grupo: 1, repetidor: true }));
  }
  this.ncu.paso();
  /* La planta no acaba de nacer: lleva funcionando. Se arranca a cada seguidor en el
     ángulo que le tocaría a esta hora — si no, una planta creada a mediodía sale
     entera en posición nocturna y con desviación de 50°, o sea toda en aviso, hasta
     que la simulación tarda diez minutos en recuperarla. */
  var ang0 = angulos(this.loc, this.t.dia, this.t.hora);
  for (i = 0; i < this.tcus.length; i++) {
    if (!this.tcus[i].repetidor) {
      var t0 = this.tcus[i];
      t0.anguloReal = t0.angulo = t0.objetivo = ang0.sel;
      t0.sensor.crudo = t0.sensor.filtrado = ang0.sel;
    }
  }
  this.repartaDesajustes(this.cfg.averias && this.cfg.averias.desajusteSig);
  /* y un paso mínimo para que el estado derivado (sol, objetivo, alarmas) exista */
  this.paso(0.001);
}

/* Un paso de simulación. dt en segundos SIMULADOS (no de reloj de pared): así el
   acelerador de la interfaz no cambia la física, solo cuánto tiempo pasa por tick. */
/* Política de carga del modo activo. El winter mode canónico (tcu.py) no es solo
   mover menos: sube el techo de SOC al 90 % y calibra cada 3 días en vez de cada 5,
   porque en invierno hay menos sol y conviene aprovechar el que hay. */
Planta.prototype.aplicaPolitica = function () {
  var E = this.cfg.estrategia;
  if (!E.politicaAuto) return;
  var p = F.politica[E.winter ? 'invierno' : 'verano'];
  E.socTgt = p.socMax; E.fcDays = p.calibDias;
};

Planta.prototype.paso = function (dt) {
  this.aplicaPolitica();
  this.t.hora += dt / 3600;
  while (this.t.hora >= 24) { this.t.hora -= 24; this.t.dia = (this.t.dia % 365) + 1; }
  /* el epoch avanza en segundos ENTEROS y guarda aparte lo que sobra: las marcas de
     tiempo del mapa son U32 de segundos, y un epoch con decimales hace que dos
     lecturas idénticas salgan distintas al codificarlas */
  this.tResto += dt;
  var ent = Math.floor(this.tResto);
  if (ent) { this.t.epoch += ent; this.tResto -= ent; }
  this.averiasPaso(dt);
  var i;
  for (i = 0; i < this.hsus.length; i++) this.hsus[i].paso(dt);
  this.ncu.paso();
  /* los TCU sin comunicación SIGUEN funcionando: pierden la Zigbee, no la cabeza.
     Lo que se congela es su marca de último contacto, que es lo que ve el SCADA. */
  for (i = 0; i < this.tcus.length; i++) this.tcus[i].paso(dt);
};

Planta.prototype.tcu = function (id) {
  for (var i = 0; i < this.tcus.length; i++) if (this.tcus[i].id === id) return this.tcus[i];
  return null;
};
Planta.prototype.seguidores = function () {
  return this.tcus.filter(function (t) { return !t.repetidor; });
};
/* Resumen de flota con el mismo vocabulario que el SCADA. */
Planta.prototype.resumen = function () {
  var r = { ok: 0, aviso: 0, alarma: 0, offline: 0, total: 0, socMin: 100, socMedio: 0,
            moviendo: 0, noDisponibles: 0 };
  var T = this.tcus;
  for (var i = 0; i < T.length; i++) {
    var t = T[i]; r.total++; r[t.salud()]++;
    r.socMin = Math.min(r.socMin, t.soc); r.socMedio += t.soc;
    if (t.moviendo) r.moviendo++;
    /* «no disponible» en el sentido del estudio: en defensa por batería, sin seguir al sol */
    if (t.parked) r.noDisponibles++;
  }
  r.socMedio /= Math.max(1, T.length);
  return r;
};

/* ═══════════════════ imagen de registros ═══════════════════
   Cada función devuelve {dirección: valor de 16 bits} con las direcciones
   ABSOLUTAS del mapa, que es como las pediría un maestro Modbus. */

/* -- TCU, su mapa propio (RS485, lo que lee la toolbox en directo) -- */
Planta.prototype.regsTCU = function (t) {
  var wo = this.cfg.wordOrder, R = {}, a = t.alarmas(), p;
  function pon(dir, v) { R[dir] = v; }
  function pon32(dir, par) { R[dir] = par[0]; R[dir + 1] = par[1]; }

  pon(30000, bits({ tipo: [0, 3], hw: [4, 7], fw: [8, 15] },
                  { tipo: TIPO_REG[t.perfil.tipo], hw: 3, fw: t.fwMenor * 16 + t.fwParche }));
  pon(30001, bits({ bt: [0, 0], baja: [1, 2], com: [3, 4], inv: [6, 6], dia: [7, 7],
                    modo: [8, 9], reed: [11, 11], ble: [12, 12], sp: [13, 15] },
                  { bt: t.bt ? 1 : 0, baja: t.bajaCapacidad, com: t.comisionado,
                    inv: this.ncu.vientoInvertido ? 1 : 0, dia: t.solar.dia ? 1 : 0,
                    modo: t.modo, reed: 0, ble: 0, sp: t.sp }));
  pon(30002, bits({ rango: [2, 2], seta: [4, 4], tsensor: [6, 6], cfg: [7, 7], xbee: [8, 8],
                    com: [9, 9], nobat: [10, 10], l2: [11, 11], l3: [12, 12], l1: [13, 13] },
                  { rango: a.fueraRango ? 1 : 0, seta: a.seta ? 1 : 0, xbee: a.zigbee ? 1 : 0,
                    nobat: a.sinBateria ? 1 : 0,
                    l2: a.socL2 ? 1 : 0, l3: a.socL3 ? 1 : 0, l1: a.socL1 ? 1 : 0 }));
  pon(30003, bits({ reloj: [2, 2], corto: [4, 4], sobre: [5, 5], eje: [8, 8], ncu: [12, 12],
                    lento: [14, 14], driver: [15, 15] },
                  { sobre: a.sobrecorriente ? 1 : 0, eje: a.ejeBloqueado ? 1 : 0,
                    ncu: a.comNcu ? 1 : 0, lento: a.velocidadBaja ? 1 : 0 }));
  pon(30004, bits({ flash: [2, 2], esp32: [3, 3], xbee: [4, 4], accel: [5, 5], rtc: [6, 6], mcu2: [7, 7] },
                  { accel: a.inclinometro ? 1 : 0 }));
  /* el bit 8 de 30005 es el resumen de 30004: «al menos un IC declarado defectuoso» */
  pon(30005, bits({ vmot_lo: [0, 0], vmot_hi: [1, 1], bus_lo: [2, 2], bus_hi: [3, 3],
                    pcb_lo: [4, 4], pcb_hi: [5, 5], ic: [8, 8] },
                  { vmot_lo: t.vBat < 22 ? 1 : 0, vmot_hi: t.vBat > 33 ? 1 : 0,
                    bus_lo: t.vBat < 22 ? 1 : 0, bus_hi: t.vBat > 33 ? 1 : 0,
                    pcb_lo: t.tPcb < -30 ? 1 : 0, pcb_hi: t.tPcb > 70 ? 1 : 0,
                    ic: R[30004] ? 1 : 0 }));
  pon(30006, bits({ oeste: [0, 0], este: [1, 1], socNo: [6, 6], calef: [9, 9],
                    relax: [10, 10], motor: [11, 11], ok: [15, 15] },
                  { oeste: t.limiteOeste ? 1 : 0, este: t.limiteEste ? 1 : 0,
                    socNo: t.bajaCapacidad >= 2 ? 1 : 0, calef: t.calefactor ? 1 : 0,
                    relax: t.relajacion ? 1 : 0, motor: t.motorHabilitado ? 0 : 1,
                    ok: t.systemOk() ? 1 : 0 }));
  pon(30010, s16(t.moviendo * K.SLEW_DPS * 1000));            /* °/s ×1000 */
  pon(30011, u16(Math.abs(t.iMotor)));
  pon32(30015, u32(t.energiaMotorTotal, wo));
  pon(30020, t.moviendo === 0 ? 0 : (t.moviendo > 0 ? 0x0001 : 0x0002));
  pon(30030, u16(t.zbAddr));
  pon(30031, u16((t.online ? 0 : 0x0100) | t.zbCanal));

  /* reloj en BCD: [mes|año] [hora|día] [seg|min] */
  var f = this.fechaSim();
  pon(30076, (bcd(f.ano) << 8) | bcd(f.mes)); pon(30077, (bcd(f.dia) << 8) | bcd(f.hora)); pon(30078, (bcd(f.min) << 8) | bcd(f.seg));
  pon(30079, (bcd(f.ano) << 8) | bcd(f.mes)); pon(30080, (bcd(f.dia) << 8) | bcd(f.hora)); pon(30081, (bcd(f.min) << 8) | bcd(f.seg));

  pon(30082, t.moviendo === 0 ? 0 : (t.moviendo > 0 ? 0x0011 : 0x0022));
  pon(30083, u16(t.vMotor));
  pon(30084, u16(Math.abs(t.iMotor)));
  pon(30085, u16(t.iMotorPico));
  pon32(30086, u32(t.energiaMotorHoy, wo));
  pon32(30088, u32(t.energiaMotorTotal, wo));
  pon(30091, u16(t.vBat * 1000));
  pon(30092, u16(t.vPanel));
  pon(30093, u16(t.iPanel));
  pon(30094, u16(t.vBat * 1000));
  pon(30095, s16(t.iBat));
  pon(30096, ((Math.round(t.soh) & 0xFF) << 8) | (Math.round(t.soc) & 0xFF));   /* SoH alto · SoC bajo */
  pon(30097, s16(t.tBat * 10));
  pon(30098, s16(t.tPcb * 10));
  pon(30099, u16(t.ah * 1000 * t.soc / 100));
  pon(30100, u16(t.ah * 1000));
  pon(30101, u16(t.ciclos));
  pon(30102, u16(t.diasPreservacion));
  pon(30110, s16((t.objetivo - t.angulo) * 10));
  pon(30111, s16(t.angulo * 10));
  pon(30112, s16(t.objetivo * 10));
  pon(30113, u16(t.criterio));
  pon(30114, u16(t.fuenteSp));
  pon(30115, s16(t.solar.zen * 100));
  pon(30116, u16(((t.solar.az + 360) % 360) * 100));
  pon(30117, s16(t.solar.real * 100));
  pon(30118, s16(t.solar.bt * 100));
  pon(30146, u16(Math.abs(t.moviendo) * K.SLEW_DPS * 1000));
  pon(30153, u16(t.cargador));
  pon(30155, R[30006]);

  /* información estática */
  pon(30300, R[30000]);
  pon(30301, u16(t.fwMayor * 1000 + t.fwMenor)); pon(30302, u16(t.fwParche));
  pon(30306, 3); pon32(30310, u32(t.mac >>> 0, wo));
  pon(30326, 2024); pon(30329, 3);
  /* nº de serie en ASCII, dos caracteres por registro y de atrás hacia delante */
  var s = ('                  ' + t.serie).slice(-18);
  for (var c = 0; c < 9; c++) {
    pon(30314 + c, (s.charCodeAt(16 - c * 2) << 8) | s.charCodeAt(17 - c * 2));
  }

  /* configuración que el simulador respeta de verdad (el resto del bloque 41xxx
     lo sirve el visor con su valor por defecto documentado) */
  var sp = t.cfgTcu.spTilt.length ? t.cfgTcu.spTilt : this.cfg.spTilt;
  for (var k = 1; k <= 7; k++) {
    if (k === 6) continue;                                  /* el mapa salta la 6 */
    pon32(41042 + k * 2, f32((sp[k] || 0) * D2R, wo));       /* 41044, 41046, … en rad */
  }
  pon(41081, u16((K.SOC_L3 << 8) | K.SOC_L2));

  /* configuración de las ENTRADAS y del motor: ahora estos registros no son adorno,
     son los que el simulador está usando de verdad para medir y para moverse */
  /* La configuración se publica desde la del EQUIPO, no desde las constantes de la
     planta: si alguien le ha escrito un registro, al releerlo tiene que salir lo que
     escribió. Media puesta en marcha consiste justo en eso. */
  var C = t.cfgTcu, pg = t.sensor.pulsosGrado;
  pon32(41058, f32(t.sensor.offsetCfg * D2R, wo));        /* offset del inclinómetro */
  pon(41037, s16(Math.round(C.topeOeste * pg)));          /* límite oeste (pulsos) */
  pon(41038, s16(Math.round(C.topeEste * pg)));           /* límite este (pulsos) */
  pon(41039, u16(C.evalMotorS * 1000));                   /* ventana de evaluación (ms) */
  pon(41040, u16(C.iMotorMax));                           /* sobrecorriente software (mA) */
  pon32(41042, f32(C.nightPos * D2R, wo));                /* posición nocturna */
  pon(41060, u16(C.dbPulsos)); pon(41061, u16(C.dbPulsos));
  pon(41062, u16(C.dbPulsosBaja)); pon(41063, u16(C.dbPulsosBaja));
  pon(41065, u16(C.reintentos));
  pon(41067, u16(C.velSinCarga * 1000));                  /* velocidad en vacío (m°/s) */
  for (var jj = 0; jj < 4; jj++) pon(40008 + jj, u16(C.jeita[jj] * 10));
  pon(40035, u16(C.heaterT * 10));
  pon(40017, u16(t.jog < 0 ? 1 : (t.jog > 0 ? 2 : 0)));

  /* y lo que se le haya escrito y no tenga modelo propio se devuelve tal cual: un
     registro que no se relee es un registro que no se puede verificar */
  for (var d in t.escrito) {
    var dn = +d;
    if (R[dn] == null) { var vv = t.escrito[d]; for (var q = 0; q < vv.length; q++) R[dn + q] = u16(vv[q]); }
  }
  return R;
};

/* -- HSU, su mapa PROPIO (R23, direcciones 30000+ de su propio espacio).
   Ojo: no es el bloque compacto que republica la NCU en 30200+ — ese va aparte,
   con otra disposición, en regsNCU(). Confundirlos es el error clásico. -- */
Planta.prototype.regsHSU = function (h) {
  var wo = this.cfg.wordOrder, R = {}, par;
  R[30000] = u16(0x2317);                                        /* ProductId + SoftwareId */
  R[30001] = bits({ nivel: [0, 2], dir: [8, 10] },
                  { nivel: h.nivel, dir: Math.floor(((h.dir + 22.5) % 360) / 45) });
  R[30002] = bits({ ws: [0, 0], ss: [1, 1], pira: [2, 2], temp: [3, 3], bat: [4, 4],
                    granizo: [5, 5], nieve: [6, 6], lluvia: [7, 7], viento: [9, 9],
                    racha: [10, 10] },
                  { ws: h.falloVientoSensor ? 1 : 0, ss: h.falloNieveSensor ? 1 : 0,
                    nieve: h.alarmaNieve() ? 1 : 0, viento: h.alarmaViento() ? 1 : 0,
                    racha: h.alarmaRacha() ? 1 : 0 });
  par = f32(h.viento, wo); R[30003] = par[0]; R[30004] = par[1];
  par = f32(h.dir, wo);    R[30005] = par[0]; R[30006] = par[1];
  par = f32(h.nieve, wo);  R[30007] = par[0]; R[30008] = par[1];
  R[30009] = 0;                                                   /* pluviómetro mm/h */
  R[30010] = kx10(this.meteo.tAmb());                             /* temperatura exterior K×10 */
  R[30011] = u16(550 + this.meteo.nubes * 3);                     /* HR %×10 */
  par = u32(h.ghi * 100, wo); R[30012] = par[0]; R[30013] = par[1];
  R[30021] = u16(h.vBat);
  par = f32(h.racha, wo); R[30022] = par[0]; R[30023] = par[1];   /* muestra instantánea */
  par = f32(h.dir, wo);   R[30024] = par[0]; R[30025] = par[1];
  R[30026] = u16((this.meteo.tAmb() + 273.15));                   /* temperatura interna K */
  R[30027] = u16(h.vBat); R[30028] = u16(h.ghi > 5 ? 13800 : 0);
  R[30031] = u16(2000 - h.nieve * 1000);                          /* distancia medida (mm) */
  return R;
};

/* -- NCU: sus registros propios + la caché donde republica TCUs y HSUs -- */
Planta.prototype.regsNCU = function () {
  var wo = this.cfg.wordOrder, R = {}, n = this.ncu, i, j, par;

  R[30002] = bits({ viento: [1, 1], nivel: [2, 4], nieve: [5, 5], racha: [6, 6], ws: [7, 7], ss: [8, 8] },
                  { viento: n.alarmaViento ? 1 : 0, nivel: n.nivelVientoGlobal,
                    nieve: n.alarmaNieve ? 1 : 0, racha: n.alarmaRacha ? 1 : 0,
                    ws: n.falloWs ? 1 : 0, ss: n.falloSs ? 1 : 0 });
  var di = { BATTERY_LOW: n.upsBateriaBaja ? 1 : 0, UPS_POWER_FAULT: n.upsFallo ? 1 : 0, seta: n.paro ? 1 : 0 };
  var wDi = (di.BATTERY_LOW << 0) | (di.UPS_POWER_FAULT << 1) | (di.seta << 13);
  for (i = 0; i < 10; i++) if (n.limpieza[i]) wDi |= 1 << (3 + i);
  R[30100] = wDi & 0xFFFF;
  R[30101] = bits({ bat: [0, 0], gw1: [4, 4], gw2: [5, 5] },
                  { bat: n.upsBateriaBaja ? 1 : 0, gw1: n.gw1Alarma ? 1 : 0, gw2: n.gw2Alarma ? 1 : 0 });
  par = u32(this.t.epoch, wo); R[30104] = par[0]; R[30105] = par[1];

  /* forzados y modos por grupo (bloque 40000+, escritura) */
  for (i = 1; i <= 7; i++) R[40000 + i] = n.forzados[i] & 0x3FF;
  /* auto_mode / manual_mode: se reconstruyen del estado real de la flota, no de lo
     último que se escribió — si alguien pasa un equipo a mano, aquí se nota */
  var mAuto = 0, mMan = 0;
  for (i = 0; i < this.tcus.length; i++) {
    var tt = this.tcus[i], bg = 1 << (tt.grupo - 1);
    if (tt.modo === MODO.AUTO) mAuto |= bg; else if (tt.modo === MODO.MANUAL) mMan |= bg;
  }
  R[40070] = u16(mAuto); R[40071] = u16(mMan);
  var auto = 0, man = 0;
  for (i = 0; i < this.tcus.length; i++) {
    var t = this.tcus[i], bit = 1 << (t.grupo - 1);
    if (t.modo === MODO.AUTO) auto |= bit; else if (t.modo === MODO.MANUAL) man |= bit;
  }
  R[40070] = auto; R[40071] = man; R[40080] = u16(n.timeoutPosicion);

  /* bloque compacto de cada TCU: 22 registros a partir de 30500 (mapa R7) */
  for (i = 0; i < this.tcus.length; i++) {
    var c = this.tcus[i], b = 30500 + i * 22, al = c.alarmas();
    R[b + 1] = bits({ bt: [0, 0], sleep: [1, 2], dia: [7, 7], modo: [8, 9], sp: [13, 15] },
                    { bt: c.bt ? 1 : 0, sleep: c.bajaCapacidad, dia: c.solar.dia ? 1 : 0,
                      modo: c.modo, sp: c.sp });
    R[b + 2] = bits({ rango: [2, 2], seta: [4, 4], zigbee: [8, 8], l2: [11, 11], l3: [12, 12],
                      l1: [13, 13], crit: [14, 14] },
                    { rango: al.fueraRango ? 1 : 0, seta: al.seta ? 1 : 0, zigbee: al.zigbee ? 1 : 0,
                      l2: al.socL2 ? 1 : 0, l3: al.socL3 ? 1 : 0, l1: al.socL1 ? 1 : 0,
                      crit: al.socCritica ? 1 : 0 });
    R[b + 3] = bits({ reloj: [2, 2], corto: [4, 4], sobre: [5, 5], eje: [8, 8], lento: [14, 14] },
                    { sobre: al.sobrecorriente ? 1 : 0, eje: al.ejeBloqueado ? 1 : 0,
                      lento: al.velocidadBaja ? 1 : 0 });
    R[b + 4] = bits({ oeste: [0, 0], este: [1, 1], motor: [11, 11], ok: [15, 15] },
                    { oeste: c.limiteOeste ? 1 : 0, este: c.limiteEste ? 1 : 0,
                      motor: c.motorHabilitado ? 0 : 1, ok: c.systemOk() ? 1 : 0 });
    R[b + 5] = u16(c.vPanel);
    par = f32(c.angulo * D2R, wo); R[b + 6] = par[0]; R[b + 7] = par[1];
    R[b + 8] = u16(Math.abs(c.iMotor)); R[b + 9] = u16(c.iMotorPico);
    par = f32(c.objetivo * D2R, wo); R[b + 10] = par[0]; R[b + 11] = par[1];
    R[b + 12] = s16(c.iPanel);
    R[b + 13] = Math.round(c.soc) & 0xFF;
    R[b + 16] = u16(c.vBat * 1000);
    R[b + 18] = s16(c.iBat);
    R[b + 19] = kx10(c.tPcb);
    R[b + 20] = kx10(c.tBat);
    R[b + 21] = Math.round(c.soh) & 0xFF;
    par = u32(c.ultimoContacto, wo);
    R[29500 + i * 2] = par[0]; R[29500 + i * 2 + 1] = par[1];

    /* bloque TCU COMPLETO: 50 registros desde 50000, donde la NCU deja todo lo que
       le saca a cada TCU (el compacto de 30500 es solo el resumen). Las escalas son
       las que declara el R7 para este bloque: tilt en Deg×10 y temperaturas en °C
       —no en K×10 como el compacto—, que es una de sus trampas. */
    var q = 50000 + i * 50, rt = this.regsTCU(c);
    R[q + 3] = 0;
    R[q + 4] = rt[30001]; R[q + 5] = rt[30002]; R[q + 6] = rt[30003];
    R[q + 7] = rt[30004]; R[q + 8] = rt[30155]; R[q + 9] = rt[30006];
    R[q + 10] = s16(c.angulo * 10); R[q + 11] = s16(c.objetivo * 10);
    R[q + 12] = al.fueraRango ? 1 : 0;
    R[q + 13] = c.sp ? (1 << (c.sp - 1)) : 0;
    R[q + 14] = rt[30082];
    R[q + 15] = u16(c.vMotor); R[q + 16] = u16(Math.abs(c.iMotor)); R[q + 17] = u16(c.iMotorPico);
    par = u32(c.energiaMotorHoy, wo); R[q + 18] = par[0]; R[q + 19] = par[1];
    R[q + 20] = u16(c.vBat * 1000); R[q + 21] = u16(c.vPanel); R[q + 22] = u16(c.iPanel);
    R[q + 23] = u16(c.vBat * 1000); R[q + 24] = s16(c.iBat);
    R[q + 25] = rt[30096];
    R[q + 26] = s16(c.tBat); R[q + 27] = s16(c.tPcb);
    R[q + 28] = u16(c.ah * 1000 * c.soc / 100);
    R[q + 29] = c.calefactor ? 1 : 0;
    R[q + 30] = u16(c.cargador);
    R[q + 31] = 0; R[q + 32] = 0;
    R[q + 33] = u16(c.iMotorPico);
    R[q + 49] = s16(c.modo === MODO.MANUAL ? c.manual * 100 : 0);
  }

  /* bloque compacto de cada HSU: 10 registros desde 30200 (otra disposición que el
     mapa propio de la HSU) y bloque extendido de piranómetros desde 28000 */
  for (j = 0; j < this.hsus.length; j++) {
    var h = this.hsus[j], hb = 30200 + j * 10;
    R[hb + 1] = bits({ nivel: [0, 2], este: [3, 3] },
                     { nivel: h.nivel, este: (h.dir > 45 && h.dir < 135) ? 1 : 0 });
    R[hb + 2] = bits({ ws: [0, 0], ss: [1, 1], nieve: [6, 6], inund: [7, 7],
                       viento: [9, 9], com: [15, 15] },
                     { ws: h.falloVientoSensor ? 1 : 0, ss: h.falloNieveSensor ? 1 : 0,
                       nieve: h.alarmaNieve() ? 1 : 0, viento: h.alarmaViento() ? 1 : 0,
                       com: h.online ? 0 : 1 });
    par = f32(h.viento, wo); R[hb + 3] = par[0]; R[hb + 4] = par[1];
    par = f32(h.dir, wo);    R[hb + 5] = par[0]; R[hb + 6] = par[1];
    par = f32(h.nieve, wo);  R[hb + 7] = par[0]; R[hb + 8] = par[1];
    par = u32(h.ultimoContacto, wo); R[29440 + j * 2] = par[0]; R[29440 + j * 2 + 1] = par[1];
    /* últimas lecturas VÁLIDAS (sin alarma) de nieve y viento: se congelan mientras
       la alarma esté activa, que es como se sabe desde cuándo sopla */
    if (!h.alarmaNieve()) h.ultimaNieveOk = this.t.epoch;
    if (!h.alarmaViento()) h.ultimoVientoOk = this.t.epoch;
    par = u32(h.ultimaNieveOk || this.t.epoch, wo); R[29320 + j * 2] = par[0]; R[29320 + j * 2 + 1] = par[1];
    par = u32(h.ultimoVientoOk || this.t.epoch, wo); R[29380 + j * 2] = par[0]; R[29380 + j * 2 + 1] = par[1];
    var eb = 28000 + j * 100;
    par = f32(h.viento, wo); R[eb + 4] = par[0]; R[eb + 5] = par[1];
    par = f32(h.dir, wo);    R[eb + 6] = par[0]; R[eb + 7] = par[1];
    par = f32(h.nieve, wo);  R[eb + 8] = par[0]; R[eb + 9] = par[1];
    R[eb + 16] = u16(h.vBat);
    par = u32(h.ghi * 100, wo);     R[eb + 21] = par[0]; R[eb + 22] = par[1];
    par = u32(h.poa * 100, wo);     R[eb + 23] = par[0]; R[eb + 24] = par[1];
    par = u32(h.difusa * 100, wo);  R[eb + 25] = par[0]; R[eb + 26] = par[1];
  }
  return R;
};

/* Fecha simulada: el día del año y la hora local del emplazamiento. */
Planta.prototype.fechaSim = function () {
  var md = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31], n = this.t.dia, mi = 0;
  while (mi < 11 && n > md[mi]) { n -= md[mi]; mi++; }
  var h = this.t.hora;
  return { ano: new Date().getFullYear() % 100, mes: mi + 1, dia: n,
           hora: Math.floor(h), min: Math.floor((h % 1) * 60), seg: Math.floor((h * 3600) % 60) };
};



/* ═══════════════════ AVERÍAS POR TASA ═══════════════════
   Pulsar averías una a una contesta «¿qué pasa si se cala este eje?». La pregunta de
   operación es otra: «¿qué aspecto tiene el SCADA en un día malo?». Y eso no se
   monta a mano, porque lo que lo hace difícil de leer es que las cosas pasan a la
   vez, en equipos distintos y sin avisar.

   Se declara con tiempos MEDIOS entre fallos, que es como se habla de esto:

     comsMtbfH    horas de media entre caídas de Zigbee de UN equipo
     comsMin      cuánto dura la caída
     duroMtbfD    días de media hasta que un eje se pone duro
     caladoMtbfD  ídem hasta que se cala
     reparaH      horas hasta que alguien va y lo arregla
     desajusteSig desviación típica del desajuste de montaje del inclinómetro (°),
                  que NO es una avería que aparece: está desde el día uno, y es lo que
                  hace que la flota no publique todos el mismo ángulo

   Todo sale de un Rnd propio con semilla: dos corridas del mismo escenario con las
   mismas tasas dan las mismas averías, en los mismos equipos y a la misma hora. Sin
   eso no serviría para comparar nada. */
Planta.prototype.averiasPaso = function (dt) {
  var A = this.cfg.averias;
  if (!A || !A.activo) return;
  var r = this.rndAv, dtH = dt / 3600;
  /* p = 1 − e^(−dt/MTBF): con dt pequeño es dt/MTBF, pero así no se rompe con pasos
     grandes (a ×1800 un paso son 30 minutos simulados) */
  var p = function (mtbfH) { return mtbfH > 0 ? 1 - Math.exp(-dtH / mtbfH) : 0; };
  var pCom = p(A.comsMtbfH || 0), pDuro = p((A.duroMtbfD || 0) * 24),
      pCal = p((A.caladoMtbfD || 0) * 24), pRep = p(A.reparaH || 0);
  for (var i = 0; i < this.tcus.length; i++) {
    var t = this.tcus[i];
    /* comunicación: cae y vuelve sola pasado su tiempo */
    if (t.online) {
      if (pCom && r.next() < pCom) { t.online = false; t.tCaido = (A.comsMin || 10) * 60; }
    } else if (t.tCaido != null) {
      t.tCaido -= dt;
      if (t.tCaido <= 0) { t.online = true; t.tCaido = null; }
    }
    /* el eje: se estropea solo, y solo se arregla si alguien va */
    if (!t.ejeDuro && !t.ejeAtascado) {
      if (pDuro && r.next() < pDuro) t.ejeDuro = true;
      else if (pCal && r.next() < pCal) t.ejeAtascado = true;
    } else if (pRep && r.next() < pRep) {
      t.ejeDuro = false; t.ejeAtascado = false; t.limpiaAlarmas();
    }
  }
};

/* El desajuste de montaje se reparte al construir la planta, no en marcha: un sensor
   torcido lo está desde que lo atornillaron. Reparto normal centrado en cero — hay
   tantos torcidos a un lado como al otro, y la mayoría casi rectos. */
Planta.prototype.repartaDesajustes = function (sigma) {
  if (!sigma) return;
  var r = new Rnd(4242);
  for (var i = 0; i < this.tcus.length; i++) {
    var g = (r.next() + r.next() + r.next() - 1.5) * 1.63;   /* ~N(0,1) barato */
    this.tcus[i].sensor.desajuste = g * sigma;
  }
};

/* ═══════════════════ ESCRITURA DEL MAPA ═══════════════════
   Hasta aquí el gemelo se mandaba las órdenes por dentro: `limpiaAlarmas()`,
   `force_sp`, tocar `modo`. Un equipo real no tiene esa puerta: TODO entra
   escribiendo registros, y por eso la toolbox puede hacer lo que hace.

   Esto es esa puerta. `escribe(dev, id, dir, valores)` es el único camino, y hace
   lo mismo que haría el firmware:

     1. GUARDA lo escrito y lo publica de vuelta en la lectura. Un registro de
        configuración que no se relee es un registro que no se puede verificar, y
        media puesta en marcha consiste justo en releer lo que acabas de escribir.
     2. APLICA el efecto si lo tiene. Los que solo se guardan se dicen como tales
        (`efecto:false` en el catálogo) en vez de fingir que hacen algo.
     3. RECHAZA lo que el equipo rechazaría: dirección desconocida, registro de solo
        lectura o valor fuera de rango. Un simulador que acepta todo enseña a
        escribir cosas que el equipo real va a rechazar.

   Devuelve {ok, aplicados:[], avisos:[]} — nunca lanza, porque un maestro Modbus
   tampoco recibe excepciones: recibe una excepción Modbus o un eco. */

/* qué sabe hacer de verdad cada registro. El catálogo es público (SIM.ESCRITURA)
   para que la interfaz pueda marcar cuáles tienen efecto y cuáles solo se guardan. */
var ESCRITURA = {
  tcu: {
    40000: { n: 'main_change_request', efecto: true, ay: 'modo: 1 OFF · 2 MANUAL · 3 AUTO · 10+n fuerza SPn' },
    40001: { n: 'input_time_seconds', efecto: true }, 40002: { n: 'input_time_minutes', efecto: true },
    40003: { n: 'input_time_hours', efecto: true },   40004: { n: 'input_date_day', efecto: true },
    40005: { n: 'input_date_month', efecto: true },   40006: { n: 'input_date_year', efecto: true },
    40007: { n: 'extended_control_command', efecto: true, ay: 'bit 13: limpiar alarmas' },
    40008: { n: 'jeita_T1', efecto: true }, 40009: { n: 'jeita_T2', efecto: true },
    40010: { n: 'jeita_T3', efecto: true }, 40011: { n: 'jeita_T4', efecto: true },
    40017: { n: 'manual_control_of_motor', efecto: true, ay: '1 este · 2 oeste · 0 parar' },
    40035: { n: 'heater_activation_temperature_threshold', efecto: true },
    41037: { n: 'maximum_west_tilt_angle', efecto: true, pulsos: true, min: 0, max: 3000 },
    41038: { n: 'maximum_east_tilt_angle', efecto: true, pulsos: true, min: -3000, max: 0 },
    41039: { n: 'motor_velocity_evaluation_time', efecto: true, ms: true, min: 500, max: 60000 },
    41040: { n: 'motor_over_current_software', efecto: true, min: 500, max: 20000 },
    41042: { n: 'nighttime_tilt_angle', efecto: true, f32: true },
    41044: { n: 'safe_position_1_tilt', efecto: true, f32: true, sp: 1 },
    41046: { n: 'safe_position_2_tilt', efecto: true, f32: true, sp: 2 },
    41048: { n: 'safe_position_3_tilt', efecto: true, f32: true, sp: 3 },
    41050: { n: 'safe_position_4_tilt', efecto: true, f32: true, sp: 4 },
    41052: { n: 'safe_position_5_tilt', efecto: true, f32: true, sp: 5 },
    41056: { n: 'safe_position_7_tilt', efecto: true, f32: true, sp: 7 },
    41058: { n: 'inclinometer_offset', efecto: true, f32: true, ay: 'compensa el desajuste de montaje (ensayo D.1.1)' },
    41060: { n: 'deadband_west', efecto: true, min: 1, max: 500 },
    41061: { n: 'deadband_east', efecto: true, min: 1, max: 500 },
    41063: { n: 'deadband_low_capacity', efecto: true, min: 1, max: 999 },
    41065: { n: 'motor_retries', efecto: true, min: 0, max: 20 },
    41067: { n: 'no_load_speed', efecto: true, ms: true }
  },
  ncu: {
    40001: { n: 'force_sp_1', efecto: true, sp: 1 }, 40002: { n: 'force_sp_2', efecto: true, sp: 2 },
    40003: { n: 'force_sp_3', efecto: true, sp: 3 }, 40004: { n: 'force_sp_4', efecto: true, sp: 4 },
    40005: { n: 'force_sp_5', efecto: true, sp: 5 }, 40006: { n: 'force_sp_6', efecto: true, sp: 6 },
    40007: { n: 'force_sp_7', efecto: true, sp: 7 },
    40070: { n: 'auto_mode', efecto: true, ay: 'un bit por grupo: pasa a AUTO' },
    40071: { n: 'manual_mode', efecto: true, ay: 'un bit por grupo: pasa a MANUAL' }
  },
  hsu: {
    40010: { n: 'wind_level_1_threshold', efecto: true },
    40011: { n: 'wind_level_2_threshold', efecto: true },
    40012: { n: 'wind_level_3_threshold', efecto: true }
  }
};

/* qué grupos enciende un mapa de bits, para poder decirlo en claro */
function gruposDe(v) {
  var out = [];
  for (var g = 1; g <= 10; g++) if ((v >> (g - 1)) & 1) out.push(g);
  return out;
}

/* lee 1 o 2 registros como el tipo que toque */
function valDe(vals, def) {
  if (def.f32) {
    var b = new ArrayBuffer(4), dv = new DataView(b);
    dv.setUint16(0, vals[0] & 0xFFFF, false); dv.setUint16(2, (vals[1] || 0) & 0xFFFF, false);
    return dv.getFloat32(0, false);
  }
  var v = vals[0] & 0xFFFF;
  return v > 32767 && def.min != null && def.min < 0 ? v - 65536 : v;
}

Planta.prototype.escribe = function (dev, id, dir, vals) {
  vals = (vals == null) ? [0] : (Array.isArray(vals) ? vals : [vals]);
  var out = { ok: false, aplicados: [], avisos: [] };
  var cat = ESCRITURA[dev];
  if (!cat) { out.avisos.push('dispositivo desconocido: ' + dev); return out; }
  var def = cat[dir];
  if (!def) {
    /* como el equipo: lo que no es escribible se rechaza, no se traga en silencio */
    out.avisos.push(dir + ' no es un registro escribible de la ' + dev.toUpperCase());
    return out;
  }
  var v = valDe(vals, def);
  if (def.min != null && v < def.min) { out.avisos.push(dir + ': ' + v + ' por debajo del mínimo (' + def.min + ')'); return out; }
  if (def.max != null && v > def.max) { out.avisos.push(dir + ': ' + v + ' por encima del máximo (' + def.max + ')'); return out; }

  if (dev === 'ncu') return this._escribeNcu(dir, def, v, out);
  if (dev === 'hsu') {
    var h = this.hsus[(id | 0) - 1] || this.hsus[0];
    if (!h) { out.avisos.push('no hay HSU ' + id); return out; }
    h.escrito = h.escrito || {}; h.escrito[dir] = vals.slice();
    if (dir >= 40010 && dir <= 40012) { h.umbral = h.umbral || {}; h.umbral[dir - 40009] = v / 3.6; }
    out.ok = true; out.aplicados.push(def.n + ' = ' + v);
    return out;
  }

  var t = this.tcu(id | 0);
  if (!t) { out.avisos.push('no hay TCU ' + id); return out; }
  t.escrito = t.escrito || {};
  t.escrito[dir] = vals.slice();                 /* se relee tal cual se escribió */
  var C = t.cfgTcu, R2 = 180 / Math.PI, ok = true;

  if (dir === 40000) {
    if (v === 1) t.modo = MODO.OFF;
    else if (v === 2) t.modo = MODO.MANUAL;
    else if (v === 3) t.modo = MODO.AUTO;
    else if (v >= 11 && v <= 17) t.forzadoLocal = v - 10;
    else if (v === 10) t.forzadoLocal = 0;
    else ok = false;
  } else if (dir >= 40001 && dir <= 40006) {
    t.reloj = t.reloj || {};
    t.reloj[{ 40001: 'seg', 40002: 'min', 40003: 'hora', 40004: 'dia', 40005: 'mes', 40006: 'anio' }[dir]] = v;
  } else if (dir === 40007) {
    if ((v >> 13) & 1) t.limpiaAlarmas();
  } else if (dir >= 40008 && dir <= 40011) {
    C.jeita[dir - 40008] = v / 10;               /* décimas de °C, como el resto del mapa */
  } else if (dir === 40017) {
    t.jog = (v === 1) ? -1 : (v === 2 ? 1 : 0);  /* 1 este (θ negativo) · 2 oeste */
  } else if (dir === 40035) { C.heaterT = v / 10;
  } else if (dir === 41037) { C.topeOeste = v / t.sensor.pulsosGrado;
  } else if (dir === 41038) { C.topeEste = v / t.sensor.pulsosGrado;
  } else if (dir === 41039) { C.evalMotorS = v / 1000;
  } else if (dir === 41040) { C.iMotorMax = v;
  } else if (dir === 41042) { C.nightPos = v * R2;
  } else if (def.sp) { C.spTilt[def.sp] = v * R2;
  } else if (dir === 41058) { t.sensor.offsetCfg = v * R2;
  } else if (dir === 41060 || dir === 41061) { C.dbPulsos = v;
  } else if (dir === 41063) { C.dbPulsosBaja = v;
  } else if (dir === 41065) { C.reintentos = v;
  } else if (dir === 41067) { C.velSinCarga = v / 1000;
  } else ok = false;

  out.ok = ok;
  if (ok) out.aplicados.push(def.n + ' = ' + (def.f32 ? v.toFixed(4) : v));
  else out.avisos.push(def.n + ': valor ' + v + ' no reconocido');
  return out;
};

Planta.prototype._escribeNcu = function (dir, def, v, out) {
  var n = this.ncu;
  n.escrito = n.escrito || {}; n.escrito[dir] = v;
  if (def.sp) {
    /* El registro ES un mapa de bits por grupo, tal cual lo define el R7, y la NCU ya
       lo guarda así. Se escribe entero de una vez —incluidos los ceros— porque
       escribir 0 es como se SUELTA un forzado, y eso también tiene que funcionar. */
    n.forzados[def.sp] = v & 0x3FF;
    out.ok = true;
    out.aplicados.push(def.n + ' = 0x' + v.toString(16) + ' (grupos ' +
      (v ? gruposDe(v).join(',') : '—') + ')');
    return out;
  }
  if (dir === 40070 || dir === 40071) {
    var modo = (dir === 40070) ? MODO.AUTO : MODO.MANUAL;
    var tocadas = 0;
    for (var i = 0; i < this.tcus.length; i++) {
      var t = this.tcus[i];
      if ((v >> (t.grupo - 1)) & 1) { t.modo = modo; tocadas++; }
    }
    out.ok = true; out.aplicados.push(def.n + ': ' + tocadas + ' equipos a ' + MODO_TXT[modo]);
    return out;
  }
  out.avisos.push(def.n + ': sin efecto modelado');
  return out;
};

/* ═══════════════════ exportación ═══════════════════ */
var API = {
  Planta: Planta, TCU: TCU, HSU: HSU, NCU: NCU, Meteo: Meteo,
  PERFILES: PERFILES, perfilDe: perfilDe, TIPO_REG: TIPO_REG, FISICA: F,
  Abanderamiento: Abanderamiento, Difusa: Difusa, Cielo: Cielo,
  ESCRITURA: ESCRITURA,
  K: K, K_CANON: K_CANON, ajusta: ajusta, restauraCanon: restauraCanon, tocados: tocados,
  PARAMS: PARAMS,
  MODO: MODO, MODO_TXT: MODO_TXT, SP: SP, SP_TXT: SP_TXT,
  CRIT: CRIT, CRIT_TXT: CRIT_TXT, FUENTE_SP: FUENTE_SP, FUENTE_TXT: FUENTE_TXT,
  CHARGER_TXT: CHARGER_TXT,
  posicionSolar: posicionSolar, angulos: angulos, cosAOI: cosAOI,
  cRateSafeLFP: cRateSafeLFP, hotDerate: hotDerate, heaterW: heaterW, poaAt: poaAt,
  u16: u16, s16: s16, u32: u32, f32: f32, kx10: kx10, bits: bits
};
if (typeof window !== 'undefined') window.SIM = API;
if (typeof module !== 'undefined') module.exports = API;
})(this);
