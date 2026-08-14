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

/* ═══════════════════ constantes canónicas ═══════════════════ */
var K = {
  AXIS_MAX: 55,                 /* tope mecánico ±55° */
  GCR: 2.382 / 6.0,             /* cuerda/pitch de la 1V bífila (0,397) */
  NIGHT_POS: -5,                /* posición nocturna */
  SLEW_DPS: 0.17,               /* velocidad real de giro (°/s) */
  HYST_DEG: 2.5,                /* deadband del lazo (estudio SUNNER) */
  WIND_T1: 11.111,              /* 40 km/h → abanderamiento parcial */
  WIND_T2: 16.667,              /* 60 km/h → abanderamiento total */
  PARTIAL_STOW: 30,             /* ° mínimos del abanderamiento parcial */
  DESTOW_MIN: 30,               /* min de histéresis para desabanderar */
  SNOW_ALARM_M: 0.03,           /* 3 cm de nieve → alarma de nieve */
  BAT_AH: 6, BAT_MAH: 6000,     /* batería 6 Ah */
  PV_PEAK: 60,                  /* panel auxiliar 60 Wp */
  P_CHG_MAX: 54,                /* tope del regulador (W) */
  V_MIN: 24.0, V_MAX: 27.2,     /* 8S LiFePO4 (V) */
  V_ABS: 27.0,                  /* tensión de absorción */
  P_ELEC: 0.64,                 /* consumo de electrónica medido (W) */
  MOT_A: 0.0503, MOT_B: 0.000845, /* motor: Wh/° = a + b·|θ| */
  JEITA_T3: 35, JEITA_T4: 45,   /* lado caliente: reduce a 35 °C, bloquea a 45 */
  T_CHG_MIN: 0,                 /* bajo 0 °C no se carga (salvo versión calefactada) */
  SOC_L1: 50, SOC_L2: 35, SOC_L3: 25,  /* umbrales de batería (configurables, 41081) */
  SOC_REARME: 5,                /* histéresis de salida de los modos de batería (%) */
  V_NOM: 25.6                   /* tensión nominal del bus (8S LiFePO4) */
};

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
     · AC — alimentado de alterna (TCU tipo AC del registro 30000). La batería
       queda como respaldo: flota al 100 % y solo trabaja si se corta la alterna,
       que es justo el ensayo que interesa poder provocar.

   El tipo va en el mapa: 30000 bits 3:0 «TCU type (BAT/AC/Unknown)» y, en el
   bloque completo de la NCU, «Power supply voltage (in the self-powered TCU, it
   is the dedicated solar panel voltage)» — el mismo registro sirve a los tres. */
var PERFILES = [
  { id: 'SP_45W_3Ah',        n: 'SP · panel 45 W · 3 Ah (76,8 Wh)',      tipo: 'sp',     wh: 76.8,  chgW: 45 },
  { id: 'SP_45W_6Ah',        n: 'SP · panel 45 W · 6 Ah (153,6 Wh)',     tipo: 'sp',     wh: 153.6, chgW: 45 },
  { id: 'SP_60W_6Ah',        n: 'SP · panel 60 W · 6 Ah (153,6 Wh)',     tipo: 'sp',     wh: 153.6, chgW: 60 },
  { id: 'SP_45W_6Ah_LT',     n: 'SP · 45 W · 6 Ah · LT calefactada',     tipo: 'sp',     wh: 153.6, chgW: 45, heated: true },
  { id: 'STRING_60W_3Ah',    n: 'STRING · regulador 60 W · 3 Ah',        tipo: 'string', wh: 76.8,  chgW: 60 },
  { id: 'STRING_60W_6Ah',    n: 'STRING · regulador 60 W · 6 Ah',        tipo: 'string', wh: 153.6, chgW: 60 },
  { id: 'STRING_60W_6Ah_LT', n: 'STRING · 60 W · 6 Ah · LT calefactada', tipo: 'string', wh: 153.6, chgW: 60, heated: true },
  { id: 'AC_6Ah',            n: 'AC · alterna + batería de respaldo',    tipo: 'ac',     wh: 153.6, chgW: 60 },
  { id: 'AC_SIN_BAT',        n: 'AC · sin batería',                      tipo: 'ac',     wh: 0,     chgW: 60 }
];
function perfilDe(id) {
  for (var i = 0; i < PERFILES.length; i++) if (PERFILES[i].id === id) return PERFILES[i];
  return PERFILES[2];                           /* SP 60 W · 6 Ah, el del gemelo */
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
             NOCHE: 5, BATERIA: 6, INHIBIDO: 7 };
