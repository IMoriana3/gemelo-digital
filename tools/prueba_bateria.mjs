#!/usr/bin/env node
/* BANCO DE NAVEGADOR DE `bateria.html` (GEM-CIELO-02)
   ===================================================
   `tools/prueba_simulador.mjs` abre `simulador.html` y nada abría ésta, así que
   el único fichero del repo que MEZCLA el espejo con código propio no se
   ejecutaba nunca fuera del navegador de un humano. Se nota: al portar Perez
   copié aquí `PEREZ_F`, `airmass`, `e0De` y `perezCielo`, que ya estaban en el
   ámbito global porque la página carga `sim/fisica.js` con <script src>. Los
   PISABA. Coincidían carácter a carácter y por eso no cambiaba nada — hasta que
   alguien tocase uno de los dos.

   Lo que se comprueba:
     1. qué globales del espejo pisa la página, contra una lista DECLARADA con
        su motivo (las que existen para leer parámetros editables en caliente);
     2. que la página abre sin errores y `poaAt` da Perez de verdad.

       node tools/prueba_bateria.mjs
*/
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const RAIZ = path.dirname(new URL('.', import.meta.url).pathname);
const PAG = pathToFileURL(path.join(RAIZ, 'bateria.html')).href;
let fallos = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x ? '  → ' + x : '')); if (!c) fallos++; };

/* ── 1) pisado del ámbito global, con su lista de exenciones y el motivo ──
   `sim/fisica.js` es un script CLÁSICO: todo lo que declara arriba cae al global
   de esta página. Redefinir uno de esos nombres aquí lo PISA, y en JS eso no da
   error: gana el último. Las que están permitidas lo están por una razón, y la
   razón se escribe; lo que no esté en la lista es un pisado por descuido. */
