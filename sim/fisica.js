/* GENERADO por tools/extrae_fisica.mjs — NO editar a mano.

   Física canónica del TCU, leída de sus fuentes en vez de copiada:
     · SolarGPTfull/solargpt/solargpt_core/tcu.py  — perfiles de hardware, motor medido
       (campaña «Consumos motor_02 @24V») y políticas de verano/invierno.
     · SolarGPTfull/solargpt/scripts/tfm_constants.py — constantes del TFM.
     · bateria.html — curvas y umbrales de la estrategia (C-rate, JEITA, calefactor,
       transposición isotrópica, abanderamiento).

   El generador contrasta lo que aparece en más de una fuente y se niega a escribir
   si divergen, así que si este fichero existe es que las tres dicen lo mismo.
   Para regenerarlo:  node tools/extrae_fisica.mjs
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
  "HYST_DEG": 2.5,
  "ALBEDO": 0.2,
  "WIND_T1": 11.111,
  "WIND_T2": 16.667,
  "PARTIAL_STOW_DEG": 30,
  "DESTOW_HOLD_H": 1,
  "ETA_CHG": 0.9,
  "V_NOM": 25.6,
  "IDLE_W": 0.64,
  "SLEEP_W": 0.64,
  "K0": 0.0503,
  "K1": 0.000845,
  "MOTOR_PEAK_W": 50,
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
function poaAt(Rdeg,el,az,bh,dh,gh){
  if(el<=0)return 0;
  var R=Rdeg*D2R, sx=Math.cos(el)*Math.sin(az), sz=Math.sin(el);
  var cosAOI=Math.max(0,sx*Math.sin(R)+sz*Math.cos(R));
  var rb=cosAOI/Math.max(Math.sin(el),0.087);
  var cb=Math.cos(Math.abs(R));
  return Math.max(0,bh)*rb + Math.max(0,dh)*(1+cb)/2 + ALBEDO*Math.max(0,gh)*(1-cb)/2;
}

FISICA.cRateSafeLFP = cRateSafeLFP;
FISICA.hotDerate = hotDerate;
FISICA.heaterW = heaterW;
FISICA.poaAt = poaAt;

if (typeof window !== "undefined") window.FISICA = FISICA;
if (typeof module !== "undefined") module.exports = FISICA;