var CRIT_TXT = ['Seguimiento', 'Backtracking', 'Manual', 'Posición de seguridad',
                'Límite de tilt', 'Noche', 'Restricción de batería', 'Motor inhibido'];
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
  if (P.el <= 0.0001) return { sol: P, dia: false, real: 0, bt: 0, sel: K.NIGHT_POS, btActivo: false };
  var sx = Math.cos(P.el) * Math.sin(P.az), sz = Math.sin(P.el);
  var tt = Math.atan2(sx, sz);
  var temp = Math.min(1, (1 / K.GCR) * Math.cos(tt));
  var bt = tt - signo(tt) * Math.acos(temp);
  var ttD = clamp(tt * R2D, -K.AXIS_MAX, K.AXIS_MAX), btD = clamp(bt * R2D, -K.AXIS_MAX, K.AXIS_MAX);
  return { sol: P, dia: true, real: ttD, bt: btD, sel: btD, btActivo: Math.abs(btD) < Math.abs(ttD) - 1e-3 };
}
/* Coseno del ángulo de incidencia con el ángulo REAL del seguidor: si está
   abanderado o parado, la captación cae — que es justo lo que interesa medir. */
function cosAOI(P, tiltDeg) {
  if (P.el <= 0) return 0;
  var sx = Math.cos(P.el) * Math.sin(P.az), sz = Math.max(0, Math.sin(P.el)), r = tiltDeg * D2R;
  return Math.max(0, sx * Math.sin(r) + sz * Math.cos(r));
}

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
  this.ah = this.perfil.wh / K.V_NOM;      /* 3 Ah o 6 Ah según el perfil; 0 si no lleva batería */
  this.acOk = true;

  /* un repetidor nace plano y ahí se queda: no tiene seguidor ni motor que mover */
  this.angulo = this.repetidor ? 0 : K.NIGHT_POS;
  this.objetivo = this.angulo;
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

  /* nace hablando: si el último contacto arrancara en 0, el SCADA vería una planta
     entera con 56 años de antigüedad de comunicaciones */
  this.online = true; this.ultimoContacto = planta.t.epoch;
  this.ejeBloqueado = false; this.sobrecorriente = false; this.setaLocal = false;
  this.fueraRango = false; this.limiteOeste = false; this.limiteEste = false;
  this.velocidadBaja = false; this.relajacion = false;

  this.stow = 0; this.stowHold = 0;        /* 0 · 1 parcial · 2 total, y su histéresis (s) */
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
    seta: n.seta || this.setaLocal,
    nivelViento: n.nivelVientoGlobal,
    vientoInvertido: n.vientoInvertido,
    nieve: n.alarmaNieve,
    limpieza: n.limpieza[g - 1],
    forzado: n.forzadoDe(g),               /* 0 o el número de safe position forzada */
    comNcu: this.online
  };
};

