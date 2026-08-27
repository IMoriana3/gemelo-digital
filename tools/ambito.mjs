/* ¿QUÉ MÓDULOS COMPARTEN EL ÁMBITO GLOBAL DE UNA PÁGINA? (GEM-AMBITO-01)
   =====================================================================
   Las páginas del gemelo cargan sus módulos con <script src>, o sea como
   scripts CLÁSICOS. Un módulo ENVUELTO en IIFE no saca nada fuera salvo lo que
   cuelga a mano de `window`; uno DESNUDO derrama todas sus declaraciones de
   nivel superior al ámbito de la página, y ahí cualquiera puede pisarlas sin
   que JS diga una palabra.

   Pasó: al portar Perez copié `PEREZ_F`, `airmass`, `e0De` y `perezCielo` en
   `bateria.html`, que ya los recibía de `sim/fisica.js` —el único módulo de
   física escrito a mano sin envolver—. Los pisaba. Coincidían carácter a
   carácter, así que no cambió ningún número, y el guard que había sólo miraba
   duplicados DENTRO de un fichero.

   ESTE MÓDULO NO BUSCA COLISIONES. Lo intenté y no se puede hacer por texto:
   las declaraciones de dentro de un IIFE van a columna 0 igual que las de
   fuera, así que un detector de nombres repetidos da ocho falsos positivos en
   `simulador.html` —los re-enlaces `var X = F.X` de planta.js— y no distingue
   ámbitos. Lo que SÍ es decidible por texto es si un módulo va envuelto, y eso
   es la causa, no el síntoma. Quien quiera comprobar el efecto tiene que
   cargar la página en un navegador y mirar `window`, y eso lo hace
   `prueba_bateria.mjs`.
*/
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Los <script src> locales de una página, en orden de carga. */
export function scriptsDe(paginaPath) {
  const html = readFileSync(paginaPath, 'utf8');
  const dir = path.dirname(paginaPath);
  return [...html.matchAll(/<script\s+src="([^"]+)"/g)]
    .map((m) => m[1].split('?')[0])
    .filter((s) => !/^https?:/.test(s) && !/\blib\//.test(s))
    .map((s) => path.join(dir, s));
}

/** ¿va envuelto? Se mira la cola, que es donde cierra el IIFE en este repo. */
export function envuelto(fichero) {
  let src;
  try { src = readFileSync(fichero, 'utf8'); } catch { return null; }
  return /\}\)\s*\(\s*(this|window|globalThis)?\s*\)\s*;?\s*$/.test(src.trimEnd());
}

/** Los módulos de una página que NO van envueltos. */
export function desnudos(paginaPath) {
  return scriptsDe(paginaPath)
    .filter((f) => envuelto(f) === false)
    .map((f) => path.basename(f));
}
