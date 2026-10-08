#!/usr/bin/env node
/* UN SOLO SITIO DONDE SE CLONA UN HERMANO (GEM-PUERTA-04)
 * =======================================================
 * `tools/clona_hermano.sh` existe para que la rutina de clonado —y con ella la
 * de CREDENCIALES— esté en un sitio y no en dos. Estaba en dos: el job `arneses`
 * y el job `navegador` llevaban cada uno su copia, y el 2026-10-08, cuando
 * `cobertura-zigbee` pasó a privado, las dos se cayeron con un «exit 128» que no
 * explicaba nada.
 *
 * Un script compartido es una PROMESA; esto es el mecanismo. Lo que exige:
 *
 *   1. ningún paso del workflow clona un hermano por su cuenta (ni `git clone`
 *      ni un `git fetch` contra una URL de github.com): el que quiera un hermano
 *      llama al script;
 *   2. todo paso que llame al script le pasa `HERMANOS_RO`, porque sin el
 *      secreto el clon de un hermano privado no puede funcionar — y pasarlo en
 *      un job y olvidarlo en el otro es exactamente la avería que esto previene;
 *   3. el script no incrusta la credencial en la URL del remoto, que la dejaría
 *      escrita en `.git/config`, y enmascara su forma BASE64: Actions tapa el
 *      valor del secreto en el log, pero no su codificación;
 *   4. y un fallo de clonado SALE CON 1 diciendo la causa probable, en vez de
 *      seguir adelante. En CI la ausencia de un prerrequisito es un fallo, no un
 *      salto.
 *
 *     node tools/prueba_clona_hermano.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const FLUJO = readFileSync(join(RAIZ, '.github/workflows/arneses.yml'), 'utf8');
const SH = readFileSync(join(RAIZ, 'tools/clona_hermano.sh'), 'utf8');

let fallos = 0, hechas = 0;
const ok = (cond, que, det) => {
  hechas++;
  if (!cond) { fallos++; console.log('  ✗ ' + que + (det ? '  → ' + det : '')); }
  else console.log('  ✓ ' + que + (det ? '  · ' + det : ''));
};

/* El workflow en bloques `- name:` para poder hablar de PASOS y no de líneas: lo
   que importa es que el paso que clona sea el que recibe el secreto, y una
   comprobación de fichero entero no distingue un paso de otro. */
const pasos = FLUJO.split(/\n(?=\s*- name:)/).slice(1).map((t) => ({
  nombre: (t.match(/- name:\s*(.*)/) || [, '?'])[1].trim(),
  texto: t,
}));

console.log('\n1 · nadie clona un hermano por su cuenta');
ok(pasos.length > 5, 'el workflow se ha podido partir en pasos',
   `${pasos.length} pasos` + (pasos.length > 5 ? '' : ' — si esto falla, el resto no mide nada'));

/* `git clone`/`git fetch` contra github.com en el workflow = una copia nueva de
   la rutina. Se mira sólo el CUERPO de los pasos, no los comentarios: la
   cabecera de arriba explica el bug y nombra los comandos que prohíbe, y un grep
   a secas se marcaría a sí mismo en rojo. */
const sinComentarios = (t) => t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const clonanAMano = pasos.filter((p) => {
  const c = sinComentarios(p.texto);
  return /git\s+clone/.test(c) ||
         (/git\s+(-c\s+\S+\s+)?fetch/.test(c) && /github\.com/.test(c));
});
ok(clonanAMano.length === 0,
   'ningún paso del workflow clona un hermano a mano',
   clonanAMano.length ? 'lo hacen: ' + clonanAMano.map((p) => `«${p.nombre}»`).join(', ') +
     ' — eso es una segunda copia de la rutina de credenciales'
   : 'todos pasan por tools/clona_hermano.sh');

console.log('\n2 · todo paso que clona recibe el secreto');
const llaman = pasos.filter((p) => /clona_hermano\.sh/.test(sinComentarios(p.texto)));
ok(llaman.length >= 2,
   'hay al menos dos pasos que llaman al script (los jobs arneses y navegador)',
   llaman.map((p) => `«${p.nombre}»`).join(' · '));
for (const p of llaman) {
  ok(/HERMANOS_RO:\s*\$\{\{\s*secrets\.HERMANOS_RO\s*\}\}/.test(p.texto),
     `«${p.nombre}» le pasa HERMANOS_RO`,
     /HERMANOS_RO/.test(p.texto) ? null
       : 'sin el secreto, el clon de un hermano privado no puede funcionar');
  ok(/OWNER:\s*\$\{\{\s*github\.repository_owner\s*\}\}/.test(p.texto),
     `«${p.nombre}» le pasa OWNER`,
     'si no, el script cae a un dueño por defecto y clonaría de otra cuenta');
}

console.log('\n3 · la credencial no se escribe donde se queda');
ok(!/https:\/\/[^"'\s]*\$\{?HERMANOS_RO/.test(SH) && !/@github\.com/.test(SH),
   'el script NO incrusta el token en la URL del remoto',
   'en la URL acabaría en .git/config del clon y en las trazas del remoto');
ok(/extraheader/.test(SH),
   'lo pasa por http.extraheader',
   'y con `git -c`, sin dejarlo en la configuración del clon');
ok(/::add-mask::/.test(SH),
   'y enmascara la forma BASE64 de la credencial',
   'Actions tapa el secreto en el log, pero no su codificación');

console.log('\n4 · un clon que falla no sigue adelante, y DICE por qué');
ok(/exit 1\b/.test(SH), 'el script sale con 1 cuando el clon falla',
   'en CI la ausencia de un prerrequisito es un fallo, no un salto');
ok(/HERMANOS_RO no está puesto/.test(SH) && /PRIVADO/.test(SH),
   'y cuando no hay secreto, el mensaje NOMBRA la causa probable y la cura',
   'un «exit 128» a secas costó una mañana el 2026-10-08');
ok(/HERMANOS_RO SÍ está puesto/.test(SH) && /historia reescrita/.test(SH),
   'y cuando SÍ lo hay, distingue «no alcanza» de «el commit ya no existe»',
   'son dos causas distintas y la segunda se arregla tocando el pin, no el acceso');

/* El commit SALE del pin, siempre. Si algún día se le pudiera pasar una rama por
   argumento, la referencia volvería a moverse sola — que es el blanco móvil que
   el pin existe para quitar, y ya atascó tres PRs en SolarGPTfull. */
ok(/\['repos'\]\[sys\.argv\[2\]\]\['commit'\]/.test(SH) && !/\bref=|--rama|--ref\b/.test(SH),
   'el commit se lee de pines.json y no se puede pasar por argumento',
   'si se pudiera, un día alguien llamaría a esto con «main»');

console.log('');
if (fallos) { console.error(`✗ ${fallos} de ${hechas} comprobaciones`); process.exit(1); }
console.log(`✓ ${hechas} comprobaciones · un solo sitio clona, y recibe el secreto`);
