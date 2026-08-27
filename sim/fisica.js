/* ESPEJO del core Python. Se mantiene A MANO, y un arnés comprueba que no derive.

   La FUENTE DE AUTORIDAD es SolarGPT:
     · solargpt_core/tcu.py         — perfiles de hardware, motor medido
                                      (campaña «Consumos motor_02 @24V»), políticas.
     · solargpt_core/tcu_compare.py — curva del motor, calefactor, balance.
     · solargpt_core/tracker.py     — canónicos de control (slew, banda muerta, stow).

   Hasta B4 este fichero lo GENERABA tools/extrae_fisica.mjs leyendo el Python. Eso
   era transpilación: herramienta propia, frágil, atada a que el extractor supiera
   parsear cada cambio del core — y sobre todo, garantizaba la copia el día que
   corría y ni un minuto más. Ahora el reparto es explícito y comprobable:

       node tools/carea_fisica.mjs

   carea este fichero contra los goldens que genera el core (sim/goldens-fisica.json)
   a 1e-9. Si difieren, se corrige AQUÍ: el Python manda. Si el core cambió a
   propósito, se regeneran los goldens y el cambio se ve en el diff.

   COBERTURA HOY: 4 de las 7 funciones (motorW, heaterW, etaCharger, consumoTCU). Las otras
   tres —cRateSafeLFP, hotDerate, poaAt— esperan a que el core publique su contraparte, y
   el arnés lo imprime en cada ejecución en vez de dejarlo implícito.
*/
var FISICA = {
 /* ── constantes medidas (tcu.py) ── */
 motor: { K0: 0.0503, K1: 0.000845, picoW: 50 },
 idleW: 0.64, sleepW: 0.64, vNom: 25.6,

 /* ── política de carga canónica: el techo de SOC y cada cuánto se calibra ──
    Verano es lo normal; invierno sube el techo y calibra más a menudo. */
 politica: {
   verano:   { socMax: 80, calibDias: 5 },
   invierno: { socMax: 90, calibDias: 3 }
 },

 /* ── perfiles de hardware (PROFILES de tcu.py, en su orden) ── */
 perfilPorDefecto: "SP_45W_6Ah",

 /* política de difusa / overcast (DiffuseConfig de tracker.py) */
 difusa: {
  "ghiMin": 50,
  "flatEnter": 1.02,
  "limitedHold": 1,
  "alphas": [
   0,
   0.25,
   0.5,
   0.75,
   1
  ],
  "switchEnter": 1.02,
  "switchExit": 1,
  "switchConfirmMin": 30,
  "switchDwellMin": 90
 },

 /* qué tiene sentido enseñar de cada variante (regla auditada de tcu.py) */
 visibilidad: {"sp":{"show_panel":true,"show_battery":true,"show_soc":true,"show_calibration":true},"string":{"show_panel":false,"show_battery":true,"show_soc":true,"show_calibration":true},"ac":{"show_panel":false,"show_battery":false,"show_soc":false,"show_calibration":false}},
 perfiles: [
  { id: "SP_45W_3Ah", n: "SP · 45W dedicated panel · 3 Ah (76.8 Wh)", tipo: "sp", ah: 3, wh: 76.8, chgW: 45, dependePoa: true, winterMode: true, heated: false },
  { id: "SP_45W_6Ah", n: "SP · 45W dedicated panel · 6 Ah (153.6 Wh)", tipo: "sp", ah: 6, wh: 153.6, chgW: 45, dependePoa: true, winterMode: true, heated: false },
  { id: "SP_60W_6Ah", n: "SP · 60W dedicated panel · 6 Ah (153.6 Wh)", tipo: "sp", ah: 6, wh: 153.6, chgW: 60, dependePoa: true, winterMode: true, heated: false },
  { id: "STRING_60W_3Ah", n: "STRING · 60W string regulator · 3 Ah (76.8 Wh)", tipo: "string", ah: 3, wh: 76.8, chgW: 60, dependePoa: true, winterMode: true, heated: false },
  { id: "STRING_60W_6Ah", n: "STRING · 60W string regulator · 6 Ah (153.6 Wh)", tipo: "string", ah: 6, wh: 153.6, chgW: 60, dependePoa: true, winterMode: true, heated: false },
  { id: "AC_grid", n: "AC · Grid (unlimited) · sin batería", tipo: "ac", ah: 0, wh: 0, chgW: 0, dependePoa: false, winterMode: false, heated: false },
  { id: "SP_45W_6Ah_LT", n: "SP · 45W dedicated panel + heater · 6 Ah (153.6 Wh) · LT calefactada", tipo: "sp", ah: 6, wh: 153.6, chgW: 45, dependePoa: true, winterMode: true, heated: true },
  { id: "STRING_60W_6Ah_LT", n: "STRING · 60W string + heater · 6 Ah (153.6 Wh) · LT calefactada", tipo: "string", ah: 6, wh: 153.6, chgW: 60, dependePoa: true, winterMode: true, heated: true }
 ],

 /* ── estrategia y geometría (bateria.html) ── */
 e: {
  "AXIS_MAX": 55,
  "NIGHT_POS": -5,
  "DEFENSE_POS": 55,
  "GCR": 0.397,
  "SLEW_DPS": 0.17,
  "HYST_DEG": 1.0,
  "ALBEDO": 0.2,
  "WIND_T1": 11.111,
  "WIND_T2": 16.667,
  "PARTIAL_STOW_DEG": 30,
  "DESTOW_HOLD_H": 0.5,
  "ETA_CHG": 0.9,
  "V_NOM": 25.6,
  "DESTOW_HOLD_MIN": 30,
  "IDLE_W": 0.64,
  "SLEEP_W": 0.64,
  "K0": 0.0503,
  "K1": 0.000845,
  "JEITA_T3": 35,
  "JEITA_T4": 45,
  "DEG_H_NORMAL": 10,
  "DEG_H_WINTER": 3
 }
};