/* ---- la jerarquía, en un solo sitio y en orden ---- */
TCU.prototype.decide = function (dt, ang) {
  var e = this.entradas(), cfg = this.p.cfg, obj, sp = SP.NINGUNA,
      fuente = FUENTE_SP.NINGUNA, crit, inhibido = false;

  /* histéresis del abanderamiento: el nivel sube al instante y baja tras DESTOW_MIN */
  var nivel = e.nivelViento;
  if (nivel >= 2) { this.stow = 2; this.stowHold = K.DESTOW_MIN * 60; }
  else if (nivel >= 1) { this.stow = Math.max(this.stow, 1); this.stowHold = K.DESTOW_MIN * 60; }
  else if (this.stowHold > 0) { this.stowHold -= dt; }
  else { this.stow = 0; }

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

  /* signo del abanderamiento: cara al sol (este por la mañana), o invertido si la
     NCU avisa de que el viento sopla del este */
  var sSol = ang.dia ? (ang.sol.az < 0 ? -1 : 1) : 1;
  if (e.vientoInvertido) sSol = -sSol;

  /* 0 — SETA: el motor queda inhibido, el seguidor se queda donde está */
  if (e.seta) {
    obj = this.angulo; crit = CRIT.INHIBIDO; inhibido = true;

  /* 1 — SP1 VIENTO */
  } else if (this.stow > 0 || e.forzado === SP.VIENTO) {
    sp = SP.VIENTO;
    fuente = e.forzado === SP.VIENTO ? FUENTE_SP.NCU : FUENTE_SP.HSU;
    obj = (e.forzado === SP.VIENTO || this.stow === 2)
      ? sSol * Math.abs(cfg.spTilt[1])
      : sSol * Math.max(K.PARTIAL_STOW, Math.abs(ang.sel));
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

  /* 5 — BATERÍA: crítico manda a defensa; muy baja congela el seguimiento */
  } else if (this.bajaCapacidad === 3) {
    obj = signo(this.angulo || 1) * Math.abs(cfg.defensaTilt); crit = CRIT.BATERIA;
    fuente = FUENTE_SP.LOCAL;
  } else if (this.bajaCapacidad === 2) {
    obj = this.angulo; crit = CRIT.BATERIA;

  /* 6 — MANUAL */
  } else if (this.modo === MODO.MANUAL) {
    obj = this.manual; crit = CRIT.MANUAL;

  /* 7 — AUTO (o parado en OFF) */
  } else if (this.modo === MODO.OFF) {
    obj = this.angulo; crit = CRIT.INHIBIDO; inhibido = true;
  } else if (!ang.dia) {
    obj = K.NIGHT_POS; crit = CRIT.NOCHE;
  } else {
    obj = ang.sel; crit = ang.btActivo ? CRIT.BACKTRACKING : CRIT.SEGUIMIENTO;
  }

  /* el repetidor no tiene seguidor que mover: se queda plano y solo repite señal */
  if (this.repetidor) { obj = 0; crit = CRIT.INHIBIDO; inhibido = true; sp = SP.NINGUNA; }

  var top = clamp(obj, -K.AXIS_MAX, K.AXIS_MAX);
  if (top !== obj) crit = CRIT.LIMITE;
  this.objetivo = top; this.sp = sp; this.fuenteSp = fuente; this.criterio = crit;
  this.bt = (crit === CRIT.BACKTRACKING);
  return inhibido;
};

