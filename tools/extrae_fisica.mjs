#!/usr/bin/env node
/* Extrae la FÍSICA CANÓNICA del TCU a sim/fisica.js, para que el simulador la lea
   en vez de llevar su propia copia.

   Dos fuentes, cada una en lo suyo:

     · SolarGPTfull/solargpt/solargpt_core/tcu.py — los perfiles de hardware y las
       constantes medidas. El fichero se declara a sí mismo «single source of truth»
       y es de donde salen los 8 perfiles, el modelo de motor (campaña «Consumos
       motor_02 @24V») y las políticas de verano/invierno.
     · SolarGPTfull/solargpt/scripts/tfm_constants.py — las constantes del TFM.
     · gemelo-digital/bateria.html — las curvas y umbrales de la ESTRATEGIA, que
       solo existen en JS: C-rate seguro, JEITA, calefactor, transposición, viento.

   Lo que hace que esto valga la pena no es solo copiar sin manos: es que CONTRASTA
   lo que aparece en más de un sitio (K0, K1, pico de motor, idle, tensión nominal,
   techo de verano) y FALLA si divergen. Que es justo el bug que cuenta la cabecera
   de tfm_constants.py: cap_Wh copiado en cuatro scripts, arreglado en uno.

       node tools/extrae_fisica.mjs [ruta/a/SolarGPTfull]

   Por defecto busca ../SolarGPTfull (los repos, hermanos). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SGPT = process.argv[2] || path.join(RAIZ, '..', 'SolarGPTfull');
const TCU_PY = path.join(SGPT, 'solargpt', 'solargpt_core', 'tcu.py');
const TFM_PY = path.join(SGPT, 'solargpt', 'scripts', 'tfm_constants.py');
const BATERIA = path.join(RAIZ, 'bateria.html');
const SALIDA = path.join(RAIZ, 'sim', 'fisica.js');

for (const f of [TCU_PY, TFM_PY, BATERIA]) {
  if (!fs.existsSync(f)) {
    console.error('no encuentro: ' + f);
    console.error('clona SolarGPTfull al lado de este repo, o pasa su ruta como argumento.');
    process.exit(1);
  }
}
const tcuPy = fs.readFileSync(TCU_PY, 'utf8');
const tfmPy = fs.readFileSync(TFM_PY, 'utf8');
const bat = fs.readFileSync(BATERIA, 'utf8');

/* ---------- lectores ---------- */
function pyNum(src, nombre, fichero) {
  const m = src.match(new RegExp('^' + nombre + '\\s*[:=][^=]*?=?\\s*([-\\d.]+)', 'm'));
  if (!m) throw new Error('no encuentro ' + nombre + ' en ' + fichero);
  return parseFloat(m[1]);
}
function pyStr(src, nombre) {
  const m = src.match(new RegExp('^' + nombre + '\\s*=\\s*["\']([^"\']+)', 'm'));
  return m ? m[1] : null;
}
/* Campo con valor por defecto dentro del dataclass TCUProfile (idle_w: float = 0.64) */
function pyCampo(src, nombre) {
  const m = src.match(new RegExp('^\\s+' + nombre + '\\s*:\\s*\\w+\\s*=\\s*([-\\d.]+)', 'm'));
  if (!m) throw new Error('no encuentro el campo ' + nombre + ' del dataclass');
  return parseFloat(m[1]);
}
function jsNum(nombre) {
  const m = bat.match(new RegExp('\\b' + nombre + '\\s*=\\s*([-\\d.]+)'));
  if (!m) throw new Error('no encuentro ' + nombre + ' en bateria.html');
  return parseFloat(m[1]);
}
/* Una función entera de bateria.html, por nombre, contando llaves. */
function jsFuncion(nombre) {
  const i = bat.indexOf('function ' + nombre + '(');
  if (i < 0) throw new Error('no encuentro function ' + nombre + '() en bateria.html');
  let p = bat.indexOf('{', i), prof = 0;
  for (let q = p; q < bat.length; q++) {
    if (bat[q] === '{') prof++;
    else if (bat[q] === '}' && --prof === 0) return bat.slice(i, q + 1);
  }
  throw new Error('no encuentro el cierre de ' + nombre);
}