/* Las curvas de bateria.html usan estas constantes de su propio ámbito. Se declaran
   aquí con el valor LEÍDO de allí, no con uno escrito a mano, para que las funciones
   se puedan traer tal cual sin tocarles ni una línea. */
var D2R = Math.PI / 180;
var JEITA_T3 = FISICA.e.JEITA_T3, JEITA_T4 = FISICA.e.JEITA_T4, ALBEDO = FISICA.e.ALBEDO;
var K0 = FISICA.motor.K0, K1 = FISICA.motor.K1;
/* la curva de motor MEDIDA (Consumos motor_02.xlsx, TCU 33), tal cual la trae bateria.html */
var MOTOR_ANG = [0,2.5,7.5,12.5,17.5,22.5,27.5,32.5,37.5,42.5,47.5,52.5,55];
var MOTOR_MA = [1500,1588,1600,1714,1860,1975,2135,2277,2409,2497,2651,2740,2800];
var MOTOR_V_MEAS = 24;
var V_NOM = FISICA.vNom, SLEW_DPS = FISICA.e.SLEW_DPS;
var IDLE_W = FISICA.idleW, SLEEP_W = FISICA.sleepW;

/* Curvas canónicas, copiadas ÍNTEGRAS de bateria.html por el generador. */
function cRateSafeLFP(t){
  if(t>25)return 1.0;
  if(t>10)return 0.5+(t-10)*(0.5/15);
  if(t>0) return 0.2+(t/10)*0.3;
  if(t>-10)return 0.05+(t+10)*(0.15/10);
  return 0.05;
}
function hotDerate(t){if(t>=JEITA_T4)return 0;if(t>JEITA_T3)return 1-0.7*(t-JEITA_T3)/(JEITA_T4-JEITA_T3);return 1;}
function heaterW(t){return t<0?1.0+0.15*Math.abs(t):0;}