/* ---- motor: velocidad real, deadband y consumo ---- */
TCU.prototype.mueve = function (dt, inhibido) {
  var err = this.objetivo - this.angulo, dead = this.p.cfg.deadband;
  /* con batería baja (L1) el lazo se hace grueso: es el winter mode del estudio
     SUNNER — 3 °/h en vez de 10 °/h, o sea ~3× menos correcciones */
  if (this.bajaCapacidad === 1) dead *= 3.3;
  /* en seguimiento solo corrige si el error supera el deadband; en posición de
     seguridad va sin histéresis (la orden es de seguridad, no de precisión) */
  var urgente = (this.sp !== SP.NINGUNA) || this.criterio === CRIT.BATERIA;
  if (inhibido || this.ejeBloqueado || (!urgente && Math.abs(err) < dead && this.moviendo === 0)) {
    this.moviendo = 0; this.iMotor = 0; this.vMotor = 0;
    this.velocidadBaja = false;
    return 0;
  }
  if (Math.abs(err) <= 0.02) { this.moviendo = 0; this.iMotor = 0; this.vMotor = 0; return 0; }
  var paso = Math.min(Math.abs(err), K.SLEW_DPS * dt), dir = signo(err);
  var antes = this.angulo;
  this.angulo = clamp(this.angulo + dir * paso, -K.AXIS_MAX, K.AXIS_MAX);
  var mov = Math.abs(this.angulo - antes);
  this.moviendo = mov > 1e-9 ? dir : 0;
  /* energía: Wh/° = a + b·|θ| (medida en banco, física canónica de SolarGPT) */
  var wh = (K.MOT_A + K.MOT_B * Math.abs(this.angulo)) * mov;
  var w = dt > 0 ? wh * 3600 / dt : 0;
  this.energiaMotorHoy += wh * 3600; this.energiaMotorTotal += wh * 3600;   /* J */
  this.vMotor = this.vBat * 1000;
  this.iMotor = this.vBat > 1 ? (w / this.vBat) * 1000 : 0;                 /* mA */
  if (this.iMotor > this.iMotorPico) this.iMotorPico = this.iMotor;
  this.velocidadBaja = this.ejeBloqueado;
  this.limiteOeste = this.angulo >= K.AXIS_MAX - 0.01;
  this.limiteEste = this.angulo <= -K.AXIS_MAX + 0.01;
  return w;
};

/* ---- batería LiFePO4: entrada según el tipo de alimentación (SP · STRING · AC),
       cargas, límites JEITA y conteo de culombios ---- */