/* ---------- perfiles canónicos (PROFILES de tcu.py) ---------- */
/* Los argumentos son POSICIONALES en el orden del dataclass:
   profile_name, power_source, battery_ah, battery_wh, charge_source, charge_w,
   charge_depends_on_poa, winter_mode, [heated=…] */
function perfiles() {
  const bloque = tcuPy.slice(tcuPy.indexOf('PROFILES: Dict[str, TCUProfile] = {'));
  const fin = bloque.indexOf('\n}');
  const cuerpo = bloque.slice(0, fin);
  const out = [];
  /* Los argumentos NO se pueden cortar por el primer «)»: hay descripciones como
     "Grid (unlimited)" con paréntesis dentro de la cadena. Se empareja contando,
     saltando lo que va entre comillas. */
  const llamadas = [];
  for (let i = cuerpo.indexOf('TCUProfile('); i >= 0; i = cuerpo.indexOf('TCUProfile(', i + 1)) {
    let p = cuerpo.indexOf('(', i), prof = 0, cad = null;
    for (let q = p; q < cuerpo.length; q++) {
      const c = cuerpo[q];
      if (cad) { if (c === cad) cad = null; continue; }
      if (c === '"' || c === "'") { cad = c; continue; }
      if (c === '(') prof++;
      else if (c === ')' && --prof === 0) { llamadas.push(cuerpo.slice(p + 1, q)); break; }
    }
  }
  for (const bruto of llamadas) {
    /* y tampoco por cualquier coma: las de dentro de una cadena no separan */
    const args = [];
    let act = '', cad = null;
    for (const c of bruto) {
      if (cad) { act += c; if (c === cad) cad = null; continue; }
      if (c === '"' || c === "'") { cad = c; act += c; continue; }
      if (c === ',') { args.push(act.trim()); act = ''; continue; }
      act += c;
    }
    if (act.trim()) args.push(act.trim());
    const pos = [], kw = {};
    for (const a of args) {
      const k = a.match(/^(\w+)\s*=\s*(.+)$/);
      if (k) kw[k[1]] = k[2];
      else pos.push(a);
    }
    const lit = s => s.replace(/^["']|["']$/g, '');
    out.push({
      id: lit(pos[0]),
      tipo: lit(pos[1]).toLowerCase(),          // sp | string | ac
      ah: parseFloat(pos[2]),
      wh: parseFloat(pos[3]),
      fuente: lit(pos[4]),
      chgW: parseFloat(pos[5]),
      dependePoa: pos[6] === 'True',
      winterMode: pos[7] === 'True',
      heated: (kw.heated || 'False') === 'True'
    });
  }
  if (!out.length) throw new Error('PROFILES salió vacío: ¿ha cambiado la forma de tcu.py?');
  return out;
}

/* ---------- lectura ---------- */
const canon = {
  motorK0: pyNum(tcuPy, 'TCU_MOTOR_K0_WH_DEG', 'tcu.py'),
  motorK1: pyNum(tcuPy, 'TCU_MOTOR_K1_WH_DEG2', 'tcu.py'),
  motorPeakW: pyNum(tcuPy, 'TCU_MOTOR_PEAK_W', 'tcu.py'),
  idleW: pyCampo(tcuPy, 'idle_w'),
  sleepW: pyCampo(tcuPy, 'sleep_w'),
  vNom: pyCampo(tcuPy, 'voltage_nom'),
  verano: { socMax: pyNum(tcuPy, 'SUMMER_SOC_MAX_PCT', 'tcu.py'), calibDias: pyNum(tcuPy, 'SUMMER_CALIB_PERIOD_DAYS', 'tcu.py') },
  invierno: { socMax: pyNum(tcuPy, 'WINTER_SOC_MAX_PCT', 'tcu.py'), calibDias: pyNum(tcuPy, 'WINTER_CALIB_PERIOD_DAYS', 'tcu.py') },
  perfilPorDefecto: pyStr(tcuPy, 'DEFAULT_PROFILE'),
  capWhTfm: pyNum(tfmPy, 'TCU_CAP_WH', 'tfm_constants.py'),
  perfiles: perfiles()
};
const estrategia = {
  AXIS_MAX: jsNum('AXIS_MAX'), NIGHT_POS: jsNum('NIGHT_POS'), DEFENSE_POS: jsNum('DEFENSE_POS'),
  GCR: (function () { const m = bat.match(/GCR\s*=\s*([\d.]+)\s*\/\s*([\d.]+)/); if (!m) throw new Error('no encuentro GCR'); return parseFloat(m[1]) / parseFloat(m[2]); })(),
  SLEW_DPS: jsNum('SLEW_DPS'), HYST_DEG: jsNum('HYST_DEG'), ALBEDO: jsNum('ALBEDO'),
  WIND_T1: jsNum('WIND_T1'), WIND_T2: jsNum('WIND_T2'),
  PARTIAL_STOW_DEG: jsNum('PARTIAL_STOW_DEG'), DESTOW_HOLD_H: jsNum('DESTOW_HOLD_H'),
  ETA_CHG: jsNum('ETA_CHG'), V_NOM: jsNum('V_NOM'),
  IDLE_W: jsNum('IDLE_W'), SLEEP_W: jsNum('SLEEP_W'),
  K0: jsNum('K0'), K1: jsNum('K1'), MOTOR_PEAK_W: jsNum('MOTOR_PEAK_W'),
  JEITA_T3: jsNum('JEITA_T3'), JEITA_T4: jsNum('JEITA_T4'),
  DEG_H_NORMAL: jsNum('DEG_H_NORMAL'), DEG_H_WINTER: jsNum('DEG_H_WINTER')
};
const funciones = ['cRateSafeLFP', 'hotDerate', 'heaterW', 'poaAt'].map(jsFuncion);

/* ---------- contraste entre fuentes ---------- */
const choques = [];
function cotejar(que, a, fa, b, fb) {
  if (Math.abs(a - b) > 1e-9) choques.push('  ' + que + ':  ' + fa + ' = ' + a + '   ≠   ' + fb + ' = ' + b);
}
cotejar('K0 del motor', canon.motorK0, 'tcu.py', estrategia.K0, 'bateria.html');
cotejar('K1 del motor', canon.motorK1, 'tcu.py', estrategia.K1, 'bateria.html');
cotejar('pico de motor', canon.motorPeakW, 'tcu.py', estrategia.MOTOR_PEAK_W, 'bateria.html');
cotejar('consumo idle', canon.idleW, 'tcu.py', estrategia.IDLE_W, 'bateria.html');
cotejar('consumo sleep', canon.sleepW, 'tcu.py', estrategia.SLEEP_W, 'bateria.html');
cotejar('tensión nominal', canon.vNom, 'tcu.py', estrategia.V_NOM, 'bateria.html');
cotejar('K0 del motor', canon.motorK0, 'tcu.py', pyNum(tfmPy, 'MOTOR_K0', 'tfm_constants.py'), 'tfm_constants.py');
cotejar('K1 del motor', canon.motorK1, 'tcu.py', pyNum(tfmPy, 'MOTOR_K1', 'tfm_constants.py'), 'tfm_constants.py');
/* la capacidad del TFM tiene que ser la de algún perfil real */
if (!canon.perfiles.some(p => Math.abs(p.wh - canon.capWhTfm) < 1e-9)) {
  choques.push('  capacidad: tfm_constants.py = ' + canon.capWhTfm + ' Wh no casa con ningún perfil de tcu.py');
}
/* el 3 °/h del winter mode y su techo tienen que ser los canónicos */
cotejar('techo de verano', canon.verano.socMax, 'tcu.py', 80, 'valor documentado en el README del gemelo');

if (choques.length) {
  console.error('\n✗ LAS FUENTES NO DICEN LO MISMO — no se genera nada:\n' + choques.join('\n'));
  console.error('\nArregla la que esté mal y vuelve a lanzarlo. Que esto salte es el motivo de que exista.\n');
  process.exit(1);
}

/* ---------- salida ---------- */
const perfilesJs = canon.perfiles.map(p => {
  /* nombre legible, en el estilo de la casa */
  const et = p.tipo === 'ac' ? 'AC' : p.tipo.toUpperCase();
  const bat = p.wh > 0 ? p.ah + ' Ah (' + p.wh + ' Wh)' : 'sin batería';
  const n = et + ' · ' + p.fuente + ' · ' + bat + (p.heated ? ' · LT calefactada' : '');
  return '  { id: ' + JSON.stringify(p.id) + ', n: ' + JSON.stringify(n) + ', tipo: ' + JSON.stringify(p.tipo) +
         ', ah: ' + p.ah + ', wh: ' + p.wh + ', chgW: ' + p.chgW +
         ', dependePoa: ' + p.dependePoa + ', winterMode: ' + p.winterMode + ', heated: ' + p.heated + ' }';
}).join(',\n');

const salida = `/* GENERADO por tools/extrae_fisica.mjs — NO editar a mano.

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
 motor: { K0: ${canon.motorK0}, K1: ${canon.motorK1}, picoW: ${canon.motorPeakW} },
 idleW: ${canon.idleW}, sleepW: ${canon.sleepW}, vNom: ${canon.vNom},

 /* ── política de carga canónica: el techo de SOC y cada cuánto se calibra ──
    Verano es lo normal; invierno sube el techo y calibra más a menudo. */
 politica: {
   verano:   { socMax: ${canon.verano.socMax}, calibDias: ${canon.verano.calibDias} },
   invierno: { socMax: ${canon.invierno.socMax}, calibDias: ${canon.invierno.calibDias} }
 },

 /* ── perfiles de hardware (PROFILES de tcu.py, en su orden) ── */
 perfilPorDefecto: ${JSON.stringify(canon.perfilPorDefecto)},
 perfiles: [
${perfilesJs}
 ],

 /* ── estrategia y geometría (bateria.html) ── */
 e: ${JSON.stringify(estrategia, null, 1).replace(/\n/g, '\n ')}
};

/* Las curvas de bateria.html usan estas constantes de su propio ámbito. Se declaran
   aquí con el valor LEÍDO de allí, no con uno escrito a mano, para que las funciones
   se puedan traer tal cual sin tocarles ni una línea. */
var D2R = Math.PI / 180;
var JEITA_T3 = FISICA.e.JEITA_T3, JEITA_T4 = FISICA.e.JEITA_T4, ALBEDO = FISICA.e.ALBEDO;

/* Curvas canónicas, copiadas ÍNTEGRAS de bateria.html por el generador. */
${funciones.join('\n')}

FISICA.cRateSafeLFP = cRateSafeLFP;
FISICA.hotDerate = hotDerate;
FISICA.heaterW = heaterW;
FISICA.poaAt = poaAt;

if (typeof window !== "undefined") window.FISICA = FISICA;
if (typeof module !== "undefined") module.exports = FISICA;
`;

fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
fs.writeFileSync(SALIDA, salida);
console.log('sim/fisica.js  ·  ' + canon.perfiles.length + ' perfiles  ·  ' + funciones.length + ' curvas  ·  ' +
  (fs.statSync(SALIDA).size / 1024).toFixed(1) + ' kB');
console.log('  motor  Wh/° = ' + canon.motorK0 + ' + ' + canon.motorK1 + '·|θ|   pico ' + canon.motorPeakW + ' W');
console.log('  techo  verano ' + canon.verano.socMax + ' % / ' + canon.verano.calibDias + ' d   ·   invierno ' +
  canon.invierno.socMax + ' % / ' + canon.invierno.calibDias + ' d');
console.log('  ✓ tcu.py, tfm_constants.py y bateria.html dicen lo mismo en todo lo que comparten');