/* Rendimiento del regulador de carga en función de la irradiancia del panel,
   η(G) = 0,96·(1 − e^(−G/100)), digitalizada de PS26002_RevA. Espejo de
   solargpt_core.tcu_compare._eta_charger — el arnés la carea. Sin esto la
   caída local de la ficha de batería no puede cargar. */
var ETA_G = [0,50,100,200,350,500,600,750,850,1000,1100,1350];
var ETA_V = ETA_G.map(function(g){ return 0.96*(1-Math.exp(-g/100)); }); ETA_V[0] = 0;
function etaCharger(G){
  var g = Math.abs(G||0); if (g <= 0) return 0;
  if (g >= ETA_G[ETA_G.length-1]) return ETA_V[ETA_V.length-1];
  var i = 0; while (i < ETA_G.length-2 && ETA_G[i+1] < g) i++;
  return ETA_V[i] + (ETA_V[i+1]-ETA_V[i]) * ((g-ETA_G[i])/(ETA_G[i+1]-ETA_G[i]));
}
function poaAt(Rdeg,el,az,bh,dh,gh){
  if(el<=0)return 0;
  var R=Rdeg*D2R, sx=Math.cos(el)*Math.sin(az), sz=Math.sin(el);
  var cosAOI=Math.max(0,sx*Math.sin(R)+sz*Math.cos(R));
  var rb=cosAOI/Math.max(Math.sin(el),0.087);
  var cb=Math.cos(Math.abs(R));
  return Math.max(0,bh)*rb + Math.max(0,dh)*(1+cb)/2 + ALBEDO*Math.max(0,gh)*(1-cb)/2;
}
function motorW(ang){
  var a=Math.min(MOTOR_ANG[MOTOR_ANG.length-1],Math.abs(ang||0)), i=0;
  while(i<MOTOR_ANG.length-2 && MOTOR_ANG[i+1]<a) i++;
  var f=(a-MOTOR_ANG[i])/((MOTOR_ANG[i+1]-MOTOR_ANG[i])||1);
  f=Math.max(0,Math.min(1,f));
  return (MOTOR_MA[i]+(MOTOR_MA[i+1]-MOTOR_MA[i])*f)/1000*MOTOR_V_MEAS;
}
function consumoTCU(o){
  var d=function(v,c){return v!=null?v:c;};
  var k0=d(o.k0,K0), k1=d(o.k1,K1), vNom=d(o.vNom,V_NOM), slew=d(o.slew,SLEW_DPS);
  var idle=d(o.idleW,IDLE_W), sleep=d(o.sleepW,SLEEP_W);
  var motorWh=0;
  if(o.mov>0.01){
    var slewH=o.mov/slew/3600;                              /* tiempo real de giro (h) */
    if(o.motorModel==='curva')      motorWh=motorW(o.pos)*Math.min(slewH,o.dtH);
    else if(o.motorModel==='factiun') motorWh=o.mov*(k0+k1*Math.abs(o.pos));
    else                            motorWh=(o.motorModel/1000)*vNom*Math.min(slewH,o.dtH);
  }
  var baseWh=(o.dia?idle:sleep)*o.dtH;
  var heatWh=0, tEff=o.tAmb;
  if(o.calefactada && o.dia && o.tAmb<0){heatWh=heaterW(o.tAmb)*o.dtH; tEff=Math.max(o.tAmb,1);}
  return {base:baseWh, motor:motorWh, heat:heatWh, total:baseWh+motorWh+heatWh, tEff:tEff};
}

FISICA.cRateSafeLFP = cRateSafeLFP;
FISICA.hotDerate = hotDerate;
FISICA.heaterW = heaterW;
FISICA.etaCharger = etaCharger;
FISICA.poaAt = poaAt;
FISICA.motorW = motorW;
FISICA.consumoTCU = consumoTCU;

if (typeof window !== "undefined") window.FISICA = FISICA;
if (typeof module !== "undefined") module.exports = FISICA;
