#!/usr/bin/env node
/* Extrae el mapa Modbus canónico (NCU R7 · TCU v6 · HSU R23) de la ficha
   cobertura-zigbee/modbus.html y lo deja en sim/modbus-map.js para que el
   simulador de planta lo use TAL CUAL.

   La ficha es la transcripción verificada de los documentos de Sunner
   (tools/test_modbus_map.mjs en cobertura-zigbee la contrasta contra el PDF).
   Copiar el mapa a mano aquí sería una segunda fuente que envejece sola: esto
   lo vuelve a generar en cada cambio.

       node tools/extrae_mapa.mjs [ruta/a/modbus.html]

   Por defecto busca ../cobertura-zigbee/modbus.html (los repos, hermanos). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FICHA = process.argv[2] || path.join(RAIZ, '..', 'cobertura-zigbee', 'modbus.html');
const SALIDA = path.join(RAIZ, 'sim', 'modbus-map.js');

if (!fs.existsSync(FICHA)) {
  console.error('no encuentro la ficha: ' + FICHA);
  console.error('clona cobertura-zigbee al lado de este repo, o pasa la ruta como argumento.');
  process.exit(1);
}

const src = fs.readFileSync(FICHA, 'utf8');

/* Los dos literales que interesan viven en el <script> de la ficha, cada uno en su
   `var X = …;` a nivel de fichero. El corte NO puede ser textual («};» al principio de
   línea): DEV va sangrado y BLOQUES cabe en una sola línea. Se recorta emparejando
   llaves/corchetes y saltando las cadenas —dentro de las descripciones hay de todo—,
   y se evalúa: son datos puros, sin llamadas ni referencias externas. */
function literal(nombre) {
  const i = src.indexOf('var ' + nombre + '=');
  if (i < 0) throw new Error('no aparece «var ' + nombre + '=» en la ficha');
  const ini = src.indexOf('=', i) + 1;
  let p = ini;
  while (' \t\n\r'.includes(src[p])) p++;
  const abre = src[p];
  const cierra = abre === '{' ? '}' : ']';
  if (abre !== '{' && abre !== '[') throw new Error(nombre + ' no empieza por { ni [');
  let prof = 0, cad = null, esc = false, fin = -1;
  for (; p < src.length; p++) {
    const c = src[p];
    if (cad) {                                   // dentro de '…' o "…": solo busco su cierre
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === cad) cad = null;
      continue;
    }
    if (c === '"' || c === "'") { cad = c; continue; }
    if (c === abre) prof++;
    else if (c === cierra && --prof === 0) { fin = p + 1; break; }
  }
  if (fin < 0) throw new Error('no encuentro el cierre de ' + nombre);
  return new Function('return (' + src.slice(ini, fin) + ')')();
}

const DEV = literal('DEV');
const BLOQUES = literal('BLOQUES');

/* Recuento: si un día la ficha cambia de forma, esto se ve en el commit. */
let nReg = 0;
for (const k of Object.keys(DEV)) for (const s of DEV[k].secs || []) nReg += (s.f || []).length;

const cab = `/* GENERADO por tools/extrae_mapa.mjs — NO editar a mano.
   Fuente: cobertura-zigbee/modbus.html (NCU_Modbus_Map_R7 · SUNNER_TCU_ModbusMap_v6 · HSU_Modbus_Map_R23).
   ${Object.keys(DEV).map(k => DEV[k].tab + ': ' + (DEV[k].secs || []).reduce((a, s) => a + (s.f || []).length, 0) + ' direcciones').join(' · ')} · ${nReg} en total.

   Formato de cada registro (el de la ficha, sin tocar):
     [dir/offset, nombre, tipo, unidad, bits{nombre:[lsb,msb]}, escala, enum, descripción,
      acceso, descripción de cada bit, por_defecto, rango]
   Las secciones con base y stride son bloques por unidad: dirección = base + (n-1)*stride + offset. */
`;

fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
fs.writeFileSync(SALIDA,
  cab +
  'var MODBUS_MAP = ' + JSON.stringify(DEV) + ';\n' +
  'var MODBUS_BLOQUES = ' + JSON.stringify(BLOQUES) + ';\n' +
  'if (typeof window !== "undefined") { window.MODBUS_MAP = MODBUS_MAP; window.MODBUS_BLOQUES = MODBUS_BLOQUES; }\n' +
  'if (typeof module !== "undefined") { module.exports = { MODBUS_MAP: MODBUS_MAP, MODBUS_BLOQUES: MODBUS_BLOQUES }; }\n');

console.log('sim/modbus-map.js  ·  ' + nReg + ' registros  ·  ' +
  (fs.statSync(SALIDA).size / 1024).toFixed(0) + ' kB');
for (const k of Object.keys(DEV)) {
  console.log('  ' + DEV[k].tab.padEnd(4) + (DEV[k].secs || []).length + ' secciones');
}