TCU.prototype.energia = function (dt, ang, wMotor) {
  var m = this.p.meteo, pf = this.perfil;
  this.vBat = K.V_MIN + (this.soc / 100) * (K.V_MAX - K.V_MIN);

  /* temperaturas: siguen a la ambiente con inercia; la PCB, un poco por encima */
  var tAmb = m.tAmb();
  this.tBat += (tAmb - this.tBat) * Math.min(1, dt / 1800);
  this.tPcb += (tAmb + (this.moviendo ? 6 : 2) - this.tPcb) * Math.min(1, dt / 600);

  /* ── ENTRADA, según de qué come este TCU ── */
  var directa = Math.max(0, Math.sin(Math.max(0, ang.sol.el))) * m.transmitancia();
  var aoi = this.repetidor ? directa : cosAOI(ang.sol, this.angulo);
  var pDisp;
  if (pf.tipo === 'ac') {
    /* alterna: potencia de sobra mientras haya red. Si se corta, el TCU pasa a
       vivir de la batería de respaldo — y el que no la lleva, se apaga. */
    this.acOk = !this.p.ncu.acFallo;
    pDisp = this.acOk ? pf.chgW : 0;
    this.vPanel = this.acOk ? 30000 : 0;
  } else if (pf.tipo === 'string') {
    /* del propio string por regulador: con sol satura en su tope; lo único que le
       afecta del seguidor es que abanderado el string produce menos, pero aun así
       sobra para 60 W hasta irradiancias bajas */
    var pStr = K.PV_PEAK * 30 * directa * Math.max(aoi, 0.25);
    if (m.nieve >= 0.02) pStr *= 0.05;
    pDisp = Math.min(pf.chgW, pStr);
    this.vPanel = (pDisp > 1 ? 30 + this.rnd.entre(-1, 1) : 0) * 1000;
  } else {
    /* panel auxiliar propio: ve el ÁNGULO REAL — abanderar o quedarse parado
       también cuesta carga, que es el meollo del estudio de disponibilidad */
    var poa = pf.chgW * directa * aoi;
    if (m.nieve >= 0.02) poa *= 0.05;            /* panel nevado: casi nada entra */
    pDisp = Math.min(poa, pf.chgW);
    this.vPanel = (poa > 1 ? 30 + this.rnd.entre(-1, 1) : 0) * 1000;
  }

  /* cargas: electrónica siempre; motor cuando se mueve; calefactor de la versión
     LT bajo 0 °C (P = 1 + 0,15·|T| W), que además desbloquea la carga */
  this.calefactor = !!pf.heated && this.tBat < 0;
  var pCal = this.calefactor ? 1.0 + 0.15 * Math.abs(this.tBat) : 0;
  var pCarga = K.P_ELEC + wMotor + pCal;

  /* límites de temperatura de carga (JEITA): bloquea en frío y en caliente */
  var tEf = this.calefactor ? Math.max(this.tBat, 1) : this.tBat;
  var derate = 1;
  if (tEf < K.T_CHG_MIN) derate = 0;
  else if (tEf >= K.JEITA_T4) derate = 0;
  else if (tEf > K.JEITA_T3) derate = 1 - 0.7 * (tEf - K.JEITA_T3) / (K.JEITA_T4 - K.JEITA_T3);
  if (this.soc >= 99.5) derate *= 0.05;          /* flotación */
  else if (this.vBat >= K.V_ABS || this.soc > 92) derate *= Math.max(0.05, 1 - (this.soc - 92) / 8 * 0.9);

  var pCargaBat = pDisp * derate - pCarga;
  this.iPanel = this.vBat > 1 ? (pDisp / this.vBat) * 1000 : 0;
  this.iBat = this.vBat > 1 ? (pCargaBat / this.vBat) * 1000 : 0;            /* + carga, − descarga */
  if (this.ah > 0) {
    this.soc = clamp(this.soc + (this.iBat / 1000) * (dt / 3600) / this.ah * 100, 0, 100);
  } else {
    /* sin batería (AC puro): no hay SoC que contar. Con red, el equipo va servido;
       sin red se queda sin alimentación y deja de comunicar. */
    this.soc = this.acOk ? 100 : 0;
    this.iBat = 0;
  }
  this.cargador = (derate === 0 && pDisp > 1) ? 2 : (pDisp > 1 ? 3 : 1);
  this.relajacion = !this.moviendo && Math.abs(this.iBat) < 30;
  if (!ang.dia && this.p.t.hora < 0.02) this.energiaMotorHoy = 0;            /* corte diario */
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
  this.solar = { real: ang.real, bt: ang.bt, zen: ang.sol.zen * R2D, az: ang.sol.az * R2D, dia: ang.dia };
  var inhibido = this.decide(dt, ang);
  var w = this.mueve(dt, inhibido);
  this.energia(dt, ang, w);
  this.fueraRango = Math.abs(this.angulo) > K.AXIS_MAX + 5;
  this.sobrecorriente = this.iMotor > this.p.cfg.iMotorMax;
  if (this.online) this.ultimoContacto = this.p.t.epoch;
};

/* Alarmas y estado, en el mismo criterio que el SCADA y la toolbox:
   eje bloqueado, sobrecorriente, batería crítica, seta o fuera de rango ⇒ ALARMA;
   el resto de bits, system_ok=0 o desviación >5° ⇒ AVISO. */