const PERMITIDO = {
  poaAt:        'lee el ALBEDO editable de la página; el cielo lo delega a FISICA.perezCielo',
  cRateSafeLFP: 'curva de admisión, sin contraparte en main (tcu_availability)',
  hotDerate:    'lee JEITA_T3/T4, editables en el panel «Batería»',
  heaterW:      'perfiles LT calefactados propios de esta ficha',
  motorW:       'lee la curva de mA editable en el panel «Motor»',
  consumoTCU:   'compone con los consumos editables de la página',
  etaCharger:   'delega: return FISICA.etaCharger(G)',
  D2R: 'constante trivial', K0: 'constante del motor, careada abajo',
  MOTOR_ANG: 'curva editable', MOTOR_MA: 'curva editable',
  MOTOR_V_MEAS: 'tensión de la campaña de medida', JEITA_T3: 'editable en el panel',
};
{
  const esp = readFileSync(path.join(RAIZ, 'sim/fisica.js'), 'utf8');
  const bat = readFileSync(path.join(RAIZ, 'bateria.html'), 'utf8');
  const decl = (s) => new Set([
    ...[...s.matchAll(/^function\s+(\w+)\s*\(/gm)].map((m) => m[1]),
    ...[...s.matchAll(/^var\s+(\w+)\s*=/gm)].map((m) => m[1]),
  ]);
  const globEspejo = decl(esp);
  const pisadas = [...decl(bat)].filter((n) => globEspejo.has(n));
  const sinMotivo = pisadas.filter((n) => !(n in PERMITIDO));
  ok(sinMotivo.length === 0,
    'los ' + pisadas.length + ' pisados del espejo están todos declarados con su motivo',
    'sin motivo: ' + sinMotivo.join(', '));
  /* Y el zombi de la lista: una exención que ya no corresponde a nada es tan
     mala como un pisado sin declarar, porque hace pasar el guard por costumbre. */
  const zombis = Object.keys(PERMITIDO).filter((n) => !pisadas.includes(n));
  ok(zombis.length === 0, 'y la lista no tiene zombis (' + Object.keys(PERMITIDO).length + ' entradas)',
    'ya no se pisan: ' + zombis.join(', '));
  ok(!/function\s+perezCielo\s*\(|var\s+PEREZ_F\s*=/.test(bat),
    'el cielo de Perez NO se copia aquí (no redefine perezCielo ni PEREZ_F)');
}

/* ── 2) que la página abra y que `poaAt` dé Perez de verdad ── */
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { try { ({ chromium } = await import('playwright-core')); }
  catch { console.error('falta playwright'); process.exit(2); } }
const EXE = process.env.CHROME_BIN || process.env.PLAYWRIGHT_CHROMIUM;
const nav = await chromium.launch({ ...(EXE ? { executablePath: EXE } : {}),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const pg = await nav.newPage({ viewport: { width: 1400, height: 900 } });
const rotos = [];
pg.on('pageerror', (e) => rotos.push(String(e.message)));
await pg.goto(PAG);
await pg.waitForTimeout(800);
ok(rotos.length === 0, 'la página abre sin errores', rotos.slice(0, 3).join(' · '));

const r = await pg.evaluate(() => {
  const D = Math.PI / 180;
  /* ancla de pvlib: zen 55, azN 150, tilt 30 al ESTE, ghi 235.2237, dni 24.0644,
     dhi 221.4209, E0 1367 → poa_global 226.194055 (allsitescomposite1990) */
  const el = (90 - 55) * D, az = (150 - 180) * D;
  const bh = 24.0644 * Math.cos(55 * D);
  return {
    poa: poaAt(-30, el, az, bh, 221.4209, 235.2237),
    delega: typeof FISICA !== 'undefined' && typeof FISICA.perezCielo === 'function',
  };
});
ok(r.delega, '`FISICA.perezCielo` está disponible en la página');

/* Los dos de arriba son de TEXTO, y el texto se puede satisfacer sin que la
   propiedad se cumpla: dos mutantes —volver a llamar al global sin delegar, y
   congelar el ALBEDO a 0,2— los pasaban. Lo que sigue es de COMPORTAMIENTO y
   no se puede engañar así: se toca lo de fuera y se exige que `poaAt` lo note. */
const vivo = await pg.evaluate(() => {
  const D = Math.PI / 180, el = (90 - 55) * D, az = (150 - 180) * D;
  const bh = 24.0644 * Math.cos(55 * D);
  const llama = (...a) => poaAt(-30, el, az, bh, 221.4209, 235.2237, ...a);
  const base = llama();
  /* 1) ¿de verdad pasa por FISICA.perezCielo? Se le pone un tope y tiene que notarse. */
  const real = FISICA.perezCielo;
  FISICA.perezCielo = function () { return 0; };
  const sinCielo = llama();
  FISICA.perezCielo = real;
  /* 2) ¿el ALBEDO de la página es el que manda? Se mueve y tiene que notarse. */
  const alb = ALBEDO;
  // eslint-disable-next-line no-global-assign
  ALBEDO = 0.9;
  const conAlbedoAlto = llama();
  ALBEDO = alb;
  return { base, sinCielo, conAlbedoAlto };
});
ok(Math.abs(vivo.base - vivo.sinCielo) > 1,
  '`poaAt` LLAMA a FISICA.perezCielo (anulándolo baja ' +
  (vivo.base - vivo.sinCielo).toFixed(2) + ' W/m²)',
  'no lo llama: ha vuelto a copiar el cielo');
ok(vivo.conAlbedoAlto > vivo.base + 1,
  'y usa el ALBEDO EDITABLE de la página (0,2 → 0,9 sube ' +
  (vivo.conAlbedoAlto - vivo.base).toFixed(2) + ' W/m²)',
  'el albedo está congelado: el panel «Energía» no hace nada');
ok(Math.abs(r.poa - 226.194055) / 226.194055 < 1e-3,
  '`poaAt` EN EL NAVEGADOR da el ancla de pvlib (' + r.poa.toFixed(4) + ' vs 226.1941)',
  r.poa.toFixed(6));

await nav.close();
console.log('\n' + (fallos ? '✗ ' + fallos + ' fallo(s)' : '✓ bateria.html abre, no pisa nada sin declarar y su poaAt es Perez'));
process.exit(fallos ? 1 : 0);