TCU.prototype.alarmas = function () {
  var e = this.entradas(), conBat = this.ah > 0;
  return {
    seta: e.seta,
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
  if (a.ejeBloqueado || a.sobrecorriente || a.socCritica || a.socL3 || a.seta || a.fueraRango) return 'alarma';
  if (!this.systemOk() || this.desviacion() > 5) return 'aviso';
  return 'ok';
};
TCU.prototype.modoTxt = function () { return MODO_TXT[this.modo]; };
TCU.prototype.estadoTxt = function () {
  if (this.sinAlimentacion) return 'sin alimentación';
  if (!this.online) return 'sin comunicación';
  if (this.sp) return SP_TXT[this.sp];
  return CRIT_TXT[this.criterio];
};

/* ═══════════════════ NCU — controlador de red ═══════════════════ */
function NCU(planta) {
  this.p = planta;
  this.seta = false;                       /* seta de emergencia del armario */
  this.limpieza = [];                      /* 10 interruptores, uno por grupo */
  for (var i = 0; i < 10; i++) this.limpieza.push(false);
  this.forzados = {};                      /* {sp: máscara de 10 bits por grupo} */
  for (var s = 1; s <= 7; s++) this.forzados[s] = 0;
  this.upsFallo = false; this.upsBateriaBaja = false;
  this.acFallo = false;                    /* corte de alterna en planta: solo lo notan los TCU tipo AC */
  this.gw1Alarma = false; this.gw2Alarma = false;
  this.nivelVientoGlobal = 0; this.alarmaViento = false; this.alarmaNieve = false;
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
  var n = 0, av = false, an = false, ar = false, fw = false, fs = false, este = false;
  var H = this.p.hsus;
  for (var i = 0; i < H.length; i++) {
    var h = H[i];
    if (!h.online) { fw = true; fs = true; continue; }
    if (h.nivel > n) n = h.nivel;
    av = av || h.alarmaViento(); an = an || h.alarmaNieve(); ar = ar || h.alarmaRacha();
    fw = fw || h.falloVientoSensor; fs = fs || h.falloNieveSensor;
    /* dirección de viento del ESTE (45°–135°): el R7 lo republica como «inverted wind» */
    if (h.nivel > 0 && h.dir > 45 && h.dir < 135) este = true;
  }
  this.nivelVientoGlobal = n; this.alarmaViento = av; this.alarmaNieve = an;
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
function Planta(cfg) {
  cfg = cfg || {};
  this.cfg = {
    nTcu: cfg.nTcu || 24,
    nHsu: cfg.nHsu || 2,
    nRep: cfg.nRep || 1,
    grupos: cfg.grupos || 4,
    deadband: cfg.deadband != null ? cfg.deadband : K.HYST_DEG,
    iMotorMax: cfg.iMotorMax || 4000,        /* mA de disparo de sobrecorriente */
    perfil: cfg.perfil || 'SP_60W_6Ah',      /* alimentación y batería (SP · STRING · AC) */
    defensaTilt: cfg.defensaTilt != null ? cfg.defensaTilt : 55,
    /* tilt de cada posición de seguridad (registros 41044…41056 de la TCU) */
    spTilt: cfg.spTilt || [0, 55, 0, 55, 0, 0, 0, 0],
    wordOrder: cfg.wordOrder || 'big'
  };
  this.loc = cfg.loc || { n: 'Gorraiz', lat: 42.81, lon: -1.58, tz: 1, dst: true };
  this.t = { dia: cfg.dia || 172, hora: cfg.hora != null ? cfg.hora : 9, epoch: Math.floor(Date.now() / 1000) };
  this.tResto = 0;
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
  /* un paso de arranque: sin él, el estado derivado (sol, objetivo, alarmas) sigue
     en su valor de construcción y la planta recién creada se lee como si fuera de
     noche aunque el reloj marque mediodía */
  this.paso(0.001);
}

/* Un paso de simulación. dt en segundos SIMULADOS (no de reloj de pared): así el
   acelerador de la interfaz no cambia la física, solo cuánto tiempo pasa por tick. */
Planta.prototype.paso = function (dt) {
  this.t.hora += dt / 3600;
  while (this.t.hora >= 24) { this.t.hora -= 24; this.t.dia = (this.t.dia % 365) + 1; }
  /* el epoch avanza en segundos ENTEROS y guarda aparte lo que sobra: las marcas de
     tiempo del mapa son U32 de segundos, y un epoch con decimales hace que dos
     lecturas idénticas salgan distintas al codificarlas */
  this.tResto += dt;
  var ent = Math.floor(this.tResto);
  if (ent) { this.t.epoch += ent; this.tResto -= ent; }
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
  var r = { ok: 0, aviso: 0, alarma: 0, offline: 0, total: 0, socMin: 100, socMedio: 0, moviendo: 0 };
  var T = this.tcus;
  for (var i = 0; i < T.length; i++) {
    var t = T[i]; r.total++; r[t.salud()]++;
    r.socMin = Math.min(r.socMin, t.soc); r.socMedio += t.soc;
    if (t.moviendo) r.moviendo++;
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
  pon(30004, 0);
  pon(30005, bits({ vmot_lo: [0, 0], vmot_hi: [1, 1], bus_lo: [2, 2], bus_hi: [3, 3],
                    pcb_lo: [4, 4], pcb_hi: [5, 5], ic: [8, 8] },
                  { vmot_lo: t.vBat < 22 ? 1 : 0, vmot_hi: t.vBat > 33 ? 1 : 0,
                    bus_lo: t.vBat < 22 ? 1 : 0, bus_hi: t.vBat > 33 ? 1 : 0,
                    pcb_lo: t.tPcb < -30 ? 1 : 0, pcb_hi: t.tPcb > 70 ? 1 : 0 }));
  pon(30006, bits({ oeste: [0, 0], este: [1, 1], socNo: [6, 6], calef: [9, 9],
                    relax: [10, 10], motor: [11, 11], ok: [15, 15] },
                  { oeste: t.limiteOeste ? 1 : 0, este: t.limiteEste ? 1 : 0,
                    socNo: t.bajaCapacidad >= 2 ? 1 : 0, calef: t.calefactor ? 1 : 0,
                    relax: t.relajacion ? 1 : 0, motor: (a.seta || t.ejeBloqueado) ? 1 : 0,
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
  var sp = this.cfg.spTilt;
  for (var k = 1; k <= 7; k++) {
    if (k === 6) continue;                                  /* el mapa salta la 6 */
    pon32(41042 + k * 2, f32((sp[k] || 0) * D2R, wo));       /* 41044, 41046, … en rad */
  }
  pon(41081, u16((K.SOC_L3 << 8) | K.SOC_L2));
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
  var di = { BATTERY_LOW: n.upsBateriaBaja ? 1 : 0, UPS_POWER_FAULT: n.upsFallo ? 1 : 0, seta: n.seta ? 1 : 0 };
  var wDi = (di.BATTERY_LOW << 0) | (di.UPS_POWER_FAULT << 1) | (di.seta << 13);
  for (i = 0; i < 10; i++) if (n.limpieza[i]) wDi |= 1 << (3 + i);
  R[30100] = wDi & 0xFFFF;
  R[30101] = bits({ bat: [0, 0], gw1: [4, 4], gw2: [5, 5] },
                  { bat: n.upsBateriaBaja ? 1 : 0, gw1: n.gw1Alarma ? 1 : 0, gw2: n.gw2Alarma ? 1 : 0 });
  par = u32(this.t.epoch, wo); R[30104] = par[0]; R[30105] = par[1];

  /* forzados y modos por grupo (bloque 40000+, escritura) */
  for (i = 1; i <= 7; i++) R[40000 + i] = n.forzados[i] & 0x3FF;
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
                      motor: (al.seta || c.ejeBloqueado) ? 1 : 0, ok: c.systemOk() ? 1 : 0 });
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

/* ═══════════════════ exportación ═══════════════════ */
var API = {
  Planta: Planta, TCU: TCU, HSU: HSU, NCU: NCU, Meteo: Meteo,
  PERFILES: PERFILES, perfilDe: perfilDe, TIPO_REG: TIPO_REG,
  K: K, MODO: MODO, MODO_TXT: MODO_TXT, SP: SP, SP_TXT: SP_TXT,
  CRIT: CRIT, CRIT_TXT: CRIT_TXT, FUENTE_SP: FUENTE_SP, FUENTE_TXT: FUENTE_TXT,
  CHARGER_TXT: CHARGER_TXT,
  posicionSolar: posicionSolar, angulos: angulos, cosAOI: cosAOI,
  u16: u16, s16: s16, u32: u32, f32: f32, kx10: kx10, bits: bits
};
if (typeof window !== 'undefined') window.SIM = API;
if (typeof module !== 'undefined') module.exports = API;
})(this);
